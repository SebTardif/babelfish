import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  spawnMonitorShellCommand,
  spawnShellCommand,
  terminateShellProcessTree,
} from "./shell-command.js";

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

  it("delegates Windows command parsing to the native shell", () => {
    const child = new EventEmitter() as ChildProcess;
    const spawn = vi.fn(() => child);

    expect(spawnShellCommand("echo ready", { cwd: "C:\\work" }, "win32", spawn)).toBe(child);
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
    expect(options).toEqual({ cwd: "C:\\work", windowsHide: true });
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
      spawnMonitorShellCommand("start /b worker.exe", {}, "win32", spawn),
    ).toBe(child);
    const [executable, args, options] = spawn.mock.calls[0]!;
    expect(executable).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    expect(args).toEqual(expect.arrayContaining(["-Mode", "monitor"]));
    expect(options).toEqual({ windowsHide: true });
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
