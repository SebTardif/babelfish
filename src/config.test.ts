import { resolveConfig } from "./config.js";

describe("resolveConfig", () => {
  it("defaults to python3 and a usable install dir", () => {
    const config = resolveConfig(undefined);
    expect(config.python).toBe("python3");
    expect(config.installDir).toContain("babelfish/hermes");
    expect(config.rootDir).toContain("babelfish");
    expect(config.timeoutMs).toBe(120000);
  });

  it("keeps only string env values", () => {
    const config = resolveConfig({
      env: { HERMES_HOME: "/tmp/hermes", DROP: 1 },
      timeoutMs: 10,
    });
    expect(config.env).toEqual({ HERMES_HOME: "/tmp/hermes" });
    expect(config.timeoutMs).toBe(1000);
  });

  it("expands a leading home marker in installDir", () => {
    expect(resolveConfig({ installDir: "~/custom-hermes" }).installDir).not.toContain("~");
  });

  it("does not derive bundle storage from a Hermes-only override", () => {
    const config = resolveConfig({ installDir: "/opt/hermes-plugins" });
    expect(config.rootDir).not.toBe("/opt");
  });
});
