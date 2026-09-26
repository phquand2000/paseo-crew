import type { Layer } from "../shared/settings.ts";
import type { WatchJudge } from "../shared/views.ts";

/** A sensor's key set, or with `null` forgotten; the server keeps any other key the values show as KEPT. */
export function withKey(values: Layer, id: string, key: string | null): Layer {
  const { [id]: _was, ...others } = values.sensor ?? {};
  const sensor = key ? { ...others, [id]: { key } } : others;
  return { ...values, sensor: Object.keys(sensor).length > 0 ? sensor : undefined };
}

/** Who answers the watch's questions and how that stands, in words and a tone: fine, failing, or nobody asked. */
export function judgeWords(judge: WatchJudge): { title: string; hint: string; tone: "success" | "warning" | "muted" } {
  const kept = "Its answers are kept in assessments.log; no seat is sent them.";
  if (judge.state === "off") return { title: "Nobody answers the watch's questions", hint: "Answered by is off: set it on Team, on the Watcher. The code's own facts go on.", tone: "muted" };
  if (judge.state === "nokey") return { title: `${judge.label} is asked nothing: it has no key`, hint: `Add its ${judge.detail} on Team, under Machine defaults, on the Watcher. The code's own facts go on.`, tone: "muted" };
  if (judge.state === "failing") return { title: `${judge.label} is not answering`, hint: `${judge.detail}. The code's own facts go on; nothing waits for an answer.`, tone: "warning" };
  return { title: `${judge.label} answers the watch's questions`, hint: judge.state === "waiting" ? `Nothing has been asked of it yet. ${kept}` : kept, tone: "success" };
}
