/**
 * PolicyRouter：按 pack.route.order 短路求值。
 * 联动：Intake → evaluate → BufferStore / Actions；不直接碰 I/O。
 */

import { isMentioned } from "./matchers.js";
import { evaluateMatchPolicy, evaluatePolicyMatch } from "./match-policy.js";
import type { InboundMessage, PolicyPack, RouteDecision, RouteRule, RouteRuleKind } from "../types.js";

export function evaluate(msg: InboundMessage, pack: PolicyPack): RouteDecision {
  const order = pack.route.order?.length
    ? pack.route.order
    : (["mention", "keyword", "default"] as RouteRuleKind[]);

  for (const kind of order) {
    if (kind === "mention") {
      const rule = pack.route.mention;
      if (!rule) continue;
      if (msg.mentioned || isMentioned({ mentioned: msg.mentioned })) {
        return fromRule(pack, "mention", rule, []);
      }
      continue;
    }

    if (kind === "summon") {
      const rule = pack.route.summon;
      if (!rule) continue;
      // 喊名字即唤醒：命中正文即放行，不计数、不禁言。
      const hits = evaluatePolicyMatch(msg.text, pack, rule.match);
      if (hits.length === 0) continue;
      return fromRule(pack, "summon", rule, hits);
    }

    if (kind === "keyword") {
      const rule = pack.route.keyword;
      if (!rule) continue;
      // 有 match AST 走可组合规则；否则扁平 keywords（已扣全局 excludeCategories）
      const hits = evaluateMatchPolicy(msg.text, pack);
      if (hits.length === 0) continue;
      const actions: RouteDecision["actions"] = [];
      if (rule.onHit === "countAndMaybeMute") {
        actions.push({ type: "countAndMaybeMute", matchedKeywords: hits });
      }
      if (rule.recallHitMessage) {
        actions.push({ type: "recallMessage", matchedKeywords: hits });
      }
      return fromRule(pack, "keyword", rule, hits, actions);
    }

    if (kind === "default") {
      const rule = pack.route.default;
      return fromRule(pack, "default", rule, []);
    }
  }

  // Fail-safe: buffer silently if pack is misconfigured
  return {
    packId: pack.id,
    matchedRule: "default",
    wake: false,
    buffer: true,
    matchedKeywords: [],
    actions: [],
  };
}

function fromRule(
  pack: PolicyPack,
  matchedRule: RouteRuleKind,
  rule: RouteRule,
  matchedKeywords: string[],
  actions: RouteDecision["actions"] = [],
): RouteDecision {
  return {
    packId: pack.id,
    matchedRule,
    wake: Boolean(rule.wake),
    buffer: Boolean(rule.buffer),
    matchedKeywords,
    actions,
  };
}
