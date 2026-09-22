/**
 * PolicyRouter：按 pack.route.order 短路求值。
 * 联动：Intake → evaluate → BufferStore / Actions；不直接碰 I/O。
 */

import { isMentioned, matchKeywords } from "./matchers.js";
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

    if (kind === "keyword") {
      const rule = pack.route.keyword;
      if (!rule) continue;
      const hits = matchKeywords(msg.text, pack.keywords);
      if (hits.length === 0) continue;
      const actions =
        rule.onHit === "countAndMaybeMute"
          ? [{ type: "countAndMaybeMute" as const, matchedKeywords: hits }]
          : [];
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
