const HISTORY_KEY = "summariesHistory";
const HISTORY_LIMIT = 24;
const FOCUS_MODE_KEY = "workspaceFocusMode";
const THEME_KEY = "workspaceThemePreset";
const SOURCE_TYPE_KEY = "workspaceSourceType";
const DEFAULT_PROMPT_ID = "jobs-default";

const appEl = document.querySelector(".app");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const qualityCardEl = document.getElementById("qualityCard");
const qualityConfidenceEl = document.getElementById("qualityConfidence");
const qualityMetaEl = document.getElementById("qualityMeta");
const qualityWarningsEl = document.getElementById("qualityWarnings");
const sourceInfoEl = document.getElementById("sourceInfo");
const promptPresetSelectEl = document.getElementById("promptPresetSelect");
const themeModeBtn = document.getElementById("themeModeBtn");
const focusModeBtn = document.getElementById("focusModeBtn");
const summarizeBtn = document.getElementById("summarizeBtn");
const pickSourceBtn = document.getElementById("pickSourceBtn");
const openOptionsBtn = document.getElementById("openOptionsBtn");
const copyMdBtn = document.getElementById("copyMdBtn");
const copyRichBtn = document.getElementById("copyRichBtn");
const copyTextBtn = document.getElementById("copyTextBtn");
const copyStepsBtn = document.getElementById("copyStepsBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const historyListEl = document.getElementById("historyList");
const actionEmptyEl = document.getElementById("actionEmpty");
const actionStepsEl = document.getElementById("actionSteps");

const tabWebBtn = document.getElementById("tabWebBtn");
const tabPasteBtn = document.getElementById("tabPasteBtn");
const tabFileBtn = document.getElementById("tabFileBtn");
const webPanelEl = document.getElementById("webPanel");
const pastePanelEl = document.getElementById("pastePanel");
const filePanelEl = document.getElementById("filePanel");
const pasteInputEl = document.getElementById("pasteInput");
const fileInputEl = document.getElementById("fileInput");
const fileMetaEl = document.getElementById("fileMeta");

const overviewEmptyEl = document.getElementById("overviewEmpty");
const overviewBodyEl = document.getElementById("overviewBody");
const overviewJudgmentEl = document.getElementById("overviewJudgment");
const overviewInsightsEl = document.getElementById("overviewInsights");
const detailToastEl = document.getElementById("detailToast");

const ctxGoalEl = document.getElementById("ctxGoal");
const ctxAudienceEl = document.getElementById("ctxAudience");
const ctxConstraintsEl = document.getElementById("ctxConstraints");
const ctxOutputEl = document.getElementById("ctxOutput");

let sourceTab = null;
let sourceType = "web";
let fileInputState = null;
let currentSummary = "";
let currentMeta = null;
let historyItems = [];
let activeHistoryId = "";
let isFocusMode = true;
let promptPresets = [];
let activePromptId = DEFAULT_PROMPT_ID;
let currentRequestId = "";
let themePreset = "classic";
let detailToastTimer = 0;

void init();

promptPresetSelectEl.addEventListener("change", onPromptPresetChanged);
themeModeBtn.addEventListener("click", cycleThemePreset);
focusModeBtn.addEventListener("click", toggleFocusMode);
summarizeBtn.addEventListener("click", summarizeCurrentInput);
pickSourceBtn.addEventListener("click", resolveSourceFromRecentTabs);
openOptionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
copyMdBtn.addEventListener("click", () => copySummary("markdown"));
copyRichBtn.addEventListener("click", copyRichText);
copyTextBtn.addEventListener("click", copyOverview);
copyStepsBtn.addEventListener("click", copyStepsOnly);
clearHistoryBtn.addEventListener("click", clearHistory);

tabWebBtn.addEventListener("click", () => switchSourceType("web"));
tabPasteBtn.addEventListener("click", () => switchSourceType("paste"));
tabFileBtn.addEventListener("click", () => switchSourceType("file"));
fileInputEl.addEventListener("change", onFilePicked);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "set_source_tab" && message.tabId) {
    void trySetSource(Number(message.tabId));
  }
  if (message?.type === "summarize_progress") {
    onSummarizeProgress(message);
  }
});

async function init() {
  setStatus("初始化中...");

  await Promise.all([
    loadPromptSettings(),
    loadThemePreset(),
    loadFocusMode(),
    loadHistory(),
    loadSourceType()
  ]);

  applySourceType();
  await resolveSourceFromRecentTabs();

  const params = new URLSearchParams(location.search);
  const queryTabId = Number(params.get("tabId"));
  if (Number.isFinite(queryTabId) && queryTabId > 0) {
    await trySetSource(queryTabId);
  }

  if (historyItems.length > 0 && !currentSummary) {
    showHistoryItem(historyItems[0].id);
  }

  if (!currentSummary) {
    resultEl.innerHTML = "";
    renderOverview();
    renderActionBoard();
  }

  setStatus(sourceType === "web" && !sourceTab ? "未找到来源网页" : "准备就绪");
  syncCopyButtons();
}

