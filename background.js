const DEFAULT_SETTINGS = {
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4.1-mini",
  temperature: 0.2,
  maxTokens: 600,
  apiKey: "",
  activeApiPresetId: "api-default",
  apiPresets: defaultApiPresets(),
  promptPresets: defaultPromptPresets(),
  activePromptId: "jobs-default"
};

const WORKSPACE_PAGE = "workspace.html";
const PDF_MAX_BYTES = 20 * 1024 * 1024;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const patch = {};

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (current[key] === undefined) {
      patch[key] = value;
    }
  }

  if (Object.keys(patch).length > 0) {
    await chrome.storage.sync.set(patch);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  await openOrFocusWorkspace(tab?.id);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "summarize_tab") {
    summarizeTab(message.tabId, message.promptId, message.requestId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, ...toErrorPayload(error) }));
    return true;
  }

  if (message?.type === "summarize_input") {
    summarizeInput({
      sourceType: message.sourceType,
      title: message.title,
      url: message.url,
      content: message.content,
      promptId: message.promptId,
      requestId: message.requestId,
      context: message.context
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, ...toErrorPayload(error) }));
    return true;
  }

  if (message?.type === "resolve_source_tab") {
    resolveSourceTab(message.preferredTabId, message.excludeTabId)
      .then((tab) => sendResponse({ ok: true, tab }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Unknown error" }));
    return true;
  }

  if (message?.type === "open_workspace") {
    openOrFocusWorkspace(message.sourceTabId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Unknown error" }));
    return true;
  }

  return false;
});

async function openOrFocusWorkspace(sourceTabId) {
  const workspaceUrl = chrome.runtime.getURL(WORKSPACE_PAGE);
  const existing = await chrome.tabs.query({ url: `${workspaceUrl}*` });

  if (existing.length > 0) {
    const workspaceTab = existing[0];

    await chrome.tabs.update(workspaceTab.id, { active: true });
    await chrome.windows.update(workspaceTab.windowId, { focused: true });

    if (sourceTabId) {
      await safeSendMessage(workspaceTab.id, { type: "set_source_tab", tabId: sourceTabId });
    }

    return { workspaceTabId: workspaceTab.id };
  }

  const url = sourceTabId ? `${workspaceUrl}?tabId=${sourceTabId}` : workspaceUrl;
  const created = await chrome.tabs.create({ url });

  return { workspaceTabId: created.id };
}

async function resolveSourceTab(preferredTabId, excludeTabId) {
  const excludeSet = new Set([excludeTabId].filter(Boolean));

  const preferred = await getTabSafe(preferredTabId);
  if (isSummarizableTab(preferred, excludeSet)) {
    return tabMeta(preferred);
  }

  const active = await getActiveTab();
  if (isSummarizableTab(active, excludeSet)) {
    return tabMeta(active);
  }

  const allTabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const candidate = allTabs
    .filter((tab) => isSummarizableTab(tab, excludeSet))
    .sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0];

  if (!candidate) {
    throw new Error("找不到可总结的网页标签页，请先打开一个 http/https 网页。");
  }

  return tabMeta(candidate);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function isSummarizableTab(tab, excludeSet) {
  if (!tab?.id) return false;
  if (excludeSet.has(tab.id)) return false;

  const sourceUrl = extractSourceUrlFromTab(tab);
  if (!sourceUrl) return false;
  if (!/^https?:\/\//i.test(sourceUrl)) return false;
  return !isPdfUrl(sourceUrl);
}

function tabMeta(tab) {
  const sourceUrl = extractSourceUrlFromTab(tab);
  return {
    id: tab.id,
    title: tab.title || "",
    url: sourceUrl || tab.url || tab.pendingUrl || ""
  };
}

async function getTabSafe(tabId) {
  if (!tabId) return undefined;

  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

async function safeSendMessage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return;
  } catch {
    // Ignore: extension page might not be ready for tab messaging yet.
  }

  try {
    await chrome.runtime.sendMessage({ ...message, targetTabId: tabId, relayToWorkspace: true });
  } catch {
    // Ignore fallback failure.
  }
}

async function summarizeTab(tabId, preferredPromptId, requestId) {
  if (!tabId) {
    throw appError("NO_TAB", "未找到可总结的标签页。");
  }

  const tab = await getTabSafe(tabId);
  if (!tab) {
    throw appError("NO_TAB", "未找到可总结的标签页。");
  }

  const sourceUrl = extractSourceUrlFromTab(tab);
  if (!sourceUrl) {
    throw appError("NO_TAB", "当前页面不是可总结的网页或 PDF。");
  }
  if (isPdfUrl(sourceUrl)) {
    throw appError("PDF_DISABLED", "PDF 总结已关闭，请使用普通网页总结。");
  }

  emitProgress(requestId, "extracting");

  let result;
  try {
    const execution = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPagePayload
    });
    result = execution[0]?.result;
  } catch (error) {
    throw appError("PAGE_ACCESS_DENIED", `无法读取该页面内容：${error.message || error}`);
  }

  const payload = result || {};
  const content = payload.content || "";
  const quality = analyzePayloadQuality(payload);

  if (content.trim().length < 200) {
    throw appError("CONTENT_TOO_SHORT", "页面正文过短，无法稳定总结。请切换到正文更完整的页面。");
  }

  const settings = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  if (!settings.apiKey) {
    throw appError("API_KEY_MISSING", "缺少 API Key，请先在设置页填写。");
  }

  emitProgress(requestId, "requesting");
  const summaryResult = await requestSummary({ settings, payload, preferredPromptId });
  emitProgress(requestId, "normalizing");

  return {
    summary: summaryResult.summary,
    meta: {
      title: payload.title || "",
      url: payload.url || "",
      length: content.length,
      quality,
      promptId: summaryResult.promptId,
      promptName: summaryResult.promptName
    }
  };
}

