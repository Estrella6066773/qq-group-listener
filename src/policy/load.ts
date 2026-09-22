/**
 * 加载 groups.yaml 与 packs/<id>/pack.yaml（及词表）。
 * 联动：Intake / 工具经 PackRegistry 取包；按 mtime 热重载，AI 改 YAML 后无需重启 Gateway。
 * 注意：群 OpenID 键一律大写；缺包时返回 null，由 Intake fail-open。
 */

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { normalizeBatchPolicy } from "./triggers.js";
import type { GroupsConfig, PluginEngineConfig, PolicyPack, RouteRuleKind } from "../types.js";

type RawPack = {
  id: string;
  version: string;
  description?: string;
  route: PolicyPack["route"];
  mute?: PolicyPack["mute"];
  batchDecision?: PolicyPack["batchDecision"];
};

type RawKeywords = {
  version?: string;
  categories?: Record<string, string[]>;
  keywords?: string[];
};

type CacheEntry = {
  pack: PolicyPack | null;
  /** max mtime of pack.yaml + keywordsRef + decision prompt */
  mtimeMs: number;
};

export function loadPluginConfig(rootDir: string): PluginEngineConfig {
  const file = path.join(rootDir, "config", "plugin.json");
  const defaults: PluginEngineConfig = {
    bufferDir: "buffer",
    stateDir: "state",
    logLevel: "info",
  };
  if (!fs.existsSync(file)) return defaults;
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PluginEngineConfig>;
  return { ...defaults, ...raw };
}

export function loadGroupsConfig(rootDir: string): GroupsConfig {
  const file = path.join(rootDir, "config", "groups.yaml");
  if (!fs.existsSync(file)) return { groups: {} };
  const raw = parseYaml(fs.readFileSync(file, "utf8")) as { groups?: Record<string, string> };
  const groups: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.groups ?? {})) {
    groups[String(k).trim().toUpperCase()] = String(v).trim();
  }
  return { groups };
}

export function groupsConfigPath(rootDir: string): string {
  return path.join(rootDir, "config", "groups.yaml");
}

export function packYamlPath(rootDir: string, packId: string): string {
  return path.join(rootDir, "packs", packId, "pack.yaml");
}

function fileMtimeMs(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** 计算策略包相关文件的最新 mtime，用于热重载判定。 */
export function packFingerprint(rootDir: string, packId: string): number {
  const packDir = path.join(rootDir, "packs", packId);
  const packFile = path.join(packDir, "pack.yaml");
  let m = fileMtimeMs(packFile);
  if (!fs.existsSync(packFile)) return m;
  try {
    const raw = parseYaml(fs.readFileSync(packFile, "utf8")) as RawPack;
    const ref = raw.route?.keyword?.keywordsRef;
    if (ref) m = Math.max(m, fileMtimeMs(path.join(packDir, ref)));
    const prompt = raw.batchDecision?.promptFile;
    if (prompt) m = Math.max(m, fileMtimeMs(path.join(packDir, prompt)));
  } catch {
    /* ignore parse errors here; loadPack will throw/return null */
  }
  return m;
}

export function loadPack(rootDir: string, packId: string): PolicyPack | null {
  const packDir = path.join(rootDir, "packs", packId);
  const packFile = path.join(packDir, "pack.yaml");
  if (!fs.existsSync(packFile)) return null;

  const raw = parseYaml(fs.readFileSync(packFile, "utf8")) as RawPack;
  if (!raw?.id || !raw.route?.default) {
    throw new Error(`Invalid pack.yaml in ${packDir}`);
  }

  let keywords: string[] = [];
  const ref = raw.route.keyword?.keywordsRef;
  if (ref) {
    keywords = loadKeywordsFile(path.join(packDir, ref));
  }

  const order = (raw.route.order ?? ["default"]) as RouteRuleKind[];
  const batchDecision = normalizeBatchPolicy(raw.batchDecision);

  return {
    id: raw.id,
    version: String(raw.version ?? "0"),
    description: raw.description,
    route: {
      order,
      mention: raw.route.mention,
      keyword: raw.route.keyword,
      default: raw.route.default,
    },
    mute: raw.mute,
    batchDecision,
    keywords,
    packDir,
  };
}

export function loadKeywordsFile(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = parseYaml(fs.readFileSync(filePath, "utf8")) as RawKeywords;
  const out: string[] = [];
  if (Array.isArray(raw.keywords)) out.push(...raw.keywords);
  if (raw.categories && typeof raw.categories === "object") {
    for (const list of Object.values(raw.categories)) {
      if (Array.isArray(list)) out.push(...list);
    }
  }
  return [...new Set(out.map((k) => String(k).trim()).filter(Boolean))];
}

export function writeGroupsConfig(rootDir: string, groups: GroupsConfig): void {
  const file = groupsConfigPath(rootDir);
  const body = stringifyYaml({ groups: groups.groups });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, file);
}

