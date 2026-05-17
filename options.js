const defaults = {
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4.1-mini",
  temperature: 0.2,
  maxTokens: 600,
  apiKey: "",
  activePromptId: "jobs-default",
  promptPresets: defaultPromptPresets(),
  activeApiPresetId: "api-default",
  apiPresets: defaultApiPresets()
};

const els = {
  addApiPresetBtn: document.getElementById("addApiPresetBtn"),
  apiPresetList: document.getElementById("apiPresetList"),
  addPromptPresetBtn: document.getElementById("addPromptPresetBtn"),
  promptPresetList: document.getElementById("promptPresetList"),
  navApiBtn: document.getElementById("navApiBtn"),
  navPromptBtn: document.getElementById("navPromptBtn"),
  apiView: document.getElementById("apiView"),
  promptView: document.getElementById("promptView"),
  saveBtn: document.getElementById("saveBtn"),
  status: document.getElementById("status")
};

let apiPresetState = [];
let activeApiPresetId = defaults.activeApiPresetId;
let promptPresetState = [];
let activePromptId = defaults.activePromptId;
let activeSettingsView = "api";
let focusedPromptPresetId = "";
const modelOptionsByPresetId = {};
const OPTIONS_VIEW_KEY = "optionsActiveView";
const THEME_KEY = "workspaceThemePreset";

init();
els.saveBtn.addEventListener("click", save);
els.addApiPresetBtn.addEventListener("click", addApiPreset);
els.addPromptPresetBtn.addEventListener("click", addPromptPreset);
els.navApiBtn.addEventListener("click", () => switchSettingsView("api"));
els.navPromptBtn.addEventListener("click", () => switchSettingsView("prompt"));

async function init() {
  const [config, localUi] = await Promise.all([
    chrome.storage.sync.get(Object.keys(defaults)),
    chrome.storage.local.get(OPTIONS_VIEW_KEY)
  ]);

  await applyThemeFromWorkspace();

  apiPresetState = sanitizeApiPresets(config.apiPresets);
  if (apiPresetState.length === 0) {
    const migrated = migrateLegacyApiConfig(config);
    apiPresetState = migrated ? [migrated] : cloneApiPresets(defaults.apiPresets);
  }

  const storedActiveApi = typeof config.activeApiPresetId === "string" ? config.activeApiPresetId : defaults.activeApiPresetId;
  activeApiPresetId = apiPresetState.some((x) => x.id === storedActiveApi) ? storedActiveApi : apiPresetState[0].id;

  promptPresetState = sanitizePromptPresets(config.promptPresets);
  promptPresetState = mergePromptPresetsWithBuiltins(promptPresetState);
  if (promptPresetState.length === 0) {
    promptPresetState = clonePromptPresets(defaults.promptPresets);
  }

  const storedActivePrompt = typeof config.activePromptId === "string" ? config.activePromptId : defaults.activePromptId;
  activePromptId = promptPresetState.some((x) => x.id === storedActivePrompt) ? storedActivePrompt : promptPresetState[0].id;
  focusedPromptPresetId = activePromptId;
  activeSettingsView = localUi[OPTIONS_VIEW_KEY] === "prompt" ? "prompt" : "api";

  renderApiPresetList();
  renderPromptPresetList();
  switchSettingsView(activeSettingsView);
}

async function applyThemeFromWorkspace() {
  const root = document.documentElement;
  const local = await chrome.storage.local.get(THEME_KEY);
  const preset = String(local[THEME_KEY] || "classic");

  if (preset === "apple") {
    root.setAttribute("data-palette", "apple");
    root.setAttribute("data-theme", "light");
    return;
  }
  if (preset === "night") {
    root.setAttribute("data-palette", "classic");
    root.setAttribute("data-theme", "dark");
    return;
  }

  root.setAttribute("data-palette", "classic");
  root.setAttribute("data-theme", "light");
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!Object.prototype.hasOwnProperty.call(changes, THEME_KEY)) return;
  void applyThemeFromWorkspace();
});

