/**
 * Feature 契约：Control UI 与会话 action 共用同一套操作。
 * 注意：这些操作默认不注册为全局 agent 工具；QQ 群仍用可选的 qq_group_policy。
 */

import { Type } from "typebox";
import { defineFeatureContract } from "openclaw/plugin-sdk/feature-contract";

const GroupId = Type.String({ minLength: 1, maxLength: 128 });
const PackId = Type.String({ minLength: 1, maxLength: 64 });

export const contract = defineFeatureContract({
  pluginId: "qq-group-listener",
  operations: {
    overview: {
      kind: "query",
      description: "Overview of group bindings, packs, and batch gates.",
      input: Type.Object({}, { additionalProperties: false }),
      output: Type.Object(
        {
          rootDir: Type.String(),
          dataDir: Type.String(),
          dryRun: Type.Boolean(),
          bindings: Type.Record(Type.String(), Type.String()),
          packs: Type.Array(
            Type.Object({
              id: Type.String(),
              version: Type.String(),
              description: Type.String(),
              keywordCount: Type.Integer(),
              hasBatch: Type.Boolean(),
            }),
          ),
          batches: Type.Array(
            Type.Object({
              groupOpenId: Type.String(),
              packId: Type.String(),
              ready: Type.Boolean(),
              reasons: Type.Array(Type.String()),
              pendingCount: Type.Integer(),
              lastMessageAtMs: Type.Integer(),
              lastDecisionAtMs: Type.Integer(),
              updatedAtMs: Type.Integer(),
              combine: Type.String(),
            }),
          ),
        },
        { additionalProperties: false },
      ),
    },
    get_pack: {
      kind: "query",
      description: "Load one policy pack and its YAML text.",
      input: Type.Object({ packId: PackId }, { additionalProperties: false }),
      output: Type.Object(
        {
          packId: Type.String(),
          version: Type.String(),
          description: Type.String(),
          keywordCount: Type.Integer(),
          keywordsSample: Type.Array(Type.String()),
          yamlText: Type.String({ maxLength: 200000 }),
          batchDecision: Type.Unknown(),
          mute: Type.Unknown(),
        },
        { additionalProperties: false },
      ),
    },
    write_pack: {
      kind: "action",
      description: "Atomically write pack.yaml and hot-reload.",
      input: Type.Object(
        {
          packId: PackId,
          yamlText: Type.String({ minLength: 1, maxLength: 200000 }),
        },
        { additionalProperties: false },
      ),
      output: Type.Object(
        {
          ok: Type.Boolean(),
          packId: Type.String(),
          version: Type.String(),
          keywordCount: Type.Integer(),
        },
        { additionalProperties: false },
      ),
    },
    bind_group: {
      kind: "action",
      description: "Bind a QQ group OpenID to a policy pack.",
      input: Type.Object(
        { groupOpenId: GroupId, packId: PackId },
        { additionalProperties: false },
      ),
      output: Type.Object(
        { ok: Type.Boolean(), groupOpenId: Type.String(), packId: Type.String() },
        { additionalProperties: false },
      ),
    },
    batch_status: {
      kind: "query",
      description: "Refresh and return batch decision gate for a group.",
      input: Type.Object({ groupOpenId: GroupId }, { additionalProperties: false }),
      output: Type.Object(
        {
          ok: Type.Boolean(),
          status: Type.Unknown(),
        },
        { additionalProperties: false },
      ),
    },
    batch_ack: {
      kind: "action",
      description: "Acknowledge batch decision: advance cursor and clear ready.",
      input: Type.Object({ groupOpenId: GroupId }, { additionalProperties: false }),
      output: Type.Object(
        {
          ok: Type.Boolean(),
          status: Type.Unknown(),
        },
        { additionalProperties: false },
      ),
    },
    reload: {
      kind: "action",
      description: "Invalidate pack cache (force hot reload).",
      input: Type.Object(
        { packId: Type.Optional(PackId) },
        { additionalProperties: false },
      ),
      output: Type.Object(
        { ok: Type.Boolean(), reloaded: Type.String() },
        { additionalProperties: false },
      ),
    },
  },
  events: {
    policy_changed: Type.Object(
      {
        kind: Type.String(),
        packId: Type.Optional(Type.String()),
        groupOpenId: Type.Optional(Type.String()),
        atMs: Type.Integer(),
      },
      { additionalProperties: false },
    ),
  },
});
