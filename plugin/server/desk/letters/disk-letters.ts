import type { DiskReading } from "../project/disk.ts";
import { type Letter, fyi, mail } from "./envelope.ts";

/** What the desk mails whoever supervises as a disk the project uses crosses its soft floor. */
export const diskLetters = {
  /** Under the soft floor: new tasks wait, so the Supervisor decides what space to free before it runs out. */
  low({ free, soft, where }: DiskReading, at: number): Letter {
    const text = `DISK LOW: the disk under ${where} has ${free} GiB free, under its soft floor of ${soft} GiB. New tasks wait to start; gates and the work already running go on.`;
    return mail(
      "disk",
      ["low", at],
      text,
      "Free space on that disk, or ask the Human to; the tasks that wait start once it is back over the floor.",
    );
  },
  /** Back over the soft floor: nothing waits on the disk any more, which asks nothing of it. */
  back(at: number): Letter {
    const text = "DISK OK: every disk the project uses is over its soft floor again.";
    return fyi(mail("disk", ["ok", at], text, "The tasks that waited on it start in this round."));
  },
};
