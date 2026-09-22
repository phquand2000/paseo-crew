import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { cleanRpc, migrateRpc, updateRpc } from "../shared/rpc.ts";
import type { CleanItem, CleanView, MigrateView, UpdateView } from "../shared/views.ts";
import { message } from "./data.ts";

type Busy = "update" | "migrate" | "clean" | null;

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const short = (path: string) => path.replace(/^\/(Users|home)\/[^/]+/, "~");

const KIND: Record<CleanItem["kind"], string> = { seat: "Seat folder", copy: "Working copy", records: "Project records", snapshot: "Copy of guides or skills", backup: "Settings backup" };

/** Picked unless it holds something of the owner's, or cannot go at all. */
const picked = (items: CleanItem[]) => new Set(items.filter((item) => !item.careful && !item.held).map((item) => item.path));

function updateHint(view: UpdateView | null): string {
  if (!view) return "Fetches the branch this checkout follows and lists what is new.";
  if (view.updated) return `Updated ${view.updated.from} → ${view.updated.to}. The plugin is reloading.`;
  if (view.blocked) return `At ${view.head || "?"}.`;
  if (view.behind === 0) return `Up to date: ${view.branch} at ${view.head}.`;
  return `${plural(view.behind, "new commit")} on ${view.upstream}. At ${view.head} now.`;
}

function migrateHint(view: MigrateView | null): string {
  if (!view) return "Reading what this version changes for the projects already set up.";
  const auto = view.steps.filter((step) => step.auto).length;
  const told = view.steps.length - auto;
  if (view.done.length > 0 && auto === 0) return `Done: ${plural(view.done.length, "change")}.${told ? ` ${plural(told, "thing")} left for you, below.` : ""}`;
  if (auto > 0) return `${plural(auto, "change")} to make for this version.${told ? ` ${plural(told, "thing")} for you to know.` : ""}`;
  return told ? `Nothing to change. ${plural(told, "thing")} for you to know, below.` : "Everything already matches this version.";
}

