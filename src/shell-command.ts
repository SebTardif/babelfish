import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

const windowsJobScript = fileURLToPath(
  new URL("../assets/windows-job.ps1", import.meta.url),
);

function windowsPowerShellPath(systemRoot = process.env.SystemRoot): string {
  const root = systemRoot && path.win32.isAbsolute(systemRoot)
    ? systemRoot
    : "C:\\Windows";
  return path.win32.join(
    root,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

function spawnWindowsJobCommand(
  command: string,
  mode: "command" | "monitor",
  options: Omit<SpawnOptions, "shell">,
  spawnProcess: SpawnProcess,
): ChildProcess {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-babelfish-"));
  const commandFile = path.join(tempDir, "command.cmd");
  writeFileSync(commandFile, command, "utf8");

  let child: ChildProcess;
  try {
    child = spawnProcess(
      windowsPowerShellPath(),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        windowsJobScript,
        "-Mode",
        mode,
        "-CommandFile",
        commandFile,
      ],
      { ...options, windowsHide: true },
    );
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
  child.once("close", () => {
    rmSync(tempDir, { recursive: true, force: true });
  });
  return child;
}

export function spawnShellCommand(
  command: string,
  options: Omit<SpawnOptions, "shell">,
  platform: NodeJS.Platform = process.platform,
  spawnProcess: SpawnProcess = spawn,
): ChildProcess {
  if (platform === "win32") {
    return spawnWindowsJobCommand(command, "command", options, spawnProcess);
  }
  return spawnProcess("/bin/sh", ["-lc", command], options);
}

export function spawnMonitorShellCommand(
  command: string,
  options: Omit<SpawnOptions, "shell">,
  platform: NodeJS.Platform = process.platform,
  spawnProcess: SpawnProcess = spawn,
): ChildProcess {
  if (platform === "win32") {
    return spawnWindowsJobCommand(command, "monitor", options, spawnProcess);
  }
  return spawnShellCommand(command, options, platform, spawnProcess);
}

export function terminateShellProcessTree(
  child: ChildProcess,
  platform: NodeJS.Platform = process.platform,
  signal: NodeJS.Signals = "SIGTERM",
  killProcess: typeof process.kill = process.kill,
): void {
  if (!child.pid) return;

  if (platform === "win32") {
    if (child.exitCode != null || child.signalCode != null) return;
    child.kill();
    return;
  }

  try {
    killProcess(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}
