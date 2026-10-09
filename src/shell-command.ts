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
const WIN_INSERTED_DOLLAR = "$\u0000";

function shieldWindowsValue(value: string): string {
  return value.replaceAll("${", `${WIN_INSERTED_DOLLAR}{`);
}

function commentStarts(command: string, index: number): boolean {
  if (index === 0) return true;
  const previous = command[index - 1] ?? "";
  return previous === " " || previous === "\t" || previous === "\n"
    || previous === ";" || previous === "|" || previous === "&"
    || previous === "(" || previous === ")";
}

type CasePhase = "subject" | "pattern" | "body";

type HereDoc = {
  delimiter: string;
  stripTabs: boolean;
  quoted: boolean;
};

const OPENS_COMMAND = new Set(["if", "then", "else", "elif", "while", "until", "do"]);

type QuoteFrame = {
  inSingle: boolean;
  inDouble: boolean;
  paren: number;
  backtick: boolean;
  caseStack: CasePhase[];
  commandPosition: boolean;
  pendingDocs: HereDoc[];
  literalHere: boolean;
};

function parseHereHeader(command: string, index: number): { cursor: number; doc: HereDoc } | null {
  let cursor = index + 2;
  let stripTabs = false;
  if (command[cursor] === "-") {
    stripTabs = true;
    cursor += 1;
  }
  while (command[cursor] === " " || command[cursor] === "\t") cursor += 1;
  let delimiter = "";
  let quoted = false;
  while (cursor < command.length) {
    const mark = command[cursor] ?? "";
    if (mark === "'") {
      const endQuote = command.indexOf("'", cursor + 1);
      if (endQuote === -1) return null;
      delimiter += command.slice(cursor + 1, endQuote);
      cursor = endQuote + 1;
      quoted = true;
      continue;
    }
    if (mark === "\"") {
      let text = "";
      let scan = cursor + 1;
      let closed = false;
      while (scan < command.length) {
        if (command[scan] === "\\" && command[scan + 1] !== undefined) {
          const next = command[scan + 1] ?? "";
          if (next === "\\" || next === "$" || next === "`" || next === "\"" || next === "\n") {
            text += next;
            scan += 2;
            continue;
          }
          text += "\\";
          scan += 1;
          continue;
        }
        if (command[scan] === "\"") {
          closed = true;
          break;
        }
        text += command[scan];
        scan += 1;
      }
      if (!closed) return null;
      delimiter += text;
      cursor = scan + 1;
      quoted = true;
      continue;
    }
    if (mark === "\\") {
      const next = command[cursor + 1];
      if (next === undefined || next === "\n") break;
      delimiter += next;
      cursor += 2;
      quoted = true;
      continue;
    }
    if (/[\s;&|<>()]/.test(mark)) break;
    delimiter += mark;
    cursor += 1;
  }
  if (!delimiter && !quoted) return null;
  return { cursor, doc: { delimiter, stripTabs, quoted } };
}

function appendPendingHereDocs(
  command: string,
  index: number,
  frame: QuoteFrame,
  out: string,
  resolve: (name: string) => string | undefined,
  platform: NodeJS.Platform,
): { out: string; index: number } {
  while (frame.pendingDocs.length > 0) {
    const doc = frame.pendingDocs.shift()!;
    const split = splitHereBody(command, index, doc);
    const body = command.slice(index, split.bodyEnd);
    out += doc.quoted
      ? expandQuotedHereBody(body, resolve)
      : expandSingleQuotedShellVariables(body, resolve, platform, { literalHere: true });
    out += command.slice(split.bodyEnd, split.end);
    index = split.end;
  }
  return { out, index };
}

function expandQuotedHereBody(
  body: string,
  resolve: (name: string) => string | undefined,
): string {
  return body.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => {
    const value = resolve(name);
    return value === undefined ? match : value;
  });
}

function splitHereBody(command: string, start: number, doc: HereDoc): { bodyEnd: number; end: number } {
  let scan = start;
  while (scan <= command.length) {
    const next = command.indexOf("\n", scan);
    const lineEnd = next === -1 ? command.length : next;
    let line = command.slice(scan, lineEnd);
    if (doc.stripTabs) line = line.replace(/^\t+/, "");
    if (line === doc.delimiter) {
      return { bodyEnd: scan, end: next === -1 ? command.length : next + 1 };
    }
    if (next === -1) return { bodyEnd: command.length, end: command.length };
    scan = next + 1;
  }
  return { bodyEnd: command.length, end: command.length };
}

