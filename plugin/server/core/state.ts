/**
 * The format of what the plugin keeps and cannot rebuild: the ledger and the rest of a project's
 * records, the owner's settings, the outbox. Raised with every change to one of them, together with
 * a step in upkeep/state.ts that carries the files from the format before, and a fixture of it.
 */
export const STATE_VERSION = 1;
