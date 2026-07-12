import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export type SpawnProcess = (command: string, options: SpawnOptions) => ChildProcess;
export type SpawnBinary = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export function spawnShellCommand(
  command: string,
  options: Omit<SpawnOptions, "shell">,
  spawnProcess: SpawnProcess = spawn,
): ChildProcess {
  return spawnProcess(command, { ...options, shell: true });
}

export function terminateShellProcessTree(
  child: ChildProcess,
  platform: NodeJS.Platform = process.platform,
  spawnBinary: SpawnBinary = spawn,
  killProcess: typeof process.kill = process.kill,
): void {
  if (!child.pid) return;

  if (platform === "win32") {
    let fellBack = false;
    const fallback = () => {
      if (fellBack) return;
      fellBack = true;
      child.kill();
    };
    const killer = spawnBinary(
      "taskkill",
      ["/pid", String(child.pid), "/t", "/f"],
      { stdio: "ignore", windowsHide: true },
    );
    killer.once("error", fallback);
    killer.once("exit", (code) => {
      if (code !== 0) fallback();
    });
    return;
  }

  try {
    killProcess(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