async function loadSourceType() {
  const data = await chrome.storage.local.get(SOURCE_TYPE_KEY);
  const saved = String(data[SOURCE_TYPE_KEY] || "web");
  sourceType = saved === "paste" || saved === "file" ? saved : "web";
}

async function switchSourceType(nextType) {
  sourceType = nextType === "paste" || nextType === "file" ? nextType : "web";
  applySourceType();
  await chrome.storage.local.set({ [SOURCE_TYPE_KEY]: sourceType });

  if (sourceType === "web") {
    await resolveSourceFromRecentTabs();
    setStatus(sourceTab ? "已切换到网页来源" : "未找到来源网页", sourceTab ? "ok" : "warn");
  } else if (sourceType === "paste") {
    setStatus("已切换到粘贴文本来源", "ok");
  } else {
    setStatus("已切换到文件来源", "ok");
  }
}

function applySourceType() {
  tabWebBtn.classList.toggle("active", sourceType === "web");
  tabPasteBtn.classList.toggle("active", sourceType === "paste");
  tabFileBtn.classList.toggle("active", sourceType === "file");

  webPanelEl.hidden = sourceType !== "web";
  pastePanelEl.hidden = sourceType !== "paste";
  filePanelEl.hidden = sourceType !== "file";
}

async function onFilePicked() {
  const file = fileInputEl.files?.[0];
  if (!file) {
    fileInputState = null;
    fileMetaEl.textContent = "未选择文件";
    return;
  }

  try {
    const content = String((await file.text()) || "").trim();
    fileInputState = {
      name: file.name,
      size: Number(file.size || 0),
      content
    };

    fileMetaEl.textContent = `${file.name} | ${formatBytes(file.size)} | ${formatNumber(content.length)} 字`;
    setStatus("文件已加载", "ok");
  } catch (error) {
    fileInputState = null;
    fileMetaEl.textContent = "文件读取失败";
    setStatus(error?.message || "文件读取失败", "error");
  }
}

async function loadThemePreset() {
  const data = await chrome.storage.local.get(THEME_KEY);
  const saved = String(data[THEME_KEY] || "classic");
  themePreset = saved === "apple" || saved === "night" ? saved : "classic";
  applyThemePreset();
}

async function cycleThemePreset() {
  const order = ["classic", "apple", "night"];
  const idx = order.indexOf(themePreset);
  themePreset = order[(idx + 1) % order.length];
  applyThemePreset();
  await chrome.storage.local.set({ [THEME_KEY]: themePreset });
  setStatus(`主题已切换：${themePresetLabel(themePreset)}`, "ok");
}

function applyThemePreset() {
  const root = document.documentElement;
  if (themePreset === "apple") {
    root.setAttribute("data-palette", "apple");
    root.setAttribute("data-theme", "light");
  } else if (themePreset === "night") {
    root.setAttribute("data-palette", "classic");
    root.setAttribute("data-theme", "dark");
  } else {
    root.setAttribute("data-palette", "classic");
    root.setAttribute("data-theme", "light");
  }
  themeModeBtn.textContent = `主题：${themePresetLabel(themePreset)}`;
}

function themePresetLabel(preset) {
  if (preset === "apple") return "蓝灰";
  if (preset === "night") return "夜间";
  return "经典";
}

async function loadPromptSettings() {
  const data = await chrome.storage.sync.get(["promptPresets", "activePromptId"]);

  promptPresets = mergePromptPresetMetasWithBuiltins(sanitizePromptPresets(data.promptPresets));
  if (promptPresets.length === 0) {
    promptPresets = defaultPromptPresetMetas();
  }

  const stored = typeof data.activePromptId === "string" ? data.activePromptId : DEFAULT_PROMPT_ID;
  activePromptId = promptPresets.some((x) => x.id === stored) ? stored : promptPresets[0].id;

  renderPromptPicker();
}

function sanitizePromptPresets(input) {
  if (!Array.isArray(input)) return [];

  return input
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `preset-${index + 1}`;
      const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : `预设 ${index + 1}`;
      return { id, name };
    });
}

function defaultPromptPresetMetas() {
  return [
    { id: "jobs-default", name: "乔布斯决策模式" },
    { id: "assistant-default", name: "总结助手提取模式" },
    { id: "standard-default", name: "标准模式 原样输出" }
  ];
}

function mergePromptPresetMetasWithBuiltins(source) {
  const merged = Array.isArray(source) ? [...source] : [];
  const seen = new Set(merged.map((item) => item.id));

  for (const builtin of defaultPromptPresetMetas()) {
    if (seen.has(builtin.id)) continue;
    merged.push({ ...builtin });
    seen.add(builtin.id);
  }

  return merged;
}

function renderPromptPicker() {
  promptPresetSelectEl.innerHTML = promptPresets
    .map((preset) => `<option value="${escapeHtmlAttr(preset.id)}">${escapeHtml(preset.name)}</option>`)
    .join("");

  promptPresetSelectEl.value = activePromptId;
}

async function onPromptPresetChanged() {
  activePromptId = promptPresetSelectEl.value;
  await chrome.storage.sync.set({ activePromptId });
  const selected = promptPresets.find((x) => x.id === activePromptId);
  setStatus(`已切换总结方式：${selected?.name || activePromptId}`, "ok");
}