function migrateLegacyApiConfig(config) {
  const endpoint = typeof config.endpoint === "string" ? config.endpoint.trim() : "";
  const apiKey = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
  const model = typeof config.model === "string" ? config.model.trim() : "";
  const temperature = Number(config.temperature);
  const maxTokens = Number(config.maxTokens);

  if (!endpoint || !model) return null;

  return {
    id: "api-legacy",
    name: "当前配置（迁移）",
    endpoint,
    apiKey,
    model,
    temperature: Number.isFinite(temperature) ? temperature : defaults.temperature,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : defaults.maxTokens
  };
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

function cloneApiPresets(presets) {
  return presets.map((item) => ({
    id: item.id,
    name: item.name,
    endpoint: item.endpoint,
    apiKey: item.apiKey,
    model: item.model,
    temperature: item.temperature,
    maxTokens: item.maxTokens
  }));
}

function clonePromptPresets(presets) {
  return presets.map((item) => ({
    id: item.id,
    name: item.name,
    postprocess: item.postprocess,
    systemPrompt: item.systemPrompt
  }));
}

function sanitizeApiPresets(input) {
  if (!Array.isArray(input)) return [];

  return input
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `api-${index + 1}`;
      const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : `API 预设 ${index + 1}`;
      const endpoint = typeof item.endpoint === "string" ? item.endpoint.trim() : "";
      const apiKey = typeof item.apiKey === "string" ? item.apiKey.trim() : "";
      const model = typeof item.model === "string" ? item.model.trim() : "";
      const temperature = Number(item.temperature);
      const maxTokens = Number(item.maxTokens);

      return {
        id,
        name,
        endpoint,
        apiKey,
        model,
        temperature: Number.isFinite(temperature) ? temperature : 0.2,
        maxTokens: Number.isFinite(maxTokens) ? maxTokens : 600
      };
    })
    .filter((item) => item.endpoint && item.model);
}

function sanitizePromptPresets(input) {
  if (!Array.isArray(input)) return [];

  return input
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `preset-${index + 1}`;
      const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : `预设 ${index + 1}`;
      const systemPrompt = typeof item.systemPrompt === "string" ? item.systemPrompt : "";
      const postprocess = item.postprocess === "jobs" ? "jobs" : "none";
      return { id, name, systemPrompt, postprocess };
    })
    .filter((item) => item.systemPrompt.trim().length > 0);
}

function mergePromptPresetsWithBuiltins(source) {
  const merged = Array.isArray(source) ? clonePromptPresets(source) : [];
  const existing = new Set(merged.map((item) => item.id));
  const builtins = defaultPromptPresets();

  for (const preset of builtins) {
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

function renderApiPresetList() {
  if (apiPresetState.length === 0) {
    els.apiPresetList.innerHTML = "<div class=\"hint\">暂无 API 预设</div>";
    return;
  }

  els.apiPresetList.innerHTML = apiPresetState
    .map((preset, index) => {
      const checked = preset.id === activeApiPresetId ? "checked" : "";
      const disableDelete = apiPresetState.length <= 1 ? "disabled" : "";
      return `
        <div class="presetItem" data-index="${index}">
          <div class="presetTop">
            <label>
              <input type="radio" name="activeApiPreset" value="${escapeHtmlAttr(preset.id)}" ${checked} />
              默认启用
            </label>
            <button type="button" class="ghost deleteApiPresetBtn" data-index="${index}" ${disableDelete}>删除</button>
          </div>
          <div class="presetBody">
            <label>
              名称
              <input class="apiName" data-index="${index}" type="text" value="${escapeHtmlAttr(preset.name)}" />
            </label>
            <label>
              API Endpoint（可填到 /v1）
              <input class="apiEndpoint" data-index="${index}" type="url" value="${escapeHtmlAttr(preset.endpoint)}" />
            </label>
            <label>
              API Key
              <input class="apiKey" data-index="${index}" type="password" value="${escapeHtmlAttr(preset.apiKey)}" />
            </label>
            <div class="inlineGrid">
              <label>
                Model
                <div class="modelRow">
                  <input class="apiModel" data-index="${index}" type="text" value="${escapeHtmlAttr(preset.model)}" />
                  <button type="button" class="ghost fetchModelsBtn" data-index="${index}">拉取模型</button>
                </div>
                ${renderModelSelect(preset, index)}
              </label>
              <label>
                Temperature (0-1)
                <input class="apiTemperature" data-index="${index}" type="number" min="0" max="1" step="0.1" value="${escapeHtmlAttr(preset.temperature)}" />
              </label>
            </div>
            <label>
              Max Tokens
              <input class="apiMaxTokens" data-index="${index}" type="number" min="100" max="4000" step="50" value="${escapeHtmlAttr(preset.maxTokens)}" />
            </label>
          </div>
        </div>
      `;
    })
    .join("");

  bindApiPresetEvents();
}

function renderModelSelect(preset, index) {
  const options = modelOptionsByPresetId[preset.id] || [];
  if (options.length === 0) return "";

  const current = String(preset.model || "").trim();
  const optionHtml = options
    .map((id) => {
      const selected = id === current ? "selected" : "";
      return `<option value="${escapeHtmlAttr(id)}" ${selected}>${escapeHtml(id)}</option>`;
    })
    .join("");

  return `
    <select class="apiModelSelect" data-index="${index}">
      <option value="">选择已拉取模型</option>
      ${optionHtml}
    </select>
  `;
}

function bindApiPresetEvents() {
  const radios = els.apiPresetList.querySelectorAll('input[name="activeApiPreset"]');
  radios.forEach((radio) => {
    radio.addEventListener("change", () => {
      activeApiPresetId = radio.value;
    });
  });

  const deleteButtons = els.apiPresetList.querySelectorAll(".deleteApiPresetBtn");
  deleteButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      deleteApiPreset(index);
    });
  });

  bindInputState(els.apiPresetList, ".apiName", (index, value) => {
    apiPresetState[index].name = value;
  });
  bindInputState(els.apiPresetList, ".apiEndpoint", (index, value) => {
    apiPresetState[index].endpoint = value;
  });
  bindInputState(els.apiPresetList, ".apiKey", (index, value) => {
    apiPresetState[index].apiKey = value;
  });
  bindInputState(els.apiPresetList, ".apiModel", (index, value) => {
    apiPresetState[index].model = value;
  });
  bindInputState(els.apiPresetList, ".apiTemperature", (index, value) => {
    apiPresetState[index].temperature = Number(value);
  });
  bindInputState(els.apiPresetList, ".apiMaxTokens", (index, value) => {
    apiPresetState[index].maxTokens = Number(value);
  });

  const fetchButtons = els.apiPresetList.querySelectorAll(".fetchModelsBtn");
  fetchButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const index = Number(button.dataset.index);
      await fetchModelsForPreset(index);
    });
  });

  const modelSelects = els.apiPresetList.querySelectorAll(".apiModelSelect");
  modelSelects.forEach((select) => {
    select.addEventListener("change", () => {
      const index = Number(select.dataset.index);
      const value = String(select.value || "").trim();
      if (!value) return;
      apiPresetState[index].model = value;
      renderApiPresetList();
      setStatus(`已选择模型：${value}`);
    });
  });
}

