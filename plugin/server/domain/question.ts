import { Lifecycle } from "./lifecycle.ts";

type QuestionStatus = "open" | "answered" | "declined" | "canceled";

/** What goes ahead while the Human is silent: the default at once, the default up to the lane's next checkpoint, or nothing. */
export type QuestionClass = "reversible" | "costly" | "irreversible";

/** A decision only the Human can make, as the Supervisor put it to them: a no and a not now are kept apart from an answer. */
export type Question = {
  id: string;
  from: string;
  lane?: string;
  question: string;
  why: string;
  options: { label: string; effect: string }[];
  recommend: string;
  reason: string;
  ifSilent: string;
  class: QuestionClass;
  status: QuestionStatus;
  openedAt: number;
  /** Its lane was put on hold for it, and stays so until whoever supervises resumes it. */
  parked?: boolean;
  answer?: { choice: string; text?: string; by: "panel" | "chat"; quote?: string; at: number };
};

export const QUESTION = new Lifecycle<QuestionStatus, "answer" | "decline" | "cancel">({
  answer: { from: ["open"], to: "answered" },
  decline: { from: ["open"], to: "declined" },
  cancel: { from: ["open"], to: "canceled" },
});
