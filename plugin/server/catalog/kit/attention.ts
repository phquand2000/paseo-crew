import type { Attention } from "../../../shared/views.ts";

export const ATTENTION: Omit<Attention, "destructive" | "irreversible" | "testPath" | "suppressed"> = {
  tickSeconds: 30,
  leadIdleMinutes: 12,
  askWaitingMinutes: 15,
  watch: false,
  repeatsAt: 3,
  reworksAt: 3,
  reviewsAt: 3,
  longTurnMinutes: 30,
  incidentsPerLane: 2,
  questionsPerDay: 3,
  judge: "off",
};
