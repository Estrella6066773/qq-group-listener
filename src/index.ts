/**
 * Feature Plugin 入口：QQ 群策略包引擎 + Control UI 管理页后端操作。
 * 联动：setup → bootListenerRuntime（before_dispatch）+ Feature handlers（供 Control UI）。
 */

import { defineFeaturePlugin } from "openclaw/plugin-sdk/feature-plugin";
import { contract } from "./contract.js";
import {
  bootListenerRuntime,
  buildOverview,
  getPackPayload,
  savePack,
  type ListenerApi,
} from "./runtime.js";

export default defineFeaturePlugin({
  contract,
  name: "QQ Group Policy Pack Engine",
  description:
    "QQ multi-group policy packs: hot-reload, batch triggers, mute, Control UI admin.",
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
