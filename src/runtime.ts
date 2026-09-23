/**
 * 运行时装配：PackRegistry / Buffer / Intake / 可选 qq_group_policy。
 * 联动：defineFeaturePlugin.setup 调用一次；Feature 操作与 before_dispatch 共用同一实例。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PackRegistry, loadPluginConfig, writePackYaml } from "./policy/load.js";
import { applyPackEdit, getPackView, unbindGroup } from "./policy/pack-editor.js";
import { BufferStore } from "./store/buffer.js";
import { BatchGate } from "./store/batch-gate.js";
import { MuteAction } from "./actions/mute.js";
import { RecallAction } from "./actions/recall.js";
import { Intake, groupIdFromSessionKey, resolveDataPaths } from "./intake.js";
import { formatWakeContext } from "./wake-context.js";
import { createPolicyToolHandlers } from "./tools/policy-tool.js";
import type { PackEdit } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function defaultRootDir(): string {
  return path.resolve(__dirname, "..");
}

export type ListenerApi = {
  pluginConfig?: {
    rootDir?: string;
    dataDir?: string;
    dryRun?: boolean;
    logLevel?: string;
  };
  config?: unknown;
  runtime?: {
    agent?: {
      resolveAgentWorkspaceDir?: (...args: never[]) => string;
    };
  };
  logger?: {
    debug?: (msg: string) => void;
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  on: (
    event: string,
    handler: (event: unknown, ctx: unknown) => unknown,
    opts?: { priority?: number },
  ) => void;
  registerTool: (tool: unknown, opts?: { name?: string; optional?: boolean }) => void;
};

export type ListenerRuntime = {
  rootDir: string;
  dataDir: string;
  dryRun: boolean;
  registry: PackRegistry;
  buffer: BufferStore;
  gate: BatchGate;
};

export function listPackIds(rootDir: string): string[] {
  const packsDir = path.join(rootDir, "packs");
  if (!fs.existsSync(packsDir)) return [];
  return fs
    .readdirSync(packsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => fs.existsSync(path.join(packsDir, id, "pack.yaml")))
    .sort();
}

export function bootListenerRuntime(api: ListenerApi): ListenerRuntime {
  const rootDir = api.pluginConfig?.rootDir
    ? path.resolve(api.pluginConfig.rootDir)
    : defaultRootDir();

  let workspaceDir = process.cwd();
  try {
    const resolveDir = api.runtime?.agent?.resolveAgentWorkspaceDir as
      | ((cfg: unknown, agentId: string) => string)
      | undefined;
    workspaceDir = resolveDir?.(api.config, "main") || workspaceDir;
  } catch {
    /* keep cwd */
  }

  const dataDir = api.pluginConfig?.dataDir
    ? path.resolve(api.pluginConfig.dataDir)
    : path.join(workspaceDir, "state", "qq-group-listener");

  const engineCfg = loadPluginConfig(rootDir);
  const registry = new PackRegistry(rootDir);
  const { bufferDir, stateDir } = resolveDataPaths(
    dataDir,
    engineCfg.bufferDir,
    engineCfg.stateDir,
  );
  const buffer = new BufferStore(bufferDir);
  const gate = new BatchGate(buffer);
  const dryRun = Boolean(api.pluginConfig?.dryRun);

  const qqbot = (api.config as { channels?: { qqbot?: { appId?: string; clientSecret?: string } } } | undefined)
    ?.channels?.qqbot;

  const mute = new MuteAction(
    () => ({
      appId: qqbot?.appId,
      clientSecret: typeof qqbot?.clientSecret === "string" ? qqbot.clientSecret : undefined,
    }),
    api.logger,
    dryRun,
  );
  const recall = new RecallAction(mute, api.logger, dryRun);

  const intake = new Intake(
    registry,
    buffer,
    stateDir,
    mute,
    api.logger,
    qqbot?.appId,
    recall,
  );

  api.on(
    "before_dispatch",
    async (event, ctx) => {
      try {
        return await intake.handle(event as never, ctx as never);
      } catch (err) {
        api.logger?.error?.(
          `qq-group-listener: hook error: ${err instanceof Error ? err.message : err}`,
        );
        return undefined;
      }
    },
    { priority: 100 },
  );

  // 泄流闸放行后：把静默期缓冲聊天注入 prompt（原生会话里没有这些被吞掉的消息）
  api.on(
    "before_prompt_build",
    (event, ctx) => {
      try {
        const sessionKey =
          (ctx as { sessionKey?: string })?.sessionKey ??
          (event as { sessionKey?: string })?.sessionKey;
        const groupOpenId = groupIdFromSessionKey(sessionKey);
        if (!groupOpenId) return undefined;

        const pack = registry.getForGroup(groupOpenId);
        if (!pack) return undefined;

        const opts = pack.wakeContext ?? {};
        if (opts.enabled === false) return undefined;

        const max = opts.maxMessages ?? 40;
        const recent = buffer.readRecent(groupOpenId, max);
        const text = formatWakeContext(recent, opts);
        if (!text) return undefined;

        api.logger?.debug?.(
          `qq-group-listener: wake-context group=${groupOpenId} lines=${recent.length}`,
        );
        return { prependContext: text };
      } catch (err) {
        api.logger?.error?.(
          `qq-group-listener: wake-context error: ${err instanceof Error ? err.message : err}`,
        );
        return undefined;
      }
    },
    { priority: 80 },
  );

  const policyTool = createPolicyToolHandlers({
    registry,
    buffer,
    logger: api.logger,
  });
  api.registerTool(policyTool, { name: "qq_group_policy", optional: true });

  const bound = Object.keys(registry.listBindings().groups).length;
  api.logger?.info?.(
    `qq-group-listener ready: root=${rootDir} data=${dataDir} groups=${bound} dryRun=${dryRun} hotReload=mtime ui=control wakeContext=on`,
  );

  return { rootDir, dataDir, dryRun, registry, buffer, gate };
}

