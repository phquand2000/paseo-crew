import assert from "node:assert/strict";
import { test } from "node:test";
import { settle } from "./fake-timeline.ts";
import { laneWithPeer } from "./harness.ts";

test("a page reaches the Human's phone through a pager of its own, which says it back and answers to nobody", async () => {
  const { h, peer, timeline } = await laneWithPeer();
  const force = (callId: string) => timeline.add({ type: "tool_call", callId, name: "Bash", status: "running", detail: { type: "shell", command: "git push --force origin main" } }, "t1");
  timeline.beat("turn_started", "t1");
  force("c1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const pagers = () => [...h.agents.values()].filter((agent) => agent.provider.startsWith("sw2-pager-"));
  assert.equal(pagers().length, 1);
  const [pager] = pagers();
  assert.match(pager!.prompt ?? "", /^[^:\n]+: the Peer on L1-T1 \(Clean build\) ran git push --force origin main\.\nIts Supervisor is told; nothing is held yet\.$/);
  assert.ok((pager!.prompt ?? "").length <= 220, "Paseo shows 220 characters of a push");
  assert.equal(pager!.labels["paseo.parent-agent-id"], undefined, "an agent with a parent is never pushed");
  assert.ok(h.agents.get(peer)!.labels["paseo.parent-agent-id"], "while every seat the desk starts under another has one");

  force("c2");
  timeline.add({ type: "tool_call", callId: "c3", name: "Edit", status: "completed", detail: { type: "edit", filePath: "src/a.ts", oldString: "const x = f();", newString: "// @ts-ignore\nconst x = f();" } }, "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(pagers().length, 1, "the same incident seen again pages nobody again, and one that is not a page pages nobody");
});
