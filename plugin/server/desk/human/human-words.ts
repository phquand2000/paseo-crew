import { sentBy } from "../../core/sent-by.ts";
import type { DeskServices } from "../services.ts";

/** Words as a quote is checked: spacing, a closing stop and case do not count. */
const flat = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .toLowerCase();

/** Whether the Human wrote `quote` in `seat`'s chat, as far back as the desk reads it. */
export async function humanWrote(
  { roster }: Pick<DeskServices, "roster">,
  seat: string,
  quote: string,
): Promise<boolean> {
  const words = flat(quote);
  if (!words) return false;
  return (await roster.history(seat, 200)).some(
    ({ item }) =>
      item.type === "user_message" &&
      sentBy(item)[0] === "person" &&
      typeof item.text === "string" &&
      flat(item.text).includes(words),
  );
}
