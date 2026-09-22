import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PackRegistry, writePackYaml } from "../src/policy/load.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function fixtureRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "qgl-hot-"));
  tmpDirs.push(d);
  fs.mkdirSync(path.join(d, "config"), { recursive: true });
  fs.mkdirSync(path.join(d, "packs", "demo"), { recursive: true });
  fs.writeFileSync(
    path.join(d, "config", "groups.yaml"),
    "groups:\n  ABC: demo\n",
    "utf8",
  );
  writePackYaml(
    d,
    "demo",
    `id: demo
version: "1"
route:
  order: [default]
  default:
    wake: false
    buffer: true
`,
  );
  return d;
}

describe("PackRegistry hot reload", () => {
  it("reloads pack when yaml mtime changes", () => {
    const root = fixtureRoot();
    const reg = new PackRegistry(root);
    const a = reg.getForGroup("ABC");
    expect(a?.version).toBe("1");

    // ensure mtime advances on coarse FS
    const packFile = path.join(root, "packs", "demo", "pack.yaml");
    const st = fs.statSync(packFile);
    fs.utimesSync(packFile, st.atime, new Date(st.mtimeMs + 2000));

    writePackYaml(
      root,
      "demo",
      `id: demo
version: "2"
route:
  order: [default]
  default:
    wake: false
    buffer: true
`,
    );
    const b = reg.getForGroup("ABC");
    expect(b?.version).toBe("2");
  });

  it("reloads group bindings when groups.yaml changes", () => {
    const root = fixtureRoot();
    fs.mkdirSync(path.join(root, "packs", "other"), { recursive: true });
    writePackYaml(
      root,
      "other",
      `id: other
version: "1"
route:
  order: [default]
  default:
    wake: true
    buffer: false
`,
    );
    const reg = new PackRegistry(root);
    expect(reg.packIdForGroup("ABC")).toBe("demo");

    const groupsFile = path.join(root, "config", "groups.yaml");
    const st = fs.statSync(groupsFile);
    fs.writeFileSync(groupsFile, "groups:\n  ABC: other\n", "utf8");
    fs.utimesSync(groupsFile, st.atime, new Date(Date.now() + 2000));

    expect(reg.packIdForGroup("ABC")).toBe("other");
  });
});
