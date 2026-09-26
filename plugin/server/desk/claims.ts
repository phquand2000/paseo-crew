import type { Project } from "./project.ts";

/** The key a lane or task is claimed under in its project. */
export const workKey = (project: Project, id: string): string => `${project.slug}:${id}`;

/** Work a call in this process has in hand, such as a lane being closed; a restart loses it, and the patrol repairs what it left. */
export class Claims {
  private readonly held = new Set<string>();

  /** Takes `key` for the caller; false when another call holds it. */
  take(key: string): boolean {
    if (this.held.has(key)) return false;
    this.held.add(key);
    return true;
  }

  has(key: string): boolean {
    return this.held.has(key);
  }

  release(key: string): void {
    this.held.delete(key);
  }
}
