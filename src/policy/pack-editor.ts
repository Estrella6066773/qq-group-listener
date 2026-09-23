/**
 * PackEditor：Control UI / Feature 操作共用的结构化编辑 seam。
 * 联动：applyEdit → 原子写 keywords.yaml 或 pack.yaml → registry.invalidate；
 * getPackView 供 get_pack；unbindGroup 写 groups.yaml。
 *
 * 注意：写入前校验；失败抛错，不留下半截 .tmp（atomicWrite 已 rename）。
 */

import path from "node:path";
import {
  loadKeywordsData,
  readPackYamlObject,
  readPackYamlText,
  writeKeywordsData,
  writePackObject,
  type PackRegistry,
} from "./load.js";
import { normalizeMatchPolicy } from "./match-policy.js";
import { normalizeBatchPolicy } from "./triggers.js";
import type {
  BatchDecisionPolicy,
  MatchPolicy,
  MutePolicy,
  PackEdit,
  PackView,
  RouteRule,
  RouteRuleKind,
} from "../types.js";

function keywordsPath(pack: { packDir: string; route: { keyword?: { keywordsRef?: string } } }): string {
  const ref = pack.route.keyword?.keywordsRef ?? "keywords.yaml";
  return path.join(pack.packDir, ref);
}

function boundGroupsFor(registry: PackRegistry, packId: string): string[] {
  const bindings = registry.listBindings().groups;
  return Object.entries(bindings)
    .filter(([, id]) => id === packId)
    .map(([gid]) => gid)
    .sort();
}

/**
 * Feature session-action / Control UI 出站前净化：去掉 undefined，得到纯 JSON 对象树。
 * OpenClaw isPluginJsonValue 遇 undefined 即抛 “Feature output must be bounded JSON”。
 */
export function toFeatureJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getPackView(registry: PackRegistry, packId: string): PackView {
  const pack = registry.getPackById(packId);
  if (!pack) throw new Error(`策略包不存在: ${packId}`);
  return toFeatureJson({
    packId: pack.id,
    version: pack.version,
    description: pack.description ?? "",
    keywordCount: pack.keywords.length,
    categories: { ...pack.categories },
    looseKeywords: [...pack.looseKeywords],
    excludeCategories: [...pack.excludeCategories],
    match: pack.route.keyword?.match ?? null,
    route: pack.route,
    mute: pack.mute ?? null,
    batchDecision: pack.batchDecision ?? null,
    boundGroups: boundGroupsFor(registry, packId),
    yamlText: readPackYamlText(registry.root, packId),
  });
}

function loadKw(registry: PackRegistry, packId: string) {
  const pack = registry.getPackById(packId);
  if (!pack) throw new Error(`策略包不存在: ${packId}`);
  const file = keywordsPath(pack);
  const data = loadKeywordsData(file);
  return { pack, file, data };
}

function ensureCategory(data: ReturnType<typeof loadKeywordsData>, category: string): string {
  const name = category.trim();
  if (!name) throw new Error("分类名不能为空");
  if (!data.categories[name]) data.categories[name] = [];
  return name;
}

function writePackMutate(
  registry: PackRegistry,
  packId: string,
  mutate: (raw: Record<string, unknown>) => void,
): void {
  const raw = readPackYamlObject(registry.root, packId);
  mutate(raw);
  if (!raw.id || !(raw.route as { default?: unknown })?.default) {
    throw new Error("Invalid pack.yaml: need id and route.default");
  }
  writePackObject(registry.root, packId, raw);
  registry.invalidatePack(packId);
}

/**
 * 应用一次结构化编辑；成功后缓存已失效。
 * @returns 更新后的 PackView
 */
