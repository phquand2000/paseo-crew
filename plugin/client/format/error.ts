/** What went wrong, in words a screen can show. */
export const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
