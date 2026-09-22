import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PackRegistry, writeKeywordsData, writePackObject } from "../src/policy/load.js";
import { applyPackEdit, getPackView, unbindGroup } from "../src/policy/pack-editor.js";

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qgl-edit-"));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.mkdirSync(path.join(root, "packs", "demo"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "groups.yaml"), "groups: {}\n", "utf8");
  writePackObject(root, "demo", {
    id: "demo",
    version: "1.0",
    description: "demo",
    route: {
      order: ["keyword", "default"],
      keyword: {
        wake: true,
        buffer: false,
        keywordsRef: "keywords.yaml",
        onHit: "countAndMaybeMute",
      },
      default: { wake: false, buffer: true },
    },
  });
  writeKeywordsData(path.join(root, "packs", "demo", "keywords.yaml"), {
    version: "1.0",
    categories: { betel: ["槟榔"] },
    keywords: [],
    excludeCategories: [],
  });
  return root;
}

describe("PackEditor", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });

  it("adds keyword and sets match", () => {
    const root = makeTempRoot();
    roots.push(root);
    const registry = new PackRegistry(root);
    applyPackEdit(registry, "demo", {
      op: "add_keyword",
      category: "betel",
      term: "青果",
    });
    let view = getPackView(registry, "demo");
    expect(view.categories.betel).toContain("青果");

    view = applyPackEdit(registry, "demo", {
      op: "set_match",
      match: {
        combine: "any",
        rules: [{ type: "category", categories: ["betel"], within: "any" }],
      },
    });
    expect(view.match?.rules[0]).toMatchObject({ type: "category", categories: ["betel"] });
  });

  it("unbinds group", () => {
    const root = makeTempRoot();
    roots.push(root);
    const registry = new PackRegistry(root);
    registry.bindGroup("ABC123", "demo");
    expect(registry.packIdForGroup("ABC123")).toBe("demo");
    const out = unbindGroup(registry, "ABC123");
    expect(out.removed).toBe(true);
    expect(registry.packIdForGroup("ABC123")).toBeNull();
  });
});
