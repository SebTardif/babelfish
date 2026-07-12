import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export type SpawnProcess = (command: string, options: SpawnOptions) => ChildProcess;

export function spawnShellCommand(
  command: string,
  options: Omit<SpawnOptions, "shell">,
  spawnProcess: SpawnProcess = spawn,
): ChildProcess {
  return spawnProcess(command, { ...options, shell: true });
}