export function applyPackEdit(registry: PackRegistry, packId: string, edit: PackEdit): PackView {
  if (!edit || typeof edit !== "object" || !("op" in edit)) {
    throw new Error("无效的 edit");
  }

  switch (edit.op) {
    case "set_meta": {
      writePackMutate(registry, packId, (raw) => {
        if (edit.description !== undefined) raw.description = edit.description;
        if (edit.version !== undefined) raw.version = String(edit.version);
      });
      break;
    }
    case "set_keywords_category": {
      const { file, data } = loadKw(registry, packId);
      const name = ensureCategory(data, edit.category);
      data.categories[name] = [
        ...new Set((edit.keywords ?? []).map((k) => String(k).trim()).filter(Boolean)),
      ];
      writeKeywordsData(file, data);
      registry.invalidatePack(packId);
      break;
    }
    case "add_keyword": {
      const { file, data } = loadKw(registry, packId);
      const name = ensureCategory(data, edit.category);
      const term = String(edit.term ?? "").trim();
      if (!term) throw new Error("关键词不能为空");
      if (!data.categories[name].includes(term)) data.categories[name].push(term);
      writeKeywordsData(file, data);
      registry.invalidatePack(packId);
      break;
    }
    case "remove_keyword": {
      const { file, data } = loadKw(registry, packId);
      const name = String(edit.category ?? "").trim();
      const term = String(edit.term ?? "").trim();
      if (!name || !term) throw new Error("需要 category 与 term");
      if (!data.categories[name]) throw new Error(`分类不存在: ${name}`);
      data.categories[name] = data.categories[name].filter((k) => k !== term);
      writeKeywordsData(file, data);
      registry.invalidatePack(packId);
      break;
    }
    case "delete_category": {
      const { file, data } = loadKw(registry, packId);
      const name = String(edit.category ?? "").trim();
      if (!name) throw new Error("分类名不能为空");
      if ((data.categories[name] ?? []).length > 0) {
        throw new Error(`分类 ${name} 仍有关键词，请先清空再删除`);
      }
      delete data.categories[name];
      data.excludeCategories = data.excludeCategories.filter((c) => c !== name);
      writeKeywordsData(file, data);
      registry.invalidatePack(packId);
      break;
    }
    case "set_exclude_categories": {
      const { file, data } = loadKw(registry, packId);
      data.excludeCategories = [
        ...new Set((edit.excludeCategories ?? []).map((c) => String(c).trim()).filter(Boolean)),
      ];
      writeKeywordsData(file, data);
      registry.invalidatePack(packId);
      break;
    }
    case "set_match": {
      writePackMutate(registry, packId, (raw) => {
        const route = (raw.route ?? {}) as Record<string, unknown>;
        const keyword = { ...((route.keyword as Record<string, unknown>) ?? {}) };
        if (edit.match === null) {
          delete keyword.match;
        } else {
          const normalized = normalizeMatchPolicy(edit.match);
          if (!normalized) delete keyword.match;
          else keyword.match = normalized;
        }
        // 若尚无 keyword 块，补默认以便挂 match
        if (!route.keyword) {
          route.keyword = {
            wake: true,
            buffer: false,
            keywordsRef: "keywords.yaml",
            onHit: "countAndMaybeMute",
            ...keyword,
          };
        } else {
          route.keyword = { ...(route.keyword as object), ...keyword };
        }
        raw.route = route;
      });
      break;
    }
    case "set_route_mute": {
      writePackMutate(registry, packId, (raw) => {
        if (edit.route) {
          const route = { ...((raw.route as Record<string, unknown>) ?? {}) };
          if (edit.route.order) route.order = edit.route.order as RouteRuleKind[];
          if (edit.route.mention !== undefined) {
            if (edit.route.mention === null) delete route.mention;
            else route.mention = edit.route.mention as RouteRule;
          }
          if (edit.route.summon !== undefined) {
            if (edit.route.summon === null) delete route.summon;
            else {
              const sm = edit.route.summon as RouteRule;
              const match = sm.match ? normalizeMatchPolicy(sm.match) : undefined;
              route.summon = { ...sm, ...(match ? { match } : { match: undefined }) };
              if (!match && "match" in (route.summon as object)) {
                delete (route.summon as { match?: MatchPolicy }).match;
              }
            }
          }
          if (edit.route.keyword !== undefined) {
            if (edit.route.keyword === null) delete route.keyword;
            else {
              const kw = edit.route.keyword as RouteRule;
              const match = kw.match ? normalizeMatchPolicy(kw.match) : undefined;
              route.keyword = { ...kw, ...(match ? { match } : { match: undefined }) };
              if (!match && "match" in (route.keyword as object)) {
                delete (route.keyword as { match?: MatchPolicy }).match;
              }
            }
          }
          if (edit.route.default) route.default = edit.route.default as RouteRule;
          raw.route = route;
        }
        if (edit.mute !== undefined) {
          if (edit.mute === null) delete raw.mute;
          else raw.mute = edit.mute as MutePolicy;
        }
      });
      break;
    }
    case "set_batch": {
      writePackMutate(registry, packId, (raw) => {
        if (edit.batchDecision === null) {
          delete raw.batchDecision;
        } else {
          raw.batchDecision = normalizeBatchPolicy(edit.batchDecision as BatchDecisionPolicy);
        }
      });
      break;
    }
    default: {
      throw new Error(`未知 edit.op: ${(edit as { op?: string }).op}`);
    }
  }

  return getPackView(registry, packId);
}

export function unbindGroup(registry: PackRegistry, groupOpenId: string): {
  ok: boolean;
  groupOpenId: string;
  removed: boolean;
} {
  const gid = groupOpenId.trim().toUpperCase();
  const removed = registry.unbindGroup(gid);
  return { ok: true, groupOpenId: gid, removed };
}
