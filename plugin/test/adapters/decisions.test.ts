import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type IncomingHttpHeaders, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type TestContext, test } from "node:test";
import { decisionsJudge } from "../../server/adapters/decisions.ts";
import type { Question } from "../../server/core/ports.ts";

/** How the endpoint answers one request: a status and body, or it stalls before its headers or after them. */
type Reply = { status: number; body?: unknown; raw?: string; retryAfter?: string; stall?: "headers" | "body" };

/** A sensor's endpoint on this machine answering from a queue, and every request it was sent. */
async function endpoint(t: TestContext, replies: Reply[]) {
  const calls: { path: string; method: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
  const server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk: Buffer) => (text += chunk.toString()));
    request.on("end", () => {
      calls.push({
        path: request.url ?? "",
        method: request.method ?? "",
        headers: request.headers,
        body: JSON.parse(text) as Record<string, unknown>,
      });
      const reply = replies.shift() ?? { status: 500 };
      if (reply.stall === "headers") return;
      response.writeHead(reply.status, {
        "content-type": "application/json",
        ...(reply.retryAfter ? { "retry-after": reply.retryAfter } : {}),
      });
      if (reply.stall === "body") return void response.write("{");
      response.end(reply.raw ?? JSON.stringify(reply.body ?? { error: "busy" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  return { calls, spec: { ...base, url } };
}

const base = {
  model: "vendor/model-1",
  body: { provider: { data_collection: "deny" }, model: "not this one" },
  timeoutSeconds: 5,
  retries: 1,
};
const gap: Question = {
  type: "noul",
  instructions: "Does `summary` say that something was not done?",
  criteria: { true: "It names one.", false: "It names none." },
};
const team: Question = {
  type: "choice",
  instructions: "Which team owns it?",
  criteria: { account: "Accounts", frontend: "The web app", payments: "Payments" },
};
// As the endpoint answers, recorded: a noul beside a choice and a score, and what the request read.
const recorded = JSON.parse(
  readFileSync(new URL("../fixtures/decisions-response.json", import.meta.url), "utf-8"),
) as unknown;

test("a sensor is asked over HTTP with its key in the header only, and only an answer to every question as asked is taken", async (t) => {
  const asked = await endpoint(t, [{ status: 200, body: recorded }]);
  const judged = await decisionsJudge(asked.spec, "secret-key-for-tests").ask({ summary: "Done." }, { is_bug: gap });
  assert.deepEqual(judged, { answers: { is_bug: { noul: 0.96 } }, model: "typesafe/jev-1.13-20260917", tokens: 476 });
  assert.equal(asked.calls.length, 1);
  const [call] = asked.calls;
  assert.deepEqual([call!.method, call!.path], ["POST", "/api"]);
  assert.equal(call!.headers.authorization, "Bearer secret-key-for-tests");
  assert.deepEqual(
    call!.body,
    {
      provider: { data_collection: "deny" },
      model: "vendor/model-1",
      state: { summary: "Done." },
      questions: { is_bug: gap },
    },
    "its data rules go with every request, and never replace what it asks",
  );
  assert.doesNotMatch(
    JSON.stringify(call!.body),
    /secret-key-for-tests/,
    "the key goes in the header and nowhere else",
  );

  const answer = async (body: unknown, questions: Record<string, Question>) =>
    decisionsJudge((await endpoint(t, [{ status: 200, body }])).spec, "k").ask({}, questions);
  const both = (b: unknown) => ({ answers: { a: { type: "noul", noul: 0.4 }, b }, model: "m" });
  const nouls = { a: gap, b: gap };
  await assert.rejects(answer(both(undefined), nouls), /the answer to b is missing/);
  await assert.rejects(answer(both({ type: "noul", noul: "0.9" }), nouls), /the answer to b is not a probability/);
  await assert.rejects(answer(both({ type: "noul", noul: 1.2 }), nouls), /the answer to b is not a probability/);
  await assert.rejects(
    answer(both({ type: "choice", choice: "x", confidence: 1 }), nouls),
    /the answer to b is not a probability/,
  );
  await assert.rejects(
    answer({ answers: { a: { type: "noul", noul: 0.4 }, b: { type: "noul", noul: 1 } } }, nouls),
    /the response names no model/,
  );
  assert.deepEqual((await answer(both({ type: "noul", noul: 1 }), nouls)).answers, {
    a: { noul: 0.4 },
    b: { noul: 1 },
  });

  assert.deepEqual((await answer(recorded, { team })).answers, { team: { choice: "payments", confidence: 0.75 } });
  const chosen = (choice: unknown) => ({ answers: { team: choice }, model: "m" });
  await assert.rejects(
    answer(chosen({ type: "choice", choice: "legal", confidence: 0.9 }), { team }),
    /the answer to team is not one of its choices/,
  );
  await assert.rejects(
    answer(chosen({ type: "choice", choice: "toString", confidence: 0.9 }), { team }),
    /the answer to team is not one of its choices/,
  );
  await assert.rejects(
    answer(chosen({ type: "choice", choice: "payments", confidence: 2 }), { team }),
    /the answer to team has a confidence outside 0 to 1/,
  );
  assert.deepEqual(
    (await answer(chosen({ type: "choice", choice: "payments" }), { team })).answers,
    { team: { choice: "payments", confidence: 0 } },
    "a choice that gives no confidence is not sure of itself",
  );
});

test("a busy, refusing or stalled sensor is retried only where retrying helps, within its time", async (t) => {
  const busy = await endpoint(t, [
    { status: 429, retryAfter: "0.01" },
    { status: 200, body: recorded },
  ]);
  assert.deepEqual((await decisionsJudge(busy.spec, "k").ask({}, { is_bug: gap })).answers.is_bug, { noul: 0.96 });
  assert.equal(busy.calls.length, 2, "a busy endpoint is asked again");

  const down = await endpoint(t, [
    { status: 503, retryAfter: "0.01" },
    { status: 502, retryAfter: "0.01" },
    { status: 200, body: recorded },
  ]);
  await assert.rejects(decisionsJudge(down.spec, "k").ask({}, { is_bug: gap }), /^Error: 502: /);
  assert.equal(down.calls.length, 2, "one try and the one retry the sensor allows");

  const refused = await endpoint(t, [
    { status: 401, body: { error: { message: "bad key sk-abcdefghijklmnopqrstuvwxyz" } } },
    { status: 200, body: recorded },
  ]);
  await assert.rejects(
    decisionsJudge(refused.spec, "k").ask({}, { is_bug: gap }),
    (error: Error) => /^401: /.test(error.message) && !error.message.includes("abcdefghijklmnop"),
  );
  assert.equal(refused.calls.length, 1, "a refused key is not tried again");

  for (const stall of ["body", "headers"] as const) {
    const stalled = await endpoint(t, [{ status: 200, stall }]);
    const quick = { ...stalled.spec, timeoutSeconds: 0.05, retries: 0 };
    await assert.rejects(decisionsJudge(quick, "k").ask({}, { is_bug: gap }), /no answer within 0.05 s/, stall);
  }

  const broken = await endpoint(t, [
    { status: 200, raw: "{" },
    { status: 200, body: recorded },
  ]);
  await assert.rejects(decisionsJudge(broken.spec, "k").ask({}, { is_bug: gap }), /the answer is not JSON/);
  assert.equal(broken.calls.length, 1, "an answer that is not JSON is not asked for again");
});
