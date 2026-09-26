import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { ModelPicker } from "./model-picker.tsx";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Button } from "./bits.tsx";
import type { Layer } from "../../shared/settings.ts";
import type { CatalogView, Folders, ProjectRow } from "../../shared/views.ts";
import type { PaseoProject } from "../state/seatworks.ts";
import { message } from "../format/error.ts";
import { harnessInForce, modelInForce, modelRow, setRole } from "../model/layer.ts";
import { TabBar } from "./tabs.tsx";

type Props = {
  open: boolean;
  catalog: CatalogView;
  available: PaseoProject[];
  projects: ProjectRow[];
  readSettings(slug: string): Promise<{ status: string; values?: Layer; machine?: Layer } | { error: string }>;
  machine: Layer;
  theme: PluginTheme;
  disabled: boolean;
  onOpenChange(open: boolean): void;
  attach(root: string, values: Layer): Promise<string | null>;
  listFolders(path?: string): Promise<Folders | { error: string }>;
  onAttached(slug: string): void;
};

const STEPS = [
  { id: "repository", label: "Repository" },
  { id: "team", label: "Team" },
  { id: "check", label: "Check" },
];

export function SetupDialog({ open, catalog, available, projects, readSettings, machine, theme, disabled, onOpenChange, attach, listFolders, onAttached }: Props) {
  const [step, setStep] = useState(0);
  const [root, setRootPath] = useState("");
  const [draft, setDraft] = useState<Layer>({});
  const [role, setActiveRole] = useState(catalog.roles[0]?.id ?? "");
  const [browsing, setBrowsing] = useState<Folders | null>(null);
  const [picking, setPicking] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  // What the target already holds; without it the selects showed the kit's agent, not the one in force.
  const [held, setHeld] = useState<{ root: string; values: Layer; machine: Layer } | null>(null);
  const attached = projects.map((entry) => entry.root);
  const styles = useMemo(
    () => ({
      footer: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingTop: 8 },
      summary: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 12 },
      pair: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    }),
    [theme],
  );

  const chosen = catalog.roles.find((entry) => entry.id === role) ?? catalog.roles[0];
  const path = root.trim();
  const inForce = held?.root === path ? held : undefined;
  // A repository not set up yet still runs on the machine's defaults, not the kit's.
  const below = inForce?.machine ?? machine;
  const harnessOf = (id: string) => {
    const spec = catalog.roles.find((entry) => entry.id === id);
    return spec ? harnessInForce(spec, draft, inForce?.values, below) : "";
  };
  const harness = catalog.harnesses.find((entry) => entry.id === harnessOf(chosen?.id ?? ""));
  const models = harness?.models ?? [];
  const settled = (id: string) => {
    const spec = catalog.roles.find((entry) => entry.id === id);
    return spec ? modelInForce(spec, draft, inForce?.values, below) : undefined;
  };
  const model = settled(chosen?.id ?? "") ?? models[0]?.id ?? "";
  const row = modelRow(model, models);

  useEffect(() => {
    const slug = projects.find((entry) => entry.root === path)?.slug;
    if (!open || !slug || held?.root === path) return;
    let stale = false;
    void readSettings(slug).then((read) => {
      if (stale || "error" in read || read.status !== "ready") return;
      setHeld({ root: path, values: read.values ?? {}, machine: read.machine ?? {} });
    });
    return () => {
      stale = true;
    };
  }, [open, path, projects, readSettings, held?.root]);

  const close = () => {
    setDraft({});
    setRootPath("");
    setStep(0);
    setBrowsing(null);
    setPicking(false);
    setTrouble(null);
    setHeld(null);
    onOpenChange(false);
  };

  const browse = (where?: string) =>
    void listFolders(where)
      .then((answer) => {
        if ("error" in answer) {
          setTrouble(answer.error);
          return;
        }
        setTrouble(null);
        setPicking(false);
        setBrowsing(answer);
      })
      // Without this a failed call left the row dead and the footer stale.
      .catch((error: unknown) => setTrouble(message(error)));

  const summary = () => {
    if (trouble) return trouble;
    if (!path) return "Choose a repository to start.";
    if (step === 1) return `${chosen?.label ?? "Every role"} on ${harness?.label ?? "its default agent"}${models.length > 0 ? ` · ${model}` : ""}.`;
    return path;
  };

  return (
    <Modal title="Set Seatworks up for a project" open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <TabBar theme={theme} active={STEPS[step]!.id} disabled={disabled} onPick={(id) => setStep(Math.max(0, STEPS.findIndex((entry) => entry.id === id)))} tabs={STEPS} />

        {step === 0 ? (
          <>
            <SettingsCard>
              <SettingsRow label="Repository" hint={path || "No folder chosen yet."}>
                <View style={styles.pair}>
                  <Button label="Browse" theme={theme} disabled={disabled} onPress={() => browse(path || undefined)} />
                  <Button label="Pick" theme={theme} disabled={disabled} onPress={() => { setBrowsing(null); setPicking(true); }} />
                </View>
              </SettingsRow>
            </SettingsCard>

            {browsing ? (
              <SettingsSection
                title={browsing.path}
                info={browsing.root ? `Inside the repository ${browsing.root}, which is what would be set up.` : browsing.repository ? "This folder is a repository." : "Open a folder, or go up."}
              >
                <SettingsCard>
                  <SettingsAction
                    label={browsing.repository ? "Use this folder" : "Use it anyway"}
                    // Attaching a folder registers its repository, so compare against that root, not the folder.
                    hint={
                      attached.includes(browsing.root ?? browsing.path)
                        ? "Already set up. Going on from here changes the agents; everything else it holds is kept."
                        : browsing.root
                          ? `Setting this up sets up ${browsing.root}.`
                          : browsing.repository
                            ? "A git repository."
                            : "Seatworks will register it as its own project."
                    }
                    actionLabel="Use"
                    disabled={disabled}
                    onPress={() => {
                      // The repository is what gets set up, so keep its root, not the folder.
                      setRootPath(browsing.root ?? browsing.path);
                      setBrowsing(null);
                    }}
                  />
                  {browsing.parent ? (
                    <SettingsAction label="Up one folder" hint={browsing.parent} actionLabel="Open" disabled={disabled} onPress={() => browse(browsing.parent ?? undefined)} />
                  ) : null}
                  {browsing.folders.map((folder) => (
                    <SettingsAction
                      key={folder.path}
                      label={folder.name}
                      hint={folder.repository ? "repository" : ""}
                      actionLabel="Open"
                      disabled={disabled}
                      onPress={() => browse(folder.path)}
                    />
                  ))}
                </SettingsCard>
              </SettingsSection>
            ) : null}

            {picking ? (
              <SettingsSection title="Projects Paseo knows" info="These have no Seatworks settings yet.">
                <SettingsCard>
                  {available.length === 0 ? (
                    <SettingsRow label="Nothing to pick" hint="Every project Paseo knows is already set up." />
                  ) : (
                    available.map((entry) => (
                      <SettingsAction
                        key={entry.root}
                        label={entry.name}
                        hint={entry.root}
                        actionLabel="Choose"
                        disabled={disabled}
                        onPress={() => {
                          setRootPath(entry.root);
                          setPicking(false);
                        }}
                      />
                    ))
                  )}
                </SettingsCard>
              </SettingsSection>
            ) : null}
          </>
        ) : null}

        {step === 1 && chosen ? (
          <>
            <TabBar theme={theme} active={chosen.id} disabled={disabled} onPick={setActiveRole} tabs={catalog.roles.map((entry) => ({ id: entry.id, label: entry.label }))} />
            <SettingsCard>
              <SettingsSelect
                label="Agent"
                hint={`Runs every ${chosen.label} turn in this repository.`}
                value={harnessOf(chosen.id)}
                options={chosen.harnesses.map((id) => ({ label: catalog.harnesses.find((entry) => entry.id === id)?.label ?? id, value: id }))}
                onValueChange={(next) => setDraft((current) => setRole(current, chosen.id, { harness: next }, true))}
                disabled={disabled}
              />
              {models.length > 1 || row.stray ? (
                <ModelPicker
                  label="Model"
                  hint={row.stray ? `${row.value} is not one this agent offers. Pick one it does.` : "Used for every lane here."}
                  value={row.value}
                  options={row.options}
                  theme={theme}
                  onValueChange={(next) => setDraft((current) => setRole(current, chosen.id, { model: next }))}
                  disabled={disabled}
                />
              ) : models.length === 1 ? (
                <SettingsRow label="Model" hint={`${harness?.label ?? "This agent"} runs one model.`}>
                  <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{models[0]!.label}</Text>
                </SettingsRow>
              ) : null}
            </SettingsCard>
          </>
        ) : null}

        {step === 2 ? (
          <SettingsCard>
            <SettingsRow label="Repository" hint={path || "none"} />
            {catalog.roles.map((entry) => (
              <SettingsRow
                key={entry.id}
                label={entry.label}
                hint={`${catalog.harnesses.find((item) => item.id === harnessOf(entry.id))?.label ?? harnessOf(entry.id)}${draft.roles?.[entry.id]?.model ? ` · ${draft.roles[entry.id]!.model}` : ""}`}
              />
            ))}
            <SettingsRow label="MCP servers" hint="Left as they are. Set them per project in the MCP tab." />
            {attached.includes(path) ? <SettingsRow label="This project is already set up" hint="Its rules, its servers and its attention stay as they are; only the agents above change." /> : null}
          </SettingsCard>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.summary} numberOfLines={1}>
            {summary()}
          </Text>
          {step > 0 ? <Button label="Back" theme={theme} onPress={() => setStep(step - 1)} /> : null}
          <Button label="Cancel" theme={theme} onPress={close} />
          {step < STEPS.length - 1 ? (
            <Button label="Next" tone="accent" theme={theme} disabled={disabled || !path} onPress={() => setStep(step + 1)} />
          ) : (
            <Button
              label="Attach"
              tone="accent"
              theme={theme}
              disabled={disabled || !path}
              onPress={() =>
                void attach(path, draft).then((slug) => {
                  if (!slug) return;
                  close();
                  onAttached(slug);
                })
              }
            />
          )}
        </View>
      </Modal.Content>
    </Modal>
  );
}