async function loadFocusMode() {
  const data = await chrome.storage.local.get(FOCUS_MODE_KEY);
  isFocusMode = data[FOCUS_MODE_KEY] !== false;
  applyFocusMode();
}

async function toggleFocusMode() {
  isFocusMode = !isFocusMode;
  applyFocusMode();
  await chrome.storage.local.set({ [FOCUS_MODE_KEY]: isFocusMode });
  setStatus(isFocusMode ? "已进入决策视图" : "已退出决策视图", "ok");
}

function applyFocusMode() {
  if (appEl) {
    appEl.classList.toggle("focusMode", isFocusMode);
  }
  focusModeBtn.textContent = isFocusMode ? "决策视图：开" : "决策视图：关";
  rerenderCurrentSummary();
}

async function loadHistory() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  historyItems = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
  renderHistory();
}

async function persistHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: historyItems });
}

async function clearHistory() {
  historyItems = [];
  activeHistoryId = "";
  currentSummary = "";
  currentMeta = null;

  resultEl.innerHTML = "";
  renderOverview();
  renderActionBoard();
  showQualityCard(null);

  await persistHistory();
  renderHistory();
  syncCopyButtons();
  setStatus("历史已清空", "ok");
}

async function resolveSourceFromRecentTabs() {
  try {
    const selfTab = await chrome.tabs.getCurrent();
    const response = await chrome.runtime.sendMessage({
      type: "resolve_source_tab",
      preferredTabId: sourceTab?.id,
      excludeTabId: selfTab?.id
    });

    if (!response?.ok || !response.tab) {
      throw new Error(response?.error || "无法定位来源标签页");
    }

    sourceTab = response.tab;
    renderSource();
  } catch (error) {
    sourceTab = null;
    renderSource();
    if (sourceType === "web") {
      setStatus(error?.message || String(error), "warn");
    }
  }
}

async function trySetSource(tabId) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "resolve_source_tab",
      preferredTabId: tabId
    });

    if (response?.ok && response.tab) {
      sourceTab = response.tab;
      renderSource();
      setStatus("来源已切换", "ok");
    }
  } catch {
    // ignore invalid tab id
  }
}

function renderSource() {
  if (!sourceTab) {
    sourceInfoEl.textContent = "未选择来源网页";
    return;
  }

  sourceInfoEl.textContent = `${sourceTab.title} | ${sourceTab.url}`;
}

