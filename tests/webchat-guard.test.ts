import { describe, expect, it } from "vitest";
import { toInbound } from "../src/intake.js";

describe("toInbound channel guard (Control UI / webchat)", () => {
  it("does not treat webchat typing in a qqbot:group session as inbound", () => {
    // 复现：Control UI 选中群会话后打字 → sessionKey 含 :group:，但 channel=webchat
    const msg = toInbound(
      {
        body: "你好龙虾",
        channel: "webchat",
        sessionKey: "agent:main:qqbot:group:C3E939C7B5642D6C67C990CFB945967E",
        isGroup: false,
        senderId: "operator",
        messageId: "ui-1",
      },
      { sessionKey: "agent:main:qqbot:group:C3E939C7B5642D6C67C990CFB945967E" },
    );
    expect(msg).toBeNull();
  });

  it("still accepts real qqbot group inbound", () => {
    const msg = toInbound(
      {
        body: "有人有槟榔吗",
        channel: "qqbot",
        sessionKey: "agent:main:qqbot:group:C3E939C7B5642D6C67C990CFB945967E",
        isGroup: true,
        senderId: "MEMBER1",
        messageId: "qq-1",
      },
      { sessionKey: "agent:main:qqbot:group:C3E939C7B5642D6C67C990CFB945967E", channelId: "qqbot" },
    );
    expect(msg?.groupOpenId).toBe("C3E939C7B5642D6C67C990CFB945967E");
    expect(msg?.text).toContain("槟榔");
  });
});
