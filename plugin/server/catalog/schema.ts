import { isAbsolute } from "node:path";
import { z } from "zod";
import { AttentionChoice } from "../../shared/settings.ts";

const text = z.string().min(1);
const texts = z.array(z.string());
const Json = z.record(z.string(), z.unknown());

/** A pattern the kit hands to `new RegExp` later, inside a try that reads a failure as "not reachable", so a typo must be caught here. */
const pattern = z.string().refine(
  (value) => {
    try {
      new RegExp(value, "i");
      return true;
    } catch {
      return false;
    }
  },
  { error: "is not a pattern this machine can read" },
);

const McpTransport = z.enum(["stdio", "http", "sse"]);

export const HarnessFile = z
  .strictObject({
    id: text,
    label: text,
    baseProvider: text,
    configDirEnv: text,
    profileRoot: text,
    contextFile: text.optional(),
    skillsDir: text,
    steers: z.boolean().optional(),
    stateWrites: z.strictObject({ path: text, delivery: z.enum(["launch", "file"]) }).optional(),
    hideSkills: z.strictObject({ roots: z.array(text).min(1), setting: text }).optional(),
    projectContextOption: text.optional(),
    projectInstructions: z.strictObject({ reads: z.array(text).min(1), otherwise: z.array(text).min(1), importAs: z.string().includes("{path}", { error: "does not say where the file's path goes" }) }).optional(),
    mcpCall: z.string().includes("{server}", { error: "does not say where the server's name goes" }).optional(),
    mcpServerField: text.optional(),
    timeline: z
      .strictObject({
        exitField: text.optional(),
        pseudoCalls: z.array(z.strictObject({ name: text, detail: text })).optional(),
        unparsed: z.strictObject({ input: text, error: pattern }).optional(),
      })
      .optional(),
    settings: z.strictObject({
      file: text,
      source: text,
      roleSource: text,
      inherits: z.strictObject({ from: text, keys: texts }).optional(),
      overlayEnv: text.optional(),
    }),
    links: z.array(z.strictObject({ link: text, target: text, optional: z.boolean().optional() })).optional(),
    files: z.record(z.string(), z.array(z.string()).min(1)).optional(),
    modelCatalog: z.strictObject({ command: z.array(z.string()).min(1), list: z.string(), clear: texts, file: z.string(), setting: z.string() }).optional(),
    checks: z.array(z.strictObject({ path: z.string(), help: z.string() })).optional(),
    mcp: z.strictObject({
      file: text,
      delivery: z.enum(["launch", "file"]),
      preapprove: z.boolean().optional(),
      transports: z.array(McpTransport).min(1),
      seed: Json.optional(),
      key: text.optional(),
      clear: z.strictObject({ set: Json.optional(), remove: texts.optional(), setInEach: z.record(z.string(), Json).optional() }).optional(),
      desk: Json.optional(),
    }),
    provider: z.strictObject({
      env: z.record(z.string(), z.string()).optional(),
      profileModeId: text.optional(),
      command: texts.optional(),
      forceFlags: z.record(z.string(), z.string()).optional(),
    }),
  })
  .refine((harness) => harness.mcp.delivery !== "file" || harness.mcp.key, { error: "delivers MCP servers in a file but names no key", path: ["mcp", "key"] });

const ProxyHook = { tool: text, args: Json.optional(), when: pattern.optional(), timeoutSeconds: z.number().positive().optional() };

const Proxy = z.strictObject({
  backend: z.discriminatedUnion("type", [z.strictObject({ type: z.literal("http"), url: text }), z.strictObject({ type: z.literal("stdio"), command: z.array(z.string()).min(1) })]),
  pin: text.optional(),
  gitExclude: texts.optional(),
  open: z.strictObject({ ...ProxyHook, route: z.strictObject({ when: pattern, from: text, field: text }).optional() }).optional(),
  close: z.strictObject(ProxyHook).optional(),
  wait: z.strictObject({ ...ProxyHook, busy: pattern.optional(), seconds: z.number().positive().optional(), pollSeconds: z.number().positive().optional() }).optional(),
  sync: z.strictObject({ tool: text, paths: text.optional(), maxPaths: z.number().int().positive().optional() }).optional(),
  errors: z.array(z.strictObject({ when: pattern, reply: text })).optional(),
  descriptions: z.record(z.string(), z.string()).optional(),
  timeoutSeconds: z.number().positive().optional(),
});

const McpSetting = z.strictObject({ type: z.enum(["number", "string", "boolean"]), label: text, default: z.union([z.string(), z.number(), z.boolean()]).optional() });

