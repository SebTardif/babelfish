import os from "node:os";
import path from "node:path";

export type HermesBridgeConfig = {
  installDir: string;
  python: string;
  timeoutMs: number;
  env: Record<string, string>;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const env: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      env[key] = raw;
    }
  }
  return env;
}

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function defaultInstallDir(): string {
  return path.join(os.homedir(), ".openclaw", "babelfish", "hermes");
}

export function resolveConfig(raw: Record<string, unknown> | undefined): HermesBridgeConfig {
  const timeout =
    typeof raw?.timeoutMs === "number"
      ? Math.trunc(raw.timeoutMs)
      : Number.parseInt(process.env.OPENCLAW_BABELFISH_HERMES_TIMEOUT_MS ?? "", 10) || 120000;
  const installDir =
    readString(raw?.installDir) ??
    process.env.OPENCLAW_BABELFISH_HERMES_PLUGIN_DIR ??
    defaultInstallDir();
  return {
    installDir: expandHome(installDir),
    python: readString(raw?.python) ?? process.env.OPENCLAW_BABELFISH_HERMES_PYTHON ?? "python3",
    timeoutMs: Math.max(1000, timeout),
    env: readEnv(raw?.env),
  };
}
