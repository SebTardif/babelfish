import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("tool calls when the Hermes bridge cannot start", () => {
  it("resolves before_tool_call when python is missing and warns", async () => {
    const pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-plugins-"));
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-root-"));
    const missingPython = path.join(rootDir, "missing-python");
    const previousPluginDir = process.env.OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR;
    const previousRoot = process.env.OPENCLAW_BABELFISH_ROOT;
    const previousPython = process.env.OPENCLAW_BABELFISH_HERMES_PYTHON;
    try {
      process.env.OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR = pluginDir;
      process.env.OPENCLAW_BABELFISH_ROOT = rootDir;
      process.env.OPENCLAW_BABELFISH_HERMES_PYTHON = missingPython;
      vi.resetModules();
      const module = await import("./index.js");
      const hooks = new Map<string, (event: unknown, ctx: unknown) => unknown>();
      const api = {
        logger: { warn: vi.fn() },
        on: vi.fn((name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
          hooks.set(name, handler);
        }),
        registerTool: vi.fn(),
        registerCommand: vi.fn(),
        registerCli: vi.fn(),
        registerAgentToolResultMiddleware: vi.fn(),
      };

      module.default.register(api);

      await expect(
        hooks.get("before_tool_call")?.({ toolName: "echo" }, { sessionId: "session-1" }),
      ).resolves.toBeUndefined();
      expect(api.logger.warn).toHaveBeenCalled();
    } finally {
      if (previousPluginDir === undefined) delete process.env.OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR;
      else process.env.OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR = previousPluginDir;
      if (previousRoot === undefined) delete process.env.OPENCLAW_BABELFISH_ROOT;
      else process.env.OPENCLAW_BABELFISH_ROOT = previousRoot;
      if (previousPython === undefined) delete process.env.OPENCLAW_BABELFISH_HERMES_PYTHON;
      else process.env.OPENCLAW_BABELFISH_HERMES_PYTHON = previousPython;
      await fs.rm(pluginDir, { recursive: true, force: true });
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("still blocks when another plugin fails to load", async () => {
    const pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-plugins-"));
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-root-"));
    const previousPluginDir = process.env.OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR;
    const previousRoot = process.env.OPENCLAW_BABELFISH_ROOT;
    const previousPython = process.env.OPENCLAW_BABELFISH_HERMES_PYTHON;
    try {
      await writePlugin(pluginDir, "aaa-broken", "def register(ctx):\n    raise RuntimeError('register failed')\n");
      await writePlugin(
        pluginDir,
        "zzz-blocker",
        [
          "def register(ctx):",
          "    def pre_tool(**kwargs):",
          "        if kwargs.get('tool_name') == 'blocked':",
          "            return {'action': 'block', 'message': 'blocked'}",
          "        return None",
          "    ctx.register_hook('pre_tool_call', pre_tool)",
          "",
        ].join("\n"),
      );
      process.env.OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR = pluginDir;
      process.env.OPENCLAW_BABELFISH_ROOT = rootDir;
      process.env.OPENCLAW_BABELFISH_HERMES_PYTHON = "python3";
      vi.resetModules();
      const module = await import("./index.js");
      const hooks = new Map<string, (event: unknown, ctx: unknown) => unknown>();
      const api = {
        logger: { warn: vi.fn() },
        on: vi.fn((name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
          hooks.set(name, handler);
        }),
        registerTool: vi.fn(),
        registerCommand: vi.fn(),
        registerCli: vi.fn(),
        registerAgentToolResultMiddleware: vi.fn(),
      };

      module.default.register(api);

      await expect(
        hooks.get("before_tool_call")?.({ toolName: "blocked" }, { sessionId: "session-1" }),
      ).resolves.toEqual({ block: true, blockReason: "blocked" });
    } finally {
      if (previousPluginDir === undefined) delete process.env.OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR;
      else process.env.OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR = previousPluginDir;
      if (previousRoot === undefined) delete process.env.OPENCLAW_BABELFISH_ROOT;
      else process.env.OPENCLAW_BABELFISH_ROOT = previousRoot;
      if (previousPython === undefined) delete process.env.OPENCLAW_BABELFISH_HERMES_PYTHON;
      else process.env.OPENCLAW_BABELFISH_HERMES_PYTHON = previousPython;
      await fs.rm(pluginDir, { recursive: true, force: true });
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});

async function writePlugin(installDir: string, name: string, source: string): Promise<void> {
  const pluginDir = path.join(installDir, name);
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(path.join(pluginDir, "plugin.yaml"), `name: ${name}\nversion: 1.0.0\ndescription: ${name}\n`);
  await fs.writeFile(path.join(pluginDir, "__init__.py"), source);
}
