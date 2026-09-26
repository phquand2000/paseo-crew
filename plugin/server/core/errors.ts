export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What a rejection carries, as an Error: an abort's reason or a thrown value may be anything. */
export const asError = (reason: unknown): Error => (reason instanceof Error ? reason : new Error(String(reason)));
