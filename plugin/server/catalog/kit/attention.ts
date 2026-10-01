import type { Attention } from "../../../shared/views.ts";

export const ATTENTION: Omit<Attention, "irreversible" | "testPath" | "suppressed"> = {
  tickSeconds: 30,
  leadIdleMinutes: 12,
  askWaitingMinutes: 15,
  watch: false,
  repeatsAt: 3,
  reworksAt: 3,
  incidentsPerLane: 2,
  questionsPerDay: 3,
  judge: "off",
};
