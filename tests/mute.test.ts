import { describe, expect, it } from "vitest";
import { rfc3339In } from "../src/actions/mute.js";

describe("rfc3339In", () => {
  it("returns absolute timestamp with offset", () => {
    const from = new Date("2026-09-22T12:00:00+08:00");
    const s = rfc3339In(60, from);
    expect(s).toMatch(/2026-09-22T12:01:00/);
    expect(s).toMatch(/[+-]\d{2}:\d{2}$/);
  });
});
