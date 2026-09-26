import type { harness } from "./harness.ts";

type Handle = { refresh: () => Promise<unknown>; archive: () => Promise<unknown> };

/**
 * The desk's next `call` on `seat` in Paseo, a look or an archive, is held until `release`, so a call is stopped at a
 * known point while another runs.
 */
export function heldCall(h: ReturnType<typeof harness>, seat: string, call: keyof Handle) {
  const agents = (h.paseo as { agents: { ref: (id: string) => Handle } }).agents;
  const ref = agents.ref;
  let armed = true;
  let reach = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => (reach = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  agents.ref = (id) => {
    const handle = ref(id);
    if (id !== seat) return handle;
    return Object.assign(Object.create(handle) as Handle, {
      [call]: async () => {
        if (armed) {
          armed = false;
          reach();
          await held;
        }
        return handle[call]();
      },
    });
  };
  return { reached, release };
}

/** The desk's next look at `seat` in Paseo is held until `release`. */
export const heldLook = (h: ReturnType<typeof harness>, seat: string) => heldCall(h, seat, "refresh");
