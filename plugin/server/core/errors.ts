/** What an unknown thrown value reads as. Written out by hand in twenty-two places before this. */
export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
