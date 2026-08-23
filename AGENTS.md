# AI Web UI Bridge — Agent Instructions

## Project Overview

This is a **Chrome Extension (Manifest V3)** that provides a unified side panel chat
interface to orchestrate ChatGPT, Claude, and Gemini — without API keys. It automates
the web UIs of these AI services by injecting prompts via content scripts and scraping
responses from the DOM.

**Zero dependencies** — No npm, no build tools, no bundlers. Pure vanilla JavaScript.

## Architecture

```
Side Panel UI          Background Service Worker       Content Scripts (per AI tab)
(chat.html/js/css) --> (background.js)            --> content/shared.js + chatgpt.js
                       Tab lifecycle & orchestration    content/shared.js + claude.js
                       Message routing (UI_UPDATE)      content/shared.js + gemini.js
```

### Message Flow
1. User types prompt in Side Panel → `chat.js` sends `START_SINGLE_AGENT` or `START_BROADCAST`
2. `background.js` finds/creates AI tabs, ensures content scripts are alive via `PING`
3. `background.js` sends `INJECT_PROMPT` to the correct content script
4. Content script injects text into the AI's input field, clicks Send, polls for response
5. Content script responds with extracted text → `background.js` sends `UI_UPDATE` back to Side Panel

### Key Contexts (Chrome Extension)
- **Side Panel context**: `chat.html`, `chat.js`, `chat.css` — UI only, no DOM access to AI tabs
- **Service Worker context**: `background.js` — No DOM access at all, orchestration only
- **Content Script context**: `content/*.js` — Has DOM access to the AI website it's injected into

> **IMPORTANT:**
> Content scripts CANNOT access chrome.tabs API. Background scripts CANNOT access page DOM.
> All cross-context communication uses `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`.

## File Reference

| File | Context | Purpose |
|------|---------|---------|
| `manifest.json` | Config | Extension permissions, content script injection rules, side panel config |
| `background.js` | Service Worker | Tab management, broadcast orchestration, message routing |
| `chat.html` | Side Panel | UI layout (sidebar with agent status, main chat area) |
| `chat.css` | Side Panel | Dark theme styling, per-agent accent colors |
| `chat.js` | Side Panel | User input handling, message rendering, status updates |
| `content/shared.js` | Content Script | `window.AIBridgeUtils` — shared DOM automation utilities |
| `content/chatgpt.js` | Content Script | ChatGPT-specific selectors, text extraction, response polling |
| `content/claude.js` | Content Script | Claude-specific selectors, text extraction, response polling |
| `content/gemini.js` | Content Script | Gemini-specific selectors, text extraction, response polling |

## Critical Patterns — MUST Follow

### 1. Selector Arrays Are Ordered by Specificity
Each content script has `INPUT_SELECTORS`, `SEND_BUTTON_SELECTORS`, and `STOP_BUTTON_SELECTORS`.
These arrays go from **most specific** (data-testid) to **most general** (tag name).
- ALWAYS add new selectors at the TOP of the array (most specific first)
- NEVER remove old selectors — they serve as fallbacks for older UI versions
- ALWAYS use `data-testid` or `aria-label` attributes when available

### 2. Input Simulation Strategy
The `simulateInput()` function in `shared.js` handles two editor types:
- **ContentEditable** (ProseMirror for ChatGPT/Claude, Quill for Gemini):
  1. Clear innerHTML → dispatch input event
  2. Try `document.execCommand('insertText')` via Selection API
  3. Verify text was inserted; if not, fallback to DOM paragraph creation
  4. Dispatch `beforeinput`, `input` (with InputEvent data field), `change`, `focus`
- **Standard textarea/input**: Use prototype value setter + dispatch events

> **WARNING:**
> Never use `element.value = text` on contenteditable elements.
> Never use `element.innerHTML = text` without also dispatching framework events.
> ProseMirror/Quill will NOT see changes unless proper InputEvent events are fired.

### 3. Response Polling Pattern
All three content scripts use the same polling pattern:
```
1. Snapshot: Count assistant turns + capture latest text BEFORE sending
2. Send prompt (inject text + click send button)
3. Poll every 350-400ms:
   a. Check isGenerating() (stop button / streaming indicator present?)
   b. Count current assistant turns
   c. Extract latest assistant text
   d. Is it NEW? (turn count increased OR text changed from snapshot)
   e. Is it STABLE? (same text for 2 consecutive polls when not generating)
   f. Send STREAM_UPDATE to extension for live preview
4. Resolve when: not generating AND text stable for 2 polls (or 1 poll after >2.5s)
```

> **CAUTION:**
> When fixing response extraction bugs:
> - The issue is almost always in `getLatestAssistantText()` or `extractText()` or the CSS selectors
> - Test by checking if `getAssistantTurnCount()` increments after sending
> - If turn count increases but text is empty → selector for the content container is wrong
> - If turn count does NOT increase → the turn-counting selector is wrong
> - If text is captured but includes junk → update the `cleanText()` junk filter set

### 4. Text Extraction & Cleaning
Each content script's `extractText()` function:
1. Clone the element (never modify live DOM)
2. Remove non-content elements (buttons, SVGs, nav, action bars)
3. Extract `textContent` (NOT `innerText` — `textContent` works in background tabs)
4. Pass through `cleanText()` which filters out:
   - UI disclaimer strings ("ChatGPT can make mistakes", etc.)
   - System prompt echoes ("[SYSTEM INSTRUCTION...")
   - Previous conversation context lines ("The user asked:", "ChatGPT responded:")
   - Intermediary states ("Thinking...", "Searching the web")

### 5. Tab Lifecycle
- `getAiTabReady(aiKey)`: Find existing tab OR create new pinned background tab
- `ensureContentScriptReady(tabId)`: Ping → reload if needed → retry up to 6 times
- `sendPromptWithTabSwitch(tabId, prompt)`: Activate tab before injection (needed for execCommand)

## Common Bug Categories & How to Fix

### "Response not captured" / Empty response
1. Open DevTools on the AI tab (not the Side Panel)
2. Check console for `[AIBridge]` and `[ChatGPT/Claude/Gemini Poll]` logs
3. If polling shows `textLen: 0` and `isNew: false` → the extraction selectors are stale
4. Inspect the AI's DOM for the response container element
5. Add the new selector to the appropriate array in the content script

### "Prompt not sent" / Stuck on "Sending to..."
1. Check if the input element selector still matches (`INPUT_SELECTORS`)
2. Check if `simulateInput` logs show the text was inserted
3. Check if `findSendButton` returns a button (or if it's disabled/hidden)
4. If the AI site changed their send button, add the new selector

### "Content script not responding" / "Could not connect"
1. The AI site may have changed their URL structure
2. Check `manifest.json` host_permissions and content_scripts matches
3. Ensure the user is logged into the AI service

## Code Style
- Vanilla JavaScript ES6+ (no TypeScript, no modules, no imports)
- IIFEs for content scripts: `(function() { ... })();`
- Console logging with prefix tags: `[AIBridge]`, `[ChatGPT]`, `[Claude]`, `[Gemini]`
- No npm packages or build steps — test by loading unpacked in chrome://extensions
- CSS uses `:root` variables for theming (dark mode only)

## Testing
1. Load the extension unpacked via `chrome://extensions` (Developer Mode ON)
2. Open Side Panel and test Single Agent mode with ChatGPT
3. Test Broadcast mode (needs ChatGPT, Claude, and Gemini tabs logged in)
4. Check DevTools console on each AI tab for `[AIBridge]` logs
5. Check Side Panel DevTools for `[UI_UPDATE]` message logs
