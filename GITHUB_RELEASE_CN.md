# GitHub 发布说明

本说明用于将本项目发布到 GitHub，并确保不包含本地隐私数据。

## 项目名称

- 中文名：多模态内容决策助理
- 英文目录名：`multimodal-content-decision-assistant-1.3`
- 版本：`1.3.0`

## 已完成的隐私处理

- 未包含浏览器运行时数据（历史记录、API 配置保存在 `chrome.storage`，不在仓库文件中）
- 未包含硬编码 API Key（源码默认值为空字符串）
- 已移除 README 中的本机绝对路径，改为通用相对路径

## 首次发布步骤

1. 在 GitHub 创建空仓库（不要勾选初始化 README）。
2. 在本地仓库根目录执行：

```bash
git add .
git commit -m "feat: initial release v1.3.0"
git branch -M main
git remote add origin <你的仓库地址>
git push -u origin main
git tag v1.3.0
git push origin v1.3.0
```

## 推荐仓库设置

- 仓库描述：
  - 多模态内容决策助理（Chrome Extension, Manifest V3）
- Topics：
  - `chrome-extension`, `manifest-v3`, `ai`, `summarizer`, `openai-compatible`
- License：
  - 建议 `MIT`

## 安装与使用（简版）

1. 打开 `chrome://extensions/`。
2. 开启开发者模式。
3. 加载已解压扩展，选择本项目目录。
4. 在 Options 页面配置 API Endpoint / API Key / Model。
5. 打开网页后点击扩展开始总结。

## 版本发布建议

- 代码变更后同步更新：
  - `manifest.json` 中 `version`
  - `README.md` 中版本说明
- 每次发布打 Tag，例如 `v1.3.1`。
