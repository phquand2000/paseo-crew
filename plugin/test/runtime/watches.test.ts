import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig, saveConfig } from "../../server/desk/project/project.ts";
import { reported } from "../console.ts";
import { settle } from "./fake-timeline.ts";
import { laneWithPeer } from "./harness.ts";
import { hookAgent, noticesOf } from "./noticed.ts";

test("a seat is followed once while it is seated and watched, let go when it goes, and followed again after a failed join or a lost stream", async (t) => {
  const said = reported(t);
  const { h, sup, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const followed = (id: string) => h.timelineOf(id).subscriptions;
  assert.deepEqual([lead, peer, sup].map(followed), [1, 1, 0], "Leads and Peers are watched; a Supervisor is not");
  await h.runtime.created(hookAgent(h, peer));
  const reviewer = h.add("crew-reviewer-claude/claude-opus-5", h.root, "rev");
  await h.tick();
  assert.deepEqual(
    [followed(peer), followed(reviewer)],
    [1, 0],
    "followed once however often it is seen; a Reviewer not",
  );

  const slow = h.add("crew-peer-claude/claude-opus-5", h.root, "slow");
  let open = () => {};
  h.timelineOf(slow).ready = new Promise((resolve) => (open = resolve));
  await h.runtime.created(hookAgent(h, slow));
  await h.runtime.archived(hookAgent(h, slow));
  open();
  await settle();
  assert.equal(h.timelineOf(slow).listeners.size, 0, "a seat archived while it is being joined leaves nothing behind");
  await h.tick();
  assert.equal(followed(slow), 2, "and is followed again if it comes back");

  const broken = h.add("crew-peer-claude/claude-opus-5", h.root, "broken");
  h.timelineOf(broken).refetch = async () => ({ epoch: "e", entries: [], error: "no such agent" });
  await h.tick();
  await settle();
  await h.tick();
  assert.equal(followed(broken), 2, "a join that failed is not held as followed, and is tried again next round");
  assert.match(said(), new RegExp(`${broken} could not be watched`));

  h.agents.get(slow)!.archivedAt = new Date().toISOString();
  await h.tick();
  assert.equal(h.timelineOf(slow).listeners.size, 0, "a seat the round no longer sees is let go");

  h.timelineOf(lead).fail("socket closed");
  await settle();
  await h.tick();
  assert.equal(followed(lead), 2, "a stream Paseo released is followed again the next round");
  assert.match(said(), new RegExp(`${lead} is no longer watched: socket closed`));
});

test("a Peer's turn as the watch reads it, and who hears of it", async (t) => {
  const { h, sup, peer, timeline } = await laneWithPeer({ attention: { watch: true, incidentsPerLane: 2 } });
  await h.call(sup, "supervisor", "set_project", { gate: "npm test", gateOn: "lane" });
  const noticed = noticesOf(h, t);
  const call = (callId: string, name: string, status: string, detail: Record<string, unknown>, error?: unknown) =>
    timeline.add({ type: "tool_call", callId, name, status, detail, ...(error ? { error } : {}) }, "t1");
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Clean the build" }, "t1");
  // A refused hand-back, as a Peer's call to the team server records it.
  const refusal =
    'MCP tool \'done\' returned an error: [\n  {\n    "type": "text",\n    "text": "This task is already merged; there is nothing to hand back."\n  }\n]';
  call("r1", "mcp__team__done", "failed", { type: "plain_text", label: "done", text: refusal }, { message: "failed" });
  call("c1", "Bash", "failed", { type: "shell", command: "cat ./missing.txt", output: "" });
  await settle();
  await noticed();
  assert.deepEqual(
    h.events("watch.fact").map((event) => [event.fact, event.quote]),
    [["call-failed", "Bash: cat ./missing.txt"]],
    "a refusal from the desk reaches no one as a failed call, while a command that failed does",
  );
  assert.deepEqual(h.events("incident.open"), [], "a failed call is a note: evidence, opening no incident");

  call("c2", "Bash", "running", { type: "unknown", input: {}, output: null });
  call("c2", "Bash", "running", { type: "shell", command: "git push --force origin main" });
  await settle();
  await noticed();
  await h.idle(sup);
  const told = h.agents.get(sup)!.sent.join("\n");
  assert.match(told, /INCIDENT I1 \(irreversible, page\) on the engineer on L1-T1 \(Clean build\)/);
  assert.match(told, /What was seen: git push --force origin main/);
  assert.match(told, /not a verdict/);
  assert.ok(!timeline.rows.some((row) => row.item.status === "completed"), "the call it warns about is still running");
  assert.deepEqual(
    h.runtime.outbox.letters().filter((letter) => letter.to === peer),
    [],
    "nothing the watch concluded is even queued for the seat it watches",
  );
  await h.idle(peer);
  const watched = h.agents.get(peer)!;
  assert.deepEqual(
    watched.sent.filter((text) => /INCIDENT|irreversible|--force|incident/i.test(text)),
    [],
    "nor reaches it when its turn ends",
  );
  const pagers = () => [...h.agents.values()].filter((agent) => agent.provider.startsWith("crew-pager-"));
  const [pager] = pagers();
  assert.equal(pagers().length, 1, "a page reaches the Human's phone through a pager of its own");
  assert.match(
    pager!.prompt ?? "",
    /^[^:\n]+: the engineer on L1-T1 \(Clean build\) ran git push --force origin main\.\nIts Supervisor is told; nothing is held yet\.$/,
  );
  assert.ok((pager!.prompt ?? "").length <= 220, "Paseo shows 220 characters of a push");
  assert.equal(pager!.labels["paseo.parent-agent-id"], undefined, "an agent with a parent is never pushed");
  assert.ok(watched.labels["paseo.parent-agent-id"], "while every seat the desk starts under another has one");
  assert.equal(pager!.archivedAt, null, "Paseo pushes its reply as its first turn ends");
  await h.endTurn(pager!.id, pager!.prompt ?? "");
  assert.ok(pager!.archivedAt, "and then the pager goes, rather than piling up idle");

  call("c3", "Bash", "running", { type: "shell", command: "git push --force origin main && rm -rf dist" });
  const edit = {
    type: "edit",
    filePath: "src/a.ts",
    oldString: "const x = f();",
    newString: "// @ts-ignore\nconst x = f();",
  };
  call("c4", "Edit", "completed", edit);
  call("c5", "Bash", "failed", { type: "shell", command: "npm test", output: "1 failing" });
  await settle();
  await noticed();
  h.agents.get(peer)!.status = "running";
  assert.match(
    (await h.call(sup, "supervisor", "status", {})).text,
    new RegExp(
      `- L1-T1 Clean build: running, engineer ${peer} running 0 min into its work, last: Bash: npm test; heard from 0 min ago$`,
      "m",
    ),
    "status shows how long a Peer's turn has run and the last step it took",
  );
  assert.equal(
    pagers().length,
    1,
    "the same incident seen again pages nobody again, and one that is not a page pages nobody",
  );
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "Cleaned" });
  for (const id of ["m1", "m2", "m3"])
    timeline.add({ type: "assistant_message", text: "Let me look at the build again.", messageId: id }, "t1");
  timeline.beat("turn_completed", "t1");
  await settle();
  await noticed();
  const listed = (await h.call(sup, "supervisor", "incidents", {})).text;
  const idOf = (kind: string) => Number(new RegExp(`- I(\\d+) \\[[^\\n]*: ${kind} `).exec(listed)?.[1]);
  assert.ok(idOf("stuck") < idOf("claim-contradicted"), "the loop is ranked above the claim, so it opens first");
  assert.match(listed, /- I\d+ \[attend, told [^\]]*\][^\n]*: stuck /, "and takes the lane's last slot for the day");
  assert.match(listed, /- I\d+ \[attend, not sent: its lane's limit for today is reached\][^\n]*: claim-contradicted /);
});

