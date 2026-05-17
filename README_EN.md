# Multimodal Content Decision Assistant (Chrome Extension)

A Manifest V3 Chromium extension for structured summarization and decision-oriented output from web pages or local text content, powered by OpenAI-compatible APIs.

## Features

- Extract and summarize web page content
- Switch between multiple prompt presets (with built-in defaults and custom presets)
- Summarize pasted text or local text files
- Save summary history locally
- Manage API presets (Endpoint / Model / Temperature / Max Tokens)

## Project Structure

- `manifest.json`: extension manifest (Manifest V3)
- `background.js`: background service worker for extraction, API calls, and orchestration
- `workspace.html` / `workspace.js` / `workspace.css`: summarization workspace UI
- `options.html` / `options.js` / `options.css`: settings UI (API and Prompt management)
- `V2-PRD-cn.md`, `V3-PRD-cn.md`: product notes and design drafts (Chinese)

## Local Installation (Developer Mode)

1. Open extension management page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder:
   - `./multimodal-content-decision-assistant-1.3`
5. After loading, the extension appears as `多模态内容决策助理`.

## Usage

1. Open the extension options/workspace.
2. Configure an OpenAI-compatible API preset:
   - Endpoint
   - API Key
   - Model
   - Temperature
   - Max Tokens
3. Choose or customize a prompt preset.
4. Open any web page and launch the workspace to generate summaries.
5. Review outputs and history in the workspace.

## Data and Storage

This extension stores configuration and history in browser storage (`chrome.storage`), including:

- API presets
- Prompt presets
- Active preset IDs
- Summary history

## Compatibility

- Chromium-based browsers (Chrome, Edge, etc.)
- Manifest V3

## Version

Current version: `1.3.0`

## Disclaimer

- This project depends on third-party AI API services. Cost and availability are determined by the provider.
- Do not process sensitive or restricted data without proper authorization.

## License

For open-source release, add a `LICENSE` file in the repository root (MIT is recommended).
