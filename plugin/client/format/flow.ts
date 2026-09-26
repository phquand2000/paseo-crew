/** Lanes start collapsed and the Lead's line is the only place a seat waiting on a permission shows, so counts must not hide it. */
export function countsInstead(lane: { taskCount: number; open: boolean; lead: { status: string; waiting: string[] } | null }): boolean {
  if (lane.taskCount === 0 || lane.open) return false;
  return Boolean(lane.lead) && lane.lead!.status !== "gone" && lane.lead!.waiting.length === 0;
}
