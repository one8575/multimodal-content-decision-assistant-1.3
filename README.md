# 多模态内容决策助理（Chrome 扩展）

基于 Manifest V3 的 Chromium 扩展，用于对网页或本地文本内容进行结构化总结与决策辅助输出，支持 OpenAI 兼容 API。

## 功能概览

- 网页内容提取与总结
- 多 Prompt 预设切换（含默认预设，可自定义）
- 本地文件/文本输入后总结
- 总结历史记录保存（本地）
- API 预设管理（Endpoint / Model / Temperature / Max Tokens）

## 项目结构

- `manifest.json`：扩展声明文件（Manifest V3）
- `background.js`：后台 service worker，负责提取、请求与流程编排
- `workspace.html` / `workspace.js` / `workspace.css`：总结工作台界面
- `options.html` / `options.js` / `options.css`：配置页面（API 与 Prompt 管理）
- `V2-PRD-cn.md`、`V3-PRD-cn.md`：产品文档与设计思路

## 本地安装（开发者模式）

1. 打开 Chrome/Edge 浏览器扩展管理页：
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目目录：
   - `./multimodal-content-decision-assistant-1.3`
5. 安装后，在扩展列表中可看到：`多模态内容决策助理`。

## 使用说明

1. 安装扩展后，先进入扩展配置页（Options）。
2. 配置可用的 OpenAI 兼容 API 参数：
   - Endpoint
   - API Key
   - Model
   - Temperature
   - Max Tokens
3. 选择或自定义 Prompt 预设。
4. 打开任意网页，点击扩展进入工作台进行总结。
5. 可在工作台查看输出结果与历史记录。

## 配置与数据

本扩展将配置和历史存储在浏览器本地存储（`chrome.storage.local`）中，包括：

- API 预设
- Prompt 预设
- 当前激活预设
- 历史记录

## 兼容性

- Chromium 内核浏览器（Chrome、Edge 等）
- Manifest V3

## 版本

当前版本：`1.3.0`

## 免责声明

- 本项目依赖第三方 AI API 服务，调用费用与可用性由对应服务商决定。
- 请勿在未授权场景处理敏感或受限数据。

## License

如需开源发布，建议在仓库根目录补充 `LICENSE` 文件（例如 MIT）。

