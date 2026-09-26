import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decisionsJudge } from "../../server/adapters/decisions.ts";
import type { Question } from "../../server/core/ports.ts";

type Reply = { status: number; body?: unknown; retryAfter?: string; json?: () => Promise<unknown> };

/** An endpoint answering from a queue, and every request it was sent as it went out. */
function endpoint(replies: Reply[]) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetcher = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    const reply = replies.shift() ?? { status: 500 };
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: { get: (name: string) => (name === "retry-after" ? (reply.retryAfter ?? null) : null) },
      json: reply.json ?? (async () => reply.body),
      text: async () => JSON.stringify(reply.body ?? { error: "busy" }),
    };
  };
  return { calls, fetcher: fetcher as never };
}

const spec = { url: "https://decide.example/api", model: "vendor/model-1", body: { provider: { data_collection: "deny" }, model: "not this one" }, timeoutSeconds: 5, retries: 1 };
const gap: Question = { type: "noul", instructions: "Does `summary` say that something was not done?", criteria: { true: "It names one.", false: "It names none." } };
// As the endpoint answers, recorded: a noul beside a choice and a score, and what the request read.
const recorded = JSON.parse(readFileSync(new URL("../fixtures/decisions-response.json", import.meta.url), "utf-8"));

test("a sensor is asked over HTTPS with its key in the header only, its data rules with every request, and what it asks unchanged", async () => {
  const { calls, fetcher } = endpoint([{ status: 200, body: recorded }]);
  const judged = await decisionsJudge(spec, "secret-key-for-tests", fetcher).ask({ summary: "Done." }, { is_bug: gap });
  assert.deepEqual(judged, { answers: { is_bug: { noul: 0.96 } }, model: "typesafe/jev-1.13-20260917", tokens: 476 });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call!.url, "https://decide.example/api");
  assert.equal(call!.method, "POST");
  assert.equal(call!.headers.Authorization, "Bearer secret-key-for-tests");
  assert.deepEqual(call!.body, { provider: { data_collection: "deny" }, model: "vendor/model-1", state: { summary: "Done." }, questions: { is_bug: gap } });
  assert.doesNotMatch(JSON.stringify(call!.body), /secret-key-for-tests/, "the key goes in the header and nowhere else");
});

test("an answer that is not every question's probability is not an answer", async () => {
  const ask = (body: unknown) => decisionsJudge(spec, "k", endpoint([{ status: 200, body }]).fetcher).ask({}, { a: gap, b: gap });
  const answered = (b: unknown) => ({ answers: { a: { type: "noul", noul: 0.4 }, b }, model: "m" });
  await assert.rejects(ask(answered(undefined)), /the answer to b is missing/);
  await assert.rejects(ask(answered({ type: "noul", noul: "0.9" })), /the answer to b is not a probability/);
  await assert.rejects(ask(answered({ type: "noul", noul: 1.2 })), /the answer to b is not a probability/);
  await assert.rejects(ask(answered({ type: "choice", choice: "x", confidence: 1 })), /the answer to b is not a probability/);
  await assert.rejects(ask({ answers: { a: { type: "noul", noul: 0.4 }, b: { type: "noul", noul: 1 } } }), /the response names no model/);
  assert.deepEqual((await ask(answered({ type: "noul", noul: 1 }))).answers, { a: { noul: 0.4 }, b: { noul: 1 } });
});

test("a choice is one of the question's own criteria, with how sure the sensor is of it", async () => {
  const team: Question = { type: "choice", instructions: "Which team owns it?", criteria: { account: "Accounts", frontend: "The web app", payments: "Payments" } };
  assert.deepEqual((await decisionsJudge(spec, "k", endpoint([{ status: 200, body: recorded }]).fetcher).ask({}, { team })).answers, { team: { choice: "payments", confidence: 0.75 } });
  const ask = (answer: unknown) => decisionsJudge(spec, "k", endpoint([{ status: 200, body: { answers: { team: answer }, model: "m" } }]).fetcher).ask({}, { team });
  await assert.rejects(ask({ type: "choice", choice: "legal", confidence: 0.9 }), /the answer to team is not one of its choices/);
  await assert.rejects(ask({ type: "choice", choice: "toString", confidence: 0.9 }), /the answer to team is not one of its choices/);
  await assert.rejects(ask({ type: "choice", choice: "payments", confidence: 2 }), /the answer to team has a confidence outside 0 to 1/);
  assert.deepEqual((await ask({ type: "choice", choice: "payments" })).answers, { team: { choice: "payments", confidence: 0 } }, "a choice that gives no confidence is not sure of itself");
});

test("a busy or failing endpoint is asked again as often as the sensor allows, and a refusal retrying cannot fix is not", async () => {
  const busy = endpoint([{ status: 429, retryAfter: "0.01" }, { status: 200, body: recorded }]);
  assert.deepEqual((await decisionsJudge(spec, "k", busy.fetcher).ask({}, { is_bug: gap })).answers.is_bug, { noul: 0.96 });
  assert.equal(busy.calls.length, 2);

  const down = endpoint([{ status: 503, retryAfter: "0.01" }, { status: 502, retryAfter: "0.01" }, { status: 200, body: recorded }]);
  await assert.rejects(decisionsJudge(spec, "k", down.fetcher).ask({}, { is_bug: gap }), /^Error: 502: /);
  assert.equal(down.calls.length, 2, "one try and the one retry the sensor allows");

  const refused = endpoint([{ status: 401, body: { error: { message: "bad key sk-abcdefghijklmnopqrstuvwxyz" } } }, { status: 200, body: recorded }]);
  await assert.rejects(decisionsJudge(spec, "k", refused.fetcher).ask({}, { is_bug: gap }), (error: Error) => /^401: /.test(error.message) && !error.message.includes("abcdefghijklmnop"));
  assert.equal(refused.calls.length, 1, "a refused key is not tried again");
});

test("a reply that stalls, before or after its headers, is no answer within the sensor's time", async () => {
  const quick = { ...spec, timeoutSeconds: 0.05, retries: 0 };
  const stalled = endpoint([{ status: 200, json: () => new Promise(() => {}) }]);
  await assert.rejects(decisionsJudge(quick, "k", stalled.fetcher).ask({}, { is_bug: gap }), /no answer within 0.05 s/);
  const silent = (() => new Promise(() => {})) as never;
  await assert.rejects(decisionsJudge(quick, "k", silent).ask({}, { is_bug: gap }), /no answer within 0.05 s/);
  const broken = endpoint([{ status: 200, json: async () => JSON.parse("{") }, { status: 200, body: recorded }]);
  await assert.rejects(decisionsJudge(spec, "k", broken.fetcher).ask({}, { is_bug: gap }), /the answer is not JSON/);
  assert.equal(broken.calls.length, 1, "an answer that is not JSON is not asked for again");
});
