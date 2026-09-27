// A seat's ssh, first on its PATH: reads the hosts the Human granted the project, and stops at once when the tailnet holds
// the connection for a check in a browser, which no agent can pass and ssh would wait on for good. Run as: ssh-shim.mjs <ssh> <args>.
import { spawn } from "node:child_process";

const [ssh, ...argv] = process.argv.slice(2);
const config = process.env.SEATWORKS_SSH_CONFIG;
const HELD = /Tailscale SSH requires an additional check|To authenticate, visit/;

// A -F the seat gives comes later, and ssh takes the last one.
const child = spawn(ssh, config ? ["-F", config, ...argv] : argv, { stdio: ["inherit", "inherit", "pipe"] });
let pending = "";
let held = false;

child.stderr.setEncoding("utf-8");
child.stderr.on("data", (chunk) => {
  if (held) return;
  const lines = (pending + chunk).split("\n");
  pending = lines.pop();
  for (const line of lines) {
    if (HELD.test(line)) {
      held = true;
      child.kill("SIGTERM");
      process.stderr.write(
        "ssh: the tailnet holds this connection for its SSH check, which has lapsed, and no agent can pass it. Nothing ran. " +
          "The Human must re-approve the Tailscale check: run ssh to this host once on their own machine and open the link it shows.\n",
      );
      return;
    }
    process.stderr.write(`${line}\n`);
  }
});
child.on("error", (error) => {
  process.stderr.write(`ssh: ${error.message}\n`);
  process.exit(127);
});
// Left to end by itself, so what is still being written to stderr is not dropped.
child.on("close", (code) => {
  if (!held && pending) process.stderr.write(pending);
  process.exitCode = held ? 255 : (code ?? 255);
});