function noteShellWord(frame: QuoteFrame, word: string): void {
  if (word === "{") {
    frame.commandPosition = true;
    return;
  }
  if (word === "!" && frame.commandPosition) {
    frame.commandPosition = true;
    return;
  }
  if (word === "case" && frame.commandPosition) {
    frame.caseStack.push("subject");
    frame.commandPosition = false;
    return;
  }
  if (word === "in" && frame.caseStack.at(-1) === "subject") {
    frame.caseStack[frame.caseStack.length - 1] = "pattern";
    frame.commandPosition = false;
    return;
  }
  if (word === "esac" && frame.commandPosition && frame.caseStack.length > 0) {
    frame.caseStack.pop();
    frame.commandPosition = false;
    return;
  }
  frame.commandPosition = frame.commandPosition && OPENS_COMMAND.has(word);
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
  options: { literalHere?: boolean } = {},
): string {
  const stack: QuoteFrame[] = [{
    inSingle: false,
    inDouble: false,
    paren: 0,
    backtick: false,
    caseStack: [],
    commandPosition: true,
    pendingDocs: [],
    literalHere: options.literalHere === true,
  }];
  let out = "";
  let word = "";
  let wordQuoted = false;
  let wordExpanded = false;
  const flushWord = (): void => {
    if (!word && !wordQuoted && !wordExpanded) return;
    const frame = stack[stack.length - 1]!;
    if (!frame.literalHere && !wordQuoted && !wordExpanded) noteShellWord(frame, word);
    else if (!frame.literalHere) frame.commandPosition = false;
    word = "";
    wordQuoted = false;
    wordExpanded = false;
  };
  for (let index = 0; index < command.length;) {
    const frame = stack[stack.length - 1]!;
    const character = command[index] ?? "";
    const quoted = frame.inSingle || frame.inDouble;
    if (!frame.literalHere && !frame.inDouble && character === "'") {
      wordQuoted = true;
      frame.inSingle = !frame.inSingle;
      out += character;
      index += 1;
      continue;
    }
    if (!frame.literalHere && !frame.inSingle && character === "\"") {
      wordQuoted = true;
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
      if (next === "$" && command.startsWith("${", index + 1)) {
        const end = command.indexOf("}", index + 3);
        const name = end === -1 ? "" : command.slice(index + 3, end);
        if (end !== -1 && SHELL_NAME.test(name)) {
          const value = resolve(name);
          if (value !== undefined) {
            out += `\\${value}`;
            index = end + 1;
            continue;
          }
        }
      }
      out += next === undefined ? character : `${character}${next}`;
      index += next === undefined ? 1 : 2;
      continue;
    }
    if (
      platform !== "win32"
      && !frame.literalHere
      && !frame.inSingle
      && !frame.inDouble
      && character === "#"
      && commentStarts(command, index)
    ) {
      const newline = command.indexOf("\n", index);
      const end = newline === -1 ? command.length : newline + 1;
      frame.commandPosition = true;
      out += command.slice(index, end);
      index = end;
      if (newline !== -1) {
        const drained = appendPendingHereDocs(command, index, frame, out, resolve, platform);
        out = drained.out;
        index = drained.index;
      }
      continue;
    }
    if (platform !== "win32" && !frame.literalHere && !quoted && command.startsWith("<<", index)) {
      flushWord();
      const header = parseHereHeader(command, index);
      if (header) {
        frame.pendingDocs.push(header.doc);
        out += command.slice(index, header.cursor);
        index = header.cursor;
        continue;
      }
    }
    if (platform !== "win32" && !quoted && character === "\n") {
      flushWord();
      out += "\n";
      index += 1;
      frame.commandPosition = true;
      const drained = appendPendingHereDocs(command, index, frame, out, resolve, platform);
      out = drained.out;
      index = drained.index;
      continue;
    }
    if (platform !== "win32" && !quoted && command.startsWith(";;", index) && frame.caseStack.at(-1) === "body") {
      flushWord();
      frame.caseStack[frame.caseStack.length - 1] = "pattern";
      frame.commandPosition = true;
      out += ";;";
      index += 2;
      continue;
    }
    if (!frame.inSingle && command.startsWith("$(", index)) {
      flushWord();
      stack.push({
        inSingle: false,
        inDouble: false,
        paren: 1,
        backtick: false,
        caseStack: [],
        commandPosition: true,
        pendingDocs: [],
        literalHere: false,
      });
      out += "$(";
      index += 2;
      continue;
    }
    if (!frame.inSingle && !frame.backtick && character === "`") {
      flushWord();
      stack.push({
        inSingle: false,
        inDouble: false,
        paren: 0,
        backtick: true,
        caseStack: [],
        commandPosition: true,
        pendingDocs: [],
        literalHere: false,
      });
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
      if (frame.caseStack.at(-1) === "pattern") {
        out += character;
        index += 1;
        continue;
      }
      frame.paren += 1;
      frame.commandPosition = true;
      out += character;
      index += 1;
      continue;
    }
    if (frame.paren > 0 && !quoted && character === ")") {
      flushWord();
      if (frame.caseStack.at(-1) === "pattern") {
        frame.caseStack[frame.caseStack.length - 1] = "body";
        frame.commandPosition = true;
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
            out += platform === "win32" ? shieldWindowsValue(value) : value.replaceAll("'", "'\\''");
            index = end + 1;
            continue;
          }
        }
        if (!frame.inSingle) wordExpanded = true;
        out += command.slice(index, end + 1);
        index = end + 1;
        continue;
      }
    }
    if (platform !== "win32" && !frame.literalHere && (quoted || !/[\s;&|()<>]/.test(character))) {
      word += character;
    } else if (!quoted) {
      flushWord();
      if (character === ";" || character === "|" || character === "&" || character === "{") {
        frame.commandPosition = true;
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
  return command
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => `%${name}%`)
    .replaceAll(WIN_INSERTED_DOLLAR, "$");
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
