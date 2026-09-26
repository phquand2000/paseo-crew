import type { PluginTheme, RpcInput } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, type SettingsInputHandle, SettingsRow } from "@getpaseo/plugin/client/ui";
import { useRef, useState } from "react";
import { Text } from "react-native";
import { questionAnswerRpc } from "../../shared/rpc.ts";
import type { FlowQuestion } from "../../shared/flow-views.ts";
import type { QuestionAnswered } from "../../shared/views.ts";
import { message } from "../format/error.ts";

type Answer = (input: RpcInput<typeof questionAnswerRpc>) => Promise<QuestionAnswered>;

const CLASSES: Record<FlowQuestion["class"], string> = {
  reversible: "Reversible: while you are silent the lane goes on as recommended, and you can turn it back",
  costly: "Costly: while you are silent the lane goes on as recommended, and stops when it reports ready",
  irreversible: "Irreversible: the lane waits for you",
};

const ago = (minutes: number): string => (minutes < 1 ? "just now" : `${minutes} min ago`);

/** One question the Supervisor put to the Human, answered here: an option, or decline, with a note that goes with it. */
function Question({ project, question, answer, theme }: { project: string; question: FlowQuestion; answer: Answer; theme: PluginTheme }) {
  const field = useRef<SettingsInputHandle>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<QuestionAnswered | null>(null);
  const send = (choice: string) => {
    setBusy(true);
    void answer({ project, question: question.id, choice, note })
      .then(setSaid)
      .catch((error: unknown) => setSaid({ error: message(error) }))
      .finally(() => setBusy(false));
  };
  const place = question.lane ? `, for ${question.lane}` : "";
  return (
    <SettingsCard>
      <SettingsRow label={`${question.id} · ${question.question}`} hint={`${CLASSES[question.class]}${place}; asked ${ago(question.minutes)}. ${question.why} If you stay silent: ${question.ifSilent}`} />
      {question.options.map((option) => {
        const recommended = option.label === question.recommend;
        return (
          <SettingsAction
            key={option.label}
            label={recommended ? `${option.label} · recommended` : option.label}
            hint={recommended ? `${option.effect} Why: ${question.reason}` : option.effect}
            actionLabel={`Choose ${option.label}`}
            onPress={() => send(option.label)}
            disabled={busy}
          />
        );
      })}
      <SettingsInput ref={field} label="Note" hint="Goes to the Supervisor with your choice; optional." placeholder="Anything they should know" onChangeText={setNote} disabled={busy} />
      <SettingsAction label="Decline" hint="You will not decide this one: the Supervisor is told, and decides what is theirs or asks another way." actionLabel="Decline" onPress={() => send("decline")} disabled={busy} />
      {said ? <Text style={{ color: "error" in said ? theme.colors.statusWarning : theme.colors.foregroundMuted, fontSize: 12 }}>{"error" in said ? said.error : said.answered}</Text> : null}
    </SettingsCard>
  );
}

export function QuestionCards({ project, questions, theme }: { project: string; questions: FlowQuestion[]; theme: PluginTheme }) {
  const answer = useRpc(questionAnswerRpc);
  return (
    <>
      {questions.map((question) => (
        <Question key={question.id} project={project} question={question} answer={answer} theme={theme} />
      ))}
    </>
  );
}
