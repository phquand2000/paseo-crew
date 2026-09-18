import { execFile } from "node:child_process";

export type Issue = { number: number; title: string; url: string; body: string };

export function issueArgs(ref: string): string[] | undefined {
  const text = ref.trim();
  // Any host, not only github.com: `gh` takes `HOST/OWNER/REPO` and a team on GitHub Enterprise had
  // its issue URL rejected as malformed, which used to take the whole lane with it.
  const url = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/issues\/(\d+)/.exec(text);
  if (url) return ["issue", "view", url[3]!, "-R", url[1] === "github.com" ? url[2]! : `${url[1]}/${url[2]}`];
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
