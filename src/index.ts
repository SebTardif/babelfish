import { resolveConfig } from "./config.js";
import { runBabelfishCli } from "./cli.js";
import {
  callHermesCliCommand,
  callHermesCommand,
  invokeHermesHook,
  invokeHermesMiddleware,
  listHermesPlugins,
  releaseHermesBridge,
  type HermesRuntimeContext,
} from "./hermes-python.js";
import {
  createNativeTools,
  NATIVE_BRIDGE_TOOL_NAMES,
  readGeneratedNativeToolRegistry,
  type GeneratedCommandEntry,
  type NativeTool,
  type NativeToolContext,
  type NativeToolEntry,
} from "./native-tools.js";

type Logger = { warn(message: string): void };
type OpenClawCommandContext = {
  args?: string;
  workspaceDir?: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
};
type OpenClawCliCommand = {
  description(text: string): OpenClawCliCommand;
  argument(flags: string, description?: string): OpenClawCliCommand;
  allowUnknownOption(value?: boolean): OpenClawCliCommand;
  action(handler: (args?: string[]) => unknown): OpenClawCliCommand;
};
type OpenClawCliProgram = {
  command(name: string): OpenClawCliCommand;
};
type OpenClawApi = {
  logger?: Logger;
  on(hook: string, handler: (event: unknown, ctx: unknown) => unknown): void;
  registerTool(
    tool: (ctx: NativeToolContext) => NativeTool[],
    options: { names: string[] },
  ): void;
  registerAgentToolResultMiddleware(
    handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown,
    options?: { runtimes?: string[] },
  ): void;
  registerCommand(command: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    handler(ctx: OpenClawCommandContext): unknown;
  }): void;
  registerCli(
    registrar: (ctx: { program: OpenClawCliProgram }) => void,
    options: {
      commands: string[];
      descriptors: Array<{ name: string; description: string; hasSubcommands: boolean }>;
    },
  ): void;
};

const UNSUPPORTED_WARNING_HOOKS = new Set([
  "pre_approval_request",
  "post_approval_response",
  "kanban_task_claimed",
  "kanban_task_completed",
  "kanban_task_blocked",
  "transform_llm_output",
]);

const UNSUPPORTED_WARNING_MIDDLEWARE = new Set([
  "llm_request",
  "llm_execution",
  "tool_execution",
]);

const config = resolveConfig(undefined);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function hermesKwargs(value: unknown): Record<string, unknown> {
  const raw = record(value);
  const out = { ...raw };
  for (const [key, entry] of Object.entries(raw)) {
    const snake = snakeCase(key);
    if (!(snake in out)) {
      out[snake] = entry;
    }
  }
  if (!("args" in out) && "params" in raw) {
    out.args = raw.params;
  }
  return out;
}

function context(ctx: unknown): HermesRuntimeContext {
  const raw = record(ctx);
  return {
    workspace: typeof raw.workspaceDir === "string" ? raw.workspaceDir : process.cwd(),
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
    sessionKey: typeof raw.sessionKey === "string" ? raw.sessionKey : undefined,
    agentId: typeof raw.agentId === "string" ? raw.agentId : undefined,
    model: typeof raw.modelId === "string" ? raw.modelId : undefined,
    provider: typeof raw.modelProviderId === "string" ? raw.modelProviderId : undefined,
    env: {},
  };
}

async function invokeHook(hook: string, event: unknown, ctx: unknown) {
  return invokeHermesHook(config, { hook, kwargs: hermesKwargs(event), context: context(ctx) });
}

async function invokeMiddleware(kind: string, event: unknown, ctx: unknown) {
  return invokeHermesMiddleware(config, { kind, kwargs: hermesKwargs(event), context: context(ctx) });
}

function firstRecord(results: unknown[]): Record<string, unknown> | undefined {
  return results.map(record).find((item) => Object.keys(item).length > 0);
}

function firstString(results: unknown[]): string | undefined {
  return results.find((item): item is string => typeof item === "string" && item.length > 0);
}

