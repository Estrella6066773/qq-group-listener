/**
 * Control UI：QQ 群策略包结构化管理页（无 YAML 文本编辑）。
 * 联动：createFeatureClient → overview / get_pack / apply_pack_edit / bind|unbind / batch_*；
 * 仅在 Labs → Custom plugin UI 开启后加载。
 */

import { defineControlUiPlugin } from "openclaw/plugin-sdk/control-ui";
import { createFeatureClient } from "openclaw/plugin-sdk/feature-contract";
import { contract } from "./contract.js";
import "./control-ui.css";

type PackView = {
  packId: string;
  version: string;
  description: string;
  keywordCount: number;
  categories: Record<string, string[]>;
  looseKeywords: string[];
  excludeCategories: string[];
  match: {
    combine: "any" | "all";
    rules: Array<Record<string, unknown>>;
  } | null;
  route: {
    order: string[];
    mention?: { wake: boolean; buffer: boolean };
    keyword?: {
      wake: boolean;
      buffer: boolean;
      keywordsRef?: string;
      onHit?: string;
      match?: unknown;
    };
    default: { wake: boolean; buffer: boolean };
  };
  mute: {
    timezone: string;
    windowMinutes: number;
    hitsBeforeMute: number;
    muteSeconds: number;
    dailyMuteThreshold: number;
    extendedMuteSeconds: number;
  } | null;
  batchDecision: {
    promptFile: string;
    deliveryChannelPrefix: string;
    pollEveryMinutes?: number;
    combine?: "any" | "all";
    triggers?: Array<Record<string, unknown>>;
  } | null;
  boundGroups: string[];
};

