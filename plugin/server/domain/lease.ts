/** A seat waiting for a lease, and for how long it asked to hold it. */
type LeaseWait = { seat: string; minutes: number };

/** A desk-kept hold on something seats share, named by them: who has it until when, and who waits in order. */
export type Lease = { holder: string; since: number; until: number; queue: LeaseWait[] };
