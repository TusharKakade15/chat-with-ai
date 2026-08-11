// AI Web UI Bridge - Background Service Worker

let chatTabId = null;

const SYSTEM_INSTRUCTION = `[SYSTEM INSTRUCTION: You are participating in a multi-AI roundtable discussion with other AI models. Keep your response concise, conversational, and direct (under 150 words). Do not output massive blocks of text. Acknowledge points made by others if provided, and build upon them or critique them briefly.]`;

// New chat URLs for each AI
const AI_CONFIG = {
  chatgpt: {
    searchPrefix: 'https://chatgpt.com',
    newChatUrl: 'https://chatgpt.com/',
  },
  claude: {
    searchPrefix: 'https://claude.ai',
    newChatUrl: 'https://claude.ai/new',
  },
  gemini: {
    searchPrefix: 'https://gemini.google.com',
    newChatUrl: 'https://gemini.google.com/app',
  }
};

// Helper to wait for a specific tab to be fully loaded
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30000);

    function listener(tId, info) {
      if (tId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        setTimeout(() => resolve(), 3000);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Find or create a tab for an AI service, then navigate to a NEW chat
async function getAiTabReady(aiKey) {
  const config = AI_CONFIG[aiKey];
  const tabs = await chrome.tabs.query({});
  let targetTab = tabs.find(t => t.url && t.url.startsWith(config.searchPrefix));

  let tabId;
  if (targetTab) {
    tabId = targetTab.id;
    // Navigate to new chat page (even if tab exists, we want a fresh conversation)
    console.log(`[${aiKey}] Found existing tab ${tabId}, navigating to new chat...`);
    await chrome.tabs.update(tabId, { url: config.newChatUrl });
    await waitForTabLoad(tabId);
  } else {
    console.log(`[${aiKey}] No tab found, opening new one...`);
    const newTab = await chrome.tabs.create({ url: config.newChatUrl, active: false });
    tabId = newTab.id;
    await waitForTabLoad(tabId);
  }

  // Ensure content script is alive
  await ensureContentScriptReady(tabId, aiKey);
  return tabId;
}

// Try to PING a tab
async function pingTab(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (res) => {
        if (chrome.runtime.lastError) {
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

// Ensure content scripts are alive, reload if needed
async function ensureContentScriptReady(tabId, label) {
  let alive = await pingTab(tabId);
  if (alive) {
    console.log(`[${label}] Content script alive.`);
    return;
  }

  console.log(`[${label}] Content script not found. Reloading tab...`);
  await chrome.tabs.reload(tabId);
  await waitForTabLoad(tabId);

  for (let i = 0; i < 5; i++) {
    alive = await pingTab(tabId);
    if (alive) {
      console.log(`[${label}] Content script alive after reload (attempt ${i + 1}).`);
      return;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  throw new Error(`Could not connect to ${label} tab. Please make sure you are logged in.`);
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

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === chatTabId) chatTabId = null;
});

function sendUiUpdate(update) {
  if (chatTabId) {
    chrome.tabs.sendMessage(chatTabId, { type: 'UI_UPDATE', ...update }).catch(() => {});
  }
}

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
    // Step 1: Get all AI tabs ready (navigate to new chat)
    sendUiUpdate({ status: 'Opening fresh ChatGPT chat...', currentAgent: 'ChatGPT' });
    const gptTabId = await getAiTabReady('chatgpt');

    sendUiUpdate({ status: 'Opening fresh Claude chat...', currentAgent: 'Claude' });
    const claudeTabId = await getAiTabReady('claude');

    sendUiUpdate({ status: 'Opening fresh Gemini chat...', currentAgent: 'Gemini' });
    const geminiTabId = await getAiTabReady('gemini');

    console.log('All tabs ready:', { gptTabId, claudeTabId, geminiTabId });

    // Turn 1: ChatGPT
    sendUiUpdate({ status: 'Sending to ChatGPT...', currentAgent: 'ChatGPT' });
    const gptPrompt = `${SYSTEM_INSTRUCTION}\n\nUser Prompt: ${initialPrompt}`;
    const gptResponse = await sendPromptToTab(gptTabId, gptPrompt);
    console.log('[ChatGPT] Response:', gptResponse);
    sendUiUpdate({ status: 'ChatGPT finished.', currentAgent: 'ChatGPT', text: gptResponse.text });

    // Turn 2: Claude
    sendUiUpdate({ status: 'Sending to Claude...', currentAgent: 'Claude' });
    const claudePrompt = `${SYSTEM_INSTRUCTION}\n\nThe user asked: "${initialPrompt}"\nChatGPT responded: "${gptResponse.text}"\nWhat is your perspective on this?`;
    const claudeResponse = await sendPromptToTab(claudeTabId, claudePrompt);
    console.log('[Claude] Response:', claudeResponse);
    sendUiUpdate({ status: 'Claude finished.', currentAgent: 'Claude', text: claudeResponse.text });

    // Turn 3: Gemini
    sendUiUpdate({ status: 'Sending to Gemini...', currentAgent: 'Gemini' });
    const geminiPrompt = `${SYSTEM_INSTRUCTION}\n\nUser asked: "${initialPrompt}"\nChatGPT said: "${gptResponse.text}"\nClaude said: "${claudeResponse.text}"\nProvide a final synthesis or concluding thoughts.`;
    const geminiResponse = await sendPromptToTab(geminiTabId, geminiPrompt);
    console.log('[Gemini] Response:', geminiResponse);
    sendUiUpdate({ status: 'Round complete.', currentAgent: 'Gemini', text: geminiResponse.text });

    sendUiUpdate({ status: 'Idle', currentAgent: null });

  } catch (error) {
    console.error('Broadcast Error:', error);
    let errorMsg = (error && error.message) ? error.message : String(error);
    sendUiUpdate({ status: `Error: ${errorMsg}`, currentAgent: null });
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_BROADCAST') {
    if (sender.tab && sender.tab.id) {
      chatTabId = sender.tab.id;
    }
    handleBroadcast(request.prompt);
    sendResponse({ status: 'started' });
  }
  return true;
});