async function summarizeCurrentInput() {
  setLoading(true);
  currentRequestId = `req-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  setStatus("正在提取内容...", "warn");
  showQualityCard(null);
  resultEl.innerHTML = "";

  try {
    let response;

    if (sourceType === "web") {
      if (!sourceTab?.id) {
        await resolveSourceFromRecentTabs();
      }
      if (!sourceTab?.id) {
        throw new Error("未找到可用网页来源");
      }

      response = await chrome.runtime.sendMessage({
        type: "summarize_tab",
        tabId: sourceTab.id,
        promptId: activePromptId,
        requestId: currentRequestId
      });
    } else {
      const payload = buildLocalInputPayload();
      response = await chrome.runtime.sendMessage({
        type: "summarize_input",
        sourceType,
        title: payload.title,
        url: payload.url,
        content: payload.content,
        context: payload.context,
        promptId: activePromptId,
        requestId: currentRequestId
      });
    }

    if (!response?.ok) {
      const error = new Error(toUserErrorMessage(response?.code, response?.error));
      error.code = response?.code || "UNKNOWN";
      throw error;
    }

    const summary = String(response.summary || "");
    const meta = response.meta && typeof response.meta === "object" ? response.meta : {};
    const resolvedSourceType = meta.sourceType || sourceType;
    const title = meta.title || (resolvedSourceType === "web" ? sourceTab?.title : "本地输入") || "Untitled";
    const url = meta.url || sourceTab?.url || "";

    currentSummary = summary;
    currentMeta = { ...meta, sourceType: resolvedSourceType };
    activeHistoryId = "";

    rerenderCurrentSummary();
    renderOverview();
    renderActionBoard();
    syncCopyButtons();
    showQualityCard(meta.quality || null);

    const steps = extractActionSteps(summary);
    await addHistoryItem({
      title,
      url,
      markdown: summary,
      steps,
      promptId: meta.promptId || activePromptId,
      promptName: meta.promptName || "",
      sourceType: resolvedSourceType,
      quality: meta.quality || null
    });

    setStatus(`完成：${title}`, "ok");
  } catch (error) {
    setStatus("失败", "error");
    resultEl.innerHTML = `<p>${escapeHtml(error?.message || String(error))}</p>`;
    showQualityCard(null);
    renderOverview();
    syncCopyButtons();
  } finally {
    currentRequestId = "";
    setLoading(false);
  }
}

function buildLocalInputPayload() {
  const context = collectContext();

  if (sourceType === "paste") {
    const content = String(pasteInputEl.value || "").trim();
    if (content.length < 80) {
      throw new Error("粘贴文本过短，建议至少 80 字");
    }

    return {
      title: `粘贴文本 ${formatTime(new Date().toISOString())}`,
      url: "",
      content,
      context
    };
  }

  if (!fileInputState?.content) {
    throw new Error("请先选择文件");
  }
  if (fileInputState.content.length < 80) {
    throw new Error("文件内容过短，建议至少 80 字");
  }

  return {
    title: fileInputState.name || "本地文件",
    url: "",
    content: fileInputState.content,
    context
  };
}

function collectContext() {
  const goal = String(ctxGoalEl.value || "").trim();
  const audience = String(ctxAudienceEl.value || "").trim();
  const constraints = String(ctxConstraintsEl.value || "").trim();
  const outputPreference = String(ctxOutputEl.value || "").trim();

  if (!goal && !audience && !constraints && !outputPreference) {
    return null;
  }

  return { goal, audience, constraints, outputPreference };
}

async function addHistoryItem({ title, url, markdown, steps, promptId, promptName, sourceType: itemSourceType, quality }) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  const item = {
    id,
    title,
    url,
    markdown,
    steps,
    promptId,
    promptName,
    sourceType: itemSourceType || "web",
    quality: quality || null,
    createdAt
  };

  historyItems = [item, ...historyItems].slice(0, HISTORY_LIMIT);
  activeHistoryId = id;

  await persistHistory();
  renderHistory();
}

function showHistoryItem(id) {
  const item = historyItems.find((x) => x.id === id);
  if (!item) return;

  activeHistoryId = item.id;
  currentSummary = String(item.markdown || "");
  currentMeta = {
    sourceType: item.sourceType || "web",
    quality: item.quality || null
  };

  rerenderCurrentSummary();
  renderOverview();
  renderActionBoard();
  showQualityCard(item.quality || null);
  renderHistory();
  syncCopyButtons();
  setStatus(`查看历史：${item.title}`);
}

function renderHistory() {
  if (!historyItems.length) {
    historyListEl.innerHTML = `<div class="historyMeta">暂无摘要历史</div>`;
    return;
  }

  const groups = {
    web: [],
    paste: [],
    file: []
  };

  for (const item of historyItems) {
    const key = item.sourceType === "paste" || item.sourceType === "file" ? item.sourceType : "web";
    groups[key].push(item);
  }

  const labels = {
    web: "网页",
    paste: "粘贴文本",
    file: "文件"
  };

  historyListEl.innerHTML = ["web", "paste", "file"]
    .filter((key) => groups[key].length > 0)
    .map((key) => {
      const itemsHtml = groups[key].map(renderHistoryRow).join("");
      return `
        <section class="historyGroup">
          <div class="historyGroupTitle">${labels[key]}</div>
          ${itemsHtml}
        </section>
      `;
    })
    .join("");

  const buttons = historyListEl.querySelectorAll(".historyItem");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => showHistoryItem(String(btn.dataset.id || "")));
  });
}

function renderHistoryRow(item) {
  const activeCls = item.id === activeHistoryId ? "active" : "";
  const title = escapeHtml(item.title || "Untitled");
  const prompt = item.promptName ? ` | ${item.promptName}` : "";
  const url = item.url ? ` | ${truncate(item.url, 36)}` : "";
  const meta = escapeHtml(`${formatTime(item.createdAt)}${prompt}${url}`);

  return `
    <button class="historyItem ${activeCls}" data-id="${escapeHtmlAttr(item.id)}" type="button">
      <div class="historyTitle">${title}</div>
      <div class="historyMeta">${meta}</div>
    </button>
  `;
}

function setLoading(loading) {
  summarizeBtn.disabled = loading;
  pickSourceBtn.disabled = loading;
  themeModeBtn.disabled = loading;
  focusModeBtn.disabled = loading;
  promptPresetSelectEl.disabled = loading;
  tabWebBtn.disabled = loading;
  tabPasteBtn.disabled = loading;
  tabFileBtn.disabled = loading;
  pasteInputEl.disabled = loading;
  fileInputEl.disabled = loading;

  summarizeBtn.textContent = loading ? "生成中..." : "生成结论";
}

function setStatus(text, level = "") {
  statusEl.textContent = text;
  statusEl.className = level ? `status ${level}` : "status";
}

function onSummarizeProgress(message) {
  if (!message?.requestId || message.requestId !== currentRequestId) {
    return;
  }

  if (message.stage === "extracting") {
    setStatus("正在提取内容...", "warn");
    return;
  }
  if (message.stage === "requesting") {
    setStatus("正在请求模型...", "warn");
    return;
  }
  if (message.stage === "normalizing") {
    setStatus("正在整理结果...", "warn");
  }
}

async function copySummary(mode) {
  if (!currentSummary.trim()) {
    showCopyToast("没有可复制的内容", true);
    return;
  }

  const text = mode === "text" ? stripMarkdown(currentSummary) : enrichMarkdownForExport(currentSummary);

  try {
    await navigator.clipboard.writeText(text);
    showCopyToast(mode === "text" ? "已复制纯文本" : "已复制 Markdown");
  } catch {
    showCopyToast("复制失败，请检查浏览器权限", true);
  }
}

function enrichMarkdownForExport(markdown) {
  return String(markdown || "")
    .replace(/^\s*-\s*判断[:：]\s*(.+)$/gm, "- **判断：** $1")
    .replace(/^\s*-\s*砍掉[:：]\s*(.+)$/gm, "- **砍掉：** $1");
}

async function copyRichText() {
  if (!currentSummary.trim()) {
    showCopyToast("没有可复制的内容", true);
    return;
  }

  const markdown = enrichMarkdownForExport(currentSummary);
  const html = renderMarkdown(markdown);
  const plain = stripMarkdown(markdown);

  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" })
      });
      await navigator.clipboard.write([item]);
      showCopyToast("已复制富文本");
      return;
    }

    await navigator.clipboard.writeText(plain);
    showCopyToast("当前环境不支持富文本，已复制纯文本");
  } catch {
    showCopyToast("复制失败，请检查浏览器权限", true);
  }
}

async function copyOverview() {
  const overview = parseOverview(currentSummary);
  const lines = [];

  if (overview.judgment) {
    lines.push(`一句话判断：${overview.judgment}`);
  }

  if (overview.insights.length > 0) {
    lines.push("三条关键洞察：");
    overview.insights.slice(0, 3).forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
  }

  if (lines.length === 0) {
    showCopyToast("暂无可复制概览", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    showCopyToast("已复制概览");
  } catch {
    showCopyToast("复制失败，请检查浏览器权限", true);
  }
}

async function copyStepsOnly() {
  const steps = getCurrentSteps();
  if (steps.length === 0) {
    showCopyToast("没有可复制的步骤", true);
    return;
  }

  const text = steps.map((step, index) => `${index + 1}. ${step.text}`).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    showCopyToast("已复制步骤");
  } catch {
    showCopyToast("复制失败，请检查浏览器权限", true);
  }
}

function showCopyToast(text, isError = false) {
  if (!detailToastEl) {
    setStatus(text, isError ? "error" : "ok");
    return;
  }

  if (detailToastTimer) {
    clearTimeout(detailToastTimer);
    detailToastTimer = 0;
  }

  detailToastEl.textContent = text;
  detailToastEl.classList.add("show");
  detailToastEl.classList.toggle("error", isError);

  detailToastTimer = window.setTimeout(() => {
    detailToastEl.classList.remove("show", "error");
    detailToastEl.textContent = "";
  }, 1800);
}

function syncCopyButtons() {
  const hasSummary = currentSummary.trim().length > 0;
  const hasSteps = getCurrentSteps().length > 0;

  copyMdBtn.disabled = !hasSummary;
  copyRichBtn.disabled = !hasSummary;
  copyTextBtn.disabled = !hasSummary;
  copyStepsBtn.disabled = !hasSteps;
}

function showQualityCard(quality) {
  if (!quality || !qualityCardEl) {
    qualityCardEl.hidden = true;
    return;
  }

  qualityCardEl.hidden = false;

  qualityConfidenceEl.textContent = buildConfidenceLabel(quality);

  if (Number.isFinite(Number(quality.fileBytes)) && Number(quality.fileBytes) > 0) {
    qualityMetaEl.textContent = [
      `文件大小 ${formatBytes(Number(quality.fileBytes))}`,
      `提取文本 ${formatNumber(quality.contentLength)} 字符`,
      `估算页数 ${formatNumber(quality.rawChunks || 0)}`
    ].join(" | ");
  } else {
    qualityMetaEl.textContent = [
      `正文长度 ${formatNumber(quality.contentLength)}`,
      `有效段落 ${formatNumber(quality.uniqueChunks)}/${formatNumber(quality.rawChunks)}`,
      `重复率 ${Math.round(Number(quality.duplicateRatio || 0) * 100)}%`
    ].join(" | ");
  }

  if (Array.isArray(quality.warnings) && quality.warnings.length > 0) {
    qualityWarningsEl.textContent = `提醒：${quality.warnings.join("；")}`;
  } else {
    qualityWarningsEl.textContent = "提醒：当前结果可直接进入执行。";
  }
}

function buildConfidenceLabel(quality) {
  const warnings = Array.isArray(quality.warnings) ? quality.warnings : [];
  const duplicateRatio = Number(quality.duplicateRatio || 0);
  const contentLength = Number(quality.contentLength || 0);

  if (warnings.length === 0 && contentLength >= 1200 && duplicateRatio <= 0.25) {
    return "可信度：高（正文充分，结构完整）";
  }
  if (warnings.length >= 2 || contentLength < 800 || duplicateRatio > 0.45) {
    return "可信度：低（信息不足，建议人工复核）";
  }
  return "可信度：中（可用，建议结合原文判断）";
}

function renderOverview() {
  if (!currentSummary.trim()) {
    overviewBodyEl.hidden = true;
    overviewEmptyEl.hidden = false;
    overviewJudgmentEl.textContent = "";
    overviewInsightsEl.innerHTML = "";
    return;
  }

  const overview = parseOverview(currentSummary);

  if (!overview.judgment && overview.insights.length === 0) {
    overviewBodyEl.hidden = true;
    overviewEmptyEl.hidden = false;
    return;
  }

  overviewBodyEl.hidden = false;
  overviewEmptyEl.hidden = true;
  overviewJudgmentEl.innerHTML = overview.judgment ? renderOverviewInline(`一句话判断：${overview.judgment}`) : "";
  overviewInsightsEl.innerHTML = overview.insights
    .slice(0, 3)
    .map((line) => `<li>${renderOverviewInline(line)}</li>`)
    .join("");
}

function parseOverview(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const focus = parseFocusSummary(markdown);
  let judgment = focus.judgment;
  const insights = [];
  let inInsightSection = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (!judgment && /^-?\s*(Amazing|Shit)\b/i.test(line)) {
      judgment = line.replace(/^-+\s*/, "").trim();
    }

    if (!judgment) {
      const matchJudgment = line.match(/^-?\s*判断[:：]\s*(.+)$/);
      if (matchJudgment) {
        judgment = matchJudgment[1].trim();
      }
    }

    if (/^##\s*2\)/.test(line) || /^##\s*三条关键洞察/.test(line)) {
      inInsightSection = true;
      continue;
    }
    if (/^##\s*[3-9]\)/.test(line)) {
      inInsightSection = false;
    }

    const structured = line.match(/^[-*]\s*判断[:：]\s*(.+)$/);
    if (structured && insights.length < 3) {
      insights.push(structured[1].trim());
      continue;
    }

    if (inInsightSection) {
      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (bullet && insights.length < 3) {
        insights.push(bullet[1].trim());
      }
    }
  }

  if (insights.length === 0) {
    for (const raw of lines) {
      const line = raw.trim();
      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (!bullet) continue;
      const text = bullet[1].trim();
      if (/^(解释|步骤|目标|预期)[:：]/.test(text)) continue;
      insights.push(text);
      if (insights.length >= 3) break;
    }
  }

  return {
    judgment: judgment || "",
    insights
  };
}

function rerenderCurrentSummary() {
  if (!currentSummary.trim()) {
    resultEl.innerHTML = "";
    return;
  }

  if (!isFocusMode) {
    resultEl.innerHTML = renderMarkdown(currentSummary);
    return;
  }

  const parsed = parseFocusSummary(currentSummary);
  const hasFocusView = isJobsFocusSummary(currentSummary, parsed);

  resultEl.innerHTML = hasFocusView ? renderFocusSummary(parsed) : renderMarkdown(currentSummary);
}

function renderFocusSummary(parsed) {
  if (!parsed.judgment && !parsed.cut) {
    return `<p>${escapeHtml("当前内容不包含可识别的决策结构，请切换普通视图查看全文。")}</p>`;
  }

  const blocks = [];
  if (parsed.judgment) {
    blocks.push(`<p><strong>一句话判断：</strong>${escapeHtml(parsed.judgment)}</p>`);
  }
  if (parsed.cut) {
    blocks.push(`<p><strong>该砍掉：</strong>${escapeHtml(parsed.cut)}</p>`);
  }

  return blocks.join("");
}

function parseFocusSummary(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let judgment = "";
  const cuts = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (!judgment) {
      if (/^-?\s*(Amazing|Shit)\b/i.test(line)) {
        judgment = line.replace(/^-+\s*/, "").trim();
      } else {
        const matchJudgment = line.match(/^-?\s*判断[:：]\s*(.+)$/);
        if (matchJudgment) {
          judgment = matchJudgment[1].trim();
        }
      }
    }

    const matchCut = line.match(/^-?\s*砍掉[:：]\s*(.+)$/);
    if (matchCut) {
      cuts.push(matchCut[1].trim());
    }
  }

  return {
    judgment,
    cut: cuts.join("；")
  };
}

function isJobsFocusSummary(markdown, parsedInput) {
  const text = String(markdown || "");
  const parsed = parsedInput || parseFocusSummary(text);
  const hasHeading = /##\s*1\)\s*一句话判断/.test(text) || /##\s*3\)\s*该砍掉的部分/.test(text);
  return hasHeading && Boolean(parsed.judgment || parsed.cut);
}

function renderMarkdown(markdown) {
  const safe = escapeHtml(String(markdown || "").replace(/\r\n/g, "\n"));
  const lines = safe.split("\n");

  let html = "";
  let inUl = false;
  let inOl = false;
  let inCode = false;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      if (!inCode) {
        closeLists();
        html += "<pre><code>";
        inCode = true;
      } else {
        html += "</code></pre>";
        inCode = false;
      }
      continue;
    }

    if (inCode) {
      html += `${line}\n`;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      html += `<h${level}>${inlineFormat(heading[2].trim())}</h${level}>`;
      continue;
    }

    if (isTableHeaderLine(line) && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      closeLists();

      const tableLines = [line, lines[i + 1].trimEnd()];
      i += 2;
      while (i < lines.length) {
        const candidate = lines[i].trimEnd();
        if (!isTableRowLine(candidate)) {
          break;
        }
        tableLines.push(candidate);
        i += 1;
      }
      i -= 1;

      html += renderMarkdownTable(tableLines);
      continue;
    }

    const ol = line.match(/^(\s*)(\d+)[\.|\)]\s+(.*)$/);
    if (ol) {
      if (!inOl) {
        closeUl();
        html += "<ol>";
        inOl = true;
      }
      const number = Number(ol[2]);
      const valueAttr = Number.isFinite(number) ? ` value="${number}"` : "";
      html += `<li${valueAttr}${listIndentStyle(ol[1])}>${inlineFormat(ol[3])}</li>`;
      continue;
    }

    const ul = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (ul) {
      if (!inUl) {
        closeOl();
        html += "<ul>";
        inUl = true;
      }
      html += `<li${listIndentStyle(ul[1])}>${inlineFormat(ul[2])}</li>`;
      continue;
    }

    if (line.startsWith(">")) {
      closeLists();
      html += `<blockquote>${inlineFormat(line.slice(1).trim())}</blockquote>`;
      continue;
    }

    const legacyDetail = line.match(/^(\s*)--\s+(.+)$/);
    if (legacyDetail) {
      closeLists();
      html += `<p class="detailLine"${indentStyle(legacyDetail[1])}>${inlineFormat(`解释：${legacyDetail[2]}`)}</p>`;
      continue;
    }

    const detailLine = line.match(/^(\s*)解释[:：]\s*(.*)$/);
    if (detailLine) {
      closeLists();
      html += `<p class="detailLine"${indentStyle(detailLine[1])}>${inlineFormat(`解释：${detailLine[2]}`)}</p>`;
      continue;
    }

    if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) {
      closeLists();
      html += "<hr />";
      continue;
    }

    if (line.trim() === "") {
      closeLists();
      continue;
    }

    closeLists();
    html += `<p>${inlineFormat(line)}</p>`;
  }

  closeLists();
  if (inCode) {
    html += "</code></pre>";
  }

  return html;

  function closeUl() {
    if (inUl) {
      html += "</ul>";
      inUl = false;
    }
  }

  function closeOl() {
    if (inOl) {
      html += "</ol>";
      inOl = false;
    }
  }

  function closeLists() {
    closeUl();
    closeOl();
  }
}

function listIndentStyle(leadingWhitespace) {
  const level = Math.floor(indentSize(leadingWhitespace) / 2);
  if (level <= 0) return "";
  return ` style="margin-left:${level * 16}px"`;
}

function indentStyle(leadingWhitespace) {
  const level = Math.floor(indentSize(leadingWhitespace) / 2);
  if (level <= 0) return "";
  return ` style="margin-left:${level * 16}px"`;
}

function indentSize(leadingWhitespace) {
  return String(leadingWhitespace || "").replace(/\t/g, "    ").length;
}

function isTableHeaderLine(line) {
  const trimmed = line.trim();
  return trimmed.includes("|") && !trimmed.startsWith(">");
}

function isTableSeparatorLine(line) {
  const cells = splitTableCells(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function isTableRowLine(line) {
  const trimmed = line.trim();
  return Boolean(trimmed) && trimmed.includes("|");
}

function splitTableCells(line) {
  let text = String(line || "").trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  if (!text) return [];
  return text.split("|").map((cell) => cell.trim());
}

function parseTableAlignments(separatorLine, columnCount) {
  const cells = splitTableCells(separatorLine);
  const alignments = [];

  for (let i = 0; i < columnCount; i += 1) {
    const marker = cells[i] || "";
    const left = marker.startsWith(":");
    const right = marker.endsWith(":");

    if (left && right) {
      alignments.push("center");
    } else if (right) {
      alignments.push("right");
    } else {
      alignments.push("left");
    }
  }

  return alignments;
}

function renderMarkdownTable(tableLines) {
  if (!Array.isArray(tableLines) || tableLines.length < 2) return "";

  const headerCells = splitTableCells(tableLines[0]);
  if (headerCells.length === 0) return "";

  const alignments = parseTableAlignments(tableLines[1], headerCells.length);
  const bodyRows = tableLines
    .slice(2)
    .map((line) => splitTableCells(line))
    .filter((cells) => cells.length > 0);

  const headHtml = headerCells
    .map((cell, index) => `<th style="text-align:${alignments[index]};">${inlineFormat(cell)}</th>`)
    .join("");

  const bodyHtml = bodyRows
    .map((cells) => {
      const columns = [];
      for (let i = 0; i < headerCells.length; i += 1) {
        columns.push(`<td style="text-align:${alignments[i]};">${inlineFormat(cells[i] || "")}</td>`);
      }
      return `<tr>${columns.join("")}</tr>`;
    })
    .join("");

  return `<div class="mdTableWrap"><table><thead><tr>${headHtml}</tr></thead>${bodyHtml ? `<tbody>${bodyHtml}</tbody>` : ""}</table></div>`;
}

function inlineFormat(text) {
  const formatted = String(text || "")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  if (/^判断[:：]/.test(formatted)) {
    return formatted.replace(/^判断[:：]/, "<strong>判断：</strong>");
  }
  if (/^砍掉[:：]/.test(formatted)) {
    return formatted.replace(/^砍掉[:：]/, "<strong>砍掉：</strong>");
  }

  return formatted;
}

function renderOverviewInline(text) {
  return inlineFormat(escapeHtml(String(text || "")));
}

function extractActionSteps(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const steps = [];
  let inStepSection = false;
  let captureList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^##\s*4\)/.test(line)) {
      inStepSection = true;
      captureList = false;
      continue;
    }

    if (/^##\s*[1-3]\)/.test(line) || /^##\s*[5-9]\)/.test(line)) {
      if (inStepSection) break;
    }

    if (!inStepSection) continue;

    if (/^-\s*步骤[:：]\s*$/.test(line)) {
      captureList = true;
      continue;
    }

    const inlineStep = line.match(/^-?\s*步骤[:：]\s*(.+)$/);
    if (inlineStep) {
      const chunks = inlineStep[1].split(/\s*[；;]\s*/).map((x) => x.trim()).filter(Boolean);
      for (const chunk of chunks) {
        steps.push({ text: chunk, done: false });
      }
      captureList = false;
      continue;
    }

    if (captureList) {
      const numbered = line.match(/^\d+\.\s+(.+)$/);
      if (numbered) {
        steps.push({ text: numbered[1].trim(), done: false });
        continue;
      }

      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        steps.push({ text: bullet[1].trim(), done: false });
        continue;
      }

      if (!line || /^-\s*(目标|预期)[:：]/.test(line)) {
        captureList = false;
      }
    }
  }

  return steps;
}

function getCurrentSteps() {
  if (!activeHistoryId) {
    return extractActionSteps(currentSummary);
  }

  const active = historyItems.find((item) => item.id === activeHistoryId);
  if (!active) {
    return extractActionSteps(currentSummary);
  }

  if (Array.isArray(active.steps)) {
    return active.steps;
  }

  const parsed = extractActionSteps(active.markdown || "");
  active.steps = parsed;
  return parsed;
}

function renderActionBoard() {
  const steps = getCurrentSteps();
  actionStepsEl.innerHTML = "";

  if (steps.length === 0) {
    actionEmptyEl.style.display = "block";
    syncCopyButtons();
    return;
  }

  actionEmptyEl.style.display = "none";

  steps.forEach((step) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(step.done);

    const text = document.createElement("span");
    text.textContent = step.text;
    if (step.done) {
      text.className = "done";
    }

    checkbox.addEventListener("change", async () => {
      step.done = checkbox.checked;
      text.className = step.done ? "done" : "";
      await persistStepState();
    });

    label.appendChild(checkbox);
    label.appendChild(text);
    li.appendChild(label);
    actionStepsEl.appendChild(li);
  });

  syncCopyButtons();
}

async function persistStepState() {
  if (!activeHistoryId) return;

  const active = historyItems.find((item) => item.id === activeHistoryId);
  if (!active) return;

  await persistHistory();
}

function stripMarkdown(markdown) {
  return String(markdown || "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^--\s?/gm, "")
    .replace(/^解释[:：]\s?/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function formatTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function truncate(text, maxLength) {
  const src = String(text || "");
  if (src.length <= maxLength) return src;
  return `${src.slice(0, maxLength - 1)}…`;
}

function formatNumber(num) {
  const n = Number(num);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("zh-CN");
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function toUserErrorMessage(code, fallback) {
  if (code === "NO_TAB") return "未找到可总结的标签页，请先打开一个网页。";
  if (code === "PDF_DISABLED") return "PDF 总结功能已关闭，请使用普通网页总结。";
  if (code === "PAGE_ACCESS_DENIED") return "页面内容读取失败，可能是浏览器限制或页面结构异常。";
  if (code === "FILE_ACCESS_DENIED") return "无法访问本地 PDF。请在扩展详情开启“允许访问文件网址”。";
  if (code === "CONTENT_TOO_SHORT") return "内容过短，建议提供更完整正文。";
  if (code === "PDF_DOWNLOAD_FAILED") return "PDF 下载失败，请检查链接是否可访问。";
  if (code === "PDF_TOO_LARGE") return "PDF 文件过大，当前版本暂不支持。";
  if (code === "PDF_EMPTY") return "PDF 内容为空或已损坏。";
  if (code === "PDF_TEXT_TOO_SHORT") return "PDF 可提取文本过短，可能是扫描件或受保护文档。";
  if (code === "API_KEY_MISSING") return "缺少 API Key，请先到设置页填写。";
  if (code === "NETWORK_ERROR") return "网络请求失败，请检查网络或 Endpoint。";
  if (code === "API_AUTH_FAILED") return "API 鉴权失败，请检查 Key 与 Endpoint 是否匹配。";
  if (code === "API_RATE_LIMIT") return "请求过于频繁，请稍后重试。";
  if (code === "API_REQUEST_FAILED") return "API 请求失败，请检查模型名、Endpoint 或服务状态。";
  if (code === "EMPTY_RESPONSE") return "模型返回为空，建议重试或切换模型。";
  return fallback || "发生未知错误，请重试。";
}

function escapeHtml(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttr(input) {
  return escapeHtml(input).replace(/`/g, "&#96;");
}
