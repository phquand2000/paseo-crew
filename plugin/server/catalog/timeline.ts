import type { HarnessSpec } from "./kit.ts";

/** How a harness writes its timeline where it differs from the rest, as its harness file says. */
export type Quirks = NonNullable<HarnessSpec["timeline"]>;

/** The exit code a harness keeps beside the call rather than in its detail, where its quirks say. */
export function exitOf(item: Record<string, unknown>, field: string | undefined): number | undefined {
  const found = field?.split(".").reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], item);
  return typeof found === "number" ? found : undefined;
}

/** A call Paseo marks as its own, or one the harness sends that is no call the seat made. */
export function pseudo(item: Record<string, unknown>, quirks: Quirks): boolean {
  const metadata = item.metadata as { synthetic?: unknown } | undefined;
  const detail = item.detail as { type?: unknown } | undefined;
  return metadata?.synthetic === true || (quirks.pseudoCalls ?? []).some((call) => item.name === call.name && detail?.type === call.detail);
}
