/**
 * RecallAction：官方 DELETE /v2/groups/{group_openid}/messages/{message_id} 撤回群消息。
 * 联动：Intake 在 RouteDecision.actions 含 recallMessage 时调用；与 MuteAction 共用凭证获取。
 * 注意：发送超过 2 分钟不可撤回；机器人须为群管理员才能撤普通成员消息；失败只记日志不拖垮禁言。
 */

import type { MuteAction } from "./mute.js";

export type RecallLogger = {
  debug?: (msg: string) => void;
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

export class RecallAction {
  constructor(
    /** 复用 MuteAction 的 access_token 缓存，避免重复请求。 */
    private auth: Pick<MuteAction, "getAccessToken">,
    private logger: RecallLogger = {},
    private dryRun = false,
  ) {}

  /**
   * 撤回指定群消息。
   * @returns recalled=true 表示平台接受或 dryRun；false 表示失败（超时/无权限等）。
   */
  async recallMessage(groupOpenId: string, messageId: string): Promise<{ recalled: boolean; reason?: string }> {
    if (!groupOpenId || !messageId) {
      return { recalled: false, reason: "missing groupOpenId or messageId" };
    }
    if (this.dryRun) {
      this.logger.warn?.(
        `qq-group-listener: DRY RUN recall group=${groupOpenId} messageId=${messageId.slice(0, 48)}…`,
      );
      return { recalled: true, reason: "dryRun" };
    }
    try {
      const token = await this.auth.getAccessToken();
      const res = await fetch(
        `https://api.sgroup.qq.com/v2/groups/${encodeURIComponent(groupOpenId)}/messages/${encodeURIComponent(messageId)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `QQBot ${token}`,
          },
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const reason = `HTTP ${res.status} ${text.slice(0, 200)}`;
        this.logger.error?.(
          `qq-group-listener: recall failed (admin? <2min?): group=${groupOpenId} ${reason}`,
        );
        return { recalled: false, reason };
      }
      this.logger.info?.(
        `qq-group-listener: recalled message group=${groupOpenId} id=${messageId.slice(0, 48)}…`,
      );
      return { recalled: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error?.(`qq-group-listener: recall error: ${reason}`);
      return { recalled: false, reason };
    }
  }
}
