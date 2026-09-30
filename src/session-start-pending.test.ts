import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("rejected session start", () => {
  it("does not fail later turns after session_start times out", async () => {
    const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-session-start-"));
    const bundleRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-babelfish-bundles-"));
    const pluginDir = path.join(installDir, "slow-start");
    await fs.mkdir(pluginDir);
    await fs.writeFile(path.join(pluginDir, "plugin.yaml"), "name: slow-start\n");
    await fs.writeFile(
      path.join(pluginDir, "__init__.py"),
      [
        "import time",
        "",
        "def register(ctx):",
        "    def on_session_start(**kwargs):",
        "        time.sleep(2)",
        "    ctx.register_hook('on_session_start', on_session_start)",
        "",
      ].join("\n"),
    );
    const previousPluginDir = process.env.OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR;
    const previousRoot = process.env.OPENCLAW_BABELFISH_ROOT;
    const previousTimeout = process.env.OPENCLAW_BABELFISH_HERMES_TIMEOUT_MS;
    const hooks = new Map<string, (event: unknown, ctx: unknown) => unknown>();
    const session = { sessionId: "slow-session" };
    try {
      process.env.OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR = installDir;
      process.env.OPENCLAW_BABELFISH_ROOT = bundleRoot;
      process.env.OPENCLAW_BABELFISH_HERMES_TIMEOUT_MS = "200";
      vi.resetModules();
      const module = await import("./index.js");
      const logger = { warn: vi.fn() };
      const api = {
        logger,
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
        hooks.get("session_start")?.({ sessionId: "slow-session" }, session),
      ).rejects.toThrow(/adapter timed out/);

      const prepare = hooks.get("agent_turn_prepare");
      await expect(prepare?.({}, session)).resolves.toBeUndefined();
      await expect(prepare?.({}, session)).resolves.toBeUndefined();
      await expect(prepare?.({}, session)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      await hooks.get("session_end")?.({ sessionId: "slow-session" }, session);
      if (previousPluginDir === undefined) {
        delete process.env.OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR;
      } else {
        process.env.OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR = previousPluginDir;
      }
      if (previousRoot === undefined) {
        delete process.env.OPENCLAW_BABELFISH_ROOT;
      } else {
        process.env.OPENCLAW_BABELFISH_ROOT = previousRoot;
      }
      if (previousTimeout === undefined) {
        delete process.env.OPENCLAW_BABELFISH_HERMES_TIMEOUT_MS;
      } else {
        process.env.OPENCLAW_BABELFISH_HERMES_TIMEOUT_MS = previousTimeout;
      }
      await fs.rm(installDir, { recursive: true, force: true });
      await fs.rm(bundleRoot, { recursive: true, force: true });
    }
  }, 20_000);
});
