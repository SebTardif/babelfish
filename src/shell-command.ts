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

function commentStarts(command: string, index: number): boolean {
  if (index === 0) return true;
  const previous = command[index - 1] ?? "";
  return previous === " " || previous === "\t" || previous === "\n"
    || previous === ";" || previous === "|" || previous === "&" || previous === "(";
}

type CasePhase = "subject" | "pattern" | "body";

type QuoteFrame = {
  inSingle: boolean;
  inDouble: boolean;
  paren: number;
  backtick: boolean;
  caseStack: CasePhase[];
};

function readHereDocument(command: string, index: number): number | null {
  let cursor = index + 2;
  let stripTabs = false;
  if (command[cursor] === "-") {
    stripTabs = true;
    cursor += 1;
  }
  while (command[cursor] === " " || command[cursor] === "\t") cursor += 1;
  let delimiter = "";
  const quote = command[cursor];
  if (quote === "'" || quote === "\"") {
    const endQuote = command.indexOf(quote, cursor + 1);
    if (endQuote === -1) return null;
    delimiter = command.slice(cursor + 1, endQuote);
    cursor = endQuote + 1;
  } else {
    const start = cursor;
    while (cursor < command.length && !/[\s;&|<>()]/.test(command[cursor] ?? "")) cursor += 1;
    delimiter = command.slice(start, cursor);
    if (!delimiter) return null;
  }
  const lineEnd = command.indexOf("\n", cursor);
  if (lineEnd === -1) return command.length;
  let scan = lineEnd + 1;
  while (scan <= command.length) {
    const next = command.indexOf("\n", scan);
    const lineEndIndex = next === -1 ? command.length : next;
    let line = command.slice(scan, lineEndIndex);
    if (stripTabs) line = line.replace(/^\t+/, "");
    if (line === delimiter) return next === -1 ? command.length : next + 1;
    if (next === -1) return command.length;
    scan = next + 1;
  }
  return command.length;
}

function noteShellWord(frame: QuoteFrame, word: string): void {
  if (word === "case") frame.caseStack.push("subject");
  else if (word === "in" && frame.caseStack.at(-1) === "subject") {
    frame.caseStack[frame.caseStack.length - 1] = "pattern";
  } else if (word === "esac" && frame.caseStack.length > 0) frame.caseStack.pop();
}

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
    caseStack: [],
  }];
  let out = "";
  let word = "";
  const flushWord = (): void => {
    if (!word) return;
    noteShellWord(stack[stack.length - 1]!, word);
    word = "";
  };
  for (let index = 0; index < command.length;) {
    const frame = stack[stack.length - 1]!;
    const character = command[index] ?? "";
    const quoted = frame.inSingle || frame.inDouble;
    if (!frame.inDouble && character === "'") {
      if (!frame.inSingle) flushWord();
      frame.inSingle = !frame.inSingle;
      out += character;
      index += 1;
      continue;
    }
    if (!frame.inSingle && character === "\"") {
      if (!frame.inDouble) flushWord();
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
    if (platform !== "win32" && !frame.inSingle && !frame.inDouble && character === "\\") {
      const next = command[index + 1];
      out += next === undefined ? character : `${character}${next}`;
      index += next === undefined ? 1 : 2;
      continue;
    }
    if (
      platform !== "win32"
      && !frame.inSingle
      && !frame.inDouble
      && character === "#"
      && commentStarts(command, index)
    ) {
      const newline = command.indexOf("\n", index);
      const end = newline === -1 ? command.length : newline + 1;
      out += command.slice(index, end);
      index = end;
      continue;
    }
    if (platform !== "win32" && !quoted && command.startsWith("<<", index)) {
      flushWord();
      const end = readHereDocument(command, index);
      if (end !== null) {
        out += command.slice(index, end);
        index = end;
        continue;
      }
    }
    if (platform !== "win32" && !quoted && command.startsWith(";;", index) && frame.caseStack.at(-1) === "body") {
      flushWord();
      frame.caseStack[frame.caseStack.length - 1] = "pattern";
      out += ";;";
      index += 2;
      continue;
    }
    if (!frame.inSingle && command.startsWith("$(", index)) {
      flushWord();
      stack.push({ inSingle: false, inDouble: false, paren: 1, backtick: false, caseStack: [] });
      out += "$(";
      index += 2;
      continue;
    }
    if (!frame.inSingle && !frame.backtick && character === "`") {
      flushWord();
      stack.push({ inSingle: false, inDouble: false, paren: 0, backtick: true, caseStack: [] });
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
    if (frame.paren > 0 && !quoted && character === "(") {
      flushWord();
      frame.paren += 1;
      out += character;
      index += 1;
      continue;
    }
    if (frame.paren > 0 && !quoted && character === ")") {
      flushWord();
      if (frame.caseStack.at(-1) === "pattern") {
        frame.caseStack[frame.caseStack.length - 1] = "body";
        out += character;
        index += 1;
        continue;
      }
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
    if (platform !== "win32" && !quoted && /[A-Za-z0-9_]/.test(character)) word += character;
    else if (!quoted) flushWord();
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
