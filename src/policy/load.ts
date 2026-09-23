/**
 * 加载 groups.yaml 与 packs/<id>/pack.yaml（及词表）。
 * 联动：Intake / 工具经 PackRegistry 取包；按 mtime 热重载，AI 改 YAML 后无需重启 Gateway。
 * 注意：群 OpenID 键一律大写；缺包时返回 null，由 Intake fail-open。
 */

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { normalizeMatchPolicy } from "./match-policy.js";
import { normalizeBatchPolicy } from "./triggers.js";
import type {
  GroupsConfig,
  KeywordsFileData,
  PluginEngineConfig,
  PolicyPack,
  RouteRule,
  RouteRuleKind,
} from "../types.js";

type RawPack = {
  id: string;
  version: string;
  description?: string;
  route: {
    order?: RouteRuleKind[];
    mention?: RouteRule;
    summon?: RouteRule;
    keyword?: RouteRule;
    default: RouteRule;
  };
  mute?: PolicyPack["mute"];
  batchDecision?: PolicyPack["batchDecision"];
  wakeContext?: PolicyPack["wakeContext"];
};

type RawKeywords = {
  version?: string;
  categories?: Record<string, string[]>;
  keywords?: string[];
  excludeCategories?: string[];
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

function atomicWrite(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, body.endsWith("\n") ? body : `${body}\n`, "utf8");
  fs.renameSync(tmp, file);
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

function normalizeKeywordRule(raw?: RouteRule): RouteRule | undefined {
  if (!raw) return undefined;
  const match = normalizeMatchPolicy(raw.match);
  // 注意：勿写入 undefined 可选字段；Feature 输出经 isPluginJsonValue，含 undefined 会报
  // “Feature output must be bounded JSON”。
  const out: RouteRule = {
    wake: Boolean(raw.wake),
    buffer: Boolean(raw.buffer),
  };
  if (raw.keywordsRef) out.keywordsRef = raw.keywordsRef;
  if (raw.onHit) out.onHit = raw.onHit;
  if (raw.recallHitMessage) out.recallHitMessage = true;
  if (match) out.match = match;
  return out;
}

/** summon 与 keyword 同形，同用一套归一化。 */
const normalizeRouteRule = normalizeKeywordRule;

/**
 * 读取 keywords.yaml 结构化数据。
 * 注意：categories 保留全部分类；扁平 keywords 需再经 flattenKeywords 排除全局 exclude。
 */
export function loadKeywordsData(filePath: string): KeywordsFileData {
  if (!fs.existsSync(filePath)) {
    return { categories: {}, keywords: [], excludeCategories: [] };
  }
  const raw = parseYaml(fs.readFileSync(filePath, "utf8")) as RawKeywords;
  const categories: Record<string, string[]> = {};
  if (raw.categories && typeof raw.categories === "object") {
    for (const [name, list] of Object.entries(raw.categories)) {
      if (!Array.isArray(list)) continue;
      categories[name] = [...new Set(list.map((k) => String(k).trim()).filter(Boolean))];
    }
  }
  const keywords = Array.isArray(raw.keywords)
    ? [...new Set(raw.keywords.map((k) => String(k).trim()).filter(Boolean))]
    : [];
  const excludeCategories = Array.isArray(raw.excludeCategories)
    ? [...new Set(raw.excludeCategories.map((c) => String(c).trim()).filter(Boolean))]
    : [];
  return {
    version: raw.version,
    categories,
    keywords,
    excludeCategories,
  };
}

/** 扁平合并：顶层 keywords + 非 exclude 分类；供无 match 时的兼容匹配。 */
export function flattenKeywords(data: KeywordsFileData): string[] {
  const excluded = new Set(data.excludeCategories);
  const out: string[] = [...data.keywords];
  for (const [name, list] of Object.entries(data.categories)) {
    if (excluded.has(name)) continue;
    out.push(...list);
  }
  return [...new Set(out.map((k) => String(k).trim()).filter(Boolean))];
}

/** @deprecated 请用 loadKeywordsData + flattenKeywords；保留给旧测试调用。 */
export function loadKeywordsFile(filePath: string): string[] {
  return flattenKeywords(loadKeywordsData(filePath));
}

export function writeKeywordsData(filePath: string, data: KeywordsFileData): void {
  const body: RawKeywords = {
    version: data.version ?? "1.0",
  };
  if (data.excludeCategories.length > 0) {
    body.excludeCategories = data.excludeCategories;
  }
  if (data.keywords.length > 0) {
    body.keywords = data.keywords;
  }
  body.categories = data.categories;
  atomicWrite(filePath, stringifyYaml(body));
}

export function loadPack(rootDir: string, packId: string): PolicyPack | null {
  const packDir = path.join(rootDir, "packs", packId);
  const packFile = path.join(packDir, "pack.yaml");
  if (!fs.existsSync(packFile)) return null;

  const raw = parseYaml(fs.readFileSync(packFile, "utf8")) as RawPack;
  if (!raw?.id || !raw.route?.default) {
    throw new Error(`Invalid pack.yaml in ${packDir}`);
  }

  let categories: Record<string, string[]> = {};
  let looseKeywords: string[] = [];
  let excludeCategories: string[] = [];
  let keywords: string[] = [];
  const ref = raw.route.keyword?.keywordsRef;
  if (ref) {
    const data = loadKeywordsData(path.join(packDir, ref));
    categories = data.categories;
    looseKeywords = data.keywords;
    excludeCategories = data.excludeCategories;
    keywords = flattenKeywords(data);
  }

  const order = (raw.route.order ?? ["default"]) as RouteRuleKind[];
  const batchDecision = normalizeBatchPolicy(raw.batchDecision);
  const keyword = normalizeKeywordRule(raw.route.keyword);
  const summon = normalizeRouteRule(raw.route.summon);

  return {
    id: raw.id,
    version: String(raw.version ?? "0"),
    description: raw.description,
    route: {
      order,
      mention: raw.route.mention,
      ...(summon ? { summon } : {}),
      keyword,
      default: raw.route.default,
    },
    mute: raw.mute,
    batchDecision,
    wakeContext: raw.wakeContext,
    keywords,
    categories,
    looseKeywords,
    excludeCategories,
    packDir,
  };
}

export function writeGroupsConfig(rootDir: string, groups: GroupsConfig): void {
  const body = stringifyYaml({ groups: groups.groups });
  atomicWrite(groupsConfigPath(rootDir), body);
}

/** 整文件写回 pack.yaml（AI 改规则入口）；调用方应随后 reload。 */
export function writePackYaml(rootDir: string, packId: string, yamlText: string): void {
  const file = packYamlPath(rootDir, packId);
  const raw = parseYaml(yamlText) as RawPack;
  if (!raw?.id || !raw.route?.default) {
    throw new Error("Invalid pack.yaml: need id and route.default");
  }
  atomicWrite(file, yamlText);
}

/** 以对象写回 pack.yaml（结构化编辑器用）。 */
export function writePackObject(rootDir: string, packId: string, obj: unknown): void {
  writePackYaml(rootDir, packId, stringifyYaml(obj));
}

export function readPackYamlObject(rootDir: string, packId: string): Record<string, unknown> {
  const text = readPackYamlText(rootDir, packId);
  const raw = parseYaml(text) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") throw new Error(`无法解析 pack.yaml: ${packId}`);
  return raw;
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

  /** 解除群绑定；键不存在时静默成功。 */
  unbindGroup(groupOpenId: string): boolean {
    this.refreshGroupsIfNeeded(true);
    const key = groupOpenId.toUpperCase();
    const existed = Object.prototype.hasOwnProperty.call(this.groups.groups, key);
    if (existed) {
      delete this.groups.groups[key];
      writeGroupsConfig(this.rootDir, this.groups);
      this.groupsMtimeMs = fileMtimeMs(groupsConfigPath(this.rootDir));
    }
    return existed;
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