export function buildOverview(rt: ListenerRuntime) {
  const bindings = rt.registry.listBindings().groups;
  const packs = listPackIds(rt.rootDir).map((id) => {
    const pack = rt.registry.getPackById(id);
    return {
      id,
      version: pack?.version ?? "?",
      description: pack?.description ?? "",
      keywordCount: pack?.keywords.length ?? 0,
      hasBatch: Boolean(pack?.batchDecision),
    };
  });

  const batches = Object.keys(bindings).map((groupOpenId) => {
    const pack = rt.registry.getForGroup(groupOpenId);
    if (!pack) {
      return {
        groupOpenId,
        packId: bindings[groupOpenId] ?? "",
        ready: false,
        reasons: ["no_pack"],
        pendingCount: 0,
        lastMessageAtMs: 0,
        lastDecisionAtMs: 0,
        updatedAtMs: Date.now(),
        combine: "any",
      };
    }
    const status = rt.gate.refresh(groupOpenId, pack);
    return {
      groupOpenId: status.groupOpenId,
      packId: status.packId,
      ready: status.ready,
      reasons: status.reasons,
      pendingCount: status.pendingCount,
      lastMessageAtMs: status.lastMessageAtMs,
      lastDecisionAtMs: status.lastDecisionAtMs,
      updatedAtMs: status.updatedAtMs,
      combine: status.combine,
    };
  });

  return {
    rootDir: rt.rootDir,
    dataDir: rt.dataDir,
    dryRun: rt.dryRun,
    bindings,
    packs,
    batches,
  };
}

export function getPackPayload(rt: ListenerRuntime, packId: string) {
  return getPackView(rt.registry, packId);
}

export function savePack(rt: ListenerRuntime, packId: string, yamlText: string) {
  writePackYaml(rt.rootDir, packId, yamlText);
  rt.registry.invalidatePack(packId);
  const pack = rt.registry.getPackById(packId);
  if (!pack) throw new Error(`写入后无法加载: ${packId}`);
  return {
    ok: true,
    packId,
    version: pack.version,
    keywordCount: pack.keywords.length,
  };
}

export function editPack(rt: ListenerRuntime, packId: string, edit: PackEdit) {
  return applyPackEdit(rt.registry, packId, edit);
}

export function unbindPackGroup(rt: ListenerRuntime, groupOpenId: string) {
  return unbindGroup(rt.registry, groupOpenId);
}