export default defineControlUiPlugin({
  id: contract.pluginId,
  activate(host) {
    host.ui.registerNavigation({
      id: "qq-policy",
      label: "QQ 群策略",
      page: { id: "qq-policy" },
      icon: "shield",
      group: "control",
    });

    host.ui.registerPage({
      id: "qq-policy",
      label: "QQ 群策略",
      mount(container, context) {
        const feature = createFeatureClient(contract, context.host);
        const root = document.createElement("section");
        root.className = "qgl-admin";
        root.innerHTML = `
          <header class="qgl-header">
            <div>
              <h1>QQ 群策略包</h1>
              <p class="qgl-sub">结构化编辑 · 词表 / 匹配条件 / 批触发器 · 群绑定（仅 QQ 扩展）</p>
            </div>
            <div class="qgl-actions">
              <button type="button" class="qgl-btn" data-act="refresh">刷新</button>
              <button type="button" class="qgl-btn qgl-btn--ghost" data-act="reload-all">强制重载缓存</button>
            </div>
          </header>
          <p class="qgl-meta" data-role="meta">加载中…</p>
          <div class="qgl-grid">
            <aside class="qgl-panel">
              <h2>群绑定</h2>
              <p class="qgl-note">群 OpenID → 策略包。点群可跳到对应包编辑。</p>
              <div data-role="bindings"></div>
              <h2>策略包</h2>
              <p class="qgl-note">选择包后在右侧编辑词表、路由、禁言与批决策。</p>
              <div data-role="packs" class="qgl-pack-list"></div>
              <h2>批决策门闩</h2>
              <p class="qgl-note">各群当前是否 ready、待处理条数等运行时状态（只读）。</p>
              <div data-role="batches"></div>
            </aside>
            <main class="qgl-panel qgl-editor">
              <div class="qgl-editor-head">
                <h2 data-role="editor-title">选择左侧策略包</h2>
              </div>
              <p class="qgl-hint" data-role="pack-meta"></p>
              <div data-role="editor-body" class="qgl-editor-body qgl-hidden">
                <section class="qgl-section" data-section="meta">
                  <h3>元信息</h3>
                  <p class="qgl-note">策略包对外说明与版本号。描述会出现在左侧包列表；改完点「保存元信息」写入 pack.yaml。</p>
                  <label class="qgl-field">描述
                    <input data-field="description" type="text" />
                  </label>
                  <label class="qgl-field">版本
                    <input data-field="version" type="text" />
                  </label>
                  <button type="button" class="qgl-btn qgl-btn--sm" data-act="save-meta">保存元信息</button>
                </section>

                <section class="qgl-section" data-section="keywords">
                  <h3>词表</h3>
                  <p class="qgl-note">按分类存放触发词，供「匹配条件」与 keyword 路由使用。点词条芯片可删除；改动即时写入 keywords.yaml，无需另存。</p>
                  <div class="qgl-row">
                    <input data-role="new-category" placeholder="新分类名" aria-label="新分类名" />
                    <button type="button" class="qgl-btn qgl-btn--sm" data-act="add-category">新建分类</button>
                  </div>
                  <div data-role="keyword-cats" class="qgl-cat-list"></div>
                </section>

                <section class="qgl-section" data-section="match">
                  <h3>匹配条件</h3>
                  <p class="qgl-note">决定「什么算命中关键词」。可组合分类 / 词条 / 正则；无规则时退回整表扁平匹配。改完点「保存匹配条件」。</p>
                  <p class="qgl-hint" data-role="match-hint"></p>
                  <label class="qgl-field">规则合并方式
                    <select data-field="match-combine">
                      <option value="any">任一规则命中即可（any）</option>
                      <option value="all">全部规则都要命中（all）</option>
                    </select>
                  </label>
                  <div data-role="match-rules" class="qgl-rule-list"></div>
                  <div class="qgl-row">
                    <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-act="add-rule-category">+ 分类规则</button>
                    <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-act="add-rule-terms">+ 词条规则</button>
                    <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-act="add-rule-regex">+ 正则规则</button>
                    <button type="button" class="qgl-btn qgl-btn--sm" data-act="save-match">保存匹配条件</button>
                  </div>
                </section>

                <section class="qgl-section" data-section="route-mute">
                  <h3>路由与禁言</h3>
                  <p class="qgl-note">路由：每条真实 QQ 群消息按顺序试 mention → keyword → default，命中即停，决定是否唤醒即时模型、是否写入缓冲。禁言：仅 keyword 命中且 onHit 为「计数并可能禁言」时，由插件自动执行，不经过模型。</p>
                  <p class="qgl-hint" data-role="route-hint"></p>
                  <div class="qgl-form-grid" data-role="route-fields"></div>
                  <p class="qgl-hint" data-role="mute-hint"></p>
                  <div class="qgl-form-grid" data-role="mute-fields"></div>
                  <button type="button" class="qgl-btn qgl-btn--sm" data-act="save-route-mute">保存路由与禁言</button>
                </section>

                <section class="qgl-section" data-section="batch">
                  <h3>批决策</h3>
                  <p class="qgl-note">缓冲里积够条件后，另起一轮 agent 读缓冲并决定是否发言（与即时 @ 回复不是同一条路径）。下方触发器控制「何时算 ready」；改完点「保存批决策」。</p>
                  <p class="qgl-hint" data-role="batch-hint"></p>
                  <div class="qgl-form-grid" data-role="batch-fields"></div>
                  <p class="qgl-note">触发器：间隔＝距上次决策满 N 分钟；条数＝游标后待处理消息数；空闲＝群内静默满 N 分钟。合并方式决定「任一满足」还是「全部满足」才 ready。</p>
                  <div data-role="batch-triggers" class="qgl-rule-list"></div>
                  <div class="qgl-row">
                    <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-act="add-trigger-interval">+ 间隔</button>
                    <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-act="add-trigger-count">+ 条数</button>
                    <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-act="add-trigger-idle">+ 空闲</button>
                    <button type="button" class="qgl-btn qgl-btn--sm" data-act="save-batch">保存批决策</button>
                  </div>
                </section>

                <section class="qgl-section" data-section="bindings">
                  <h3>本包绑定的群</h3>
                  <p class="qgl-note">只有绑定到本包的群 OpenID 才会套用上述路由/禁言/批决策。未绑定的群插件不拦截。OpenID 请用大写。</p>
                  <div data-role="pack-bindings"></div>
                  <div class="qgl-row">
                    <input data-role="bind-group" placeholder="群 OpenID（大写）" aria-label="群 OpenID" />
                    <button type="button" class="qgl-btn qgl-btn--sm" data-act="bind">绑定</button>
                  </div>
                </section>
              </div>
              <p class="qgl-status" data-role="status" aria-live="polite"></p>
            </main>
          </div>
        `;
        container.append(root);

        const escapeHtml = (s: string) =>
          s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

        const el = {
          meta: root.querySelector('[data-role="meta"]') as HTMLElement,
          bindings: root.querySelector('[data-role="bindings"]') as HTMLElement,
          packs: root.querySelector('[data-role="packs"]') as HTMLElement,
          batches: root.querySelector('[data-role="batches"]') as HTMLElement,
          editorTitle: root.querySelector('[data-role="editor-title"]') as HTMLElement,
          packMeta: root.querySelector('[data-role="pack-meta"]') as HTMLElement,
          editorBody: root.querySelector('[data-role="editor-body"]') as HTMLElement,
          status: root.querySelector('[data-role="status"]') as HTMLElement,
          description: root.querySelector('[data-field="description"]') as HTMLInputElement,
          version: root.querySelector('[data-field="version"]') as HTMLInputElement,
          keywordCats: root.querySelector('[data-role="keyword-cats"]') as HTMLElement,
          newCategory: root.querySelector('[data-role="new-category"]') as HTMLInputElement,
          matchCombine: root.querySelector('[data-field="match-combine"]') as HTMLSelectElement,
          matchRules: root.querySelector('[data-role="match-rules"]') as HTMLElement,
          matchHint: root.querySelector('[data-role="match-hint"]') as HTMLElement,
          routeHint: root.querySelector('[data-role="route-hint"]') as HTMLElement,
          muteHint: root.querySelector('[data-role="mute-hint"]') as HTMLElement,
          batchHint: root.querySelector('[data-role="batch-hint"]') as HTMLElement,
          routeFields: root.querySelector('[data-role="route-fields"]') as HTMLElement,
          muteFields: root.querySelector('[data-role="mute-fields"]') as HTMLElement,
          batchFields: root.querySelector('[data-role="batch-fields"]') as HTMLElement,
          batchTriggers: root.querySelector('[data-role="batch-triggers"]') as HTMLElement,
          packBindings: root.querySelector('[data-role="pack-bindings"]') as HTMLElement,
          bindGroup: root.querySelector('[data-role="bind-group"]') as HTMLInputElement,
        };

        let selectedPackId: string | null = null;
        let currentView: PackView | null = null;
        let draftRules: Array<Record<string, unknown>> = [];
        let draftTriggers: Array<Record<string, unknown>> = [];
        let busy = false;

        const setStatus = (text: string, kind: "ok" | "err" | "" = "") => {
          el.status.textContent = text;
          el.status.dataset.kind = kind;
        };

        const setBusy = (v: boolean) => {
          busy = v;
          root.classList.toggle("qgl-busy", v);
        };

        const applyEdit = async (edit: Record<string, unknown>) => {
          if (!selectedPackId) return;
          const view = (await feature.invoke("apply_pack_edit", {
            packId: selectedPackId,
            edit,
          })) as PackView;
          currentView = view;
          fillEditor(view);
          await renderOverview();
          return view;
        };

        const fillEditor = (view: PackView) => {
          el.editorBody.classList.remove("qgl-hidden");
          el.editorTitle.textContent = view.packId;
          el.packMeta.textContent = `v${view.version} · ${view.keywordCount} 关键词 · ${view.description || "无描述"}`;
          el.description.value = view.description;
          el.version.value = view.version;

          // keywords
          el.keywordCats.innerHTML = "";
          const catNames = Object.keys(view.categories).sort();
          if (catNames.length === 0) {
            el.keywordCats.innerHTML = `<p class="qgl-empty">暂无分类</p>`;
          }
          for (const cat of catNames) {
            const terms = view.categories[cat] ?? [];
            const card = document.createElement("div");
            card.className = "qgl-cat";
            card.innerHTML = `
              <div class="qgl-cat__head">
                <strong>${escapeHtml(cat)}</strong>
                <span class="qgl-muted">${terms.length} 词</span>
                <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-act="delete-category" data-cat="${escapeHtml(cat)}">删除分类</button>
              </div>
              <div class="qgl-chips" data-cat-chips="${escapeHtml(cat)}"></div>
              <div class="qgl-row">
                <input data-add-term="${escapeHtml(cat)}" placeholder="新关键词" aria-label="向 ${escapeHtml(cat)} 添加关键词" />
                <button type="button" class="qgl-btn qgl-btn--sm" data-act="add-keyword" data-cat="${escapeHtml(cat)}">添加</button>
              </div>
            `;
            const chips = card.querySelector(`[data-cat-chips="${CSS.escape(cat)}"]`) as HTMLElement;
            for (const term of terms) {
              const chip = document.createElement("button");
              chip.type = "button";
              chip.className = "qgl-chip";
              chip.title = "点击删除";
              chip.textContent = term;
              chip.dataset.act = "remove-keyword";
              chip.dataset.cat = cat;
              chip.dataset.term = term;
              chips.append(chip);
            }
            el.keywordCats.append(card);
          }

          // match
          const hasKeyword = Boolean(view.route.keyword);
          el.matchHint.textContent = hasKeyword
            ? "当前状态：已启用 keyword 路由。无规则时引擎退回扁平词表（已扣除全局排除分类）。"
            : "当前状态：未启用 keyword 路由；保存匹配条件时会自动补上 keyword 块。";
          draftRules = view.match?.rules ? structuredClone(view.match.rules) : [];
          el.matchCombine.value = view.match?.combine === "all" ? "all" : "any";
          renderMatchRules();

          // 路由/禁言：区块顶 hint 写全局语义；各 field-block 内 qgl-note 写本规则用途。
          const r = view.route;
          const orderText = (r.order ?? []).join(" → ") || "（未设置）";
          el.routeHint.textContent =
            `本包求值顺序：${orderText}（短路：命中即停）。唤醒＝交给即时模型回复；缓冲＝写入批决策阅读队列。仅 channel=qqbot 的真实入站生效（Control UI 打字不会被吞）。`;
          el.routeFields.innerHTML = `
            <div class="qgl-field-block">
              <span class="qgl-field-title">提及（@ / mention）</span>
              <p class="qgl-note">机器人被 @ 或提及时走此规则。常见配置：开唤醒、关缓冲 → 立刻由即时模型回复，不入批决策缓冲。</p>
              <label class="qgl-field">唤醒即时模型
                <input type="checkbox" data-rf="mention.wake" ${r.mention?.wake ? "checked" : ""} />
              </label>
              <label class="qgl-field">写入批决策缓冲
                <input type="checkbox" data-rf="mention.buffer" ${r.mention?.buffer ? "checked" : ""} />
              </label>
            </div>
            <div class="qgl-field-block">
              <span class="qgl-field-title">关键词（keyword）</span>
              <p class="qgl-note">命中上方匹配条件 / 词表时走此规则。常见配置：关唤醒、开缓冲 → 静默计数或禁言，原文留给批决策。命中后动作选「计数并可能禁言」时，按下方禁言阈值由插件自动处理。</p>
              <label class="qgl-field">唤醒即时模型
                <input type="checkbox" data-rf="keyword.wake" ${r.keyword?.wake ? "checked" : ""} />
              </label>
              <label class="qgl-field">写入批决策缓冲
                <input type="checkbox" data-rf="keyword.buffer" ${r.keyword?.buffer ? "checked" : ""} />
              </label>
              <label class="qgl-field">命中后动作
                <select data-rf="keyword.onHit">
                  <option value="countAndMaybeMute" ${r.keyword?.onHit !== "none" ? "selected" : ""}>计数并可能禁言</option>
                  <option value="none" ${r.keyword?.onHit === "none" ? "selected" : ""}>仅路由，不计数</option>
                </select>
              </label>
            </div>
            <div class="qgl-field-block">
              <span class="qgl-field-title">默认 / 闲聊（default）</span>
              <p class="qgl-note">未命中 @ 与关键词时走此规则。常见配置：关唤醒、开缓冲 → 静默入缓冲，等批决策门闩就绪后再读。</p>
              <label class="qgl-field">唤醒即时模型
                <input type="checkbox" data-rf="default.wake" ${r.default?.wake ? "checked" : ""} />
              </label>
              <label class="qgl-field">写入批决策缓冲
                <input type="checkbox" data-rf="default.buffer" ${r.default?.buffer ? "checked" : ""} />
              </label>
            </div>
          `;
          const m = view.mute;
          el.muteHint.textContent = m
            ? "禁言由插件自动执行，不经过即时模型；成功后会写入一条系统记录供批决策阅读。窗口内命中次数须严格大于「禁言前命中次数」才触发；当日禁言次数达到「延长档阈值」后改用延长时长。"
            : "本包未配置禁言策略；即使关键词命中后动作设为「计数并可能禁言」，也不会真正禁言。";
          el.muteFields.innerHTML = m
            ? `
            <label class="qgl-field">时区（用于划分「当天」）
              <input data-mf="timezone" value="${escapeHtml(m.timezone)}" />
            </label>
            <label class="qgl-field">滑动窗口（分钟）
              <input data-mf="windowMinutes" type="number" value="${m.windowMinutes}" />
            </label>
            <label class="qgl-field">禁言前命中次数（须严格大于此值）
              <input data-mf="hitsBeforeMute" type="number" value="${m.hitsBeforeMute}" />
            </label>
            <label class="qgl-field">基础禁言时长（秒）
              <input data-mf="muteSeconds" type="number" value="${m.muteSeconds}" />
            </label>
            <label class="qgl-field">延长档阈值（当日禁言次数）
              <input data-mf="dailyMuteThreshold" type="number" value="${m.dailyMuteThreshold}" />
            </label>
            <label class="qgl-field">延长禁言时长（秒）
              <input data-mf="extendedMuteSeconds" type="number" value="${m.extendedMuteSeconds}" />
            </label>
          `
            : `<p class="qgl-empty">本包无禁言策略</p>`;

          // batch
          const b = view.batchDecision;
          if (!b) {
            el.batchHint.textContent = "本包未配置批决策：缓冲即使写入，也不会自动拉起批决策 agent。";
            el.batchFields.innerHTML = `<p class="qgl-empty">本包无批决策</p>`;
            draftTriggers = [];
            el.batchTriggers.innerHTML = "";
          } else {
            el.batchHint.textContent =
              "轮询周期控制多久检查一次门闩；提示词文件与发言通道前缀指向策略包目录内的决策脚本与发群目标。";
            el.batchFields.innerHTML = `
              <label class="qgl-field">触发器合并方式
                <select data-bf="combine">
                  <option value="any" ${b.combine !== "all" ? "selected" : ""}>任一触发器满足即可（any）</option>
                  <option value="all" ${b.combine === "all" ? "selected" : ""}>全部触发器都要满足（all）</option>
                </select>
              </label>
              <label class="qgl-field">轮询周期（分钟）
                <input data-bf="pollEveryMinutes" type="number" value="${b.pollEveryMinutes ?? 1}" />
              </label>
              <label class="qgl-field">决策提示词文件（相对策略包目录）
                <input data-bf="promptFile" value="${escapeHtml(b.promptFile)}" />
              </label>
              <label class="qgl-field">发言通道前缀（如 qqbot:group:）
                <input data-bf="deliveryChannelPrefix" value="${escapeHtml(b.deliveryChannelPrefix)}" />
              </label>
            `;
            draftTriggers = b.triggers ? structuredClone(b.triggers) : [];
            renderBatchTriggers();
          }

          // bindings
          el.packBindings.innerHTML = "";
          if (view.boundGroups.length === 0) {
            el.packBindings.innerHTML = `<p class="qgl-empty">暂无绑定</p>`;
          } else {
            for (const gid of view.boundGroups) {
              const row = document.createElement("div");
              row.className = "qgl-bind-row";
              row.innerHTML = `
                <code>${escapeHtml(gid)}</code>
                <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-act="unbind" data-gid="${escapeHtml(gid)}">解绑</button>
              `;
              el.packBindings.append(row);
            }
          }
        };

        const renderMatchRules = () => {
          el.matchRules.innerHTML = "";
          if (draftRules.length === 0) {
            el.matchRules.innerHTML = `<p class="qgl-empty">暂无匹配规则（将使用扁平词表）</p>`;
            return;
          }
          draftRules.forEach((rule, idx) => {
            const type = String(rule.type ?? "category");
            const card = document.createElement("div");
            card.className = "qgl-rule";
            card.dataset.idx = String(idx);
            let body = "";
            if (type === "category") {
              body = `
                <label class="qgl-field">包含分类（逗号分隔）
                  <input data-mr="categories" value="${escapeHtml(((rule.categories as string[]) ?? []).join(", "))}" />
                </label>
                <label class="qgl-field">排除分类（逗号分隔）
                  <input data-mr="exclude" value="${escapeHtml(((rule.exclude as string[]) ?? []).join(", "))}" />
                </label>
                <label class="qgl-field">分类内合并
                  <select data-mr="within">
                    <option value="any" ${rule.within !== "all" ? "selected" : ""}>任一分类命中即可</option>
                    <option value="all" ${rule.within === "all" ? "selected" : ""}>所列分类都要命中</option>
                  </select>
                </label>`;
            } else if (type === "terms") {
              body = `
                <label class="qgl-field">词条（逗号分隔）
                  <input data-mr="terms" value="${escapeHtml(((rule.terms as string[]) ?? []).join(", "))}" />
                </label>
                <label class="qgl-field">词条内合并
                  <select data-mr="within">
                    <option value="any" ${rule.within !== "all" ? "selected" : ""}>任一词条命中即可</option>
                    <option value="all" ${rule.within === "all" ? "selected" : ""}>所列词条都要命中</option>
                  </select>
                </label>`;
            } else {
              body = `
                <label class="qgl-field">正则表达式
                  <input data-mr="pattern" value="${escapeHtml(String(rule.pattern ?? ""))}" />
                </label>`;
            }
            const typeLabel =
              type === "category" ? "分类规则" : type === "terms" ? "词条规则" : "正则规则";
            card.innerHTML = `
              <div class="qgl-rule__head">
                <strong>${escapeHtml(typeLabel)}</strong>
                <div class="qgl-row">
                  <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-act="rule-up" data-idx="${idx}">上移</button>
                  <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-act="rule-down" data-idx="${idx}">下移</button>
                  <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-act="rule-del" data-idx="${idx}">删除</button>
                </div>
              </div>
              ${body}
            `;
            el.matchRules.append(card);
          });
        };

        const syncDraftRulesFromDom = () => {
          const cards = [...el.matchRules.querySelectorAll(".qgl-rule")];
          draftRules = cards.map((card, i) => {
            const prev = draftRules[i] ?? { type: "category" };
            const type = String(prev.type ?? "category");
            const get = (name: string) =>
              (card.querySelector(`[data-mr="${name}"]`) as HTMLInputElement | HTMLSelectElement | null)
                ?.value ?? "";
            const split = (s: string) =>
              s
                .split(/[,，]/)
                .map((x) => x.trim())
                .filter(Boolean);
            if (type === "category") {
              return {
                type: "category",
                categories: split(get("categories")),
                exclude: split(get("exclude")),
                within: get("within") === "all" ? "all" : "any",
              };
            }
            if (type === "terms") {
              return {
                type: "terms",
                terms: split(get("terms")),
                within: get("within") === "all" ? "all" : "any",
              };
            }
            return { type: "regex", pattern: get("pattern").trim() };
          });
        };

        const renderBatchTriggers = () => {
          el.batchTriggers.innerHTML = "";
          if (draftTriggers.length === 0) {
            el.batchTriggers.innerHTML = `<p class="qgl-empty">暂无触发器</p>`;
            return;
          }
          draftTriggers.forEach((tr, idx) => {
            const type = String(tr.type ?? "interval");
            const card = document.createElement("div");
            card.className = "qgl-rule";
            let field = "";
            let typeLabel = "间隔";
            let typeNote = "距上次批决策满若干分钟即满足。";
            if (type === "interval") {
              field = `<label class="qgl-field">间隔分钟数
                <input data-tr="everyMinutes" type="number" value="${Number(tr.everyMinutes ?? 10)}" />
              </label>`;
            } else if (type === "messageCount") {
              typeLabel = "条数";
              typeNote = "游标之后待处理消息达到阈值即满足。";
              field = `<label class="qgl-field">待处理消息条数阈值
                <input data-tr="threshold" type="number" value="${Number(tr.threshold ?? 20)}" />
              </label>`;
            } else {
              typeLabel = "空闲";
              typeNote = "群内静默满若干分钟（无新缓冲消息）即满足。";
              field = `<label class="qgl-field">空闲分钟数
                <input data-tr="idleMinutes" type="number" value="${Number(tr.idleMinutes ?? 5)}" />
              </label>`;
            }
            card.innerHTML = `
              <div class="qgl-rule__head">
                <strong>${escapeHtml(typeLabel)}</strong>
                <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-act="trigger-del" data-idx="${idx}">删除</button>
              </div>
              <p class="qgl-note">${escapeHtml(typeNote)}</p>
              ${field}
            `;
            el.batchTriggers.append(card);
          });
        };

        const syncDraftTriggersFromDom = () => {
          const cards = [...el.batchTriggers.querySelectorAll(".qgl-rule")];
          draftTriggers = cards.map((card, i) => {
            const prev = draftTriggers[i] ?? { type: "interval" };
            const type = String(prev.type ?? "interval");
            const num = (name: string) =>
              Number((card.querySelector(`[data-tr="${name}"]`) as HTMLInputElement | null)?.value ?? 0);
            if (type === "messageCount") return { type, threshold: num("threshold") };
            if (type === "idle") return { type, idleMinutes: num("idleMinutes") };
            return { type: "interval", everyMinutes: num("everyMinutes") };
          });
        };

        const renderOverview = async () => {
          if (context.signal.aborted) return;
          setBusy(true);
          try {
            const data = await feature.invoke("overview", {});
            if (context.signal.aborted) return;
            el.meta.textContent = `root=${data.rootDir} · data=${data.dataDir} · dryRun=${data.dryRun}`;

            el.bindings.innerHTML = "";
            const entries = Object.entries(data.bindings);
            if (entries.length === 0) {
              el.bindings.innerHTML = `<p class="qgl-empty">暂无绑定</p>`;
            } else {
              for (const [gid, packId] of entries) {
                const row = document.createElement("div");
                row.className = "qgl-bind-side";
                row.innerHTML = `
                  <button type="button" class="qgl-item" data-act="goto-pack" data-pack="${escapeHtml(packId)}">
                    <strong>${escapeHtml(gid)}</strong><span>→ ${escapeHtml(packId)}</span>
                  </button>
                  <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-act="unbind" data-gid="${escapeHtml(gid)}">解绑</button>
                `;
                el.bindings.append(row);
              }
            }

            el.packs.innerHTML = "";
            for (const p of data.packs) {
              const row = document.createElement("button");
              row.type = "button";
              row.className = "qgl-pack" + (selectedPackId === p.id ? " is-active" : "");
              row.setAttribute("aria-pressed", selectedPackId === p.id ? "true" : "false");
              const desc = (p.description || "").trim();
              row.innerHTML = `
                <div class="qgl-pack__title">
                  <span class="qgl-pack__name">${escapeHtml(p.id)}</span>
                  <span class="qgl-pack__badge">v${escapeHtml(p.version)}</span>
                </div>
                <div class="qgl-pack__meta">${p.keywordCount} 词 · ${p.hasBatch ? "含批决策" : "无批决策"}</div>
                ${desc ? `<div class="qgl-pack__desc">${escapeHtml(desc)}</div>` : ""}
              `;
              row.onclick = () => void selectPack(p.id);
              el.packs.append(row);
            }

            el.batches.innerHTML = "";
            if (data.batches.length === 0) {
              el.batches.innerHTML = `<p class="qgl-empty">无门闩数据</p>`;
            } else {
              for (const b of data.batches) {
                const card = document.createElement("div");
                card.className = "qgl-batch" + (b.ready ? " is-ready" : "");
                card.innerHTML = `
                  <div><strong>${escapeHtml(b.groupOpenId.slice(0, 12))}…</strong> → ${escapeHtml(b.packId)}</div>
                  <div>${b.ready ? "READY" : "idle"} · pending ${b.pendingCount}</div>
                  <div class="qgl-muted">${escapeHtml(b.reasons.join(", ") || "—")}</div>
                  <div class="qgl-row">
                    <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-gid="${escapeHtml(b.groupOpenId)}" data-act="batch-refresh">刷新</button>
                    <button type="button" class="qgl-btn qgl-btn--sm qgl-btn--ghost" data-gid="${escapeHtml(b.groupOpenId)}" data-act="batch-ack">Ack</button>
                  </div>
                `;
                el.batches.append(card);
              }
            }
          } catch (err) {
            if (!context.signal.aborted) setStatus(String(err), "err");
          } finally {
            if (!context.signal.aborted) setBusy(false);
          }
        };

        const selectPack = async (packId: string) => {
          selectedPackId = packId;
          setBusy(true);
          try {
            const pack = (await feature.invoke("get_pack", { packId })) as PackView;
            if (context.signal.aborted) return;
            currentView = pack;
            fillEditor(pack);
            setStatus(`已加载 ${packId}`, "ok");
            await renderOverview();
          } catch (err) {
            if (!context.signal.aborted) setStatus(String(err), "err");
          } finally {
            if (!context.signal.aborted) setBusy(false);
          }
        };

        root.addEventListener("click", (ev) => {
          const t = ev.target as HTMLElement | null;
          const btn = t?.closest("button[data-act]") as HTMLButtonElement | null;
          if (!btn || busy) return;
          const act = btn.dataset.act;
          void (async () => {
            try {
              if (act === "refresh") {
                await renderOverview();
                if (selectedPackId) await selectPack(selectedPackId);
                setStatus("已刷新", "ok");
              } else if (act === "reload-all") {
                await feature.invoke("reload", {});
                await renderOverview();
                if (selectedPackId) await selectPack(selectedPackId);
                setStatus("缓存已重载", "ok");
              } else if (act === "goto-pack") {
                await selectPack(btn.dataset.pack!);
              } else if (act === "save-meta") {
                await applyEdit({
                  op: "set_meta",
                  description: el.description.value,
                  version: el.version.value,
                });
                setStatus("元信息已保存", "ok");
              } else if (act === "add-category") {
                const cat = el.newCategory.value.trim();
                if (!cat) {
                  setStatus("请填写分类名", "err");
                  return;
                }
                await applyEdit({ op: "set_keywords_category", category: cat, keywords: [] });
                el.newCategory.value = "";
                setStatus(`已创建分类 ${cat}`, "ok");
              } else if (act === "delete-category") {
                await applyEdit({ op: "delete_category", category: btn.dataset.cat });
                setStatus(`已删除分类 ${btn.dataset.cat}`, "ok");
              } else if (act === "add-keyword") {
                const cat = btn.dataset.cat!;
                const input = root.querySelector(`[data-add-term="${CSS.escape(cat)}"]`) as HTMLInputElement;
                const term = input?.value.trim() ?? "";
                if (!term) {
                  setStatus("请填写关键词", "err");
                  return;
                }
                await applyEdit({ op: "add_keyword", category: cat, term });
                setStatus(`已添加 ${term}`, "ok");
              } else if (act === "remove-keyword") {
                await applyEdit({
                  op: "remove_keyword",
                  category: btn.dataset.cat,
                  term: btn.dataset.term,
                });
                setStatus(`已删除 ${btn.dataset.term}`, "ok");
              } else if (act === "add-rule-category") {
                syncDraftRulesFromDom();
                draftRules.push({ type: "category", categories: [], exclude: [], within: "any" });
                renderMatchRules();
              } else if (act === "add-rule-terms") {
                syncDraftRulesFromDom();
                draftRules.push({ type: "terms", terms: [], within: "any" });
                renderMatchRules();
              } else if (act === "add-rule-regex") {
                syncDraftRulesFromDom();
                draftRules.push({ type: "regex", pattern: "" });
                renderMatchRules();
              } else if (act === "rule-del") {
                syncDraftRulesFromDom();
                draftRules.splice(Number(btn.dataset.idx), 1);
                renderMatchRules();
              } else if (act === "rule-up") {
                syncDraftRulesFromDom();
                const i = Number(btn.dataset.idx);
                if (i > 0) {
                  const tmp = draftRules[i - 1];
                  draftRules[i - 1] = draftRules[i];
                  draftRules[i] = tmp;
                }
                renderMatchRules();
              } else if (act === "rule-down") {
                syncDraftRulesFromDom();
                const i = Number(btn.dataset.idx);
                if (i < draftRules.length - 1) {
                  const tmp = draftRules[i + 1];
                  draftRules[i + 1] = draftRules[i];
                  draftRules[i] = tmp;
                }
                renderMatchRules();
              } else if (act === "save-match") {
                syncDraftRulesFromDom();
                const match =
                  draftRules.length === 0
                    ? null
                    : { combine: el.matchCombine.value === "all" ? "all" : "any", rules: draftRules };
                await applyEdit({ op: "set_match", match });
                setStatus("匹配条件已保存", "ok");
              } else if (act === "save-route-mute") {
                if (!currentView) return;
                const bool = (name: string) =>
                  Boolean((root.querySelector(`[data-rf="${name}"]`) as HTMLInputElement | null)?.checked);
                const onHit =
                  (root.querySelector('[data-rf="keyword.onHit"]') as HTMLSelectElement | null)?.value ??
                  "countAndMaybeMute";
                const route = {
                  order: currentView.route.order,
                  mention: { wake: bool("mention.wake"), buffer: bool("mention.buffer") },
                  keyword: {
                    wake: bool("keyword.wake"),
                    buffer: bool("keyword.buffer"),
                    keywordsRef: currentView.route.keyword?.keywordsRef ?? "keywords.yaml",
                    onHit,
                    match: currentView.match ?? undefined,
                  },
                  default: { wake: bool("default.wake"), buffer: bool("default.buffer") },
                };
                let mute = currentView.mute;
                if (mute) {
                  const num = (name: string) =>
                    Number((root.querySelector(`[data-mf="${name}"]`) as HTMLInputElement)?.value ?? 0);
                  const tz =
                    (root.querySelector('[data-mf="timezone"]') as HTMLInputElement)?.value ?? mute.timezone;
                  mute = {
                    timezone: tz,
                    windowMinutes: num("windowMinutes"),
                    hitsBeforeMute: num("hitsBeforeMute"),
                    muteSeconds: num("muteSeconds"),
                    dailyMuteThreshold: num("dailyMuteThreshold"),
                    extendedMuteSeconds: num("extendedMuteSeconds"),
                  };
                }
                await applyEdit({ op: "set_route_mute", route, mute });
                setStatus("路由与禁言已保存", "ok");
              } else if (act === "add-trigger-interval") {
                syncDraftTriggersFromDom();
                draftTriggers.push({ type: "interval", everyMinutes: 10 });
                renderBatchTriggers();
              } else if (act === "add-trigger-count") {
                syncDraftTriggersFromDom();
                draftTriggers.push({ type: "messageCount", threshold: 20 });
                renderBatchTriggers();
              } else if (act === "add-trigger-idle") {
                syncDraftTriggersFromDom();
                draftTriggers.push({ type: "idle", idleMinutes: 5 });
                renderBatchTriggers();
              } else if (act === "trigger-del") {
                syncDraftTriggersFromDom();
                draftTriggers.splice(Number(btn.dataset.idx), 1);
                renderBatchTriggers();
              } else if (act === "save-batch") {
                if (!currentView?.batchDecision) {
                  setStatus("本包无批决策，无法保存", "err");
                  return;
                }
                syncDraftTriggersFromDom();
                const str = (name: string) =>
                  (root.querySelector(`[data-bf="${name}"]`) as HTMLInputElement | HTMLSelectElement)
                    ?.value ?? "";
                await applyEdit({
                  op: "set_batch",
                  batchDecision: {
                    promptFile: str("promptFile"),
                    deliveryChannelPrefix: str("deliveryChannelPrefix"),
                    pollEveryMinutes: Number(str("pollEveryMinutes") || 1),
                    combine: str("combine") === "all" ? "all" : "any",
                    triggers: draftTriggers,
                  },
                });
                setStatus("批决策已保存", "ok");
              } else if (act === "bind") {
                if (!selectedPackId) return;
                const groupOpenId = el.bindGroup.value.trim().toUpperCase();
                if (!groupOpenId) {
                  setStatus("请填写群 OpenID", "err");
                  return;
                }
                await feature.invoke("bind_group", { groupOpenId, packId: selectedPackId });
                el.bindGroup.value = "";
                await selectPack(selectedPackId);
                setStatus(`已绑定 ${groupOpenId} → ${selectedPackId}`, "ok");
              } else if (act === "unbind") {
                const gid = btn.dataset.gid!;
                await feature.invoke("unbind_group", { groupOpenId: gid });
                if (selectedPackId) await selectPack(selectedPackId);
                else await renderOverview();
                setStatus(`已解绑 ${gid}`, "ok");
              } else if (act === "batch-refresh") {
                const gid = btn.dataset.gid!;
                const res = await feature.invoke("batch_status", { groupOpenId: gid });
                await renderOverview();
                setStatus(`门闩 ${JSON.stringify(res.status)}`, "ok");
              } else if (act === "batch-ack") {
                const gid = btn.dataset.gid!;
                await feature.invoke("batch_ack", { groupOpenId: gid });
                await renderOverview();
                setStatus(`已 ack ${gid}`, "ok");
              }
            } catch (err) {
              if (!context.signal.aborted) setStatus(String(err), "err");
            }
          })();
        });

        const unsub = feature.on("policy_changed", () => {
          void renderOverview();
        });

        void renderOverview();

        return {
          dispose: () => {
            unsub();
            root.remove();
          },
        };
      },
    });
  },
});
