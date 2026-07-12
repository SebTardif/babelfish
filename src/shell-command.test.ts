import type { ChildProcess } from "node:child_process";
import { spawnShellCommand } from "./shell-command.js";

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
