/**
 * openclaw plugins build 会重写 openclaw.plugin.json；此脚本把 configSchema / tools 契约补回去。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "openclaw.plugin.json");
const raw = JSON.parse(fs.readFileSync(file, "utf8"));

raw.contracts = { tools: ["qq_group_policy"] };
raw.toolMetadata = { qq_group_policy: { optional: true } };
raw.configSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rootDir: { type: "string", description: "Plugin root containing config/ and packs/." },
    dataDir: { type: "string", description: "Directory for buffer/ and state/." },
    dryRun: { type: "boolean", description: "Log mute actions without calling the platform API." },
    logLevel: { type: "string", enum: ["debug", "info", "warn", "error"] },
  },
};
raw.version = raw.version || "0.2.0";
raw.description =
  "QQ multi-group policy packs with hot-reload, batch triggers, mute, and Control UI admin.";

fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
console.log("patched openclaw.plugin.json (configSchema + contracts.tools)");
