import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { writeConfigAtomic } from "../../core/config-file.ts";
import { type Json, isRecord, sameJson } from "../../core/json.ts";
import { daemonLog } from "../../core/logger.ts";
import { paseoConfigPath } from "../../core/paths.ts";
import { paseoToolsPolicy, supportsRole } from "../kit/harness-files.ts";
import type { HarnessSpec, Kit, ModelSpec, RoleSpec } from "../kit/kit.ts";
import { providerId } from "../kit/roles.ts";
import { presetOn } from "../team/role-seats.ts";
import type { Team } from "../team/team.ts";

/** A Paseo agent profile: the provider a seat starts with and the model it starts on. */
type Profile = Json & { id: string };

/** Keys the kit sets on a provider or a profile only when it wants them, so one it stops wanting is taken off. */
const PROVIDER_OPTIONAL = ["command", "models", "additionalModels", "paseoTools", "description"];
const PROFILE_OPTIONAL = ["model", "modeId", "thinkingOptionId"];

function labelFor(kit: Kit, role: RoleSpec, harness: HarnessSpec): string {
  const tag = kit.prefix.replace(/[-_]+$/, "");
  const base = `${role.label} · ${harness.label}`;
  return tag ? `${base} (${tag})` : base;
}

export function seatPairs(kit: Kit): { role: RoleSpec; harness: HarnessSpec }[] {
  const pairs: { role: RoleSpec; harness: HarnessSpec }[] = [];
  for (const role of kit.roles) {
    for (const harness of Object.values(kit.harnesses))
      if (supportsRole(kit, harness, role)) pairs.push({ role, harness });
  }
  return pairs;
}

function choiceFor(team: Team, role: RoleSpec, harness: HarnessSpec): { model?: string; thinking?: string } {
  const seat = team.roles[role.role];
  if (seat && seat.harness.id === harness.id) return { model: seat.model?.id, thinking: seat.thinking };
  const { model, thinking } = presetOn(
    role,
    harness,
    Object.values(team.roles).map((entry) => entry.role),
  );
  return { model: model?.id, thinking };
}

function defaultModel(harness: HarnessSpec, choice: { model?: string }): ModelSpec[] {
  if (!choice.model) return [];
  const label = harness.models?.find((entry) => entry.id === choice.model)?.label ?? choice.model;
  return [{ id: choice.model, label, isDefault: true }];
}

function desiredProvider(kit: Kit, team: Team, role: RoleSpec, harness: HarnessSpec): Json {
  const entry: Json = {
    extends: harness.baseProvider,
    label: labelFor(kit, role, harness),
    env: { ...(harness.provider.env ?? {}), SEATWORKS_ROLE: role.role, SEATWORKS_KIT: kit.dir },
  };
  if (role.description) entry.description = role.description;
  const command = (harness.provider.command ?? []).map((part) => part.replaceAll("KIT", kit.dir));
  if (command.length > 0) entry.command = command;
  const models = defaultModel(harness, choiceFor(team, role, harness));
  if (models.length > 0) entry.additionalModels = models;
  const tools = paseoToolsPolicy(kit, role);
  if (tools) entry.paseoTools = tools;
  return entry;
}

function desiredProfile(kit: Kit, team: Team, role: RoleSpec, harness: HarnessSpec): Profile {
  const id = providerId(kit, role.role, harness.id);
  const choice = choiceFor(team, role, harness);
  const profile: Profile = { id, name: labelFor(kit, role, harness), provider: id };
  if (choice.model) profile.model = choice.model;
  if (harness.provider.profileModeId) profile.modeId = harness.provider.profileModeId;
  if (choice.thinking) profile.thinkingOptionId = choice.thinking;
  return profile;
}

function managedEnvKeys(kit: Kit): Set<string> {
  const keys = new Set<string>();
  for (const harness of Object.values(kit.harnesses)) {
    keys.add(harness.configDirEnv);
    for (const key of Object.keys(harness.provider.env ?? {})) keys.add(key);
  }
  return keys;
}

