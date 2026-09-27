// An ssh ProxyCommand: joins stdin and stdout to <host> <port> through the proxy a seat's sandbox names in ALL_PROXY, since a
// sandbox lets no raw connection out; Claude's is http with the sandbox's own credentials, Codex's socks. Direct without one.
import { writeSync } from "node:fs";
import { connect } from "node:net";

const [host, port] = process.argv.slice(2);
const proxy = process.env.ALL_PROXY || process.env.all_proxy;

function fail(why) {
  writeSync(2, `ssh-tunnel: ${why}\n`);
  process.exit(255);
}

function join(socket, early) {
  if (early.length > 0) process.stdout.write(early);
  socket.pipe(process.stdout);
  process.stdin.pipe(socket);
  // Stdout to a pipe is written later on macOS: exiting at once would drop the last of what the host said.
  socket.on("close", () => process.stdout.write("", () => process.exit(0)));
}

/** Collects what `socket` sends until `done` says how much of it was the proxy's answer; the rest belongs to ssh. */
function answer(socket, done) {
  let heard = Buffer.alloc(0);
  const onData = (data) => {
    heard = Buffer.concat([heard, data]);
    const used = done(heard);
    if (used === undefined) return;
    socket.off("data", onData);
    join(socket, heard.subarray(used));
  };
  socket.on("data", onData);
}

function http(socket, url) {
  const user = decodeURIComponent(url.username);
  const auth = user ? `Proxy-Authorization: Basic ${Buffer.from(`${user}:${decodeURIComponent(url.password)}`).toString("base64")}\r\n` : "";
  socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`);
  answer(socket, (heard) => {
    const end = heard.indexOf("\r\n\r\n");
    if (end < 0) return undefined;
    const status = heard.subarray(0, heard.indexOf("\r\n")).toString();
    if (!/^HTTP\/1\.[01] 2/.test(status)) fail(`the sandbox's proxy refused ${host}:${port}: ${status}`);
    return end + 4;
  });
}

function socks(socket) {
  const name = Buffer.from(host);
  socket.write(Buffer.from([5, 1, 0]));
  let greeted = false;
  answer(socket, (heard) => {
    if (!greeted) {
      if (heard.length < 2) return undefined;
      if (heard[1] !== 0) fail("the sandbox's socks proxy asks for credentials the sandbox did not give");
      greeted = true;
      socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([Number(port) >> 8, Number(port) & 255])]));
    }
    // The greeting's answer is the first two bytes of what was heard.
    if (heard.length < 7) return undefined;
    if (heard[3] !== 0) fail(`the sandbox's proxy refused ${host}:${port} (socks reply ${heard[3]})`);
    const bound = heard[5] === 1 ? 4 : heard[5] === 4 ? 16 : 1 + heard[6];
    return heard.length < 8 + bound ? undefined : 8 + bound;
  });
}

process.stdout.on("error", () => process.exit(0));
if (!proxy) {
  const socket = connect(Number(port), host, () => join(socket, Buffer.alloc(0)));
  socket.on("error", (error) => fail(error.message));
} else {
  const url = new URL(proxy);
  const socket = connect(Number(url.port), url.hostname);
  socket.on("error", (error) => fail(`the sandbox's proxy: ${error.code ?? error.message}`));
  if (url.protocol === "http:") socket.once("connect", () => http(socket, url));
  else if (/^socks5h?:$/.test(url.protocol)) socket.once("connect", () => socks(socket));
  else fail(`a ${url.protocol} proxy is not one ssh can go through`);
}
