---
name: chrome-extension-debugging
description: >-
  Use this skill when debugging Chrome extension issues including message passing
  failures, content script injection problems, service worker errors, tab lifecycle
  issues, or Side Panel rendering bugs.
---

# Chrome Extension Debugging Guide

## Understanding the Three Contexts

This extension has three isolated JavaScript contexts. Bugs often stem from
confusing which context code runs in.

### 1. Service Worker (`background.js`)
- **DevTools**: Go to `chrome://extensions` → find "AI Web UI Bridge" → click "Service Worker"
- **Has access to**: `chrome.tabs`, `chrome.runtime`, `chrome.sidePanel`, `chrome.storage`
- **Does NOT have**: DOM access, `document`, `window` (beyond ServiceWorkerGlobalScope)
- **Common bugs**: Tab not found, message not delivered, service worker goes idle

### 2. Side Panel (`chat.html`, `chat.js`, `chat.css`)
- **DevTools**: Right-click inside the Side Panel → "Inspect"
- **Has access to**: Its own DOM, `chrome.runtime.sendMessage`, `chrome.runtime.onMessage`
- **Does NOT have**: `chrome.tabs` API, access to any web page DOM
- **Common bugs**: UI not updating, messages not received, event listeners lost

### 3. Content Scripts (`content/*.js`)
- **DevTools**: Open DevTools on the AI website tab (ChatGPT/Claude/Gemini)
- **Has access to**: The web page DOM, `chrome.runtime.sendMessage`, `chrome.runtime.onMessage`
- **Does NOT have**: `chrome.tabs` API, access to other tabs, access to Side Panel DOM
- **Common bugs**: Element not found, input simulation fails, response not captured

## Debugging Steps

### Message Passing Issues
1. Add `console.log` at the sender with the message type
2. Add `console.log` at the receiver's `onMessage` listener
3. Check if `chrome.runtime.lastError` has an error
4. Ensure the `onMessage` listener returns `true` for async responses

### Content Script Not Injecting
1. Check `manifest.json` → `content_scripts` → `matches` patterns
2. Verify the URL matches the pattern (watch for subdomain changes)
3. Check if the page loads in an iframe (content scripts don't inject into iframes by default)
4. Try reloading the extension at `chrome://extensions`

### Service Worker Going Idle
- MV3 service workers can go idle after ~30 seconds of inactivity
- Long-running operations (like Broadcast mode) should complete within the timeout
- If the worker dies mid-broadcast, the chain breaks silently

## Testing Checklist
1. Load extension unpacked: `chrome://extensions` → Developer Mode → Load Unpacked
2. After code changes: Click the refresh icon on the extension card
3. After manifest changes: Remove and re-load the extension
4. Check all three DevTools consoles for errors
