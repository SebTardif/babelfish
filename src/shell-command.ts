import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
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

const SHELL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

type QuoteFrame = {
  inSingle: boolean;
  inDouble: boolean;
  paren: number;
  backtick: boolean;
};

// Values already inside single quotes are inserted here. The shell never
// expands ${NAME} in single quotes, and a raw insert would let a quote in
// the value close a POSIX string. A $(...) or backtick command starts a new
// quote context, including when the outer command is double-quoted. cmd.exe
// treats apostrophes as ordinary characters, so Windows copies the value.
export function expandSingleQuotedShellVariables(
  command: string,
  resolve: (name: string) => string | undefined,
  platform: NodeJS.Platform = process.platform,
): string {
  const stack: QuoteFrame[] = [{
    inSingle: false,
    inDouble: false,
    paren: 0,
    backtick: false,
  }];
  let out = "";
  for (let index = 0; index < command.length;) {
    const frame = stack[stack.length - 1]!;
    const character = command[index] ?? "";
    if (!frame.inDouble && character === "'") {
      frame.inSingle = !frame.inSingle;
      out += character;
      index += 1;
      continue;
    }
    if (!frame.inSingle && character === "\"") {
      frame.inDouble = !frame.inDouble;
      out += character;
      index += 1;
      continue;
    }
    if (frame.inDouble && character === "\\") {
      const next = command[index + 1];
      out += next === undefined ? character : `${character}${next}`;
      index += next === undefined ? 1 : 2;
      continue;
    }
    if (frame.backtick && !frame.inSingle && character === "\\") {
      const next = command[index + 1];
      out += next === undefined ? character : `${character}${next}`;
      index += next === undefined ? 1 : 2;
      continue;
    }
    if (!frame.inSingle && command.startsWith("$(", index)) {
      stack.push({ inSingle: false, inDouble: false, paren: 1, backtick: false });
      out += "$(";
      index += 2;
      continue;
    }
    if (!frame.inSingle && !frame.backtick && character === "`") {
      stack.push({ inSingle: false, inDouble: false, paren: 0, backtick: true });
      out += character;
      index += 1;
      continue;
    }
    if (frame.backtick && !frame.inSingle && character === "`") {
      stack.pop();
      out += character;
      index += 1;
      continue;
    }
    if (frame.paren > 0 && !frame.inSingle && !frame.inDouble && character === "(") {
      frame.paren += 1;
      out += character;
      index += 1;
      continue;
    }
    if (frame.paren > 0 && !frame.inSingle && !frame.inDouble && character === ")") {
      frame.paren -= 1;
      out += character;
      index += 1;
      if (frame.paren === 0) stack.pop();
      continue;
    }
    if (command.startsWith("${", index)) {
      const end = command.indexOf("}", index + 2);
      const name = end === -1 ? "" : command.slice(index + 2, end);
      if (end !== -1 && SHELL_NAME.test(name)) {
        if (frame.inSingle) {
          const value = resolve(name);
          if (value !== undefined) {
            out += platform === "win32" ? value : value.replaceAll("'", "'\\''");
            index = end + 1;
            continue;
          }
        }
        out += command.slice(index, end + 1);
        index = end + 1;
        continue;
      }
    }
    out += character;
    index += 1;
  }
  return out;
}

// cmd.exe expands %NAME%, not ${NAME}. The value stays in the environment.
export function commandForPlatformShell(command: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") {
    return command;
  }
  return command.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => `%${name}%`);
}

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
  command: string | readonly string[],
  mode: "command" | "monitor",
  options: Omit<SpawnOptions, "shell">,
  spawnProcess: SpawnProcess,
): ChildProcess {
  return spawnProcess(
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
      typeof command === "string" ? "-CommandBase64" : "-ArgvBase64",
      Buffer.from(typeof command === "string" ? command : JSON.stringify(command), "utf8").toString("base64"),
    ],
    { ...options, detached: false, windowsHide: true },
  );
}

export function spawnShellCommand(
  command: string | readonly string[],
  options: Omit<SpawnOptions, "shell">,
  platform: NodeJS.Platform = process.platform,
  spawnProcess: SpawnProcess = spawn,
): ChildProcess {
  if (typeof command === "string") {
    command = commandForPlatformShell(command, platform);
  }
  if (typeof command !== "string") {
    const [file, ...args] = command;
    if (!file) {
      throw new Error("Command argv is empty");
    }
    if (platform === "win32") {
      return spawnWindowsJobCommand(command, "command", options, spawnProcess);
    }
    return spawnProcess(file, args, options);
  }
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
  const shellCommand = commandForPlatformShell(command, platform);
  if (platform === "win32") {
    return spawnWindowsJobCommand(shellCommand, "monitor", options, spawnProcess);
  }
  return spawnShellCommand(shellCommand, options, platform, spawnProcess);
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
