import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { type AddressInfo, type Server, connect, createServer } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig } from "../../server/desk/project/project.ts";
import { tempDir } from "../tempdir.ts";
import { harness } from "./harness.ts";

const BIN = fileURLToPath(new URL("../../bin/", import.meta.url));
const wire = (...parts: Buffer[]) =>
  Buffer.concat(parts.flatMap((part) => [Buffer.from([0, 0, 0, part.length]), part])).toString("base64");
const raw = Buffer.from(generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x!, "base64url");
const KEY = `ssh-ed25519 ${wire(Buffer.from("ssh-ed25519"), raw)}`;

test("the Human's ssh grant reaches a seat that writes code as a config ssh resolves: the host pinned, no key, no agent, nothing asked", () => {
  const h = harness();
  saveConfig(h.project.state, {
    ...loadConfig(h.project.state),
    ssh: {
      "example-host": { hostName: "192.0.2.10", user: "example-user", port: 22, hostKey: KEY },
      "bad host": { hostName: "192.0.2.20", user: "x", port: 22, hostKey: KEY },
    },
  });
  const open = (provider: string) =>
    h.runtime.sessionOpen({ agentId: provider, reason: "create", provider, cwd: h.root, env: {} }).env;
  const config = open("sw2-peer-codex").SEATWORKS_SSH_CONFIG;
  assert.ok(config, "a Peer is given the config");
  assert.equal(open("sw2-peer-claude").SEATWORKS_SSH_CONFIG, config, "whichever harness it runs on");
  assert.equal(open("sw2-lead-claude").SEATWORKS_SSH_CONFIG, undefined, "a role that writes no code reaches no host");

  const resolved = spawnSync("ssh", ["-G", "-F", config, "example-host"], { encoding: "utf-8" });
  assert.equal(resolved.status, 0, resolved.stderr);
  const settings = new Map(
    resolved.stdout.split("\n").map((line) => [line.split(" ")[0], line.slice(line.indexOf(" ") + 1)]),
  );
  for (const [name, value] of Object.entries({
    hostname: "192.0.2.10",
    user: "example-user",
    port: "22",
    batchmode: "yes",
    stricthostkeychecking: "true",
    identityagent: "none",
    identityfile: "none",
    pubkeyauthentication: "false",
    forwardagent: "no",
    controlmaster: "false",
    globalknownhostsfile: "/dev/null",
  }))
    assert.equal(settings.get(name), value, `${name}: ssh never asks, and reads no key, agent or shared connection`);
  assert.match(settings.get("proxycommand") ?? "", /ssh-tunnel\.mjs' %h %p$/, "out through the seat's sandbox proxy");
  assert.deepEqual(
    readFileSync(settings.get("userknownhostsfile")!, "utf-8").trim().split("\n"),
    [`${settings.get("hostkeyalias")} ${KEY}`],
    "the one host key the Human pinned, and no other host's",
  );
});

/** Runs the seat's ssh over a stand-in that plays `script`, as the shim is written to PATH. */
const shim = (script: string, env: Record<string, string> = {}) => {
  const fake = join(tempDir("sw2-ssh-"), "ssh");
  writeFileSync(fake, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return spawnSync(process.execPath, [join(BIN, "ssh-shim.mjs"), fake, "example-host", "hostname"], {
    encoding: "utf-8",
    env: { ...process.env, ...env },
    timeout: 20_000,
  });
};

test("a seat's ssh reads the granted hosts, and stops at once, without the link, when the tailnet holds it for a check", () => {
  const ran = shim(`echo "$@"; echo warn >&2; exit 3`, { SEATWORKS_SSH_CONFIG: "/state/ssh/config" });
  assert.deepEqual([ran.status, ran.stdout, ran.stderr], [3, "-F /state/ssh/config example-host hostname\n", "warn\n"]);

  // As Tailscale sends it once the check has lapsed; ssh would then wait on the browser for good.
  const held = shim(
    `printf '# Tailscale SSH requires an additional check.\\n# To authenticate, visit: https://login.example/a/s3cret\\n' >&2; exec sleep 600`,
  );
  assert.equal(held.signal, null, "it did not wait for the check");
  assert.equal(held.status, 255);
  assert.match(held.stderr, /Nothing ran\. The Human must pass the check again/);
  assert.doesNotMatch(held.stderr, /s3cret/, "the link is the Human's to open, never a seat's");
});

const listening = async (server: Server): Promise<number> => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
};

test("a seat reaches the host through the proxy its sandbox gives it: http with the sandbox's own credentials, or socks", async (t) => {
  // Half-open, as a real proxy is: ssh closes its side first and still reads the rest.
  const echo = createServer({ allowHalfOpen: true }, (socket) => socket.pipe(socket));
  const heard: string[] = [];
  const proxy = createServer({ allowHalfOpen: true }, (client) =>
    client.once("data", (first) => {
      const onward = (host: string, port: number, reply: Buffer) => {
        const up = connect(port, host, () => {
          client.write(reply);
          client.pipe(up).pipe(client);
        });
      };
      if (first[0] === 5) {
        client.write(Buffer.from([5, 0]));
        client.once("data", (asked) => {
          const host = asked.subarray(5, 5 + asked[4]!).toString();
          heard.push(`socks ${host}`);
          onward(host, asked.readUInt16BE(5 + asked[4]!), Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        });
        return;
      }
      const head = first.toString().split("\r\n");
      heard.push(head.find((line) => line.startsWith("Proxy-Authorization:")) ?? "no credentials");
      const [, host, port] = /^CONNECT (\S+):(\d+) /.exec(head[0]!)!;
      onward(host!, Number(port), Buffer.from("HTTP/1.1 200 Connection established\r\n\r\n"));
    }),
  );
  const [target, via] = [await listening(echo), await listening(proxy)];
  t.after(() => {
    echo.close();
    proxy.close();
  });
  const through = async (url: string) => {
    const tunnel = spawn(process.execPath, [join(BIN, "ssh-tunnel.mjs"), "127.0.0.1", String(target)], {
      env: { ...process.env, ALL_PROXY: url },
    });
    let out = "";
    tunnel.stdout.on("data", (data: Buffer) => (out += String(data)));
    tunnel.stdin.end("SSH-2.0-seat\n");
    const [code] = (await once(tunnel, "exit")) as [number];
    return [code, out];
  };
  assert.deepEqual(await through(`http://seat:p%40ss@127.0.0.1:${via}`), [0, "SSH-2.0-seat\n"], "Claude's");
  assert.deepEqual(await through(`socks5h://127.0.0.1:${via}`), [0, "SSH-2.0-seat\n"], "Codex's");
  assert.deepEqual(heard, [
    `Proxy-Authorization: Basic ${Buffer.from("seat:p@ss").toString("base64")}`,
    "socks 127.0.0.1",
  ]);
});
