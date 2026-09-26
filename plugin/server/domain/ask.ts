import { Lifecycle } from "./lifecycle.ts";

export type AskStatus = "open" | "answered";

export const ASK = new Lifecycle<AskStatus, "answer">({ answer: { from: ["open"], to: "answered" } });