export const McpFile = z
  .strictObject({
    id: text,
    label: text,
    description: z.string().optional(),
    order: z.number().optional(),
    kind: z.enum(["proxy", "server"]),
    proxy: Proxy.optional(),
    instructions: z.string().optional(),
    server: z.looseObject({ type: McpTransport }).optional(),
    settings: z.record(z.string(), McpSetting).default({}),
    defaults: z.strictObject({ enabled: z.boolean() }).default({ enabled: false }),
    tools: z.record(z.string(), texts).optional(),
    roles: texts.optional(),
    rule: text.optional(),
    roleNotes: z.record(z.string(), z.string()).optional(),
    skills: texts.optional(),
    help: z.string().optional(),
    requires: z.array(text.refine((path) => !isAbsolute(path), { error: "is not a path inside the project" })).optional(),
  })
  .refine((entry) => entry.kind !== "proxy" || entry.proxy, { error: "is a proxy with no proxy block", path: ["proxy"] })
  .refine((entry) => entry.kind !== "server" || entry.server, { error: "is a server with no server block", path: ["server"] });

const Role = z.strictObject({
  role: text,
  label: text,
  description: z.string().optional(),
  concern: z.string().optional(),
  can: texts.optional(),
  tools: text.optional(),
  follows: text.optional(),
  defaults: z.strictObject({ harness: text, model: text.optional(), thinking: text.optional() }).optional(),
  prompt: text,
  skills: text.nullable(),
  extraSkills: z.array(z.string().regex(/^[^:]+:[^:]+$/, { error: "is not written set:name" })).optional(),
  paseoTools: z.strictObject({ enabled: z.boolean().optional(), disabledTools: texts.optional(), allow: texts.optional() }).optional(),
  hidesWords: texts.optional(),
  writes: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/?$/, { error: "is not one file, or one folder ending in /, under the project's state" })).optional(),
});

export const RolesFile = z.strictObject({
  providerPrefix: z.string().optional(),
  attention: AttentionChoice.optional(),
  roles: z.array(Role),
});

/** The tools Paseo gives every agent, as a list the plugin keeps in step with Paseo. */
export const PaseoFile = z.strictObject({ tools: z.array(text).min(1) });

/** Commands a seat's shell finds refused on its PATH, each with why: what a rule on the command line misses, such as `env gh`. */
export const RefusedFile = z.record(z.string(), text).refine((list) => Object.keys(list).every((name) => /^[\w.+-]+$/.test(name)), { error: "names what is not a command's name" });

const Gate = z.strictObject({
  files: z.array(text).min(1),
  script: text.optional(),
  run: text,
  lockfiles: z.record(z.string(), text).optional(),
});

/** `reviewQuestion` goes to every review of a change under `paths`, and `rehearse`, a project command, runs with the lane gate. It never holds a landing. */
export const RiskRule = z.strictObject({ paths: z.array(text).min(1), invariant: text, reviewQuestion: text, rehearse: text.optional() });

export type RiskRule = z.infer<typeof RiskRule>;

export const EcosystemFile = z.strictObject({
  serialOnly: texts,
  riskRules: z.array(RiskRule),
  gates: z.array(Gate),
  scriptRunners: texts,
  unsetScript: text,
  files: z.strictObject({ test: pattern, docs: pattern }),
  watch: z.strictObject({
    destructive: pattern,
    testPath: pattern,
    suppressed: pattern,
    skipped: pattern,
    assertion: pattern,
    refused: pattern,
    runners: texts,
  }),
});

/** A model the watch may ask over HTTP; `key` names the secret it takes, which the machine settings keep. */
export const SensorFile = z.strictObject({
  id: text,
  label: text,
  key: text,
  url: z.url({ protocol: /^https$/, error: "is not an https address" }),
  model: text,
  terms: text,
  body: Json.optional(),
  timeoutSeconds: z.number().min(1).max(30),
  retries: z.number().int().min(0).max(3),
});

/** A field the code fills is null in `instructions` until the moment it is asked at fills it; `question` is the question itself. */
const Instructions = z.union([text, z.record(z.string(), text.nullable()).refine((fields) => typeof fields.question === "string", { error: "names no question" })]);

const Mode = z.enum(["off", "shadow"]);
const unit = z.number().min(0).max(1);

/**
 * One condition, answered yes or no: at or above `yes` it holds, at or below `no` it does not, and between is unclear. A question
 * about an act names in `acts` each fact that opens it and the act as it asks it, the fact's own words where `{quote}` is.
 */
const Noul = z
  .strictObject({ type: z.literal("noul"), instructions: Instructions, criteria: z.strictObject({ true: text, false: text }), acts: z.record(z.string(), text.includes("{quote}")).optional(), mode: Mode, yes: unit, no: unit })
  .refine((check) => check.no < check.yes, { error: "no must sit below yes" });

/** One of several answers, taken at `sure` or more and unclear below; `after` names who an instruction must come from for it to be asked. */
const Choice = z
  .strictObject({ type: z.literal("choice"), instructions: Instructions, criteria: z.record(z.string(), text), mode: Mode, sure: unit, after: z.array(text).optional() })
  .refine((check) => Object.keys(check.criteria).length >= 2, { error: "a choice needs two criteria or more" });

export const ChecksFile = z.record(z.string().regex(/^[a-z][a-z_]*$/, { error: "is not a lowercase name" }), z.discriminatedUnion("type", [Noul, Choice]));
