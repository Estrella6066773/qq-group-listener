/**
 * Feature Plugin 入口：小龙虾的 QQ 群科学冲浪指南（性质：策略包引擎）+ Control UI（侧栏「QQ冲浪指南」）。
 * 联动：setup → bootListenerRuntime（before_dispatch）+ Feature handlers（供 Control UI）。
 */

import { defineFeaturePlugin } from "openclaw/plugin-sdk/feature-plugin";
import { contract } from "./contract.js";
import {
  bootListenerRuntime,
  buildOverview,
  editPack,
  getPackPayload,
  savePack,
  unbindPackGroup,
  type ListenerApi,
} from "./runtime.js";
import type { PackEdit } from "./types.js";

export default defineFeaturePlugin({
  contract,
  name: "Smart QQ Group Listener for OpenClaw",
  description:
    "小龙虾的 QQ 群科学冲浪指南：何时唤醒/缓冲/禁言/撤回；唤醒时注入近期群聊。",
  setup(api, events) {
    const rt = bootListenerRuntime(api as unknown as ListenerApi);

    return {
      overview: () => buildOverview(rt),

      get_pack: ({ packId }) => getPackPayload(rt, packId),

      write_pack: ({ packId, yamlText }) => {
        const out = savePack(rt, packId, yamlText);
        events.emit("policy_changed", {
          kind: "write_pack",
          packId,
          atMs: Date.now(),
        });
        return out;
      },

      apply_pack_edit: ({ packId, edit }) => {
        const view = editPack(rt, packId, edit as PackEdit);
        events.emit("policy_changed", {
          kind: "apply_pack_edit",
          packId,
          atMs: Date.now(),
        });
        return view;
      },

      bind_group: ({ groupOpenId, packId }) => {
        const gid = groupOpenId.trim().toUpperCase();
        if (!rt.registry.getPackById(packId)) {
          throw new Error(`策略包不存在: ${packId}`);
        }
        rt.registry.bindGroup(gid, packId);
        events.emit("policy_changed", {
          kind: "bind_group",
          packId,
          groupOpenId: gid,
          atMs: Date.now(),
        });
        return { ok: true, groupOpenId: gid, packId };
      },

      unbind_group: ({ groupOpenId }) => {
        const out = unbindPackGroup(rt, groupOpenId);
        events.emit("policy_changed", {
          kind: "unbind_group",
          groupOpenId: out.groupOpenId,
          atMs: Date.now(),
        });
        return out;
      },

      batch_status: ({ groupOpenId }) => {
        const gid = groupOpenId.trim().toUpperCase();
        const pack = rt.registry.getForGroup(gid);
        if (!pack) throw new Error(`群未绑定策略包: ${gid}`);
        return { ok: true, status: rt.gate.refresh(gid, pack) };
      },

      batch_ack: ({ groupOpenId }) => {
        const gid = groupOpenId.trim().toUpperCase();
        const pack = rt.registry.getForGroup(gid);
        if (!pack) throw new Error(`群未绑定策略包: ${gid}`);
        const status = rt.gate.acknowledge(gid, pack);
        events.emit("policy_changed", {
          kind: "batch_ack",
          packId: pack.id,
          groupOpenId: gid,
          atMs: Date.now(),
        });
        return { ok: true, status };
      },

      reload: ({ packId }) => {
        if (packId) rt.registry.invalidatePack(packId);
        else rt.registry.invalidateAll();
        events.emit("policy_changed", {
          kind: "reload",
          packId: packId || undefined,
          atMs: Date.now(),
        });
        return { ok: true, reloaded: packId ?? "all" };
      },
    };
  },
});
