# Seatworks Paseo plugin

The kit's server plugin for Paseo 0.8. It applies a seat's profile when an agent is created, points
a seat at its project's config directory, and turns markers, failed turns and watcher sweeps into
attention events.

## Layout

| Path | Holds |
|---|---|
| `index.server.ts` | Builds the runtime and calls `wire()` |
| `server/kit.ts` | The kit model read from the daemon config, `seats.json` and harness manifests, cached until one of those files changes; finding a project's root |
| `server/project.ts` | A project's `.seatworks/project.json`: slug, pinned models and attention settings, with defaults and the problems found; read again on every use |
| `server/runtime.ts` | What features share: the outbox, seat lookup, raising an attention event, timers |
| `server/messages.ts` | Every text an agent or the attention log receives |
| `server/hooks.ts` | `on()`, which logs a failing event handler with its feature's name |
| `server/log.ts`, `server/timeline.ts` | The attention log file, and reading a turn's timeline |
| `server/features/*.ts` | One behavior each: pure functions, plus `register(server, runtime)` for the Paseo calls |
| `server/features/index.ts` | The feature list and `wire()` |
| `server/fakes.ts` | A fake server and a fake `paseo` for tests that go through `wire()` |

## Adding or changing a feature

1. Put the decision in a pure function that takes the kit and the event and returns data, and keep
   the Paseo calls in `register`.
2. Put any text an agent reads in `messages.ts`.
3. Add the module to `features` in `server/features/index.ts`.
4. Test the pure function in a `*.test.ts` beside it, and the behavior end to end in
   `server/wiring.test.ts`.
5. A setting one project may want different goes in `project.ts`, read through
   `runtime.project(root)`: give it a default, and turn an invalid value into a problem and the
   default rather than a failure. `runtime.project` logs each problem once.

## Delivery

Every message the plugin sends an agent goes through `runtime.post()`. It lands in
`~/.paseo/seatworks/outbox.json` first, so a plugin reload or daemon restart loses nothing. It is
sent only when the recipient is idle, has no question of its own open, and has no message from us
still starting; letters waiting then go together when its turn ends, and a letter to an archived agent is
dropped. Only an urgent attention event interrupts a running turn.

A `before` hook that throws fails the operation with its message, which is how a launch is refused;
an `on` handler that throws is only logged. Hooks time out after 30 seconds, and events can overlap
or arrive out of order.

## Checking and loading

```bash
npm install
npm run check
paseo plugin reload seatworks
```

`npm run check` runs `tsc` and `node --test`. Paseo compiles the plugin with esbuild and never
typechecks it. Import local files with their `.ts` extension and SDK types with `import type`, so
Node runs the tests without a build step.