/** 整文件写回 pack.yaml（AI 改规则入口）；调用方应随后 reload。 */
export function writePackYaml(rootDir: string, packId: string, yamlText: string): void {
  const file = packYamlPath(rootDir, packId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // validate parse
  const raw = parseYaml(yamlText) as RawPack;
  if (!raw?.id || !raw.route?.default) {
    throw new Error("Invalid pack.yaml: need id and route.default");
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, yamlText.endsWith("\n") ? yamlText : `${yamlText}\n`, "utf8");
  fs.renameSync(tmp, file);
}

export function readPackYamlText(rootDir: string, packId: string): string {
  const file = packYamlPath(rootDir, packId);
  return fs.readFileSync(file, "utf8");
}

/**
 * 解析群绑定到 pack；按 mtime 热重载。
 * groups.yaml 变更也会使绑定映射刷新。
 */
export class PackRegistry {
  private cache = new Map<string, CacheEntry>();
  private groups: GroupsConfig;
  private groupsMtimeMs = 0;

  constructor(private rootDir: string) {
    this.groups = { groups: {} };
    this.refreshGroupsIfNeeded(true);
  }

  get root(): string {
    return this.rootDir;
  }

  /** 强制丢弃全部缓存（工具 reload 用）。 */
  invalidateAll(): void {
    this.cache.clear();
    this.groupsMtimeMs = 0;
    this.refreshGroupsIfNeeded(true);
  }

  invalidatePack(packId: string): void {
    this.cache.delete(packId);
  }

  private refreshGroupsIfNeeded(force = false): void {
    const m = fileMtimeMs(groupsConfigPath(this.rootDir));
    if (!force && m === this.groupsMtimeMs) return;
    this.groups = loadGroupsConfig(this.rootDir);
    this.groupsMtimeMs = m;
  }

  packIdForGroup(groupOpenId: string): string | null {
    this.refreshGroupsIfNeeded();
    const id = this.groups.groups[groupOpenId.toUpperCase()];
    return id || null;
  }

  listBindings(): GroupsConfig {
    this.refreshGroupsIfNeeded();
    return { groups: { ...this.groups.groups } };
  }

  bindGroup(groupOpenId: string, packId: string): void {
    this.refreshGroupsIfNeeded(true);
    this.groups.groups[groupOpenId.toUpperCase()] = packId;
    writeGroupsConfig(this.rootDir, this.groups);
    this.groupsMtimeMs = fileMtimeMs(groupsConfigPath(this.rootDir));
  }

  getPackById(packId: string): PolicyPack | null {
    const fp = packFingerprint(this.rootDir, packId);
    const hit = this.cache.get(packId);
    if (hit && hit.mtimeMs === fp) return hit.pack;
    const pack = loadPack(this.rootDir, packId);
    this.cache.set(packId, { pack, mtimeMs: fp });
    return pack;
  }

  getForGroup(groupOpenId: string): PolicyPack | null {
    const packId = this.packIdForGroup(groupOpenId);
    if (!packId) return null;
    return this.getPackById(packId);
  }
}