async function requestSummary({ settings, payload, preferredPromptId }) {
  const resolvedPrompt = resolvePromptPreset(settings, preferredPromptId);
  const systemPrompt = resolvedPrompt.systemPrompt;
  const sourceType = payload.sourceType || "web";
  const sourceLabel = payload.sourceLabel || (sourceType === "web" ? "网页" : sourceType === "paste" ? "粘贴文本" : "本地文件");

  const contextLines = [];
  const context = payload.context && typeof payload.context === "object" ? payload.context : null;
  if (context) {
    if (context.goal) contextLines.push(`目标: ${context.goal}`);
    if (context.audience) contextLines.push(`受众: ${context.audience}`);
    if (context.constraints) contextLines.push(`约束: ${context.constraints}`);
    if (context.outputPreference) contextLines.push(`输出偏好: ${context.outputPreference}`);
  }

  const userPrompt = [
    `输入来源: ${sourceLabel}`,
    `内容标题: ${payload.title || "(none)"}`,
    `内容URL: ${payload.url || "(none)"}`,
    contextLines.length > 0 ? `补充上下文:\n${contextLines.join("\n")}` : "",
    "内容正文:",
    payload.content
  ].filter(Boolean).join("\n\n");

  const requestBody = {
    model: settings.model || DEFAULT_SETTINGS.model,
    temperature: Number(settings.temperature ?? DEFAULT_SETTINGS.temperature),
    max_tokens: Number(settings.maxTokens ?? DEFAULT_SETTINGS.maxTokens),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  const endpoint = normalizeEndpoint(settings.endpoint || DEFAULT_SETTINGS.endpoint);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    throw appError("NETWORK_ERROR", `网络请求失败：${error.message || error}`);
  }

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw appError("API_AUTH_FAILED", `API 鉴权失败 (${response.status})：${truncate(errText, 220)}`);
    }
    if (response.status === 429) {
      throw appError("API_RATE_LIMIT", `API 触发限流 (${response.status})：${truncate(errText, 220)}`);
    }
    throw appError("API_REQUEST_FAILED", `API 请求失败 (${response.status})：${truncate(errText, 220)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw appError("EMPTY_RESPONSE", "模型返回为空，请重试或切换模型。");
  }

  const summary = resolvedPrompt.postprocess === "jobs" ? normalizeSummaryOutput(content) : content;

  return {
    summary,
    promptId: resolvedPrompt.id,
    promptName: resolvedPrompt.name
  };
}

async function summarizeInput({ sourceType, title, url, content, promptId, requestId, context }) {
  const text = String(content || "").trim();
  if (text.length < 80) {
    throw appError("CONTENT_TOO_SHORT", "输入内容过短，建议提供更完整正文后重试。");
  }

  emitProgress(requestId, "extracting");
  const rawChunks = text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const uniqueChunks = [...new Set(rawChunks)];

  const payload = {
    sourceType: sourceType || "paste",
    sourceLabel: sourceType === "file" ? "本地文件" : sourceType === "web" ? "网页" : "粘贴文本",
    title: String(title || "").trim() || "未命名内容",
    url: String(url || "").trim(),
    content: text.slice(0, 22000),
    context: context && typeof context === "object" ? context : null,
    rawChunkCount: rawChunks.length || 1,
    uniqueChunkCount: uniqueChunks.length || 1
  };

  const quality = analyzePayloadQuality(payload);
  const settings = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  if (!settings.apiKey) {
    throw appError("API_KEY_MISSING", "缺少 API Key，请先在设置页填写。");
  }

  emitProgress(requestId, "requesting");
  const summaryResult = await requestSummary({ settings, payload, preferredPromptId: promptId });
  emitProgress(requestId, "normalizing");

  return {
    summary: summaryResult.summary,
    meta: {
      title: payload.title,
      url: payload.url,
      sourceType: payload.sourceType,
      length: payload.content.length,
      quality,
      promptId: summaryResult.promptId,
      promptName: summaryResult.promptName
    }
  };
}

async function summarizePdfTab({ tab, sourceUrl, preferredPromptId, requestId }) {
  emitProgress(requestId, "extracting");

  const settings = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  if (!settings.apiKey) {
    throw appError("API_KEY_MISSING", "缺少 API Key，请先在设置页填写。");
  }

  const bytes = await fetchPdfBytes(sourceUrl);
  const extracted = await extractPdfTextFromBytes(bytes);
  if (extracted.text.trim().length < 40) {
    throw appError("PDF_TEXT_TOO_SHORT", "PDF 可提取文本过短，可能是扫描件或受保护文档。");
  }

  emitProgress(requestId, "requesting");
  const summaryResult = await requestSummary({
    settings,
    preferredPromptId,
    payload: {
      title: tab.title || "PDF 文档",
      url: sourceUrl,
      content: extracted.text
    }
  });
  emitProgress(requestId, "normalizing");

  return {
    summary: summaryResult.summary,
    meta: {
      title: tab.title || "PDF 文档",
      url: sourceUrl,
      length: extracted.text.length,
      quality: analyzePdfQuality({
        byteLength: bytes.byteLength,
        textLength: extracted.text.length,
        pageGuess: extracted.pageGuess
      }),
      promptId: summaryResult.promptId,
      promptName: summaryResult.promptName
    }
  };
}

async function fetchPdfBytes(sourceUrl) {
  let response;
  try {
    response = await fetch(sourceUrl);
  } catch (error) {
    if (/^file:\/\//i.test(sourceUrl)) {
      throw appError("FILE_ACCESS_DENIED", "无法访问本地 PDF。请在扩展详情开启“允许访问文件网址”。");
    }
    throw appError("PDF_DOWNLOAD_FAILED", `PDF 下载失败：${error.message || error}`);
  }

  if (!response.ok) {
    throw appError("PDF_DOWNLOAD_FAILED", `PDF 下载失败 (${response.status})。`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > PDF_MAX_BYTES) {
    throw appError("PDF_TOO_LARGE", `PDF 体积过大（>${Math.floor(PDF_MAX_BYTES / 1024 / 1024)}MB），暂不支持。`);
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 64) {
    throw appError("PDF_EMPTY", "PDF 内容为空或损坏。");
  }
  if (bytes.byteLength > PDF_MAX_BYTES) {
    throw appError("PDF_TOO_LARGE", `PDF 体积过大（>${Math.floor(PDF_MAX_BYTES / 1024 / 1024)}MB），暂不支持。`);
  }

  return bytes;
}

async function extractPdfTextFromBytes(arrayBuffer) {
  const binary = binaryStringFromArrayBuffer(arrayBuffer);
  const pageGuess = (binary.match(/\/Type\s*\/Page\b/g) || []).length || 0;

  const streamTexts = await extractPdfStreamTexts(binary);
  const fallbackTexts = extractPdfLiteralTexts(binary);

  const merged = [...streamTexts, ...fallbackTexts].map((x) => sanitizePdfText(x)).filter(Boolean);
  const content = merged.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return {
    text: content.slice(0, 22000),
    pageGuess
  };
}

async function extractPdfStreamTexts(binary) {
  const results = [];
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamRegex.exec(binary))) {
    const streamBody = match[1];
    const headerStart = Math.max(0, match.index - 600);
    const header = binary.slice(headerStart, match.index);
    const hasTextOps = /Tj|TJ|BT|ET/.test(streamBody);
    const flate = /\/FlateDecode/.test(header);

    if (!hasTextOps && !flate) continue;

    const chunks = [];
    if (hasTextOps) chunks.push(streamBody);
    if (flate) {
      const decoded = await tryInflateToText(streamBody);
      if (decoded) chunks.push(decoded);
    }

    for (const raw of chunks) {
      const literals = extractPdfLiteralTexts(raw);
      const hexes = extractPdfHexTexts(raw);
      const arrays = extractPdfArrayTexts(raw);
      results.push(...literals, ...hexes, ...arrays);
    }
  }
  return results;
}

function extractPdfLiteralTexts(input) {
  const out = [];
  const regex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
  let match;
  while ((match = regex.exec(input))) {
    out.push(decodePdfLiteral(match[1]));
  }
  return out;
}

function extractPdfArrayTexts(input) {
  const out = [];
  const regex = /\[(.*?)\]\s*TJ/gs;
  let match;
  while ((match = regex.exec(input))) {
    const segment = match[1];
    const strRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)|<([0-9a-fA-F\s]+)>/g;
    const parts = [];
    let s;
    while ((s = strRegex.exec(segment))) {
      if (s[1] !== undefined) {
        parts.push(decodePdfLiteral(s[1]));
      } else if (s[2] !== undefined) {
        parts.push(decodePdfHex(s[2]));
      }
    }
    if (parts.length > 0) out.push(parts.join(""));
  }
  return out;
}

function extractPdfHexTexts(input) {
  const out = [];
  const regex = /<([0-9a-fA-F\s]+)>\s*Tj/g;
  let match;
  while ((match = regex.exec(input))) {
    out.push(decodePdfHex(match[1]));
  }
  return out;
}

function decodePdfHex(hexText) {
  const clean = String(hexText || "").replace(/[^0-9a-fA-F]/g, "");
  if (!clean) return "";

  const even = clean.length % 2 === 0 ? clean : `${clean}0`;
  const bytes = new Uint8Array(even.length / 2);
  for (let i = 0; i < even.length; i += 2) {
    bytes[i / 2] = parseInt(even.slice(i, i + 2), 16);
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.slice(2));
  }

  // Many PDFs store CJK in 2-byte big-endian codes without BOM.
  if (looksLikeUtf16Be(bytes)) {
    const maybeUtf16 = decodeUtf16Be(bytes);
    if (hasReadableText(maybeUtf16)) return maybeUtf16;
  }

  const utf8 = utf8FromBytes(bytes);
  if (hasReadableText(utf8)) return utf8;
  return latin1FromBytes(bytes);
}

function decodeUtf16Be(bytes) {
  if (!bytes || bytes.length === 0) return "";
  let payload = bytes;
  if (payload.length % 2 !== 0) {
    const patched = new Uint8Array(payload.length + 1);
    patched.set(payload);
    payload = patched;
  }
  try {
    return new TextDecoder("utf-16be", { fatal: false }).decode(payload);
  } catch {
    return "";
  }
}

function latin1FromBytes(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function looksLikeUtf16Be(bytes) {
  if (!bytes || bytes.length < 4 || bytes.length % 2 !== 0) return false;
  let zeroCount = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    if (bytes[i] === 0x00) zeroCount += 1;
  }
  return zeroCount / (bytes.length / 2) > 0.2;
}

function hasReadableText(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  const bad = (t.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/g) || []).length;
  return bad / t.length < 0.2;
}

function decodePdfLiteral(raw) {
  let output = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      output += ch;
      continue;
    }

    const next = raw[++i];
    if (next === undefined) break;

    if (next === "n") output += "\n";
    else if (next === "r") output += "\r";
    else if (next === "t") output += "\t";
    else if (next === "b") output += "\b";
    else if (next === "f") output += "\f";
    else if (next === "(" || next === ")" || next === "\\") output += next;
    else if (/[0-7]/.test(next)) {
      let oct = next;
      for (let j = 0; j < 2; j++) {
        const peek = raw[i + 1];
        if (peek && /[0-7]/.test(peek)) {
          oct += peek;
          i += 1;
        } else {
          break;
        }
      }
      output += String.fromCharCode(parseInt(oct, 8));
    } else {
      output += next;
    }
  }
  return output;
}

async function tryInflateToText(binaryChunk) {
  try {
    const bytes = binaryStringToUint8(binaryChunk);
    const ds = new DecompressionStream("deflate");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return utf8FromBytes(new Uint8Array(ab));
  } catch {
    return "";
  }
}

function binaryStringFromArrayBuffer(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let out = "";
  const block = 0x8000;
  for (let i = 0; i < bytes.length; i += block) {
    const chunk = bytes.subarray(i, i + block);
    out += String.fromCharCode(...chunk);
  }
  return out;
}

function binaryStringToUint8(input) {
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    bytes[i] = input.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function utf8FromBytes(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

function sanitizePdfText(input) {
  return String(input || "")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function resolvePromptPreset(settings, preferredPromptId) {
  const source = Array.isArray(settings.promptPresets) && settings.promptPresets.length > 0
    ? settings.promptPresets
    : defaultPromptPresets();
  const presets = mergePromptPresetsWithBuiltins(sanitizePromptPresets(source));

  const fallback = presets[0] || defaultPromptPresets()[0];
  const wanted = preferredPromptId || settings.activePromptId || fallback.id;

  return presets.find((item) => item.id === wanted) || fallback;
}

function sanitizePromptPresets(input) {
  return input
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `preset-${index + 1}`;
      const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : `预设 ${index + 1}`;
      const systemPrompt = typeof item.systemPrompt === "string" ? item.systemPrompt.trim() : "";
      const postprocess = item.postprocess === "jobs" ? "jobs" : "none";
      return { id, name, systemPrompt, postprocess };
    })
    .filter((item) => item.systemPrompt.length > 0);
}

function mergePromptPresetsWithBuiltins(source) {
  const merged = Array.isArray(source) ? [...source] : [];
  const existing = new Set(merged.map((item) => item.id));
  for (const preset of defaultPromptPresets()) {
    if (existing.has(preset.id)) continue;
    merged.push({
      id: preset.id,
      name: preset.name,
      postprocess: preset.postprocess,
      systemPrompt: preset.systemPrompt
    });
    existing.add(preset.id);
  }
  return merged;
}

function defaultPromptPresets() {
  return [
    {
      id: "jobs-default",
      name: "乔布斯决策模式",
      postprocess: "jobs",
      systemPrompt: [
        "You are Steve Jobs in product-review mode.",
        "Use concise Chinese.",
        "Keep sharp judgment, but add short explanations for logic clarity.",
        "Output in this exact Markdown structure:",
        "## 1) 一句话判断",
        "- 只能是 Amazing 或 Shit 之一，然后补一句不超过20字的结论。",
        "## 2) 三条关键洞察",
        "- 每条必须是两行：",
        "  第一行：- 判断：...",
        "  第二行：  解释：...",
        "## 3) 该砍掉的部分",
        "- 每条必须是两行：",
        "  第一行：- 砍掉：...",
        "  第二行：  解释：...",
        "## 4) 一周内可执行下一步",
        "- 必须拆成三行，不允许合并：",
        "  - 目标：...",
        "  - 步骤：...",
        "  - 预期：...",
        "Do not output JSON. Do not skip headings. Never merge step 4 into one line."
      ].join("\n")
    },
    {
      id: "assistant-default",
      name: "总结助手提取模式",
      postprocess: "none",
      systemPrompt: [
        "你是总结助手。请用中文输出。",
        "输出结构固定为：",
        "## 核心摘要",
        "- 用 3 条要点概括全文。",
        "## 关键信息提取",
        "- 信息点：...",
        "- 信息点：...",
        "## 可执行建议",
        "- 行动1：...",
        "- 行动2：...",
        "不要输出 JSON，不要编造原文没有的信息。"
      ].join("\n")
    },
    {
      id: "standard-default",
      name: "标准模式 原样输出",
      postprocess: "none",
      systemPrompt: [
        "你是一位专业写作助手和信息整理专家。请用中文输出。",
        "任务：将用户提供的笔记整理为结构清晰、逻辑严谨的 Markdown 文档。",
        "约束：只使用用户提供的信息，不引用外部资料；若缺失信息则标注“原文未提供”。",
        "风格：可适度使用少量表情符号提升可读性（总数不超过3个）。",
        "请按步骤执行：",
        "1. 内容分析：识别关键信息、区分主要观点与支撑细节、标记高/中/低重要度。",
        "2. 结构重组：按主题优先（必要时按时间顺序），建立清晰层级。",
        "3. 格式优化：统一标题和术语，使用列表/表格增强可读性。",
        "4. 质量提升：去重、消除冲突表达、补充“待确认项”。",
        "输出结构：",
        "# <主题标题>",
        "## 核心摘要",
        "## 结构化内容",
        "## 重点结论与依据",
        "## 待确认项",
        "## 行动建议（若原文包含可执行内容）",
        "不要输出 JSON，不要编造原文没有的信息。"
      ].join("\n")
    }
  ];
}

function defaultApiPresets() {
  return [
    {
      id: "api-default",
      name: "默认 OpenAI",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "",
      model: "gpt-4.1-mini",
      temperature: 0.2,
      maxTokens: 600
    }
  ];
}

function normalizeSummaryOutput(content) {
  const normalized = content
    .split("\n")
    .map((line) => line.trimEnd())
    .flatMap((line) => {
      const step4Match = line.match(/目标：(.+?)[｜|]步骤：(.+?)[｜|]预期：(.+)/);
      if (step4Match) {
        return [
          `- 目标：${step4Match[1].trim()}`,
          `- 步骤：${step4Match[2].trim()}`,
          `- 预期：${step4Match[3].trim()}`
        ];
      }

      const insightMatch = line.match(/^-\s*判断：(.+?)[｜|]因为：(.+)$/);
      if (insightMatch) {
        return [`- 判断：${insightMatch[1].trim()}`, `解释：${insightMatch[2].trim()}`];
      }

      const cutMatch = line.match(/^-\s*砍掉：(.+?)[｜|]原因：(.+)$/);
      if (cutMatch) {
        return [`- 砍掉：${cutMatch[1].trim()}`, `解释：${cutMatch[2].trim()}`];
      }

      const legacyComment = line.match(/^\s*--\s*(因为|原因)\s*[:：]\s*(.+)$/);
      if (legacyComment) {
        return [`解释：${legacyComment[2].trim()}`];
      }

      return [line];
    })
    .join("\n");

  return normalizeStepBlocks(normalized);
}

function normalizeStepBlocks(content) {
  const lines = content.split("\n");
  const output = [];

  for (const line of lines) {
    const stepInlineMatch = line.match(/^\s*-\s*步骤[:：]\s*(.+)$/);
    if (!stepInlineMatch) {
      output.push(line);
      continue;
    }

    output.push("- 步骤：");
    const stepItems = splitStepItems(stepInlineMatch[1]);
    if (stepItems.length === 0) {
      continue;
    }

    for (let i = 0; i < stepItems.length; i++) {
      output.push(`${i + 1}. ${stepItems[i]}`);
    }
  }

  return output.join("\n");
}

function splitStepItems(rawText) {
  const text = rawText.trim();
  if (!text) return [];

  const splitter = /\s*[；;]\s*/;
  const chunks = text
    .split(splitter)
    .map((x) => x.trim())
    .filter(Boolean);

  if (chunks.length <= 1) {
    return [text];
  }

  return chunks;
}

function normalizeEndpoint(input) {
  let endpoint = (input || "").trim();

  if (!endpoint) {
    return DEFAULT_SETTINGS.endpoint;
  }

  endpoint = endpoint.replace(/\/+$/, "");

  if (endpoint.endsWith("/chat/completions")) {
    return endpoint;
  }

  if (endpoint.endsWith("/v1")) {
    return `${endpoint}/chat/completions`;
  }

  if (endpoint.endsWith("/chat")) {
    return `${endpoint}/completions`;
  }

  return endpoint;
}

function extractSourceUrlFromTab(tab) {
  const rawUrl = String(tab?.url || tab?.pendingUrl || "");
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (/^file:\/\//i.test(rawUrl)) return rawUrl;

  if (/^chrome-extension:\/\//i.test(rawUrl)) {
    try {
      const parsed = new URL(rawUrl);
      const src = parsed.searchParams.get("src");
      if (src && /^https?:\/\//i.test(src)) return src;
      if (src) {
        const decoded = decodeURIComponent(src);
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    } catch {
      // Ignore parse errors.
    }
  }

  return "";
}

function isPdfUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return /\.pdf$/i.test(parsed.pathname) || /\.pdf($|[?#])/i.test(url);
  } catch {
    return /\.pdf($|[?#])/i.test(url);
  }
}

function emitProgress(requestId, stage) {
  if (!requestId) return;
  chrome.runtime.sendMessage({
    type: "summarize_progress",
    requestId,
    stage
  }).catch(() => {
    // Ignore progress relay failures.
  });
}

function appError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function toErrorPayload(error) {
  return {
    code: error?.code || "UNKNOWN",
    error: error?.message || "Unknown error"
  };
}

function analyzePayloadQuality(payload) {
  const content = String(payload?.content || "");
  const contentLength = content.trim().length;
  const rawChunks = Number(payload?.rawChunkCount || 0);
  const uniqueChunks = Number(payload?.uniqueChunkCount || 0);
  const duplicateRatio = rawChunks > 0 ? 1 - uniqueChunks / rawChunks : 0;

  const warnings = [];
  if (contentLength < 1200) warnings.push("正文偏短");
  if (duplicateRatio > 0.38) warnings.push("重复文本偏多");
  if (uniqueChunks < 10) warnings.push("有效段落较少");

  return {
    grade: warnings.length > 0 ? "caution" : "good",
    warnings,
    contentLength,
    rawChunks,
    uniqueChunks,
    duplicateRatio: Number(duplicateRatio.toFixed(3))
  };
}

function analyzePdfQuality({ byteLength, textLength, pageGuess }) {
  const warnings = [];
  if (textLength < 1200) warnings.push("可提取文本偏短");
  if (byteLength > 12 * 1024 * 1024) warnings.push("文档较大，响应可能偏慢");
  if (pageGuess > 0 && textLength / pageGuess < 120) warnings.push("可能包含大量扫描页");

  return {
    grade: warnings.length > 0 ? "caution" : "good",
    warnings,
    contentLength: textLength,
    rawChunks: pageGuess,
    uniqueChunks: pageGuess,
    duplicateRatio: 0,
    fileBytes: byteLength
  };
}

function truncate(input, maxLen) {
  const text = String(input || "");
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function extractPagePayload() {
  const blacklist = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "SVG",
    "CANVAS",
    "HEADER",
    "FOOTER",
    "NAV",
    "ASIDE",
    "FORM"
  ]);

  const articleEl =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body;

  const walker = document.createTreeWalker(articleEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (blacklist.has(parent.tagName)) return NodeFilter.FILTER_REJECT;

      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length < 25) return NodeFilter.FILTER_REJECT;

      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const chunks = [];
  while (walker.nextNode() && chunks.length < 400) {
    chunks.push(walker.currentNode.textContent.replace(/\s+/g, " ").trim());
  }

  const uniqueChunks = [...new Set(chunks)];
  const deduped = uniqueChunks.join("\n").slice(0, 22000);

  return {
    title: document.title,
    url: location.href,
    content: deduped,
    rawChunkCount: chunks.length,
    uniqueChunkCount: uniqueChunks.length
  };
}
