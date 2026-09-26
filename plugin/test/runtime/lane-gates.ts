import type { harness } from "./harness.ts";

type Look = { refresh: () => Promise<unknown> };

/** The desk's next look at `seat` in Paseo is held until `release`, so a call is stopped at a known point while another runs. */
export function heldLook(h: ReturnType<typeof harness>, seat: string) {
  const agents = (h.paseo as { agents: { ref: (id: string) => Look } }).agents;
  const ref = agents.ref;
  let armed = true;
  let looked = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => (looked = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  agents.ref = (id) => {
    const handle = ref(id);
    if (id !== seat) return handle;
    return Object.assign(Object.create(handle) as Look, {
      refresh: async () => {
        if (armed) {
          armed = false;
          looked();
          await held;
        }
        return handle.refresh();
      },
    });
  };
  return { reached, release };
}
