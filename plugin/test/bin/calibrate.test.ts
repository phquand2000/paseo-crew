import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tempDir } from "../../server/core/testing.ts";
import { keepAssessment } from "../../server/runtime/watch/assessments.ts";

const HOME = tempDir("sw2-calibrate-home-");
process.env.HOME = HOME;
const { calibrate } = await import("../../bin/calibrate.ts");

test("marks on incidents, whether still in the book or only in the event log, are read against the answers kept for them", async () => {
  const state = tempDir("sw2-calibrate-");
  const base = Date.parse("2026-09-01T00:00:00Z");
  const items: Record<string, unknown> = {};
  const acks: string[] = [];
  for (let index = 0; index < 24; index++) {
    const seat = `peer-${Math.floor(index / 2)}`;
    const at = base + Math.floor(index / 2) * 3_600_000 + (index % 2) * 30_000;
    const useful = index % 2 === 0;
    const kind = index < 12 ? "needs_human" : "unsafe_action";
    const answers = { needs_human: useful ? 0.95 : 0.85, unsafe_action: 0.9 };
    await keepAssessment(state, { at, askedAt: at, seat, provider: "sw2-peer-claude", turnId: `t${index}`, running: true, sensor: "jev", model: "typesafe/jev-1.13-20260917", id: null, cost: null, questions: {}, answers, facts: [], found: [kind], state: { recent: [useful ? "useful" : "noise"] } });
    const incident = { id: `I${index + 1}`, seat, where: seat, kind, level: "attend", quote: "q", facts: [], opened: at, last: at + 1000, count: 1, open: false, label: useful ? "useful" : "noise" };
    if (kind === "needs_human") items[incident.id] = incident;
    else acks.push(JSON.stringify({ at: new Date(at).toISOString(), kind: "incident.ack", id: incident.id, verdict: incident.label, seat, finding: kind, opened: incident.opened, last: incident.last }));
  }
  items.I25 = { id: "I25", seat: "peer-0", where: "x", kind: "stuck", level: "attend", quote: "q", facts: ["stuck"], opened: base, last: base, count: 1, open: false, label: "useful" };
  items.I26 = { id: "I26", seat: "peer-1", where: "x", kind: "stuck", level: "attend", quote: "q", facts: ["stuck"], opened: base, last: base, count: 1, open: false, label: "noise" };
  writeFileSync(join(state, "incidents.json"), JSON.stringify({ next: 27, items }));
  writeFileSync(join(state, "events.log"), `${acks.join("\n")}\nnot json\n`);

  const kept = await calibrate({ state });
  assert.match(kept, /^24 assessments over 0\.5 days; answered by typesafe\/jev-1\.13-20260917 \(24\)/);
  assert.match(kept, /needs_human \(alone, attend, fires at or above 0\.80\)\n {2}answered 24 times as kept\n {2}marked: 6 useful, 6 noise\n {2}AUROC as kept: 1\.00/, "a useful incident and the noise that opened thirty seconds after it are each read on their own answers");
  assert.match(kept, /needs_human[\s\S]*?at 0\.80: fires on 24 turns, at most 24 in 24 hours[\s\S]*?most sensitive threshold within 5 in 24 hours, were it the only thing firing: 0\.96/);
  assert.match(kept, /together, with the 0 attend incidents code facts opened: at most 24 in 24 hours at the thresholds set/);
  assert.match(kept, /unsafe_action[^\n]*\n[^\n]*\n {2}marked: 6 useful, 6 noise\n {2}AUROC as kept: 0\.50[\s\S]*?→ make it label-only/);
  assert.match(kept, /stuck: 1 useful, 1 noise \(precision 0\.50\)/);

  mkdirSync(join(HOME, ".local", "share", "seatworks-v2"), { recursive: true });
  writeFileSync(join(HOME, ".local", "share", "seatworks-v2", "settings.json"), JSON.stringify({ sensor: { key: "k" } }));
  const fetcher = async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { state: { recent: string[] }; questions: Record<string, unknown> };
    const p = body.state.recent[0] === "useful" ? 0.9 : 0.1;
    const answers = Object.fromEntries(Object.keys(body.questions).map((name) => [name, { type: "noul", noul: p }]));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ answers, model: "typesafe/jev-1.14-20261001", usage: { cost: 0.00002 } }), text: async () => "" };
  };
  const again = await calibrate({ state, ask: true, fetcher: fetcher as never });
  assert.match(again, /asked again: 24 answered, 0 failed, cost 0\.000480; answered by typesafe\/jev-1\.14-20261001 \(24\)/);
  assert.match(again, /unsafe_action[\s\S]*?AUROC as kept: 0\.50; asked again: 1\.00 \(6 useful, 6 noise answered\)[\s\S]*?→ keep/);

  const refused = async () => ({ ok: false, status: 401, headers: { get: () => null }, json: async () => ({}), text: async () => "no" });
  const failing = await calibrate({ state, ask: true, fetcher: refused as never });
  assert.match(failing, /asked again: 0 answered, 24 failed/);
  assert.match(failing, /needs_human[\s\S]*?asked again: not computed, since 24 assessments could not be asked again\n {2}→ not enough marks answered again to judge/, "a re-ask that failed judges nothing");
});
