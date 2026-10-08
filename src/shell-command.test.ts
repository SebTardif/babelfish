import { EventEmitter, once } from "node:events";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  commandForPlatformShell,
  expandSingleQuotedShellVariables,
  spawnMonitorShellCommand,
  spawnShellCommand,
  terminateShellProcessTree,
} from "./shell-command.js";

describe("expandSingleQuotedShellVariables", () => {
  const resolve = (name: string) => name === "FLAG" ? "deny" : undefined;

  it("leaves double-quoted and bare variables for the shell", () => {
    expect(expandSingleQuotedShellVariables('echo "${FLAG}" ${FLAG}', resolve)).toBe(
      'echo "${FLAG}" ${FLAG}',
    );
  });

  it("inserts a single-quoted variable and escapes quotes in the value", () => {
    expect(expandSingleQuotedShellVariables("echo '${FLAG}'", () => "den'y", "linux")).toBe(
      "echo 'den'\\''y'",
    );
  });

  it("inserts a single-quoted name inside a double-quoted command substitution", () => {
    const command = "if [ \"$(printf %s '${FLAG}')\" = deny ]; then exit 2; fi; exit 0";
    expect(expandSingleQuotedShellVariables(command, () => "deny", "linux")).toBe(
      "if [ \"$(printf %s 'deny')\" = deny ]; then exit 2; fi; exit 0",
    );
    expect(expandSingleQuotedShellVariables(
      "if [ \"`printf %s '${FLAG}'`\" = deny ]; then exit 2; fi",
      () => "deny",
      "linux",
    )).toBe("if [ \"`printf %s 'deny'`\" = deny ]; then exit 2; fi");
  });

  it("leaves a double-quoted name inside a command substitution for the shell", () => {
    expect(expandSingleQuotedShellVariables(
      'echo "$(printf %s "${FLAG}")"',
      () => "deny",
      "linux",
    )).toBe('echo "$(printf %s "${FLAG}")"');
  });

  it("escapes an apostrophe inside a nested POSIX command substitution", () => {
    expect(expandSingleQuotedShellVariables(
      "$(printf %s '${FLAG}')",
      () => "a'b",
      "linux",
    )).toBe("$(printf %s 'a'\\''b')");
  });

  it("ignores an apostrophe inside a shell comment", () => {
    const command = "# don't skip guard\nif [ '${FLAG}' = deny ]; then exit 2; fi; exit 0";
    expect(expandSingleQuotedShellVariables(command, () => "deny", "linux")).toBe(
      "# don't skip guard\nif [ 'deny' = deny ]; then exit 2; fi; exit 0",
    );
  });

  it("ignores an apostrophe inside a quoted here-document", () => {
    const command = "cat <<'EOF' >/dev/null\n'\nEOF\nif [ '${FLAG}' = deny ]; then exit 2; fi; exit 0";
    expect(expandSingleQuotedShellVariables(command, () => "deny", "linux")).toBe(
      "cat <<'EOF' >/dev/null\n'\nEOF\nif [ 'deny' = deny ]; then exit 2; fi; exit 0",
    );
  });

  it("keeps parsing the command after a here-document redirection", () => {
    const command = "cat <<'EOF' >/dev/null; if [ '${FLAG}' = deny ]; then exit 2; fi; exit 0\ntext\nEOF\n";
    expect(expandSingleQuotedShellVariables(command, () => "deny", "linux")).toBe(
      "cat <<'EOF' >/dev/null; if [ 'deny' = deny ]; then exit 2; fi; exit 0\ntext\nEOF\n",
    );
  });

  it("keeps command position after then", () => {
    const command = "if [ \"$(if true; then case x in x) printf %s '${FLAG}';; esac; fi)\" = deny ]; then exit 2; fi; exit 0";
    expect(expandSingleQuotedShellVariables(command, () => "deny", "linux")).toBe(
      "if [ \"$(if true; then case x in x) printf %s 'deny';; esac; fi)\" = deny ]; then exit 2; fi; exit 0",
    );
  });

  it("inserts a bare name inside a quoted here-document", () => {
    const command = "if [ \"$(cat <<'EOF'\n${FLAG}\nEOF\n)\" = deny ]; then exit 2; fi; exit 0";
    expect(expandSingleQuotedShellVariables(command, () => "deny", "linux")).toBe(
      "if [ \"$(cat <<'EOF'\ndeny\nEOF\n)\" = deny ]; then exit 2; fi; exit 0",
    );
  });

  it("leaves quote characters in an unquoted here-document for the shell", () => {
    const command = "cat <<EOF\n'${FLAG}'\nEOF\n";
    expect(expandSingleQuotedShellVariables(command, () => "den'y", "linux")).toBe(command);
  });

  it("treats a partly quoted delimiter as a quoted here-document", () => {
    const command = "cat <<E'OF'\n${FLAG}\nEOF\n";
    expect(expandSingleQuotedShellVariables(command, () => "deny", "linux")).toBe(
      "cat <<E'OF'\ndeny\nEOF\n",
    );
  });

  it("starts a here-document body after a comment on the header line", () => {
    const command = "cat <<'EOF' # note\n${FLAG}\nEOF\n";
    expect(expandSingleQuotedShellVariables(command, () => "deny", "linux")).toBe(
      "cat <<'EOF' # note\ndeny\nEOF\n",
    );
  });

  it("leaves a bare name in an unquoted here-document for the shell", () => {
    const command = "cat <<EOF\n${FLAG}\nEOF\n";
    expect(expandSingleQuotedShellVariables(command, () => "deny", "linux")).toBe(command);
  });

  it("inserts a single-quoted name inside a quoted here-document", () => {
    const command = "sh <<'EOF'\nif [ '${FLAG}' = deny ]; then exit 2; fi\nexit 0\nEOF\n";
    expect(expandSingleQuotedShellVariables(command, () => "deny", "linux")).toBe(
      "sh <<'EOF'\nif [ 'deny' = deny ]; then exit 2; fi\nexit 0\nEOF\n",
    );
  });

  it("does not treat a parenthesized case pattern as a substitution", () => {
    const command = ": \"$(case x in (x) :;; esac)\"; if [ '${FLAG}' = deny ]; then exit 2; fi; exit 0";
    expect(expandSingleQuotedShellVariables(command, () => "deny", "linux")).toBe(
      ": \"$(case x in (x) :;; esac)\"; if [ 'deny' = deny ]; then exit 2; fi; exit 0",
    );
  });

  it("does not treat case and in arguments as shell syntax", () => {
    const command = ": \"$(printf '%s' case in)\"; if [ '${FLAG}' = deny ]; then exit 2; fi; exit 0";
    expect(expandSingleQuotedShellVariables(command, () => "deny", "linux")).toBe(
      ": \"$(printf '%s' case in)\"; if [ 'deny' = deny ]; then exit 2; fi; exit 0",
    );
  });

  it("keeps a command substitution open across a case pattern", () => {
    const command = "if [ \"$(case x in x) printf %s '${FLAG}';; esac)\" = deny ]; then exit 2; fi; exit 0";
    expect(expandSingleQuotedShellVariables(command, () => "deny", "linux")).toBe(
      "if [ \"$(case x in x) printf %s 'deny';; esac)\" = deny ]; then exit 2; fi; exit 0",
    );
  });

  it("does not treat an unquoted escape as the start of a quote", () => {
    const command = ": \\'; if [ \"" + "${FLAG}" + "\" = \"den'y\" ]; then exit 2; fi; exit 0";
    expect(expandSingleQuotedShellVariables(command, () => "inserted", "linux")).toBe(command);
  });

  it("copies an apostrophe into a Windows command without a POSIX escape", () => {
    expect(expandSingleQuotedShellVariables(
      "if '${FLAG}'=='den'y' exit /b 2",
      () => "den'y",
      "win32",
    )).toBe("if 'den'y'=='den'y' exit /b 2");
  });

  it("keeps a single-quoted name the resolver does not supply", () => {
    expect(expandSingleQuotedShellVariables("echo '${OTHER}'", resolve)).toBe("echo '${OTHER}'");
  });
});

