import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export function spawnShellCommand(
  command: string,
  options: Omit<SpawnOptions, "shell">,
  platform: NodeJS.Platform = process.platform,
  spawnProcess: SpawnProcess = spawn,
): ChildProcess {
  if (platform === "win32") {
    return spawnProcess(command, [], { ...options, shell: true });
  }
  return spawnProcess("/bin/sh", ["-lc", command], options);
}

export function spawnMonitorShellCommand(
  command: string,
  options: Omit<SpawnOptions, "shell">,
  platform: NodeJS.Platform = process.platform,
  spawnProcess: SpawnProcess = spawn,
): ChildProcess {
  const monitorCommand = platform === "win32"
    ? `${command}\r\nping.exe -t 127.0.0.1 >NUL`
    : command;
  return spawnShellCommand(monitorCommand, options, platform, spawnProcess);
}

export function terminateShellProcessTree(
  child: ChildProcess,
  platform: NodeJS.Platform = process.platform,
  signal: NodeJS.Signals = "SIGTERM",
  spawnBinary: SpawnProcess = spawn,
  killProcess: typeof process.kill = process.kill,
): void {
  if (!child.pid) return;

  if (platform === "win32") {
    if (child.exitCode != null || child.signalCode != null) return;
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
    killProcess(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}
