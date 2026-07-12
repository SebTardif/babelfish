import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
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
    const child = {} as ChildProcess;
    const spawn = vi.fn(() => child);

    expect(spawnShellCommand("echo ready", { cwd: "C:\\work" }, "win32", spawn)).toBe(child);
    expect(spawn).toHaveBeenCalledWith(
      "echo ready",
      [],
      { cwd: "C:\\work", shell: true },
    );
  });
});

describe("terminateShellProcessTree", () => {
  it("terminates POSIX process groups", () => {
    const child = { pid: 42, kill: vi.fn() } as unknown as ChildProcess;
    const killProcess = vi.fn();

    terminateShellProcessTree(child, "linux", "SIGTERM", vi.fn(), killProcess);

    expect(killProcess).toHaveBeenCalledWith(-42, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("uses taskkill to terminate Windows process trees", () => {
    const child = { pid: 42, kill: vi.fn() } as unknown as ChildProcess;
    const killer = new EventEmitter() as ChildProcess;
    const spawnBinary = vi.fn(() => killer);

    terminateShellProcessTree(child, "win32", "SIGTERM", spawnBinary, vi.fn());

    expect(spawnBinary).toHaveBeenCalledWith(
      "taskkill",
      ["/pid", "42", "/t", "/f"],
      { stdio: "ignore", windowsHide: true },
    );
    killer.emit("exit", 0);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("falls back when taskkill cannot start", () => {
    const child = { pid: 42, kill: vi.fn() } as unknown as ChildProcess;
    const killer = new EventEmitter() as ChildProcess;

    terminateShellProcessTree(
      child,
      "win32",
      "SIGTERM",
      vi.fn(() => killer),
      vi.fn(),
    );
    killer.emit("error", new Error("missing taskkill"));

    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("does not target an exited child's stale PID", () => {
    const child = {
      pid: 42,
      exitCode: 0,
      signalCode: null,
      kill: vi.fn(),
    } as unknown as ChildProcess;
    const spawnBinary = vi.fn();
    const killProcess = vi.fn();

    terminateShellProcessTree(child, "win32", "SIGTERM", spawnBinary, killProcess);

    expect(spawnBinary).not.toHaveBeenCalled();
    expect(killProcess).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });
});
