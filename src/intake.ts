/**
 * Intake：OpenClaw before_dispatch 事件 → InboundMessage + RouteDecision 副作用。
 * 联动：PackRegistry → PolicyRouter → BufferStore / StateStore / MuteAction。
 *
 * 静默自动化：keyword 可 wake=false + onHit=countAndMaybeMute → 达阈自动禁言，
 * 不唤醒 agent；禁言成功后写入 kind=mute_event 缓冲，供批决策阅读。
 *
 * 注意：失败时 fail-open（返回 undefined，不吞消息）；群 OpenID 必须大写。
 */

import path from "node:path";
import { evaluate } from "./policy/router.js";
import { isMentioned } from "./policy/matchers.js";
import type { PackRegistry } from "./policy/load.js";
import { BufferStore } from "./store/buffer.js";
import { BatchGate } from "./store/batch-gate.js";
import { StateStore, stateFileForGroup } from "./store/state.js";
import type { MuteAction } from "./actions/mute.js";
import { buildMuteEventRecord } from "./actions/mute-event.js";
import type { BufferRecord, InboundMessage, RouteDecision } from "./types.js";

export type IntakeLogger = {
  debug?: (msg: string) => void;
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

export type DispatchEvent = {
  body?: string;
  content?: string;
  senderId?: string;
  sessionKey?: string;
  isGroup?: boolean;
  messageId?: string;
  id?: string;
  rawEventType?: string;
  mentions?: Array<{ is_you?: boolean }>;
  timestamp?: number;
  /** OpenClaw originating channel：qqbot 入站为 "qqbot"；Control UI 打字为 "webchat"。 */
  channel?: string;
};

export type DispatchCtx = {
  sessionKey?: string;
  channelId?: string;
};

export function normalizeGroupKey(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

export function groupIdFromSessionKey(sessionKey: unknown): string {
  const m = /:group:([^:]+)/i.exec(String(sessionKey ?? ""));
  return m ? normalizeGroupKey(m[1]) : "";
}

/** 仅处理 QQ 频道真实入站；放过 webchat / Control UI 等操作员输入。 */
export function isQqbotInboundChannel(channel: unknown): boolean {
  const ch = String(channel ?? "")
    .trim()
    .toLowerCase();
  return ch === "qqbot" || ch.startsWith("qqbot:");
}

export function toInbound(
  event: DispatchEvent,
  ctx: DispatchCtx | undefined,
  appId?: string,
): InboundMessage | null {
  const sessionKey = ctx?.sessionKey ?? event.sessionKey;
  const channel = event.channel ?? ctx?.channelId;
  // 关键：群会话里从 Control UI 打字时 sessionKey 仍含 :group:，但 channel=webchat。
  // 若只看 sessionKey 会误吞操作员输入（handled:true → 龙虾客户端像卡住）。
  if (!isQqbotInboundChannel(channel)) return null;

  const groupOpenId = groupIdFromSessionKey(sessionKey);
  const isGroup = event.isGroup === true || Boolean(groupOpenId);
  if (!isGroup || !groupOpenId) return null;

  const text = String(event.body ?? event.content ?? "");
  const mentioned = isMentioned({
    rawEventType: event.rawEventType,
    mentions: event.mentions,
    text,
    appId,
  });

  return {
    messageId: String(event.messageId ?? event.id ?? `${groupOpenId}:${Date.now()}`),
    groupOpenId,
    memberOpenId: String(event.senderId ?? ""),
    text,
    mentioned,
    timestampMs: Number(event.timestamp) || Date.now(),
    raw: event,
  };
}

export class Intake {
  private states = new Map<string, StateStore>();
  private gate: BatchGate;

  constructor(
    private registry: PackRegistry,
    private buffer: BufferStore,
    private stateDir: string,
    private mute: MuteAction,
    private logger: IntakeLogger = {},
    private appId?: string,
  ) {
    this.gate = new BatchGate(buffer);
  }

  private stateFor(groupOpenId: string, timezone: string): StateStore {
    const key = groupOpenId.toUpperCase();
    let s = this.states.get(key);
    if (!s) {
      s = new StateStore(stateFileForGroup(this.stateDir, key), timezone);
      this.states.set(key, s);
    }
    return s;
  }

  private appendAndRefreshGate(
    rec: BufferRecord,
    pack: { id: string; batchDecision?: unknown },
    groupOpenId: string,
    atMs: number,
  ): void {
    try {
      this.buffer.append(rec);
      const status = this.gate.refresh(groupOpenId, pack as never, atMs);
      if (status.ready) {
        this.logger.info?.(
          `qq-group-listener: batch ready group=${groupOpenId} reasons=${status.reasons.join(",")}`,
        );
      }
    } catch (err) {
      this.logger.error?.(
        `qq-group-listener: buffer append failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * 处理入站。返回值直接作为 before_dispatch 的返回：
   * - `{ handled: true }` 吞掉（零模型调用）
   * - `undefined` 放行唤醒
   */
  async handle(
    event: DispatchEvent,
    ctx?: DispatchCtx,
  ): Promise<{ handled: true } | undefined> {
    const msg = toInbound(event, ctx, this.appId);
    if (!msg) return undefined;

    const pack = this.registry.getForGroup(msg.groupOpenId);
    if (!pack) {
      // unbound group → do not interfere
      return undefined;
    }

    const decision = evaluate(msg, pack);
    this.logger.debug?.(
      `qq-group-listener: group=${msg.groupOpenId} rule=${decision.matchedRule} ` +
        `wake=${decision.wake} buffer=${decision.buffer} kw=[${decision.matchedKeywords.join(",")}]`,
    );

    if (decision.buffer) {
      const rec: BufferRecord = {
        messageId: msg.messageId,
        groupOpenId: msg.groupOpenId,
        memberOpenId: msg.memberOpenId,
        text: msg.text,
        mentioned: msg.mentioned,
        timestampMs: msg.timestampMs,
        packId: pack.id,
        matchedRule: decision.matchedRule,
        kind: "message",
      };
      this.appendAndRefreshGate(rec, pack, msg.groupOpenId, msg.timestampMs);
    }

    for (const action of decision.actions) {
      if (action.type === "countAndMaybeMute" && pack.mute) {
        const state = this.stateFor(msg.groupOpenId, pack.mute.timezone);
        const windowMs = pack.mute.windowMinutes * 60 * 1000;
        const { count, isNew } = state.recordHit(
          msg.memberOpenId,
          msg.messageId,
          msg.timestampMs,
          windowMs,
        );
        state.save();
        this.logger.info?.(
          `qq-group-listener: keyword hit [${action.matchedKeywords.join(", ")}] ` +
            `member=${msg.memberOpenId} window=${count} new=${isNew}`,
        );
        if (isNew) {
          const result = await this.mute.maybeMute({
            groupOpenId: msg.groupOpenId,
            memberOpenId: msg.memberOpenId,
            hitCount: count,
            policy: pack.mute,
            state,
          });
          // 禁言成功：写入系统记录供批决策阅读，不依赖 wake
          if (result.muted) {
            const muteRec = buildMuteEventRecord({
              groupOpenId: msg.groupOpenId,
              memberOpenId: msg.memberOpenId,
              packId: pack.id,
              matchedRule: decision.matchedRule,
              timestampMs: Date.now(),
              seconds: result.seconds,
              keywords: action.matchedKeywords,
              hitCount: count,
              extended: result.extended,
            });
            this.appendAndRefreshGate(muteRec, pack, msg.groupOpenId, muteRec.timestampMs);
          }
        }
      }
    }

    if (!decision.wake) {
      return { handled: true };
    }
    return undefined;
  }
}

export function resolveDataPaths(
  dataDir: string,
  relativeBuffer: string,
  relativeState: string,
): { bufferDir: string; stateDir: string } {
  return {
    bufferDir: path.isAbsolute(relativeBuffer)
      ? relativeBuffer
      : path.join(dataDir, relativeBuffer),
    stateDir: path.isAbsolute(relativeState) ? relativeState : path.join(dataDir, relativeState),
  };
}

export type { RouteDecision };
