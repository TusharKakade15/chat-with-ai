// AI Web UI Bridge - Background Service Worker

let chatTabId = null;

// The System Instruction to keep AI responses concise and aware of the multi-agent context
const SYSTEM_INSTRUCTION = `[SYSTEM INSTRUCTION: You are participating in a multi-AI roundtable discussion with other AI models. Keep your response concise, conversational, and direct (under 150 words). Do not output massive blocks of text. Acknowledge points made by others if provided, and build upon them or critique them briefly.]`;

// Helper to wait for a specific tab to be fully loaded
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // resolve anyway after timeout
    }, 30000);

    function listener(tId, info) {
      if (tId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        // Delay to allow SPA frameworks to initialize
        setTimeout(() => resolve(), 3000);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Helper to ensure a tab exists for a given URL and return its ID
async function ensureAiTab(urlStartsWith, exactUrlToOpen) {
  const tabs = await chrome.tabs.query({});
  let targetTab = tabs.find(t => t.url && t.url.startsWith(urlStartsWith));
  
  if (targetTab) {
    return targetTab.id;
  } else {
    const newTab = await chrome.tabs.create({ url: exactUrlToOpen, active: false });
    await waitForTabLoad(newTab.id);
    return newTab.id;
  }
}

// Try to PING a tab to see if content script is alive.
// Returns true if alive, false otherwise.
async function pingTab(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (res) => {
        if (chrome.runtime.lastError) {
          console.log('Ping failed for tab', tabId, chrome.runtime.lastError.message);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } catch (e) {
      resolve(false);
    }
  });
}

// Ensure content scripts are alive in a tab. 
// If not, RELOAD the tab (which triggers manifest content_scripts injection).
// This avoids chrome.scripting.executeScript which has permission issues.
async function ensureContentScriptReady(tabId, label) {
  let alive = await pingTab(tabId);
  if (alive) {
    console.log(`[${label}] Content script already alive.`);
    return;
  }

  console.log(`[${label}] Content script not found. Reloading tab...`);
  await chrome.tabs.reload(tabId);
  await waitForTabLoad(tabId);

  // Retry ping up to 5 times with delay
  for (let i = 0; i < 5; i++) {
    alive = await pingTab(tabId);
    if (alive) {
      console.log(`[${label}] Content script alive after reload (attempt ${i + 1}).`);
      return;
    }
    console.log(`[${label}] Ping retry ${i + 1}/5...`);
    await new Promise(r => setTimeout(r, 2000));
  }

  throw new Error(`Could not connect to ${label} tab even after reloading. Please make sure you are logged in and the page is fully loaded.`);
}

// When the extension icon is clicked, open the full-page chat UI
chrome.action.onClicked.addListener(async (tab) => {
  if (chatTabId) {
    try {
      await chrome.tabs.update(chatTabId, { active: true });
      return;
    } catch (e) {
      chatTabId = null;
    }
  }
  const newTab = await chrome.tabs.create({ url: 'chat.html' });
  chatTabId = newTab.id;
});

// Clean up chatTabId if the user closes it
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === chatTabId) {
    chatTabId = null;
  }
});

// Function to send update to the UI
function sendUiUpdate(update) {
  if (chatTabId) {
    chrome.tabs.sendMessage(chatTabId, { type: 'UI_UPDATE', ...update }).catch(() => {});
  }
}

// Send a prompt to a tab and wait for the scraped response
function sendPromptToTab(tabId, prompt) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'INJECT_PROMPT', prompt: prompt }, (res) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      resolve(res);
    });
  });
}

// Handle the Broadcast workflow
async function handleBroadcast(initialPrompt) {
  try {
    sendUiUpdate({ status: 'Finding AI tabs...' });
    
    // Ensure all tabs are open
    const gptTabId = await ensureAiTab('https://chatgpt.com', 'https://chatgpt.com/');
    const claudeTabId = await ensureAiTab('https://claude.ai', 'https://claude.ai/new');
    const geminiTabId = await ensureAiTab('https://gemini.google.com', 'https://gemini.google.com/app');

    console.log('Tab IDs:', { gptTabId, claudeTabId, geminiTabId });

    // Ensure content scripts are injected and alive in all tabs
    sendUiUpdate({ status: 'Connecting to AI tabs...' });
    await ensureContentScriptReady(gptTabId, 'ChatGPT');
    await ensureContentScriptReady(claudeTabId, 'Claude');
    await ensureContentScriptReady(geminiTabId, 'Gemini');

    // Turn 1: ChatGPT
    sendUiUpdate({ status: 'Waiting for ChatGPT...', currentAgent: 'ChatGPT' });
    const gptPrompt = `${SYSTEM_INSTRUCTION}\n\nUser Prompt: ${initialPrompt}`;
    const gptResponse = await sendPromptToTab(gptTabId, gptPrompt);
    sendUiUpdate({ status: 'ChatGPT finished.', currentAgent: 'ChatGPT', text: gptResponse.text });

    // Turn 2: Claude
    sendUiUpdate({ status: 'Waiting for Claude...', currentAgent: 'Claude' });
    const claudePrompt = `${SYSTEM_INSTRUCTION}\n\nThe user asked: "${initialPrompt}"\nChatGPT responded: "${gptResponse.text}"\nWhat is your perspective on this?`;
    const claudeResponse = await sendPromptToTab(claudeTabId, claudePrompt);
    sendUiUpdate({ status: 'Claude finished.', currentAgent: 'Claude', text: claudeResponse.text });

    // Turn 3: Gemini
    sendUiUpdate({ status: 'Waiting for Gemini...', currentAgent: 'Gemini' });
    const geminiPrompt = `${SYSTEM_INSTRUCTION}\n\nUser asked: "${initialPrompt}"\nChatGPT said: "${gptResponse.text}"\nClaude said: "${claudeResponse.text}"\nProvide a final synthesis or concluding thoughts on their responses.`;
    const geminiResponse = await sendPromptToTab(geminiTabId, geminiPrompt);
    sendUiUpdate({ status: 'Round complete.', currentAgent: 'Gemini', text: geminiResponse.text });

    sendUiUpdate({ status: 'Idle', currentAgent: null });

  } catch (error) {
    console.error('Broadcast Error:', error);
    let errorMsg = (error && error.message) ? error.message : String(error);
    sendUiUpdate({ status: `Error: ${errorMsg}`, currentAgent: null });
  }
}

// Listen for messages from the Chat UI
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_BROADCAST') {
    // Capture the chat UI tab ID
    if (sender.tab && sender.tab.id) {
      chatTabId = sender.tab.id;
    }
    handleBroadcast(request.prompt);
    sendResponse({ status: 'started' });
  }
  return true;
});
