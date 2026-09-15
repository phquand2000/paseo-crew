import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { type Kit, type RoleSpec, defaultModel, defaultThinking, harnessOf, modelsOf, paseoToolsPolicy, providerId, seatRoles } from "./kit.ts";
import { paseoConfigPath } from "./paths.ts";
import { sameJson } from "./store.ts";

type Json = Record<string, any>;

export function labelFor(kit: Kit, role: RoleSpec): string {
  const tag = kit.prefix.replace(/[-_]+$/, "");
  return tag ? `${role.label} (${tag})` : role.label;
}

export function desiredProvider(kit: Kit, role: RoleSpec): Json {
  const harness = harnessOf(kit, role);
  const entry: Json = {
    extends: harness.baseProvider,
    label: labelFor(kit, role),
    env: { ...(harness.provider.env ?? {}), SEATWORKS_ROLE: role.role, SEATWORKS_KIT: kit.dir },
  };
  if (role.description) entry.description = role.description;
  const command = (harness.provider.command ?? []).map((part) => part.replaceAll("KIT", kit.dir));
  if (command.length > 0) entry.command = command;
  const models = modelsOf(role);
  if (models.length > 0) entry.models = models;
  const tools = paseoToolsPolicy(role);
  if (tools) entry.paseoTools = tools;
  return entry;
}

export function desiredProfile(kit: Kit, role: RoleSpec): Json {
  const harness = harnessOf(kit, role);
  const model = defaultModel(role);
  const profile: Json = { id: providerId(kit, role.role), name: labelFor(kit, role), provider: providerId(kit, role.role) };
  if (model) profile.model = model.id;
  if (harness.provider.profileModeId) profile.modeId = harness.provider.profileModeId;
  const thinking = harness.hasThinking === false ? undefined : defaultThinking(role, model);
  if (thinking) profile.thinkingOptionId = thinking;
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

export function reconcile(config: Json, kit: Kit): { config: Json; changed: string[] } {
  const next: Json = structuredClone(config);
  next.agents ??= {};
  next.agents.providers ??= {};
  next.daemon ??= {};
  next.daemon.agentProfiles ??= [];
  const managed = managedEnvKeys(kit);
  const changed: string[] = [];
  for (const role of kit.roles.filter((entry) => entry.headless)) {
    const id = providerId(kit, role.role);
    if (next.agents.providers[id]) {
      delete next.agents.providers[id];
      changed.push(`provider ${id} removed`);
    }
    const before = next.daemon.agentProfiles.length;
    next.daemon.agentProfiles = next.daemon.agentProfiles.filter((entry: Json) => entry.id !== id);
    if (next.daemon.agentProfiles.length !== before) changed.push(`profile ${id} removed`);
  }
  for (const role of seatRoles(kit)) {
    const id = providerId(kit, role.role);
    const have: Json = next.agents.providers[id] ?? {};
    const want = desiredProvider(kit, role);
    const kept = Object.fromEntries(
      Object.entries(have.env ?? {}).filter(([key]) => !key.startsWith("SEATWORKS_") && !managed.has(key)),
    );
    const merged: Json = { ...have, ...want, env: { ...kept, ...want.env } };
    for (const key of ["command", "models", "paseoTools", "description"]) if (!(key in want)) delete merged[key];
    if (!sameJson(merged, have)) {
      next.agents.providers[id] = merged;
      changed.push(`provider ${id}`);
    }
    const profile = desiredProfile(kit, role);
    const profiles: Json[] = next.daemon.agentProfiles;
    const index = profiles.findIndex((entry) => entry.id === profile.id);
    const current = index >= 0 ? profiles[index] : undefined;
    const mergedProfile: Json = { ...(current ?? {}), ...profile };
    for (const key of ["model", "modeId", "thinkingOptionId"]) if (!(key in profile)) delete mergedProfile[key];
    if (!current || !sameJson(mergedProfile, current)) {
      if (index >= 0) profiles[index] = mergedProfile;
      else profiles.push(mergedProfile);
      changed.push(`profile ${profile.id}`);
    }
  }
  return { config: next, changed };
}

export function applyReconcile(kit: Kit, configPath = paseoConfigPath()): string[] {
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as Json;
  const { config: next, changed } = reconcile(config, kit);
  if (changed.length > 0) writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return changed;
}

export function reloadDaemon(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("paseo", ["daemon", "reload"], { timeout: 30_000 }, (error, _stdout, stderr) => {
      if (error) console.error("seatworks-v2: paseo daemon reload failed:", stderr || error.message);
      resolve(!error);
    });
  });
}
