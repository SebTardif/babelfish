import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HermesBridgeConfig } from "./config.js";
import {
  callHermesTool,
  listHermesPlugins,
  type HermesCommandSummary,
  type HermesListResult,
  type HermesRuntimeContext,
  type HermesToolSummary,
} from "./hermes-python.js";
import { syncHermesSkills } from "./skill-sync.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const generatedRegistryFile = "babelfish.generated.json";

export const SUPPORTED_APPS = ["hermes"] as const;
export type SupportedApp = (typeof SUPPORTED_APPS)[number];

export const NATIVE_BRIDGE_TOOL_NAMES = ["babelfish_plugins_list"] as const;

const OPENCLAW_RESERVED_COMMANDS = [
  "help", "commands", "status", "diagnostics", "codex", "whoami", "context", "btw",
  "stop", "restart", "reset", "new", "compact", "config", "debug", "allowlist",
  "activation", "skill", "subagents", "kill", "steer", "tell", "model", "models",
  "queue", "send", "bash", "exec", "think", "verbose", "reasoning", "elevated", "usage",
];

const OPENCLAW_CLI_ROOTS = [
  "crestodian", "setup", "onboard", "configure", "config", "backup", "migrate", "doctor",
  "dashboard", "reset", "uninstall", "message", "mcp", "transcripts", "agent", "agents",
  "status", "health", "sessions", "commitments", "tasks", "acp", "gateway", "daemon", "logs",
  "system", "models", "infer", "capability", "approvals", "exec-policy", "nodes", "devices",
  "node", "sandbox", "tui", "terminal", "chat", "cron", "dns", "docs", "qa", "proxy",
  "hooks", "webhooks", "qr", "clawbot", "pairing", "plugins", "channels", "directory",
  "security", "secrets", "skills", "update", "completion", "babelfish",
];

type JsonObject = Record<string, unknown>;

export type NativeToolContext = {
  workspaceDir?: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  modelId?: string;
  modelProviderId?: string;
  activeModel?: {
    provider?: string;
    modelId?: string;
    modelRef?: string;
  };
};

export type NativeTool = {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details?: unknown }>;
};

export type NativeToolEntry = {
  kind: "tool";
  app: SupportedApp;
  name: string;
  plugin: string;
  originalName: string;
  description: string;
  inputSchema: JsonObject;
};

export type GeneratedCommandEntry = {
  app: SupportedApp;
  name: string;
  plugin: string;
  originalName: string;
  description: string;
  argsHint: string;
};

export type GeneratedNativeToolRegistry = {
  generatedAt: string;
  installDir: string;
  tools: NativeToolEntry[];
  commands: GeneratedCommandEntry[];
  cliCommands: GeneratedCommandEntry[];
};

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function sanitizeName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "plugin";
}

