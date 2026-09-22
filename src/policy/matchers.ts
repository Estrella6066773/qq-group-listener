/**
 * 关键词 / @ 匹配器。
 * 联动：PolicyRouter.evaluate 调用 matchKeywords / isMentioned；
 * 词表来自 PolicyPack.keywords（由 load 从 keywords.yaml 展开）。
 *
 * 注意：中文用子串；拉丁词用词边界，避免 nice 命中 ice。
 * 简繁：对文本与词条做同一套繁→简映射后再比。
 */

/** 高频繁→简（覆盖词表常见字即可，非完整 OpenCC）。 */
const TRAD_TO_SIMP: Record<string, string> = {
  檳: "槟",
  榔: "榔",
  煙: "烟",
  葉: "叶",
  嗎: "吗",
  啡: "啡",
  鴉: "鸦",
  片: "片",
  罌: "罂",
  粟: "粟",
  鹽: "盐",
  裏: "里",
  麵: "面",
  鬆: "松",
  應: "应",
  該: "该",
  對: "对",
  開: "开",
  關: "关",
  電: "电",
  腦: "脑",
};

export function toSimplified(input: string): string {
  let out = "";
  for (const ch of input) {
    out += TRAD_TO_SIMP[ch] ?? ch;
  }
  return out;
}

export function normalizeForMatch(text: string): string {
  return toSimplified(String(text ?? "")).toLowerCase();
}

/** 是否主要为拉丁/数字词（需要词边界）。 */
export function isLatinToken(token: string): boolean {
  return /^[a-z0-9][a-z0-9+\-_/]*$/i.test(token);
}

/**
 * 在文本中匹配词表。同条多词可命中多个，但调用方计数时只记 1 次。
 * @returns 命中的原始词条（小写化后的规范化形式用于比较时返回词表原词）
 */
export function matchKeywords(text: string, keywords: string[]): string[] {
  const hay = normalizeForMatch(text);
  if (!hay || keywords.length === 0) return [];

  const hits: string[] = [];
  for (const raw of keywords) {
    const needle = normalizeForMatch(raw);
    if (!needle) continue;
    if (isLatinToken(needle)) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`, "i");
      if (re.test(hay)) hits.push(raw);
    } else if (hay.includes(needle)) {
      hits.push(raw);
    }
  }
  return hits;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 判定是否被 @ / 提及机器人。
 * 前置：依赖 Intake 已从事件抽出 mentioned，或传入原始线索。
 */
export function isMentioned(flags: {
  mentioned?: boolean;
  rawEventType?: string;
  mentions?: Array<{ is_you?: boolean }>;
  text?: string;
  appId?: string;
}): boolean {
  if (flags.mentioned === true) return true;
  const t = String(flags.rawEventType ?? "");
  if (t === "GROUP_AT_MESSAGE_CREATE" || /AT_MESSAGE/i.test(t)) return true;
  if (Array.isArray(flags.mentions) && flags.mentions.some((m) => m?.is_you === true)) {
    return true;
  }
  const appId = flags.appId?.trim();
  if (appId && flags.text) {
    if (flags.text.includes(`<@${appId}>`) || flags.text.includes(`@${appId}`)) return true;
  }
  return false;
}
