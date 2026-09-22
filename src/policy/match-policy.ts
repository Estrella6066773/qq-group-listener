/**
 * 可组合关键词匹配策略求值。
 * 联动：PolicyRouter.keyword → evaluateMatchPolicy；词表来自 PolicyPack.categories；
 * 规则 AST 来自 route.keyword.match（无 match 时退回扁平 pack.keywords）。
 *
 * 注意：全局 excludeCategories 与规则级 exclude 叠加；regex 编译失败视为本规则未命中。
 */

import { matchKeywords, normalizeForMatch } from "./matchers.js";
import type { MatchPolicy, MatchRule, PolicyPack } from "../types.js";

function uniq(terms: string[]): string[] {
  return [...new Set(terms.map((t) => String(t).trim()).filter(Boolean))];
}

function termsInCategories(
  categories: Record<string, string[]>,
  names: string[],
): string[] {
  const out: string[] = [];
  for (const name of names) {
    const list = categories[name];
    if (Array.isArray(list)) out.push(...list);
  }
  return uniq(out);
}

function excludedTermSet(
  categories: Record<string, string[]>,
  excludeNames: string[],
): Set<string> {
  return new Set(termsInCategories(categories, excludeNames).map((t) => normalizeForMatch(t)));
}

/**
 * 解析单条规则用到的词条（已扣排除分类）。
 * within=all 时按「每类是否命中」另算，此处仍返回合并词表供 any 路径。
 */
export function resolveRuleTerms(
  pack: PolicyPack,
  rule: Extract<MatchRule, { type: "category" }>,
): { terms: string[]; categoryNames: string[] } {
  const globalEx = pack.excludeCategories ?? [];
  const ruleEx = rule.exclude ?? [];
  const excludedCats = [...new Set([...globalEx, ...ruleEx])];
  const categoryNames = (rule.categories ?? []).filter((c) => !excludedCats.includes(c));
  const banned = excludedTermSet(pack.categories, excludedCats);
  const raw = termsInCategories(pack.categories, categoryNames);
  const terms = raw.filter((t) => !banned.has(normalizeForMatch(t)));
  return { terms, categoryNames };
}

function evalCategoryRule(text: string, pack: PolicyPack, rule: Extract<MatchRule, { type: "category" }>): string[] {
  const within = rule.within ?? "any";
  const { terms, categoryNames } = resolveRuleTerms(pack, rule);
  if (within === "all") {
    if (categoryNames.length === 0) return [];
    const allHits: string[] = [];
    for (const cat of categoryNames) {
      const catTerms = (pack.categories[cat] ?? []).filter(Boolean);
      const hits = matchKeywords(text, catTerms);
      if (hits.length === 0) return [];
      allHits.push(...hits);
    }
    return uniq(allHits);
  }
  return matchKeywords(text, terms);
}

function evalTermsRule(text: string, rule: Extract<MatchRule, { type: "terms" }>): string[] {
  const terms = uniq(rule.terms ?? []);
  if (terms.length === 0) return [];
  // within=all：每个 term 都必须出现（极少用）
  if ((rule.within ?? "any") === "all") {
    const hits = matchKeywords(text, terms);
    if (hits.length < terms.length) return [];
    return hits;
  }
  return matchKeywords(text, terms);
}

function evalRegexRule(text: string, rule: Extract<MatchRule, { type: "regex" }>): string[] {
  const pattern = String(rule.pattern ?? "").trim();
  if (!pattern) return [];
  try {
    const re = new RegExp(pattern, "i");
    const hay = normalizeForMatch(text);
    const m = hay.match(re);
    if (!m) return [];
    return [m[0] || pattern];
  } catch {
    // 非法正则：本规则视为未命中（不抛，避免拖垮整条消息管线）
    return [];
  }
}

export function evaluateRule(text: string, pack: PolicyPack, rule: MatchRule): string[] {
  if (rule.type === "category") return evalCategoryRule(text, pack, rule);
  if (rule.type === "terms") return evalTermsRule(text, rule);
  if (rule.type === "regex") return evalRegexRule(text, rule);
  return [];
}

/**
 * 按 match 策略求值；无 match 或 rules 为空时用扁平 keywords（兼容旧 pack）。
 * @returns 命中词条列表（供禁言计数 / 日志）；空数组 = 未命中 keyword 路由。
 */
export function evaluateMatchPolicy(text: string, pack: PolicyPack): string[] {
  const policy: MatchPolicy | undefined = pack.route.keyword?.match;
  if (!policy || !Array.isArray(policy.rules) || policy.rules.length === 0) {
    return matchKeywords(text, pack.keywords);
  }

  const combine = policy.combine === "all" ? "all" : "any";
  const collected: string[] = [];

  if (combine === "all") {
    for (const rule of policy.rules) {
      const hits = evaluateRule(text, pack, rule);
      if (hits.length === 0) return [];
      collected.push(...hits);
    }
    return uniq(collected);
  }

  for (const rule of policy.rules) {
    const hits = evaluateRule(text, pack, rule);
    if (hits.length > 0) collected.push(...hits);
  }
  return uniq(collected);
}

/** 规范化 UI / YAML 写入的 match（去掉空字段）。 */
export function normalizeMatchPolicy(raw: unknown): MatchPolicy | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as { combine?: string; rules?: unknown[] };
  const rulesIn = Array.isArray(obj.rules) ? obj.rules : [];
  const rules: MatchRule[] = [];
  for (const r of rulesIn) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const type = String(row.type ?? "");
    if (type === "category") {
      const categories = Array.isArray(row.categories)
        ? row.categories.map((c) => String(c).trim()).filter(Boolean)
        : [];
      if (categories.length === 0) continue;
      const exclude = Array.isArray(row.exclude)
        ? row.exclude.map((c) => String(c).trim()).filter(Boolean)
        : undefined;
      const within = row.within === "all" ? "all" : "any";
      rules.push({ type: "category", categories, exclude, within });
    } else if (type === "terms") {
      const terms = Array.isArray(row.terms)
        ? row.terms.map((t) => String(t).trim()).filter(Boolean)
        : [];
      if (terms.length === 0) continue;
      const within = row.within === "all" ? "all" : "any";
      rules.push({ type: "terms", terms, within });
    } else if (type === "regex") {
      const pattern = String(row.pattern ?? "").trim();
      if (!pattern) continue;
      rules.push({ type: "regex", pattern });
    }
  }
  if (rules.length === 0) return undefined;
  return {
    combine: obj.combine === "all" ? "all" : "any",
    rules,
  };
}
