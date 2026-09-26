import type { Attention } from "../../../shared/views.ts";
import type { FileKinds } from "../../core/git.ts";
import type { Kit } from "./kit.ts";

/** What a test file's change is read for: a skip marker it adds, or assertions it loses; global, since they are counted. */
type TestMarkers = { skipped: RegExp; assertion: RegExp };

export function testMarkers(kit: Kit): TestMarkers {
  return {
    skipped: new RegExp(kit.ecosystem.watch.skipped, "gi"),
    assertion: new RegExp(kit.ecosystem.watch.assertion, "gi"),
  };
}

/** How a change to a test file weakened it, if it did: a new skip marker, or fewer assertions. */
export function weakened(before: string, after: string, markers: TestMarkers): string | undefined {
  const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;
  if (count(after, markers.skipped) > count(before, markers.skipped)) return "adds a skip marker";
  const [was, now] = [count(before, markers.assertion), count(after, markers.assertion)];
  return now < was ? `${was} assertions become ${now}` : undefined;
}

/** The patterns the watch reads calls with: the ecosystem's, and attention's where a settings layer set its own. */
export function watchPatterns(kit: Kit, attention: Attention) {
  return {
    destructive: new RegExp(attention.destructive, "i"),
    testPath: new RegExp(attention.testPath, "i"),
    suppressed: new RegExp(attention.suppressed, "i"),
    ...testMarkers(kit),
    runners: new Set(kit.ecosystem.watch.runners),
  };
}

export function fileKinds(kit: Kit): FileKinds {
  return { test: new RegExp(kit.ecosystem.files.test, "i"), docs: new RegExp(kit.ecosystem.files.docs, "i") };
}
