import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsCard } from "@getpaseo/plugin/client/ui";
import { type ReactNode, useMemo } from "react";
import { Text, View } from "react-native";
import { Dot, Rule } from "./bits.tsx";
import type { WatchJudge, WatchView } from "../../shared/flow-views.ts";
import { incidentState } from "../format/watch.ts";
import { judgeWords } from "../format/watch.ts";

const ago = (minutes: number): string => (minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`);

function useStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      heading: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const, letterSpacing: 0.6, textTransform: "uppercase" as const, paddingTop: 6 },
      row: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
      labels: { flex: 1, gap: 4, minWidth: 0 },
      title: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
      hint: { color: theme.colors.foregroundMuted, fontSize: 12 },
      dot: { paddingTop: 5 },
    }),
    [theme],
  );
}

function Section({ title, children, theme }: { title: string; children: ReactNode; theme: PluginTheme }) {
  const styles = useStyles(theme);
  return (
    <>
      <Text style={styles.heading}>{title}</Text>
      <SettingsCard>
        <View>{children}</View>
      </SettingsCard>
    </>
  );
}

/** Trouble nobody is mailed about, shown whatever the watch is doing: a refused call is the harness's, not the watch's. */
function Trouble({ watch, theme }: { watch: WatchView; theme: PluginTheme }) {
  const styles = useStyles(theme);
  if (watch.trouble.length === 0) return null;
  return (
    <Section title="Not from the watch" theme={theme}>
      {watch.trouble.map((entry, index) => (
        <View key={`${entry.kind}-${index}`}>
          {index > 0 ? <Rule theme={theme} /> : null}
          <View style={styles.row}>
            <View style={styles.dot}>
              <Dot color={theme.colors.statusWarning} />
            </View>
            <View style={styles.labels}>
              <Text style={styles.title}>{entry.kind === "call.malformed" ? "A call never reached the desk" : entry.kind}</Text>
              <Text style={styles.hint}>{entry.detail}</Text>
            </View>
            <Text style={styles.hint}>{ago(entry.minutes)}</Text>
          </View>
        </View>
      ))}
    </Section>
  );
}

function JudgeLine({ judge, theme }: { judge: WatchJudge; theme: PluginTheme }) {
  const styles = useStyles(theme);
  const words = judgeWords(judge);
  const tone = { success: theme.colors.statusSuccess, warning: theme.colors.statusWarning, muted: theme.colors.foregroundMuted }[words.tone];
  return (
    <Section title="The watch" theme={theme}>
      <View style={styles.row}>
        <View style={styles.dot}>
          <Dot color={tone} />
        </View>
        <View style={styles.labels}>
          <Text style={styles.title}>{words.title}</Text>
          <Text style={styles.hint}>{words.hint}</Text>
        </View>
        {judge.minutes !== null ? <Text style={styles.hint}>{ago(judge.minutes)}</Text> : null}
      </View>
    </Section>
  );
}

/** Who answers the watch, then what the code noticed and nobody has marked yet, in short cards like the open asks. */
export function WatchCard({ watch, theme }: { watch: WatchView; theme: PluginTheme }) {
  const styles = useStyles(theme);
  return (
    <View style={{ gap: 10 }}>
      <JudgeLine judge={watch.judge} theme={theme} />
      {watch.incidents.length > 0 ? (
        <Section title={`Incidents · ${watch.incidents.length} not yet marked`} theme={theme}>
          {watch.incidents.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Rule theme={theme} /> : null}
              <View style={[styles.row, { alignItems: "center" }]}>
                <View style={styles.labels}>
                  <Text style={styles.title}>{`${item.id} · ${item.title}`}</Text>
                  <Text style={styles.hint}>{`${item.name} · ${incidentState(item)}`}</Text>
                </View>
                <Text style={styles.hint}>{ago(item.minutes)}</Text>
              </View>
            </View>
          ))}
        </Section>
      ) : null}
      <Trouble watch={watch} theme={theme} />
    </View>
  );
}
