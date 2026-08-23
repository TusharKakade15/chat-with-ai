---
name: add-new-ai-provider
description: >-
  Use this skill when adding support for a new AI provider (e.g., Perplexity, Copilot,
  DeepSeek) to the bridge extension. Covers all files that need changes.
---

# Adding a New AI Provider

## Files to Modify

### 1. `manifest.json`
- Add host_permissions for the new provider's domain
- Add a new content_scripts entry with `content/shared.js` + the new provider script
- Set `"run_at": "document_idle"`

### 2. `background.js`
- Add entry to `AI_CONFIG` object with `searchPrefix` and `newChatUrl`
- Add case to `handleSingleAgent` for the new agent key
- Optionally extend `handleBroadcast` to include the new agent in the roundtable

### 3. `content/<provider>.js` (NEW FILE)
Follow the exact structure of existing content scripts:
1. Wrap everything in an IIFE: `(function() { ... })();`
2. Define `INPUT_SELECTORS` — ordered from most specific to most general
3. Define `SEND_BUTTON_SELECTORS` — same ordering
4. Define `STOP_BUTTON_SELECTORS` — for detecting generation in progress
5. Implement `getAssistantTurnCount()` — count response containers in the DOM
6. Implement `getLatestAssistantText()` — extract text from the latest response
7. Implement `extractText(el)` — clone element, strip junk, return `textContent`
8. Implement `cleanText(raw)` — filter out UI disclaimer strings and artifacts
9. Implement `isGenerating()` — check for stop button or spinner/streaming indicator
10. Call `window.AIBridgeUtils.setupMessageListener(async (promptText) => { ... })`
    - Inside the callback: find input, inject text, click send, wait for response
11. Implement `waitForResponse(turnCountBefore, textBefore, promptText, timeoutMs)`
    - Poll every 350-400ms
    - Send `STREAM_UPDATE` messages for live preview
    - Resolve when text is stable and not generating

### 4. `chat.html`
- Add a new agent badge in the sidebar `.agents-status` section:
  ```html
  <div class="agent" id="agent-<provider>" data-agent="<provider>">
      <div class="agent-icon <provider>-color">ABBR</div>
      <span>ProviderName</span>
  </div>
  ```
- Add a new option in `<select id="mode-select">` if single-agent mode is supported

### 5. `chat.css`
- Add a CSS variable: `--<provider>-color: #hexcolor;`
- Add icon class: `.<provider>-color { background-color: var(--<provider>-color); }`
- Add message accent: `.message.<provider> .message-bubble { border-left: 3px solid var(--<provider>-color); }`

### 6. `chat.js`
- Add the new agent to the `agents` object:
  ```javascript
  const agents = {
      // ... existing agents
      'ProviderName': document.getElementById('agent-<provider>')
  };
  ```
- Add handling for the new mode in `handleSend()` if it has a single-agent option
- Update mode select change handler if needed

## Verification
1. Load the updated extension in `chrome://extensions`
2. Log into the new AI provider in a browser tab
3. Test Single Agent mode → verify prompt injection and response capture
4. Test Broadcast mode → verify the new provider receives context from others
5. Check DevTools console on the provider's tab for `[AIBridge]` logs
