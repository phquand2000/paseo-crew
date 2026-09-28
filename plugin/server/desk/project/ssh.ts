import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Kit, RoleSpec } from "../../catalog/kit/kit.ts";
import { can } from "../../catalog/kit/roles.ts";
import { writeConfigAtomic } from "../../core/config-file.ts";
import { nodeBin } from "../../core/paths.ts";
import { type Project, type SshHost, loadConfig } from "./project.ts";

/** Read by the ssh a seat's PATH finds first. */
export const SEAT_SSH = "CREW_SSH_CONFIG";

const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`).replaceAll("%", "%%")}'`;

/** Seats cannot read ~/.ssh, and ssh must never wait on a prompt no one answers: each host is complete here. */
function hostBlock(name: string, host: SshHost, knownHosts: string, tunnel: string): string {
  return [
    `Host ${name}`,
    `  HostName ${host.hostName}`,
    `  Port ${host.port}`,
    `  User ${host.user}`,
    `  HostKeyAlias ${name}`,
    `  UserKnownHostsFile "${knownHosts}"`,
    "  GlobalKnownHostsFile /dev/null",
    "  StrictHostKeyChecking yes",
    "  UpdateHostKeys no",
    "  BatchMode yes",
    "  IdentityFile none",
    "  IdentitiesOnly yes",
    "  IdentityAgent none",
    "  PubkeyAuthentication no",
    "  PasswordAuthentication no",
    "  KbdInteractiveAuthentication no",
    "  ForwardAgent no",
    "  ControlMaster no",
    "  ControlPath none",
    "  ConnectionAttempts 1",
    "  ConnectTimeout 10",
    "  ServerAliveInterval 15",
    "  ServerAliveCountMax 2",
    `  ProxyCommand ${tunnel} %h %p`,
    "",
  ].join("\n");
}

const keep = (file: string, text: string) => {
  if (!existsSync(file) || readFileSync(file, "utf-8") !== text) writeConfigAtomic(file, text, 0o644);
};

/** Writes the ssh config a role that writes code reaches the Human's `ssh` hosts with, and gives its path; none without a host. */
export function seatSsh(kit: Kit, role: RoleSpec, project: Project): string | undefined {
  if (!can(role, "write")) return undefined;
  const hosts = Object.entries(loadConfig(project.state).ssh);
  if (hosts.length === 0) return undefined;
  const dir = join(project.state, "ssh");
  const knownHosts = join(dir, "known_hosts");
  const tunnel = `${quoted(nodeBin())} ${quoted(join(kit.dir, "bin", "ssh-tunnel.mjs"))}`;
  mkdirSync(dir, { recursive: true });
  keep(knownHosts, hosts.map(([name, host]) => `${name} ${host.hostKey}\n`).join(""));
  const config = join(dir, "config");
  keep(config, hosts.map(([name, host]) => hostBlock(name, host, knownHosts, tunnel)).join("\n"));
  return config;
}
