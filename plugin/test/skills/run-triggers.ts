// npm run eval:triggers -- --agent "claude -p" [--role peer] [--runs 3] [--jobs 4]
// Not part of npm test: every brief costs model calls.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadKit } from "../../server/catalog/kit.ts";
import { type TriggerCase, loadCases, openedSkills, rightRun, skillCards, triggerPrompt } from "./triggers.ts";

const { values } = parseArgs({
  options: {
    agent: { type: "string" },
    role: { type: "string" },
    runs: { type: "string", default: "3" },
    jobs: { type: "string", default: "4" },
    timeout: { type: "string", default: "180" },
  },
});
if (!values.agent) {
  console.error('Name the agent to ask: --agent "claude -p", "codex exec", "pi -p", ...');
  process.exit(2);
}
const [command, ...args] = values.agent.split(/\s+/).filter(Boolean);
const runs = Number(values.runs);
const timeout = Number(values.timeout) * 1000;

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command!, [...args, prompt], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    const timer = setTimeout(() => child.kill(), timeout);
    child.on("close", () => (clearTimeout(timer), resolve(out)));
    child.on("error", () => (clearTimeout(timer), resolve(out)));
  });
}

type Job = { role: string; test: TriggerCase; prompt: string };
type Outcome = { job: Job; answers: (string[] | undefined)[] };

const kit = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const cases = loadCases();
const jobs: Job[] = [];
for (const [role, list] of Object.entries(cases)) {
  if (values.role && role !== values.role) continue;
  const cards = skillCards(kit, role);
  for (const test of list) jobs.push({ role, test, prompt: triggerPrompt(role, cards, test.brief) });
}

const outcomes: Outcome[] = jobs.map((job) => ({ job, answers: [] }));
const queue = outcomes.flatMap((outcome) => Array.from({ length: runs }, () => outcome));
await Promise.all(
  Array.from({ length: Number(values.jobs) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift())
      next.answers.push(openedSkills(await ask(next.job.prompt)));
  }),
);

let failed = 0;
for (const { job, answers } of outcomes) {
  const right = answers.filter((opened) => opened !== undefined && rightRun(job.test, opened)).length;
  const ok = right / runs >= 0.5;
  if (!ok) failed++;
  const seen = answers.map((opened) => (opened === undefined ? "?" : `[${opened.join(",")}]`)).join(" ");
  const want = job.test.expect.length ? job.test.expect.join("|") : "none";
  console.log(
    `${ok ? "ok  " : "FAIL"} ${job.role.padEnd(10)} ${right}/${runs} want ${want}${job.test.near ? ` not ${job.test.near}` : ""}  got ${seen}\n     ${job.test.brief}`,
  );
}
console.log(`\n${outcomes.length - failed}/${outcomes.length} briefs right in at least half their runs`);
process.exit(failed ? 1 : 0);