function stringifyResult(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function supportedApp(value: unknown): SupportedApp {
  if (value === "hermes") {
    return value;
  }
  throw new Error(`Unsupported app: ${String(value || "(missing)")}`);
}

function result(value: unknown): { content: Array<{ type: "text"; text: string }>; details: unknown } {
  return { content: [{ type: "text", text: stringifyResult(value) }], details: value };
}

function inputSchemaFor(tool: HermesToolSummary): JsonObject {
  const schema = asObject(tool.schema);
  const parameters = asObject(schema?.parameters) ?? asObject(asObject(schema?.function)?.parameters);
  if (parameters?.type === "object") {
    return parameters;
  }
  if (schema?.type === "object") {
    return schema;
  }
  return { type: "object", additionalProperties: true };
}

function generatedToolName(params: {
  plugin: string;
  tool: string;
  duplicates: Set<string>;
}): string {
  if (
    !params.duplicates.has(params.tool) &&
    !NATIVE_BRIDGE_TOOL_NAMES.includes(params.tool as (typeof NATIVE_BRIDGE_TOOL_NAMES)[number])
  ) {
    return params.tool;
  }
  return `${sanitizeName(params.plugin)}__${sanitizeName(params.tool)}`;
}

function uniqueName(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function commandBaseName(command: string): string {
  return sanitizeName(command).replace(/^[^A-Za-z]+/, "").toLowerCase();
}

function commandName(params: { plugin: string; command: string; duplicates: Set<string> }): string {
  const cleaned = commandBaseName(params.command);
  const fallback = `babelfish_${sanitizeName(params.plugin)}_${sanitizeName(params.command)}`.toLowerCase();
  const base = cleaned || fallback;
  if (!params.duplicates.has(base)) {
    return base;
  }
  return fallback;
}

export function buildNativeToolEntries(list: HermesListResult): NativeToolEntry[] {
  const counts = new Map<string, number>();
  for (const plugin of list.plugins) {
    for (const tool of plugin.tools) {
      if (tool.available) {
        counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
      }
    }
  }
  const duplicates = new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name),
  );
  const entries: NativeToolEntry[] = [];
  const usedNames = new Set<string>(NATIVE_BRIDGE_TOOL_NAMES);

  for (const plugin of list.plugins) {
    for (const tool of plugin.tools) {
      if (!tool.available) {
        continue;
      }
      entries.push({
        kind: "tool",
        app: "hermes",
        name: uniqueName(
          generatedToolName({ plugin: plugin.key, tool: tool.name, duplicates }),
          usedNames,
        ),
        plugin: plugin.key,
        originalName: tool.name,
        description: tool.description || `Plugin tool ${plugin.key}/${tool.name}`,
        inputSchema: inputSchemaFor(tool),
      });
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function buildCommandEntries(
  list: HermesListResult,
  select: (plugin: HermesListResult["plugins"][number]) => HermesCommandSummary[],
  reservedNames: string[] = [],
): GeneratedCommandEntry[] {
  const counts = new Map<string, number>();
  for (const plugin of list.plugins) {
    for (const command of select(plugin)) {
      if (command.available) {
        const key = commandBaseName(command.name) || `${plugin.key}/${command.name}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const duplicates = new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name),
  );
  for (const name of reservedNames) {
    duplicates.add(name);
  }
  const usedNames = new Set(reservedNames);
  return list.plugins.flatMap((plugin) =>
    select(plugin)
      .filter((entry) => entry.available)
      .map((entry) => ({
        app: "hermes" as const,
        name: uniqueName(
          commandName({ plugin: plugin.key, command: entry.name, duplicates }),
          usedNames,
        ),
        plugin: plugin.key,
        originalName: entry.name,
        description: entry.description || `Run plugin command ${plugin.key}/${entry.name}`,
        argsHint: entry.argsHint,
      })),
  ).sort((a, b) => a.name.localeCompare(b.name));
}

function registryPath(root = packageRoot): string {
  return path.join(root, generatedRegistryFile);
}

function manifestPath(root = packageRoot): string {
  return path.join(root, "openclaw.plugin.json");
}

export function readGeneratedNativeToolRegistry(root = packageRoot): GeneratedNativeToolRegistry {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath(root), "utf8")) as Partial<GeneratedNativeToolRegistry>;
    return {
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
      installDir: typeof parsed.installDir === "string" ? parsed.installDir : "",
      tools: Array.isArray(parsed.tools) ? parsed.tools.filter(isNativeToolEntry) : [],
      commands: Array.isArray(parsed.commands) ? parsed.commands.filter(isCommandEntry) : [],
      cliCommands: Array.isArray(parsed.cliCommands)
        ? parsed.cliCommands.filter(isCommandEntry)
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    return { generatedAt: "", installDir: "", tools: [], commands: [], cliCommands: [] };
  }
}

function isNativeToolEntry(value: unknown): value is NativeToolEntry {
  const item = asObject(value);
  return (
    item?.kind === "tool" &&
    item.app === "hermes" &&
    typeof item.name === "string" &&
    typeof item.plugin === "string" &&
    typeof item.originalName === "string" &&
    typeof item.description === "string" &&
    asObject(item.inputSchema) !== undefined
  );
}

function isCommandEntry(value: unknown): value is GeneratedCommandEntry {
  const item = asObject(value);
  return (
    typeof item?.name === "string" &&
    item.app === "hermes" &&
    typeof item.plugin === "string" &&
    typeof item.originalName === "string" &&
    typeof item.description === "string" &&
    typeof item.argsHint === "string"
  );
}

async function writeManifestTools(names: string[], root: string): Promise<void> {
  const target = manifestPath(root);
  const manifest = JSON.parse(await fsp.readFile(target, "utf8")) as JsonObject;
  const contracts = asObject(manifest.contracts) ?? {};
  contracts.tools = names;
  manifest.contracts = contracts;
  await fsp.writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function readOptionalFile(target: string): Promise<string | undefined> {
  try {
    return await fsp.readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function restoreFile(target: string, contents: string | undefined): Promise<void> {
  if (contents === undefined) {
    await fsp.rm(target, { force: true });
  } else {
    await fsp.writeFile(target, contents);
  }
}

export async function regenerateNativeTools(
  config: HermesBridgeConfig,
  options: { root?: string } = {},
): Promise<{ generatedTools: string[]; restartRequired: true }> {
  const root = options.root ?? packageRoot;
  const list = await listHermesPlugins(config);
  const failures = list.plugins.filter((plugin) => plugin.error);
  if (failures.length > 0) {
    throw new Error(
      `Could not load installed plugins: ${failures
        .map((plugin) => `${plugin.key}: ${plugin.error}`)
        .join("; ")}`,
    );
  }
  const tools = buildNativeToolEntries(list);
  const commands = buildCommandEntries(list, (plugin) => plugin.commands, OPENCLAW_RESERVED_COMMANDS);
  const cliCommands = buildCommandEntries(list, (plugin) => plugin.cliCommands ?? [], OPENCLAW_CLI_ROOTS);
  const registry: GeneratedNativeToolRegistry = {
    generatedAt: new Date().toISOString(),
    installDir: list.installDir,
    tools,
    commands,
    cliCommands,
  };
  const registryTarget = registryPath(root);
  const manifestTarget = manifestPath(root);
  const skillsTarget = path.join(root, "skills", "babelfish-generated");
  const backupRoot = path.join(root, `.babelfish-regenerate-${process.pid}-${Date.now()}`);
  const previousRegistry = await readOptionalFile(registryTarget);
  const previousManifest = await readOptionalFile(manifestTarget);
  const hadSkills = fs.existsSync(skillsTarget);
  if (hadSkills) {
    await fsp.mkdir(backupRoot, { recursive: true });
    await fsp.cp(skillsTarget, path.join(backupRoot, "skills"), { recursive: true });
  }
  try {
    await fsp.writeFile(registryTarget, `${JSON.stringify(registry, null, 2)}\n`);
    await writeManifestTools([...NATIVE_BRIDGE_TOOL_NAMES, ...tools.map((tool) => tool.name)], root);
    await syncHermesSkills(config, root);
  } catch (error) {
    await restoreFile(registryTarget, previousRegistry);
    await restoreFile(manifestTarget, previousManifest);
    await fsp.rm(skillsTarget, { recursive: true, force: true });
    if (hadSkills) {
      await fsp.cp(path.join(backupRoot, "skills"), skillsTarget, { recursive: true });
    }
    throw error;
  } finally {
    await fsp.rm(backupRoot, { recursive: true, force: true });
  }
  return { generatedTools: tools.map((tool) => tool.name), restartRequired: true };
}

function runtimeContext(ctx: NativeToolContext): HermesRuntimeContext {
  return {
    workspace: ctx.workspaceDir ?? process.cwd(),
    sessionId: ctx.sessionId,
    sessionKey: ctx.sessionKey,
    agentId: ctx.agentId,
    model: ctx.modelId ?? ctx.activeModel?.modelId ?? ctx.activeModel?.modelRef,
    provider: ctx.modelProviderId ?? ctx.activeModel?.provider,
    env: {},
  };
}

function bridgeTools(config: HermesBridgeConfig): NativeTool[] {
  return [
    {
      name: "babelfish_plugins_list",
      description: "List installed app plugins and their registered OpenClaw surfaces.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          app: { type: "string", enum: SUPPORTED_APPS, description: "Optional app filter." },
        },
      },
      execute: async (_toolCallId, params) => {
        const rawApp = asObject(params)?.app;
        if (rawApp !== undefined) {
          const app = supportedApp(rawApp);
          return result({ app, ...(await listHermesPlugins(config)) });
        }
        return result({ apps: [{ app: "hermes", ...(await listHermesPlugins(config)) }] });
      },
    },
  ];
}

function generatedTools(
  config: HermesBridgeConfig,
  entries: NativeToolEntry[],
  ctx: NativeToolContext,
): NativeTool[] {
  return entries.map((entry) => ({
    name: entry.name,
    description: entry.description,
    parameters: entry.inputSchema,
    execute: async (_toolCallId, params, signal) => {
      const openclawContext = runtimeContext(ctx);
      const tool = await callHermesTool(
        config,
        {
          plugin: entry.plugin,
          tool: entry.originalName,
          args: params ?? {},
          context: openclawContext,
        },
        { signal },
      );
      return result(tool.parsedResult ?? tool.result);
    },
  }));
}

export function createNativeTools(
  config: HermesBridgeConfig,
  entries: NativeToolEntry[],
  ctx: NativeToolContext,
): NativeTool[] {
  return [...bridgeTools(config), ...generatedTools(config, entries, ctx)];
}