test("a write the sandbox refused is a note, and the Supervisor's status names where once it repeats, for the Human to grant", async (t) => {
  const { h, sup, timeline } = await laneWithPeer();
  const noticed = noticesOf(h, t);
  const cache = join(homedir(), "Library", "Caches", "go-build");
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Build it" }, "t1");
  const build = (callId: string, output: string) =>
    timeline.add(
      {
        type: "tool_call",
        callId,
        name: "Bash",
        status: "failed",
        detail: { type: "shell", command: `go build ./cmd/${callId}`, output },
      },
      "t1",
    );
  build("b1", `go: creating work dir: mkdir ${cache}/ab/12-d: operation not permitted`);
  build("b2", `open ${cache}/cd/34-d: read-only file system\nopen ${cache}/cd/78-d: read-only file system`);
  build("b3", "ld: undefined symbol _main");
  build("b4", `/bin/sh: ${cache}/ef/56-d: Operation not permitted.`);
  await settle();
  await noticed();
  assert.deepEqual(
    h
      .events("watch.fact")
      .filter((event) => event.fact === "sandbox-denied")
      .map((event) => event.quote),
    [`${cache}/ab/12-d`, `${cache}/cd/34-d`, `${cache}/ef/56-d`],
    "one path for each call refused, the one its first refusal names",
  );
  assert.deepEqual(h.events("incident.open"), [], "a note opens no incident");
  const status = (await h.call(sup, "supervisor", "status", {})).text;
  assert.match(status, new RegExp(`^- ${cache}: refused 3 times$`, "m"));
  assert.match(status, /Only the Human can grant one, in writableOutside/);

  saveConfig(h.project.state, { ...loadConfig(h.project.state), writableOutside: [cache] });
  assert.doesNotMatch(
    (await h.call(sup, "supervisor", "status", {})).text,
    /sandbox refused/,
    "a granted path is not asked for again",
  );
});

test("a socket the sandbox refused is a note apart from writes, and the Supervisor's status names it at once, for the Human to grant", async (t) => {
  const { h, sup, timeline } = await laneWithPeer();
  const noticed = noticesOf(h, t);
  const socket = join(homedir(), ".orbstack", "run", "docker.sock");
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Start the database" }, "t1");
  timeline.add(
    {
      type: "tool_call",
      callId: "d1",
      name: "Bash",
      status: "failed",
      detail: {
        type: "shell",
        command: "docker compose up -d",
        output: `permission denied while trying to connect to the Docker daemon socket at unix://${socket}: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.47/containers/json": dial unix ${socket}: connect: operation not permitted`,
      },
    },
    "t1",
  );
  await settle();
  await noticed();
  const facts = h.events("watch.fact").filter((event) => /denied$/.test(String(event.fact)));
  assert.deepEqual(
    facts.map((event) => [event.fact, event.quote]),
    [["socket-denied", socket]],
    "a refused connection is no write to grant",
  );
  const status = (await h.call(sup, "supervisor", "status", {})).text;
  assert.match(status, new RegExp(`^- ${socket.replaceAll(".", "\\.")}: refused 1 times$`, "m"));
  assert.match(status, /Only the Human can grant one, in sockets of this project's project\.json/);
  assert.doesNotMatch(status, /Writes the sandbox refused/);

  saveConfig(h.project.state, { ...loadConfig(h.project.state), sockets: [socket] });
  assert.doesNotMatch(
    (await h.call(sup, "supervisor", "status", {})).text,
    /Sockets the sandbox refused/,
    "a granted socket is not asked for again",
  );
});
