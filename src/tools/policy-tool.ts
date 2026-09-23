/**
 * qq_group_policy：供 AI 热改策略 / 查批决策门闩。
 * 联动：写 packs/*.yaml 或 groups.yaml → PackRegistry 下次按 mtime 自动重载；
 * batch_ack 推进游标。须在 openclaw.plugin.json contracts.tools 声明。
 */

import type { PackRegistry } from "../policy/load.js";
import { writePackYaml } from "../policy/load.js";
import { applyPackEdit, getPackView, unbindGroup } from "../policy/pack-editor.js";
import type { BufferStore } from "../store/buffer.js";
import { BatchGate } from "../store/batch-gate.js";
import type { PackEdit } from "../types.js";

export type PolicyToolLogger = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

type Action =
  | "get"
  | "reload"
  | "write_pack"
  | "bind_group"
  | "unbind_group"
  | "list_bindings"
  | "batch_status"
  | "batch_ack"
  | "set_keywords_category"
  | "apply_pack_edit";

export type PolicyToolParams = {
  action: Action;
  groupOpenId?: string;
  packId?: string;
  /** write_pack：完整 pack.yaml 文本 */
  yamlText?: string;
  /** set_keywords_category */
  category?: string;
  keywords?: string[];
  /** apply_pack_edit */
  edit?: PackEdit;
};

function ok(details: Record<string, unknown>, text?: string) {
  return {
    content: [{ type: "text" as const, text: text ?? JSON.stringify(details, null, 2) }],
    details,
  };
}

function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: { ok: false, error: message },
  };
}

export function createPolicyToolHandlers(deps: {
  registry: PackRegistry;
  buffer: BufferStore;
  logger?: PolicyToolLogger;
}) {
  const gate = new BatchGate(deps.buffer);

  return {
    name: "qq_group_policy",
    description:
      "QQ冲浪指南热管理：读取/重载/结构化编辑策略包、绑定/解绑群、批决策门闩。改配置后按文件 mtime 热重载。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [
            "get",
            "reload",
            "write_pack",
            "bind_group",
            "unbind_group",
            "list_bindings",
            "batch_status",
            "batch_ack",
            "set_keywords_category",
            "apply_pack_edit",
          ],
        },
        groupOpenId: { type: "string", description: "群 OpenID（建议大写）" },
        packId: { type: "string" },
        yamlText: { type: "string", description: "write_pack 时的完整 pack.yaml" },
        category: { type: "string", description: "set_keywords_category 的类别名" },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "替换该 category 下的词表",
        },
        edit: {
          type: "object",
          description: "apply_pack_edit 的判别联合（含 op 字段）",
          additionalProperties: true,
        },
      },
    },
    async execute(_id: string, params: PolicyToolParams) {
      try {
        const action = params.action;
        const groupOpenId = params.groupOpenId?.trim().toUpperCase();
        let packId = params.packId?.trim();

        if (action === "list_bindings") {
          return ok({ ok: true, bindings: deps.registry.listBindings().groups });
        }

        if (action === "reload") {
          if (packId) deps.registry.invalidatePack(packId);
          else deps.registry.invalidateAll();
          const pack = packId
            ? deps.registry.getPackById(packId)
            : groupOpenId
              ? deps.registry.getForGroup(groupOpenId)
              : null;
          deps.logger?.info?.(`qq_group_policy: reloaded packId=${packId ?? "(all)"}`);
          return ok({
            ok: true,
            reloaded: packId ?? "all",
            pack: pack
              ? { id: pack.id, version: pack.version, keywords: pack.keywords.length }
              : null,
          });
        }

        if (action === "bind_group") {
          if (!groupOpenId || !packId) return fail("bind_group 需要 groupOpenId 与 packId");
          if (!deps.registry.getPackById(packId)) return fail(`策略包不存在: ${packId}`);
          deps.registry.bindGroup(groupOpenId, packId);
          return ok({ ok: true, groupOpenId, packId });
        }

        if (action === "unbind_group") {
          if (!groupOpenId) return fail("unbind_group 需要 groupOpenId");
          return ok(unbindGroup(deps.registry, groupOpenId));
        }

        if (action === "get") {
          if (!packId && groupOpenId) {
            packId = deps.registry.packIdForGroup(groupOpenId) ?? undefined;
          }
          if (!packId) return fail("get 需要 packId 或已绑定的 groupOpenId");
          const view = getPackView(deps.registry, packId);
          return ok({
            ok: true,
            pack: view,
            yamlText: view.yamlText,
          });
        }

        if (action === "write_pack") {
          if (!packId) return fail("write_pack 需要 packId");
          if (!params.yamlText?.trim()) return fail("write_pack 需要 yamlText");
          writePackYaml(deps.registry.root, packId, params.yamlText);
          deps.registry.invalidatePack(packId);
          const pack = deps.registry.getPackById(packId);
          deps.logger?.info?.(`qq_group_policy: wrote pack ${packId}`);
          return ok({
            ok: true,
            packId,
            version: pack?.version,
            keywordCount: pack?.keywords.length ?? 0,
          });
        }

        if (action === "set_keywords_category") {
          if (!packId) return fail("set_keywords_category 需要 packId");
          if (!params.category) return fail("需要 category");
          if (!Array.isArray(params.keywords)) return fail("需要 keywords 数组");
          const view = applyPackEdit(deps.registry, packId, {
            op: "set_keywords_category",
            category: params.category,
            keywords: params.keywords,
          });
          return ok({
            ok: true,
            packId,
            category: params.category,
            keywordCount: view.keywordCount,
          });
        }

        if (action === "apply_pack_edit") {
          if (!packId) return fail("apply_pack_edit 需要 packId");
          if (!params.edit) return fail("apply_pack_edit 需要 edit");
          const view = applyPackEdit(deps.registry, packId, params.edit);
          return ok({ ok: true, pack: view });
        }

        if (action === "batch_status") {
          if (!groupOpenId) return fail("batch_status 需要 groupOpenId");
          const pack = deps.registry.getForGroup(groupOpenId);
          if (!pack) return fail(`群未绑定策略包: ${groupOpenId}`);
          const status = gate.refresh(groupOpenId, pack);
          return ok({ ok: true, status });
        }

        if (action === "batch_ack") {
          if (!groupOpenId) return fail("batch_ack 需要 groupOpenId");
          const pack = deps.registry.getForGroup(groupOpenId);
          if (!pack) return fail(`群未绑定策略包: ${groupOpenId}`);
          const status = gate.acknowledge(groupOpenId, pack);
          deps.logger?.info?.(
            `qq_group_policy: batch_ack group=${groupOpenId} pending=${status.pendingCount}`,
          );
          return ok({ ok: true, status });
        }

        return fail(`未知 action: ${action}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger?.error?.(`qq_group_policy: ${message}`);
        return fail(message);
      }
    },
  };
}
