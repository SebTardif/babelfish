import { appendMonitorContext, createMonitorOutputReader, MAX_MONITOR_OUTPUT_BYTES } from "./monitor-output.js";

describe("bounded monitor output", () => {
  it("stops once on an oversized line and retains complete preceding lines", () => {
    const lines: string[] = [];
    const overflow = vi.fn();
    const reader = createMonitorOutputReader((line) => lines.push(line), overflow);
    reader.write(Buffer.from("ready\n"));
    reader.write(Buffer.alloc(MAX_MONITOR_OUTPUT_BYTES, 65));
    expect(overflow).not.toHaveBeenCalled();
    reader.write(Buffer.from("x\nlater\n"));
    reader.write(Buffer.from("ignored"));
    reader.end();
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(lines).toEqual(["ready"]);
  });

  it("counts UTF-8 bytes and flushes a split character and final line once", () => {
    const lines: string[] = [];
    const overflow = vi.fn();
    const reader = createMonitorOutputReader((line) => { if (line) lines.push(line); }, overflow);
    for (const byte of Buffer.from("one\r\ntwo\ré\nfinal")) reader.write(Buffer.from([byte]));
    reader.end();
    reader.end();
    expect(lines).toEqual(["one", "two", "é", "final"]);
    expect(overflow).not.toHaveBeenCalled();
    const oversized = createMonitorOutputReader(() => undefined, overflow);
    oversized.write(Buffer.from("é".repeat(MAX_MONITOR_OUTPUT_BYTES / 2)));
    expect(overflow).not.toHaveBeenCalled();
    oversized.write(Buffer.from("é"));
    expect(overflow).toHaveBeenCalledTimes(1);
  });

  it("bounds retained context without capping lifetime output", () => {
    let pending: string[] = [];
    const overflow = vi.fn();
    const reader = createMonitorOutputReader((line) => {
      pending = appendMonitorContext(pending, `Status: ${line}`);
    }, overflow);
    const line = "é".repeat(100_000);
    for (let turn = 0; turn < 2; turn += 1) {
      for (let index = 0; index < 10; index += 1) reader.write(Buffer.from(`${index}:${line}\n`));
      expect(pending).toHaveLength(5);
      expect(pending[0]).toMatch(/^Status: 5:/);
      expect(pending.reduce((sum, text) => sum + Buffer.byteLength(text), 0)).toBeLessThanOrEqual(MAX_MONITOR_OUTPUT_BYTES);
      pending = [];
    }
    expect(overflow).not.toHaveBeenCalled();
  });

  it("retains only the last 50 lines and drops a line too large with its prefix", () => {
    let pending: string[] = [];
    for (let index = 0; index < 60; index += 1) pending = appendMonitorContext(pending, String(index));
    expect(pending).toHaveLength(50);
    expect(pending[0]).toBe("10");
    expect(appendMonitorContext(pending, "x".repeat(MAX_MONITOR_OUTPUT_BYTES + 1))).toEqual([]);
  });
});
