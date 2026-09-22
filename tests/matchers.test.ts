import { describe, expect, it } from "vitest";
import { isLatinToken, matchKeywords, normalizeForMatch, toSimplified } from "../src/policy/matchers.js";

describe("matchers", () => {
  it("matches Chinese substring", () => {
    expect(matchKeywords("今天去嚼槟榔了", ["槟榔"])).toContain("槟榔");
  });

  it("normalizes traditional to simplified for betel", () => {
    expect(toSimplified("檳榔")).toBe("槟榔");
    expect(matchKeywords("来点檳榔", ["槟榔"])).toContain("槟榔");
  });

  it("does not match 烟囱 for tobacco compounds", () => {
    const tobacco = ["抽烟", "吸烟", "香烟", "烟瘾"];
    expect(matchKeywords("烟囱坏了", tobacco)).toEqual([]);
    expect(matchKeywords("别抽烟了", tobacco)).toContain("抽烟");
  });

  it("uses word boundary for English tokens", () => {
    expect(isLatinToken("ice")).toBe(true);
    expect(matchKeywords("this is nice", ["ice"])).toEqual([]);
    expect(matchKeywords("buy some ice now", ["ice"])).toContain("ice");
    expect(matchKeywords("smoking weed tonight", ["weed"])).toContain("weed");
  });

  it("is case-insensitive", () => {
    expect(normalizeForMatch("THC")).toBe("thc");
    expect(matchKeywords("contains THC here", ["thc"])).toContain("thc");
  });
});