async function fetchModelsForPreset(index) {
  const preset = apiPresetState[index];
  if (!preset) return;

  const endpoint = String(preset.endpoint || "").trim();
  const apiKey = String(preset.apiKey || "").trim();

  if (!endpoint) {
    setStatus("请先填写 Endpoint");
    return;
  }
  if (!apiKey) {
    setStatus("请先填写 API Key");
    return;
  }

  const modelsEndpoint = toModelsEndpoint(endpoint);
  setStatus("拉取模型中...");

  let response;
  try {
    response = await fetch(modelsEndpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
  } catch (error) {
    setStatus(`拉取失败：${error.message || error}`);
    return;
  }

  if (!response.ok) {
    const errText = await response.text();
    setStatus(`拉取失败 (${response.status})：${truncate(errText, 120)}`);
    return;
  }

  const data = await response.json();
  const models = Array.isArray(data?.data) ? data.data : [];
  const ids = models
    .map((x) => (x && typeof x.id === "string" ? x.id.trim() : ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "en"));

  if (ids.length === 0) {
    setStatus("未拉取到可用模型");
    return;
  }

  modelOptionsByPresetId[preset.id] = ids;

  if (!ids.includes(String(preset.model || "").trim())) {
    preset.model = ids[0];
  }

  renderApiPresetList();
  setStatus(`已拉取 ${ids.length} 个模型`);
}

function toModelsEndpoint(endpointInput) {
  const endpoint = normalizeEndpoint(endpointInput || "");
  return endpoint.replace(/\/chat\/completions$/i, "/models");
}

function normalizeEndpoint(input) {
  let endpoint = (input || "").trim();

  if (!endpoint) {
    return defaults.endpoint;
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

function truncate(input, maxLen) {
  const text = String(input || "");
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function renderPromptPresetList() {
  if (promptPresetState.length === 0) {
    els.promptPresetList.innerHTML = "<div class=\"hint\">暂无 Prompt 预设</div>";
    return;
  }
  if (!promptPresetState.some((x) => x.id === focusedPromptPresetId)) {
    focusedPromptPresetId = activePromptId || promptPresetState[0].id;
  }

  els.promptPresetList.innerHTML = promptPresetState
    .map((preset, index) => {
      const checked = preset.id === activePromptId ? "checked" : "";
      const disableDelete = promptPresetState.length <= 1 ? "disabled" : "";
      const focusedCls = preset.id === focusedPromptPresetId ? "isFocus" : "";
      const toneCls = `tone-${(index % 4) + 1}`;
      const postprocessLabel = preset.postprocess === "jobs" ? "结构化规整" : "原样输出";
      return `
        <div class="presetItem promptPresetCard ${focusedCls} ${toneCls}" data-index="${index}" data-id="${escapeHtmlAttr(preset.id)}">
          <div class="presetTop">
            <label>
              <input type="radio" name="activePrompt" value="${escapeHtmlAttr(preset.id)}" ${checked} />
              默认启用
            </label>
            <button type="button" class="ghost deletePromptPresetBtn" data-index="${index}" ${disableDelete}>删除</button>
          </div>
          <div class="promptCardMeta">
            <span class="promptBadge">预设 ${index + 1}</span>
            <span class="promptBadge muted">${postprocessLabel}</span>
          </div>
          <div class="presetBody">
            <label>
              名称
              <input class="promptName" data-index="${index}" type="text" value="${escapeHtmlAttr(preset.name)}" />
            </label>
            <label>
              输出后处理
              <select class="promptPostprocess" data-index="${index}">
                <option value="jobs" ${preset.postprocess === "jobs" ? "selected" : ""}>乔布斯结构化规整</option>
                <option value="none" ${preset.postprocess === "none" ? "selected" : ""}>原样输出</option>
              </select>
            </label>
            <label>
              System Prompt
              <textarea class="promptContent" data-index="${index}">${escapeHtml(preset.systemPrompt)}</textarea>
            </label>
          </div>
        </div>
      `;
    })
    .join("");

  bindPromptPresetEvents();
}

function bindPromptPresetEvents() {
  const radios = els.promptPresetList.querySelectorAll('input[name="activePrompt"]');
  radios.forEach((radio) => {
    radio.addEventListener("change", () => {
      activePromptId = radio.value;
      focusedPromptPresetId = radio.value;
      refreshPromptFocusVisual();
    });
  });

  const cards = els.promptPresetList.querySelectorAll(".promptPresetCard");
  cards.forEach((card) => {
    card.addEventListener("click", () => {
      focusedPromptPresetId = String(card.dataset.id || "");
      refreshPromptFocusVisual();
    });
  });

  const deleteButtons = els.promptPresetList.querySelectorAll(".deletePromptPresetBtn");
  deleteButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      deletePromptPreset(index);
    });
  });

  bindInputState(els.promptPresetList, ".promptName", (index, value) => {
    const preset = promptPresetState[index];
    if (preset?.id) focusedPromptPresetId = preset.id;
    promptPresetState[index].name = value;
    refreshPromptFocusVisual();
  });

  const postprocesses = els.promptPresetList.querySelectorAll(".promptPostprocess");
  postprocesses.forEach((select) => {
    select.addEventListener("change", () => {
      const index = Number(select.dataset.index);
      const preset = promptPresetState[index];
      if (preset?.id) focusedPromptPresetId = preset.id;
      promptPresetState[index].postprocess = select.value === "jobs" ? "jobs" : "none";
      renderPromptPresetList();
    });
  });

  bindInputState(els.promptPresetList, ".promptContent", (index, value) => {
    const preset = promptPresetState[index];
    if (preset?.id) focusedPromptPresetId = preset.id;
    promptPresetState[index].systemPrompt = value;
    refreshPromptFocusVisual();
  });
}

