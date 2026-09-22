import { describe, expect, it } from "vitest";
import { evaluateMatchPolicy, normalizeMatchPolicy } from "../src/policy/match-policy.js";
import type { MatchPolicy, PolicyPack } from "../src/types.js";

function basePack(opts: {
  keywords?: string[];
  categories?: Record<string, string[]>;
  excludeCategories?: string[];
  match?: MatchPolicy;
}): PolicyPack {
  const match = opts.match;
  return {
    id: "test",
    version: "1",
    route: {
      order: ["keyword", "default"],
      keyword: {
        wake: true,
        buffer: false,
        onHit: "countAndMaybeMute",
        ...(match ? { match } : {}),
      },
      default: { wake: false, buffer: true },
    },
    keywords: opts.keywords ?? ["槟榔", "香烟"],
    categories: opts.categories ?? {
      betel: ["槟榔"],
      tobacco: ["香烟", "抽烟"],
      alcohol: ["啤酒"],
    },
    looseKeywords: [],
    excludeCategories: opts.excludeCategories ?? ["alcohol"],
    packDir: ".",
  };
}

describe("evaluateMatchPolicy", () => {
  it("falls back to flat keywords when match missing", () => {
    const pack = basePack({ keywords: ["槟榔"] });
    expect(evaluateMatchPolicy("来点槟榔", pack)).toContain("槟榔");
    expect(evaluateMatchPolicy("天气不错", pack)).toEqual([]);
  });

  it("category rule respects global excludeCategories", () => {
    const pack = basePack({
      match: {
        combine: "any",
        rules: [{ type: "category", categories: ["betel", "alcohol"], within: "any" }],
      },
    });
    expect(evaluateMatchPolicy("喝啤酒", pack)).toEqual([]);
    expect(evaluateMatchPolicy("嚼槟榔", pack)).toContain("槟榔");
  });

  it("combine all requires every rule", () => {
    const pack = basePack({
      match: {
        combine: "all",
        rules: [
          { type: "category", categories: ["betel"] },
          { type: "category", categories: ["tobacco"] },
        ],
      },
    });
    expect(evaluateMatchPolicy("只有槟榔", pack)).toEqual([]);
    expect(evaluateMatchPolicy("槟榔和抽烟", pack).length).toBeGreaterThan(0);
  });

  it("terms and regex rules", () => {
    const pack = basePack({
      match: {
        combine: "any",
        rules: [
          { type: "terms", terms: ["特殊口令"] },
          { type: "regex", pattern: "尼古丁袋" },
        ],
      },
    });
    expect(evaluateMatchPolicy("请输入特殊口令", pack)).toContain("特殊口令");
    expect(evaluateMatchPolicy("尼古丁袋到货", pack).length).toBeGreaterThan(0);
  });

  it("invalid regex does not throw", () => {
    const pack = basePack({
      match: { combine: "any", rules: [{ type: "regex", pattern: "(" }] },
    });
    expect(evaluateMatchPolicy("anything", pack)).toEqual([]);
  });
});

describe("normalizeMatchPolicy", () => {
  it("drops empty rules", () => {
    expect(
      normalizeMatchPolicy({
        combine: "any",
        rules: [{ type: "category", categories: [] }, { type: "terms", terms: ["a"] }],
      }),
    ).toEqual({
      combine: "any",
      rules: [{ type: "terms", terms: ["a"], within: "any" }],
    });
  });
});
