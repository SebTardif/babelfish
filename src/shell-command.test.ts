import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  spawnShellCommand,
  terminateShellProcessTree,
} from "./shell-command.js";

describe("spawnShellCommand", () => {
  it("delegates command parsing to the platform shell", () => {
    const child = {} as ChildProcess;
    const spawn = vi.fn(() => child);

    expect(spawnShellCommand("printf ready", { cwd: "/tmp" }, spawn)).toBe(child);
    expect(spawn).toHaveBeenCalledWith("printf ready", {
      cwd: "/tmp",
      shell: true,
    });
  });
});

describe("terminateShellProcessTree", () => {
  it("terminates POSIX process groups", () => {
    const child = { pid: 42, kill: vi.fn() } as unknown as ChildProcess;
    const killProcess = vi.fn();

    terminateShellProcessTree(child, "linux", vi.fn(), killProcess);

    expect(killProcess).toHaveBeenCalledWith(-42, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("uses taskkill to terminate Windows process trees", () => {
    const child = { pid: 42, kill: vi.fn() } as unknown as ChildProcess;
    const killer = new EventEmitter() as ChildProcess;
    const spawnBinary = vi.fn(() => killer);

    terminateShellProcessTree(child, "win32", spawnBinary, vi.fn());

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

    terminateShellProcessTree(child, "win32", vi.fn(() => killer), vi.fn());
    killer.emit("error", new Error("missing taskkill"));

    expect(child.kill).toHaveBeenCalledOnce();
  });
});
