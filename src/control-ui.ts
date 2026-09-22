/**
 * Control UI：QQ 群策略包可视化管理页。
 * 联动：createFeatureClient → overview/get_pack/write_pack/bind_group/batch_*；
 * 仅在 Labs → Custom plugin UI 开启后加载。
 */

import { defineControlUiPlugin } from "openclaw/plugin-sdk/control-ui";
import { createFeatureClient } from "openclaw/plugin-sdk/feature-contract";
import { contract } from "./contract.js";
import "./control-ui.css";

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
              <p class="qgl-sub">多群绑定 · 热重载 YAML · 批决策门闩（仅 QQ 扩展）</p>
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
              <div data-role="bindings"></div>
              <h2>策略包</h2>
              <div data-role="packs" class="qgl-pack-list"></div>
              <h2>批决策门闩</h2>
              <div data-role="batches"></div>
            </aside>
            <main class="qgl-panel qgl-editor">
              <div class="qgl-editor-head">
                <h2 data-role="editor-title">选择左侧策略包</h2>
                <div class="qgl-actions">
                  <button type="button" class="qgl-btn" data-act="save" disabled>保存 pack.yaml</button>
                </div>
              </div>
              <p class="qgl-hint" data-role="pack-meta"></p>
              <textarea data-role="yaml" spellcheck="false" aria-label="pack.yaml" disabled
                placeholder="选择策略包后在此编辑 pack.yaml"></textarea>
              <p class="qgl-status" data-role="status" aria-live="polite"></p>
              <div class="qgl-bind-form">
                <h3>绑定群到当前包</h3>
                <div class="qgl-row">
                  <input data-role="bind-group" placeholder="群 OpenID（大写）" aria-label="群 OpenID" />
                  <button type="button" class="qgl-btn" data-act="bind" disabled>绑定</button>
                </div>
              </div>
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
          yaml: root.querySelector('[data-role="yaml"]') as HTMLTextAreaElement,
          status: root.querySelector('[data-role="status"]') as HTMLElement,
          bindGroup: root.querySelector('[data-role="bind-group"]') as HTMLInputElement,
          saveBtn: root.querySelector('[data-act="save"]') as HTMLButtonElement,
          bindBtn: root.querySelector('[data-act="bind"]') as HTMLButtonElement,
        };

        let selectedPackId: string | null = null;
        let busy = false;

        const setStatus = (text: string, kind: "ok" | "err" | "" = "") => {
          el.status.textContent = text;
          el.status.dataset.kind = kind;
        };

        const setBusy = (v: boolean) => {
          busy = v;
          root.classList.toggle("qgl-busy", v);
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
                const row = document.createElement("button");
                row.type = "button";
                row.className = "qgl-item";
                row.innerHTML = `<strong>${escapeHtml(gid)}</strong><span>→ ${escapeHtml(packId)}</span>`;
                row.onclick = () => void selectPack(packId);
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
            const pack = await feature.invoke("get_pack", { packId });
            if (context.signal.aborted) return;
            el.editorTitle.textContent = pack.packId;
            el.packMeta.textContent = `v${pack.version} · ${pack.keywordCount} 关键词 · ${pack.description || "无描述"}`;
            el.yaml.value = pack.yamlText;
            el.yaml.disabled = false;
            el.saveBtn.disabled = false;
            el.bindBtn.disabled = false;
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
                setStatus("已刷新", "ok");
              } else if (act === "reload-all") {
                await feature.invoke("reload", {});
                await renderOverview();
                setStatus("缓存已重载", "ok");
              } else if (act === "save") {
                if (!selectedPackId) return;
                await feature.invoke("write_pack", {
                  packId: selectedPackId,
                  yamlText: el.yaml.value,
                });
                await selectPack(selectedPackId);
                setStatus("已保存并热重载", "ok");
              } else if (act === "bind") {
                if (!selectedPackId) return;
                const groupOpenId = el.bindGroup.value.trim().toUpperCase();
                if (!groupOpenId) {
                  setStatus("请填写群 OpenID", "err");
                  return;
                }
                await feature.invoke("bind_group", {
                  groupOpenId,
                  packId: selectedPackId,
                });
                el.bindGroup.value = "";
                await renderOverview();
                setStatus(`已绑定 ${groupOpenId} → ${selectedPackId}`, "ok");
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
