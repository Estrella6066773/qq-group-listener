/**
 * MuteAction：调用 QQ 群禁言 API。
 * 联动：Intake 在 RouteDecision.actions 含 countAndMaybeMute 且 StateStore.shouldMute 时调用。
 * 前置：机器人须为群管理员；clientSecret 须为明文（SecretRef 无法在此解析）。
 */

import type { MutePolicy } from "../types.js";
import type { StateStore } from "../store/state.js";

export type MuteLogger = {
  debug?: (msg: string) => void;
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

export type QqbotCredentials = {
  appId?: string;
  clientSecret?: string;
};

/** RFC3339 with local offset — QQ expects absolute expire time. */
export function rfc3339In(seconds: number, from = new Date()): string {
  const t = new Date(from.getTime() + seconds * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const offMin = -t.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  return (
    `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}` +
    `T${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export class MuteAction {
  private tokenCache: { value: string; expiresAt: number } = { value: "", expiresAt: 0 };

  constructor(
    private getCredentials: () => QqbotCredentials,
    private logger: MuteLogger = {},
    private dryRun = false,
  ) {}

  async getAccessToken(): Promise<string> {
    const { appId, clientSecret } = this.getCredentials();
    if (!appId || !clientSecret || typeof clientSecret !== "string") {
      throw new Error(
        "qqbot appId/clientSecret unavailable (need plaintext config; SecretRef is not resolved in-plugin)",
      );
    }
    if (this.tokenCache.value && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.value;
    }
    const res = await fetch("https://api.bot.qq.com/app/getAppAccessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, clientSecret }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!res.ok || !data.access_token) {
      throw new Error(`getAppAccessToken failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    }
    this.tokenCache = {
      value: data.access_token,
      expiresAt: Date.now() + Math.max(60, (Number(data.expires_in) || 7200) - 60) * 1000,
    };
    return this.tokenCache.value;
  }

  async muteMember(groupOpenId: string, memberOpenId: string, seconds: number): Promise<void> {
    if (this.dryRun) {
      this.logger.warn?.(
        `qq-group-listener: DRY RUN mute group=${groupOpenId} member=${memberOpenId} ${seconds}s`,
      );
      return;
    }
    const token = await this.getAccessToken();
    const body = {
      members: [
        {
          op: "add",
          member_openid: memberOpenId,
          mute_expire_at: rfc3339In(seconds),
        },
      ],
    };
    const res = await fetch(
      `https://api.sgroup.qq.com/v2/groups/${encodeURIComponent(groupOpenId)}/restrict_chat_setting`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `QQBot ${token}`,
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `mute failed (is bot group admin?): HTTP ${res.status} ${text.slice(0, 200)}`,
      );
    }
  }

  /**
   * 根据命中计数与策略决定是否禁言并执行。
   * @returns 是否实际发起了禁言（含 dryRun 记为 true）
   */
  async maybeMute(args: {
    groupOpenId: string;
    memberOpenId: string;
    hitCount: number;
    policy: MutePolicy;
    state: StateStore;
  }): Promise<boolean> {
    const { groupOpenId, memberOpenId, hitCount, policy, state } = args;
    if (!memberOpenId) return false;
    const decision = state.shouldMute(memberOpenId, hitCount, policy);
    if (!decision.mute) return false;
    try {
      await this.muteMember(groupOpenId, memberOpenId, decision.seconds);
      state.recordMute(memberOpenId);
      state.save();
      this.logger.warn?.(
        `qq-group-listener: muted ${memberOpenId} for ${decision.seconds}s ` +
          `(tier=${decision.extended ? "extended" : "base"}, mutesToday=${decision.priorMutes + 1})`,
      );
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error?.(`qq-group-listener: mute failed: ${msg}`);
      return false;
    }
  }
}