export function UpkeepSection({ theme }: { theme: PluginTheme }) {
  const update = useRpc(updateRpc) as unknown as (input: { apply: boolean }) => Promise<UpdateView>;
  const migrate = useRpc(migrateRpc) as unknown as (input: { apply: boolean }) => Promise<MigrateView>;
  const clean = useRpc(cleanRpc) as unknown as (input: { remove?: string[] }) => Promise<CleanView>;
  const [busy, setBusy] = useState<Busy>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [updated, setUpdated] = useState<UpdateView | null>(null);
  const [migrated, setMigrated] = useState<MigrateView | null>(null);
  const [cleaned, setCleaned] = useState<CleanView | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const styles = useMemo(
    () => ({
      list: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
      title: { color: theme.colors.foreground, fontSize: 13 },
      text: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
      mono: { color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: "Menlo" },
    }),
    [theme],
  );

  const run = async (which: Exclude<Busy, null>, work: () => Promise<void>) => {
    setBusy(which);
    setErrors((current) => ({ ...current, [which]: null }));
    try {
      await work();
    } catch (problem) {
      setErrors((current) => ({ ...current, [which]: message(problem) }));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void run("migrate", async () => setMigrated(await migrate({ apply: false })));
    // Once per mount: an update reloads the plugin, and this is what the owner needs next.
  }, []);

  const canUpdate = Boolean(updated && !updated.blocked && !updated.updated && updated.behind > 0);
  const autoSteps = migrated?.steps.filter((step) => step.auto).length ?? 0;
  const items = cleaned?.items ?? [];
  const picks = items.filter((item) => chosen.has(item.path));
  const freed = picks.reduce((sum, item) => sum + item.bytes, 0);
  const found = items.reduce((sum, item) => sum + item.bytes, 0);
  const cleanHint = !cleaned
    ? "Seat folders, working copies and copies nobody uses any more. Scans first; removes only what you pick."
    : `${cleaned.removed.length ? `Removed ${plural(cleaned.removed.length, "item")}. ` : ""}${items.length ? `${plural(items.length, "item")} found, ${size(found)}.` : "Nothing left to clean."}`;

  return (
    <SettingsSection title="Plugin" info="Update Seatworks, carry what a new version changes into your projects, and clear what is left behind.">
      <SettingsCard>
        <SettingsAction
          label="Updates"
          hint={updateHint(updated)}
          error={errors.update ?? updated?.blocked ?? null}
          actionLabel={busy === "update" ? (canUpdate ? "Updating" : "Checking") : canUpdate ? "Update" : "Check"}
          disabled={busy !== null || Boolean(updated?.updated)}
          onPress={() => void run("update", async () => setUpdated(await update({ apply: canUpdate })))}
        />
        {updated && (updated.commits.length > 0 || updated.running > 0) ? (
          <View style={styles.list}>
            {updated.commits.map((commit) => (
              <Text key={commit.sha} style={styles.mono}>{`${commit.sha}  ${commit.subject}`}</Text>
            ))}
            {updated.installs ? <Text style={styles.text}>Its packages changed, so the update runs npm install.</Text> : null}
            {updated.paseo ? <Text style={styles.text}>{`It asks for Paseo ${updated.paseo}.`}</Text> : null}
            {updated.running > 0 ? <Text style={styles.text}>{`${plural(updated.running, "seat")} running now keep the prompts they started with; Migrate lists them after the update.`}</Text> : null}
          </View>
        ) : null}
      </SettingsCard>

      <SettingsCard>
        <SettingsAction
          label="Migrate"
          hint={migrateHint(migrated)}
          error={errors.migrate ?? null}
          actionLabel={busy === "migrate" ? "Working" : autoSteps > 0 ? "Migrate" : "Check again"}
          disabled={busy !== null}
          onPress={() => void run("migrate", async () => setMigrated(await migrate({ apply: autoSteps > 0 })))}
        />
        {migrated && migrated.steps.length + migrated.done.length > 0 ? (
          <View style={styles.list}>
            {migrated.done.map((line) => (
              <Text key={line} style={styles.text}>{`✓ ${line}`}</Text>
            ))}
            {migrated.steps.map((step) => (
              <View key={`${step.kind}:${step.where}:${step.what}`}>
                <Text style={styles.title}>{`${step.auto ? "•" : "!"} ${step.where} · ${step.what}`}</Text>
                {step.detail.map((line) => (
                  <Text key={line} style={styles.text}>{`   ${line}`}</Text>
                ))}
              </View>
            ))}
          </View>
        ) : null}
      </SettingsCard>

      <SettingsCard>
        <SettingsAction
          label="Clean up"
          hint={cleanHint}
          error={errors.clean ?? (cleaned?.failed.length ? cleaned.failed.map((fail) => `${short(fail.path)}: ${fail.error}`).join("\n") : null)}
          actionLabel={busy === "clean" ? (picks.length ? "Removing" : "Scanning") : picks.length ? `Remove ${picks.length} · ${size(freed)}` : "Scan"}
          disabled={busy !== null}
          onPress={() =>
            void run("clean", async () => {
              const next = await clean(picks.length ? { remove: picks.map((item) => item.path) } : {});
              setCleaned(next);
              setChosen(picks.length ? new Set() : picked(next.items));
            })
          }
        />
        {items.map((item) => (
          <SettingsSwitch
            key={item.path}
            label={`${KIND[item.kind]} · ${short(item.path)}`}
            hint={`${item.held ? `Kept: ${item.held}` : item.why} · ${size(item.bytes)}`}
            value={chosen.has(item.path)}
            disabled={busy !== null || item.held !== null}
            onValueChange={(on) =>
              setChosen((current) => {
                const next = new Set(current);
                if (on) next.add(item.path);
                else next.delete(item.path);
                return next;
              })
            }
          />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}