function bindInputState(container, selector, setter) {
  const inputs = container.querySelectorAll(selector);
  inputs.forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.index);
      setter(index, input.value);
    });
  });
}

function addApiPreset() {
  const id = `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  apiPresetState.push({
    id,
    name: "新 API 预设",
    endpoint: defaults.endpoint,
    apiKey: "",
    model: defaults.model,
    temperature: defaults.temperature,
    maxTokens: defaults.maxTokens
  });

  if (!activeApiPresetId) {
    activeApiPresetId = id;
  }

  renderApiPresetList();
}

function deleteApiPreset(index) {
  if (apiPresetState.length <= 1) {
    setStatus("至少保留一个 API 预设");
    return;
  }

  const removed = apiPresetState.splice(index, 1)[0];
  if (removed && removed.id === activeApiPresetId) {
    activeApiPresetId = apiPresetState[0].id;
  }

  renderApiPresetList();
}

function addPromptPreset() {
  const id = `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  promptPresetState.push({
    id,
    name: "新 Prompt 预设",
    postprocess: "none",
    systemPrompt: "你是总结助手。请用中文总结并提取关键行动。"
  });

  if (!activePromptId) {
    activePromptId = id;
  }
  focusedPromptPresetId = id;

  renderPromptPresetList();
}

function deletePromptPreset(index) {
  if (promptPresetState.length <= 1) {
    setStatus("至少保留一个 Prompt 预设");
    return;
  }

  const removed = promptPresetState.splice(index, 1)[0];
  if (removed && removed.id === activePromptId) {
    activePromptId = promptPresetState[0].id;
  }
  if (removed && removed.id === focusedPromptPresetId) {
    focusedPromptPresetId = promptPresetState[0].id;
  }

  renderPromptPresetList();
}

