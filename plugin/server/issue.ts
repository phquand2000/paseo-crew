import { execFile } from "node:child_process";

export type Issue = { number: number; title: string; url: string; body: string };

export function issueArgs(ref: string): string[] | undefined {
  const text = ref.trim();
  const url = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/.exec(text);
  if (url) return ["issue", "view", url[2]!, "-R", url[1]!];
  const full = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(text);
  if (full) return ["issue", "view", full[2]!, "-R", full[1]!];
  const short = /^#?(\d+)$/.exec(text);
  if (short) return ["issue", "view", short[1]!];
  return undefined;
}

export function fetchIssue(ref: string, cwd: string): Promise<Issue | { error: string }> {
  const args = issueArgs(ref);
  if (!args) return Promise.resolve({ error: `"${ref}" is not an issue reference` });
  return new Promise((resolve) => {
    execFile("gh", [...args, "--json", "number,title,url,body"], { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ error: (String(stderr) || error.message).trim().slice(0, 300) });
        return;
      }
      try {
        const value = JSON.parse(String(stdout)) as Issue;
        resolve({ number: value.number, title: value.title, url: value.url, body: value.body ?? "" });
      } catch {
        resolve({ error: "gh returned unreadable output" });
      }
    });
  });
}