describe("commandForPlatformShell", () => {
  it("leaves braced variables for the POSIX shell", () => {
    expect(commandForPlatformShell('printf "%s" "${CLAUDE_PROJECT_DIR}"', "linux")).toBe(
      'printf "%s" "${CLAUDE_PROJECT_DIR}"',
    );
  });

  it("asks Windows cmd to expand the same names", () => {
    expect(commandForPlatformShell('node "${CLAUDE_PLUGIN_ROOT}\\monitor.mjs"', "win32")).toBe(
      'node "%CLAUDE_PLUGIN_ROOT%\\monitor.mjs"',
    );
  });
});

describe("spawnShellCommand", () => {
  it("preserves POSIX login-shell execution", () => {
    const child = {} as ChildProcess;
    const spawn = vi.fn(() => child);

    expect(spawnShellCommand("printf ready", { cwd: "/tmp" }, "linux", spawn)).toBe(child);
    expect(spawn).toHaveBeenCalledWith(
      "/bin/sh",
      ["-lc", "printf ready"],
      { cwd: "/tmp" },
    );
  });

  it("spawns argv commands without a POSIX login shell", () => {
    const child = {} as ChildProcess;
    const spawn = vi.fn(() => child);

    expect(
      spawnShellCommand(["node", "hook.mjs", "safe; echo pwned"], { cwd: "/tmp" }, "linux", spawn),
    ).toBe(child);
    expect(spawn).toHaveBeenCalledWith(
      "node",
      ["hook.mjs", "safe; echo pwned"],
      { cwd: "/tmp" },
    );
    expect(spawn.mock.calls[0]?.[1]).not.toContain("-lc");
  });

  it("keeps Windows argv commands inside the Job supervisor", () => {
    const child = {} as ChildProcess;
    const spawn = vi.fn(() => child);

    expect(
      spawnShellCommand(["node", "hook.mjs"], { cwd: "C:\\work" }, "win32", spawn),
    ).toBe(child);
    const [executable, args, options] = spawn.mock.calls[0]!;
    expect(executable).toMatch(/powershell\.exe$/);
    expect(args).toContain("-ArgvBase64");
    expect(JSON.parse(Buffer.from(args.at(-1)!, "base64").toString("utf8")))
      .toEqual(["node", "hook.mjs"]);
    expect(options).toEqual({ cwd: "C:\\work", detached: false, windowsHide: true });
  });

  it("rejects an empty argv command", () => {
    const spawn = vi.fn();
    expect(() => spawnShellCommand([], { cwd: "/tmp" }, "linux", spawn)).toThrow(/empty/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("preserves literal argv through the platform launcher", async () => {
    const args = ["", "two words", "a\"b", "back\\slash\\", "trail space\\", "$(echo changed)", "%PATH%", "x & y", "日本語"];
    const child = spawnShellCommand(
      [process.execPath, "-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk));
    const [code] = await once(child, "close");
    expect(Buffer.concat(stderr).toString("utf8")).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(Buffer.concat(stdout).toString("utf8"))).toEqual(args);
  }, 15_000);

  it("terminates argv command descendants with their supervisor", async () => {
    const child = spawnShellCommand([
      process.execPath, "-e",
      "const {spawn}=require('node:child_process'); const worker=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(worker.pid); setInterval(()=>{},1000);",
    ], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let workerPid: number | undefined;
    const closed = once(child, "close");
    try {
      let stdout = "";
      child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      await vi.waitFor(() => expect(stdout).toMatch(/^\d+\s/), { timeout: 10_000 });
      workerPid = Number(stdout.trim());
      terminateShellProcessTree(child);
      await closed;
      await vi.waitFor(() => {
        expect(() => process.kill(workerPid!, 0)).toThrow();
      }, { timeout: 5_000 });
    } finally {
      terminateShellProcessTree(child, process.platform, "SIGKILL");
      if (workerPid) {
        try { process.kill(workerPid, "SIGKILL"); } catch { /* Already exited. */ }
      }
    }
  }, 20_000);

  it("delegates Windows command parsing to the native shell", () => {
    const child = new EventEmitter() as ChildProcess;
    const spawn = vi.fn(() => child);

    expect(
      spawnShellCommand(
        "echo ready",
        { cwd: "C:\\work", detached: true },
        "win32",
        spawn,
      ),
    ).toBe(child);
    const [executable, args, options] = spawn.mock.calls[0]!;
    expect(executable).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    expect(args).toEqual(expect.arrayContaining([
      "-File",
      expect.stringMatching(/windows-job\.ps1$/),
      "-Mode",
      "command",
      "-CommandBase64",
      expect.any(String),
    ]));
    expect(options).toEqual({
      cwd: "C:\\work",
      detached: false,
      windowsHide: true,
    });
    expect(Buffer.from(args.at(-1)!, "base64").toString("utf8")).toBe(
      "echo ready",
    );
  });
});

describe("spawnMonitorShellCommand", () => {
  it("uses a Windows Job Object supervisor as a durable process-tree root", () => {
    const child = new EventEmitter() as ChildProcess;
    const spawn = vi.fn(() => child);

    expect(
      spawnMonitorShellCommand(
        "start /b worker.exe",
        { detached: true },
        "win32",
        spawn,
      ),
    ).toBe(child);
    const [executable, args, options] = spawn.mock.calls[0]!;
    expect(executable).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    expect(args).toEqual(expect.arrayContaining(["-Mode", "monitor"]));
    expect(options).toEqual({ detached: false, windowsHide: true });
    expect(Buffer.from(args.at(-1)!, "base64").toString("utf8")).toBe(
      "start /b worker.exe",
    );
  });

  it("does not alter POSIX monitor commands", () => {
    const child = {} as ChildProcess;
    const spawn = vi.fn(() => child);

    spawnMonitorShellCommand("worker &", {}, "linux", spawn);

    expect(spawn).toHaveBeenCalledWith(
      "/bin/sh",
      ["-lc", "worker &"],
      {},
    );
  });

  it("retires a monitor supervisor after its command tree drains", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "babelfish-monitor-"));
    await fs.writeFile(path.join(root, "monitor.mjs"), "console.log('ready');");
    const child = spawnMonitorShellCommand("node monitor.mjs", {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk));

    const [code] = await once(child, "close");

    expect(code).toBe(0);
    expect(Buffer.concat(stdout).toString("utf8").trim()).toBe("ready");
  }, 15_000);
});

describe("terminateShellProcessTree", () => {
  it("terminates POSIX process groups", () => {
    const child = { pid: 42, kill: vi.fn() } as unknown as ChildProcess;
    const killProcess = vi.fn();

    terminateShellProcessTree(child, "linux", "SIGTERM", killProcess);

    expect(killProcess).toHaveBeenCalledWith(-42, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("terminates the Windows Job Object supervisor", () => {
    const child = {
      pid: 42,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
    } as unknown as ChildProcess;

    terminateShellProcessTree(child, "win32");

    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("does not target an exited child's stale PID", () => {
    const child = {
      pid: 42,
      exitCode: 0,
      signalCode: null,
      kill: vi.fn(),
    } as unknown as ChildProcess;
    const killProcess = vi.fn();

    terminateShellProcessTree(child, "win32", "SIGTERM", killProcess);

    expect(killProcess).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("still terminates a POSIX group after its leader exits", () => {
    const child = {
      pid: 42,
      exitCode: 0,
      signalCode: null,
      kill: vi.fn(),
    } as unknown as ChildProcess;
    const killProcess = vi.fn();

    terminateShellProcessTree(child, "linux", "SIGTERM", killProcess);

    expect(killProcess).toHaveBeenCalledWith(-42, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
  });
});
