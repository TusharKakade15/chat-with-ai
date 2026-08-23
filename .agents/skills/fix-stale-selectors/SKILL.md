---
name: fix-stale-selectors
description: >-
  Use this skill when a content script fails to find elements on ChatGPT, Claude,
  or Gemini — typically manifesting as "Response not captured", empty responses,
  "Prompt not sent", or timeout errors. Guides the agent through diagnosing and
  fixing stale CSS selectors.
---

# Fix Stale DOM Selectors

When AI websites update their UI, our CSS selectors break. Follow these steps:

## Step 1: Identify Which AI Site Is Broken
- Check the error message or user report
- Look at the content script logs for the failing site:
  - `[ChatGPT Poll]` logs → problem in `content/chatgpt.js`
  - `[Claude Poll]` logs → problem in `content/claude.js`
  - `[Gemini Poll]` logs → problem in `content/gemini.js`

## Step 2: Determine the Failure Type
- **Input not found**: `INPUT_SELECTORS` array needs updating
- **Send button not found/disabled**: `SEND_BUTTON_SELECTORS` needs updating
- **Response text empty**: `getLatestAssistantText()` selectors or `extractText()` selectors need updating
- **Turn count not incrementing**: `getAssistantTurnCount()` selectors need updating
- **Stop button detection wrong**: `STOP_BUTTON_SELECTORS` needs updating

## Step 3: Find the New Selectors
Look at the AI website's current DOM structure. The key elements to identify:

### For ChatGPT (`content/chatgpt.js`):
- Input: Look for `#prompt-textarea` or contenteditable div inside the composer
- Send: Look for button with `data-testid` containing "send" or `aria-label` containing "Send"
- Response: Look for `[data-message-author-role="assistant"]` containers
- Content: Look for `.markdown` or `.prose` inside response containers

### For Claude (`content/claude.js`):
- Input: Look for `ProseMirror` contenteditable div
- Send: Look for button with `aria-label="Send Message"`
- Response: Look for `.font-claude-response`, `.standard-markdown`, `[data-is-streaming]`
- Content: Look for `.standard-markdown` or `.progressive-markdown` blocks

### For Gemini (`content/gemini.js`):
- Input: Look for `rich-textarea` with contenteditable, or `.ql-editor`
- Send: Look for button with `aria-label` containing "Send"
- Response: Look for `model-response` custom element or `.model-response`
- Content: Look for `.model-response-text` or markdown containers
- Streaming: Look for `mat-progress-spinner`, `.sparkle-container.animating`

## Step 4: Update the Selector Arrays
- Add new selectors at the **TOP** of the array (most specific first)
- Keep old selectors as fallbacks (do NOT remove them)
- Use `data-testid` or `aria-label` attributes when available
- Test with: Load extension → open AI site → send a test prompt

## Step 5: Update `cleanText()` if Needed
If new UI text appears in extracted responses (disclaimers, button labels, etc.):
- Add the exact string to the `junkExact` Set in the relevant content script's `cleanText()`
- Or add a pattern filter if the junk is dynamic

## Step 6: Update `extractText()` if Needed
If new DOM elements appear inside response containers that shouldn't be scraped:
- Add the selector to the `querySelectorAll().forEach(n => n.remove())` call in `extractText()`