/** Paseo's config with every provider and profile the kit's seats need, as the kit and team want them now. */
function reconcile(config: Json, kit: Kit, team: Team): { config: Json; changed: string[] } {
  const next = structuredClone(config);
  const providers = child(child(next, "agents"), "providers") as Record<string, Json>;
  const daemon = child(next, "daemon");
  daemon.agentProfiles ??= [];
  const changed: string[] = [];
  const pairs = seatPairs(kit);
  const wanted = new Set(pairs.map((pair) => providerId(kit, pair.role.role, pair.harness.id)));
  if (kit.prefix) dropStale(providers, daemon, kit.prefix, wanted, changed);
  const managed = managedEnvKeys(kit);
  const profiles = daemon.agentProfiles as Json[];
  for (const { role, harness } of pairs) {
    const id = providerId(kit, role.role, harness.id);
    reconcileProvider(providers, id, desiredProvider(kit, team, role, harness), managed, changed);
    reconcileProfile(profiles, desiredProfile(kit, team, role, harness), changed);
  }
  return { config: next, changed };
}

/** The record at `key`, made where it is missing. */
function child(parent: Json, key: string): Json {
  parent[key] ??= {};
  return parent[key] as Json;
}

/** Takes off the providers and profiles under the kit's prefix that no seat needs any more. */
function dropStale(
  providers: Record<string, Json>,
  daemon: Json,
  prefix: string,
  wanted: Set<string>,
  changed: string[],
): void {
  for (const id of Object.keys(providers)) {
    if (id.startsWith(prefix) && !wanted.has(id)) {
      delete providers[id];
      changed.push(`provider ${id} removed`);
    }
  }
  daemon.agentProfiles = (daemon.agentProfiles as Json[]).filter((entry) => {
    const id = entry.id;
    const stale = typeof id === "string" && id.startsWith(prefix) && !wanted.has(id);
    if (stale) changed.push(`profile ${id} removed`);
    return !stale;
  });
}

/** One provider as the kit wants it, keeping env the owner added; the env keys the kit manages follow the kit. */
function reconcileProvider(
  providers: Record<string, Json>,
  id: string,
  want: Json,
  managed: Set<string>,
  changed: string[],
): void {
  const have = providers[id] ?? {};
  const env = Object.entries(isRecord(have.env) ? have.env : {});
  const kept = Object.fromEntries(env.filter(([key]) => !key.startsWith("SEATWORKS_") && !managed.has(key)));
  const merged: Json = { ...have, ...want, env: { ...kept, ...(want.env as Json) } };
  for (const key of PROVIDER_OPTIONAL) if (!(key in want)) delete merged[key];
  if (sameJson(merged, have)) return;
  providers[id] = merged;
  changed.push(`provider ${id}`);
}

/** One profile as the kit wants it, keeping what else the owner set on it. */
function reconcileProfile(profiles: Json[], profile: Profile, changed: string[]): void {
  const index = profiles.findIndex((entry) => entry.id === profile.id);
  const current = index >= 0 ? profiles[index] : undefined;
  const merged: Json = { ...(current ?? {}), ...profile };
  for (const key of PROFILE_OPTIONAL) if (!(key in profile)) delete merged[key];
  if (current && sameJson(merged, current)) return;
  if (index >= 0) profiles[index] = merged;
  else profiles.push(merged);
  changed.push(`profile ${profile.id}`);
}

export function applyReconcile(kit: Kit, team: Team): string[] {
  const configPath = paseoConfigPath();
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as Json;
  const { config: next, changed } = reconcile(config, kit, team);
  // Staged and renamed: a daemon killed mid-write could not parse its own config. The mode is kept so a private config is not widened.
  if (changed.length > 0)
    writeConfigAtomic(configPath, `${JSON.stringify(next, null, 2)}\n`, statSync(configPath).mode & 0o777);
  return changed;
}

export function reloadDaemon(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("paseo", ["daemon", "reload"], { timeout: 30_000 }, (error, _stdout, stderr) => {
      if (error) daemonLog.error("paseo daemon reload failed:", stderr || error.message);
      resolve(!error);
    });
  });
}