async function save() {
  const duplicateApiPresetIds = hasDuplicateIds(apiPresetState.map((x) => x.id));
  if (duplicateApiPresetIds) {
    setStatus("API 预设 ID 重复，请修改后再保存");
    return;
  }

  const duplicatePromptPresetIds = hasDuplicateIds(promptPresetState.map((x) => x.id));
  if (duplicatePromptPresetIds) {
    setStatus("Prompt 预设 ID 重复，请修改后再保存");
    return;
  }

  const cleanedApiPresets = apiPresetState
    .map((item, index) => ({
      id: String(item.id || `api-${index + 1}`).trim(),
      name: String(item.name || `API 预设 ${index + 1}`).trim(),
      endpoint: String(item.endpoint || "").trim(),
      apiKey: String(item.apiKey || "").trim(),
      model: String(item.model || "").trim(),
      temperature: Number(item.temperature),
      maxTokens: Number(item.maxTokens)
    }))
    .filter((item) => item.id && item.name && item.endpoint && item.model);

  if (cleanedApiPresets.length === 0) {
    setStatus("至少保留一个有效 API 预设");
    return;
  }

  for (const api of cleanedApiPresets) {
    if (!api.endpoint.startsWith("http")) {
      setStatus(`Endpoint 格式不对：${api.name}`);
      return;
    }

    if (!Number.isFinite(api.temperature) || api.temperature < 0 || api.temperature > 1) {
      setStatus(`Temperature 超出范围：${api.name}`);
      return;
    }

    if (!Number.isFinite(api.maxTokens) || api.maxTokens < 100) {
      setStatus(`Max Tokens 不合法：${api.name}`);
      return;
    }
  }

  const cleanedPromptPresets = promptPresetState
    .map((item, index) => ({
      id: String(item.id || `prompt-${index + 1}`).trim(),
      name: String(item.name || `预设 ${index + 1}`).trim(),
      postprocess: item.postprocess === "jobs" ? "jobs" : "none",
      systemPrompt: String(item.systemPrompt || "").trim()
    }))
    .filter((item) => item.id && item.name && item.systemPrompt);

  if (cleanedPromptPresets.length === 0) {
    setStatus("至少保留一个有效 Prompt 预设");
    return;
  }

  const activeApi = cleanedApiPresets.some((x) => x.id === activeApiPresetId) ? activeApiPresetId : cleanedApiPresets[0].id;
  const activePrompt = cleanedPromptPresets.some((x) => x.id === activePromptId) ? activePromptId : cleanedPromptPresets[0].id;
  const effectiveApi = cleanedApiPresets.find((x) => x.id === activeApi) || cleanedApiPresets[0];

  await chrome.storage.sync.set({
    endpoint: effectiveApi.endpoint,
    apiKey: effectiveApi.apiKey,
    model: effectiveApi.model,
    temperature: effectiveApi.temperature,
    maxTokens: effectiveApi.maxTokens,
    activeApiPresetId: activeApi,
    apiPresets: cleanedApiPresets,
    promptPresets: cleanedPromptPresets,
    activePromptId: activePrompt
  });

  activeApiPresetId = activeApi;
  activePromptId = activePrompt;
  setStatus("已保存");
}

function setStatus(text) {
  els.status.textContent = text;
}

function refreshPromptFocusVisual() {
  const cards = els.promptPresetList.querySelectorAll(".promptPresetCard");
  cards.forEach((card) => {
    const isFocused = String(card.dataset.id || "") === focusedPromptPresetId;
    card.classList.toggle("isFocus", isFocused);
  });
}

function switchSettingsView(view) {
  activeSettingsView = view === "prompt" ? "prompt" : "api";
  const showApi = activeSettingsView === "api";

  els.apiView.hidden = !showApi;
  els.promptView.hidden = showApi;
  els.apiView.classList.toggle("active", showApi);
  els.promptView.classList.toggle("active", !showApi);
  els.navApiBtn.classList.toggle("active", showApi);
  els.navPromptBtn.classList.toggle("active", !showApi);
  void chrome.storage.local.set({ [OPTIONS_VIEW_KEY]: activeSettingsView });
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

function hasDuplicateIds(ids) {
  const seen = new Set();
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id) continue;
    if (seen.has(id)) return true;
    seen.add(id);
  }
  return false;
}