function textResult(text: string): Record<string, unknown> {
  return { content: [{ type: "text", text }] };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function registerWarnings(api: OpenClawApi): void {
  void listHermesPlugins(config).then(
    (list) => {
      for (const plugin of list.plugins) {
        for (const hook of plugin.hooks) {
          if (UNSUPPORTED_WARNING_HOOKS.has(hook)) {
            api.logger?.warn(`Babelfish plugin ${plugin.key} registered unsupported hook ${hook}`);
          }
        }
        for (const middleware of plugin.middleware) {
          if (UNSUPPORTED_WARNING_MIDDLEWARE.has(middleware)) {
            api.logger?.warn(`Babelfish plugin ${plugin.key} registered unsupported middleware ${middleware}`);
          }
        }
      }
    },
    (error: unknown) => {
      api.logger?.warn(`Babelfish could not inspect installed app plugins: ${(error as Error).message}`);
    },
  );
}

function registerToolHooks(api: OpenClawApi): void {
  api.on("before_tool_call", async (event, ctx) => {
    const middlewareResult = await invokeMiddleware("tool_request", event, ctx);
    const rewrite = middlewareResult.results.map(record).find(
      (decision) => decision.args !== null && typeof decision.args === "object" && !Array.isArray(decision.args),
    );
    const hookEvent = rewrite ? { ...record(event), args: rewrite.args, params: rewrite.args } : event;
    const hookResult = await invokeHook("pre_tool_call", hookEvent, ctx);
    // Hermes pre_tool_call is block-only; payload rewrites belong to tool_request middleware.
    const block = hookResult.results
      .map(record)
      .find(
        (decision) => decision.action === "block" && typeof decision.message === "string" && decision.message.length > 0,
      );
    if (block) {
      return {
        block: true,
        blockReason: block.message,
      };
    }
    return rewrite ? { params: rewrite.args } : undefined;
  });

  api.on("after_tool_call", async (event, ctx) => {
    await invokeHook("post_tool_call", event, ctx);
  });

  api.registerAgentToolResultMiddleware(
    async (event, ctx) => {
      const [toolResult, terminalResult] = await Promise.all([
        invokeHook("transform_tool_result", event, ctx),
        invokeHook("transform_terminal_output", event, ctx),
      ]);
      const transformed = firstString([
        ...toolResult.results,
        ...terminalResult.results,
      ]);
      return transformed ? { result: textResult(transformed) } : undefined;
    },
    { runtimes: ["openclaw", "codex"] },
  );
}

export function registerNativeTools(api: OpenClawApi, generated?: NativeToolEntry[]): void {
  const entries = generated ?? readGeneratedNativeToolRegistry().tools;
  api.registerTool((toolContext) => createNativeTools(config, entries, toolContext), {
    names: [...NATIVE_BRIDGE_TOOL_NAMES, ...entries.map((entry) => entry.name)],
  });
}

export function registerHermesCommands(api: OpenClawApi, generated?: GeneratedCommandEntry[]): void {
  const entries = generated ?? readGeneratedNativeToolRegistry().commands;
  for (const entry of entries) {
    api.registerCommand({
      name: entry.name,
      description: entry.description,
      acceptsArgs: true,
      handler: async (ctx) => {
        const result = await callHermesCommand(config, {
          plugin: entry.plugin,
          command: entry.originalName,
          args: ctx.args ?? "",
          context: context(ctx),
        });
        return { text: text(result.result) };
      },
    });
  }
}

export function registerHermesCliCommands(
  api: OpenClawApi,
  generated?: GeneratedCommandEntry[],
): void {
  const entries = generated ?? readGeneratedNativeToolRegistry().cliCommands;
  if (entries.length === 0) {
    return;
  }
  for (const entry of entries) {
    api.registerCli(
      ({ program }) => {
        program
          .command(entry.name)
          .description(entry.description)
          .argument("[args...]", entry.argsHint || "Arguments passed to the imported CLI command.")
          .allowUnknownOption(true)
          .action(async (args = []) => {
            const result = await callHermesCliCommand(config, {
              plugin: entry.plugin,
              command: entry.originalName,
              args,
              context: { workspace: process.cwd(), env: {} },
            });
            if (result.stdout) {
              process.stdout.write(result.stdout);
            }
            if (result.stderr) {
              process.stderr.write(result.stderr);
            }
            if (result.result !== null && result.result !== undefined) {
              const output = text(result.result);
              console.log(output);
            }
          });
      },
      {
        commands: [entry.name],
        descriptors: [{
        name: entry.name,
        description: entry.description,
        hasSubcommands: false,
        }],
      },
    );
  }
}

function registerRunHooks(api: OpenClawApi): void {
  api.on("agent_turn_prepare", async (event, ctx) => {
    const hookResult = await invokeHook("pre_llm_call", event, ctx);
    const contextParts = hookResult.results
      .map((result) => typeof result === "string" ? result : record(result).context)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    return contextParts.length > 0 ? { prependContext: contextParts.join("\n\n") } : undefined;
  });

  api.on("model_call_started", async (event, ctx) => {
    await invokeHook("pre_api_request", event, ctx);
  });
  api.on("model_call_ended", async (event, ctx) => {
    await invokeHook(
      record(event).outcome === "error" ? "api_request_error" : "post_api_request",
      event,
      ctx,
    );
  });
  api.on("llm_output", async (event, ctx) => {
    await invokeHook("post_llm_call", event, ctx);
  });
  api.on("agent_end", async (event, ctx) => {
    await invokeHook("on_session_end", event, ctx);
  });
}

export function registerBabelfishCli(api: OpenClawApi): void {
  api.registerCli(
    ({ program }) => {
      program
        .command("babelfish")
        .description("Manage imported app plugins.")
        .argument("[args...]", "Babelfish command and arguments.")
        .allowUnknownOption(true)
        .action(async (args = []) => runBabelfishCli(args));
    },
    {
      commands: ["babelfish"],
      descriptors: [
        { name: "babelfish", description: "Manage imported app plugins.", hasSubcommands: true },
      ],
    },
  );
}

function registerSessionHooks(api: OpenClawApi): void {
  api.on("session_start", async (event, ctx) => {
    await invokeHook("on_session_start", event, ctx);
  });
  api.on("session_end", async (event, ctx) => {
    const runtimeContext = context(ctx);
    try {
      await invokeHermesHook(config, {
        hook: "on_session_finalize",
        kwargs: hermesKwargs(event),
        context: runtimeContext,
      });
    } finally {
      releaseHermesBridge(config, runtimeContext);
    }
  });
  api.on("before_reset", async (event, ctx) => {
    const runtimeContext = context(ctx);
    try {
      await invokeHermesHook(config, {
        hook: "on_session_reset",
        kwargs: hermesKwargs(event),
        context: runtimeContext,
      });
    } finally {
      releaseHermesBridge(config, runtimeContext);
    }
  });
}

function registerMessageHooks(api: OpenClawApi): void {
  api.on("before_dispatch", async (event, ctx) => {
    const result = firstRecord((await invokeHook("pre_gateway_dispatch", event, ctx)).results);
    // Hermes defines skip/rewrite/allow here; OpenClaw's stable result can only represent skip.
    if (result?.action === "skip") {
      return { handled: true };
    }
    return undefined;
  });
}

function registerSubagentHooks(api: OpenClawApi): void {
  api.on("subagent_spawned", async (event, ctx) => {
    await invokeHook("subagent_start", event, ctx);
  });
  api.on("subagent_ended", async (event, ctx) => {
    await invokeHook("subagent_stop", event, ctx);
  });
}

export default {
  id: "babelfish",
  name: "Babelfish",
  description: "Use plugins from supported coding and agent apps in OpenClaw.",
  register(api: OpenClawApi): void {
    registerNativeTools(api);
    registerBabelfishCli(api);
    registerHermesCommands(api);
    registerHermesCliCommands(api);
    registerWarnings(api);
    registerToolHooks(api);
    registerRunHooks(api);
    registerSessionHooks(api);
    registerMessageHooks(api);
    registerSubagentHooks(api);
  },
};
