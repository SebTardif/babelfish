import { resolveConfig } from "./config.js";
import { installHermesPlugin, uninstallHermesPlugin } from "./git-install.js";
import { listHermesPlugins } from "./hermes-python.js";
import { regenerateNativeTools } from "./native-tools.js";

function readOptionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function usage(): string {
  return [
    "Usage:",
    "  babelfish mcp",
    "  babelfish list [app]",
    "  babelfish install <app> <source> [--name <name>] [--force]",
    "  babelfish uninstall <app> <name>",
  ].join("\n");
}

function requireApp(value: string | undefined): "hermes" {
  if (value === "hermes") {
    return value;
  }
  throw new Error(`Unsupported app: ${value || "(missing)"}`);
}

export async function runBabelfishCli(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "-h" || command === "--help") {
    console.log(usage());
    return;
  }

  const config = resolveConfig(undefined);
  if (command === "mcp") {
    const { startHermesMcpServer } = await import("./mcp-server.js");
    await startHermesMcpServer(config);
    return;
  }

  if (command === "list") {
    const app = args[1];
    if (app) {
      requireApp(app);
      console.log(JSON.stringify({ app, ...(await listHermesPlugins(config)) }, null, 2));
      return;
    }
    console.log(
      JSON.stringify({ apps: [{ app: "hermes", ...(await listHermesPlugins(config)) }] }, null, 2),
    );
    return;
  }

  if (command === "install") {
    const app = requireApp(args[1]);
    const source = args[2];
    if (!source || source.startsWith("--")) {
      throw new Error(usage());
    }
    let generated: Awaited<ReturnType<typeof regenerateNativeTools>> | undefined;
    const result = await installHermesPlugin({
      installDir: config.installDir,
      source,
      name: readOptionValue(args, "--name"),
      force: args.includes("--force"),
      afterChange: async () => {
        generated = await regenerateNativeTools(config);
      },
    });
    console.log(JSON.stringify({ app, installed: result, ...generated }, null, 2));
    return;
  }

  if (command === "uninstall") {
    const app = requireApp(args[1]);
    const name = args[2];
    if (!name || name.startsWith("--")) {
      throw new Error(usage());
    }
    let generated: Awaited<ReturnType<typeof regenerateNativeTools>> | undefined;
    const result = await uninstallHermesPlugin({
      installDir: config.installDir,
      name,
      afterChange: async () => {
        generated = await regenerateNativeTools(config);
      },
    });
    console.log(JSON.stringify({ app, removed: result, ...generated }, null, 2));
    return;
  }

  throw new Error(usage());
}
