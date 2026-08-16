// AI Web UI Bridge - Background Service Worker

let chatTabId = null;

const SYSTEM_INSTRUCTION = `[SYSTEM INSTRUCTION: You are participating in a multi-AI roundtable discussion with other AI models. Keep your response concise, conversational, and direct (under 150 words). Do not output massive blocks of text. Acknowledge points made by others if provided, and build upon them or critique them briefly.]`;

const AI_CONFIG = {
  chatgpt: { searchPrefix: 'https://chatgpt.com', newChatUrl: 'https://chatgpt.com/' },
  claude:  { searchPrefix: 'https://claude.ai',   newChatUrl: 'https://claude.ai/new' },
  gemini:  { searchPrefix: 'https://gemini.google.com', newChatUrl: 'https://gemini.google.com/app' }
};

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }, 30000);

    function listener(tId, info) {
      if (tId === tabId && info.status === 'complete') {
        if (!resolved) {
          resolved = true;
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          setTimeout(() => resolve(), 2500);
        }
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function getAiTabReady(aiKey) {
  const config = AI_CONFIG[aiKey];
  const tabs = await chrome.tabs.query({});
  let targetTab = tabs.find(t => t.url && t.url.startsWith(config.searchPrefix));
  let tabId;

  if (targetTab) {
    tabId = targetTab.id;
    console.log(`[${aiKey}] Found existing tab ${tabId}. Checking readiness...`);
    const isAlive = await pingTab(tabId);
    if (!isAlive) {
      console.log(`[${aiKey}] Tab exists but script not responding, reloading...`);
      await chrome.tabs.reload(tabId);
      await waitForTabLoad(tabId);
    }
  } else {
    console.log(`[${aiKey}] No tab found, opening new one in background...`);
    const newTab = await chrome.tabs.create({ url: config.newChatUrl, active: false });
    tabId = newTab.id;
    await waitForTabLoad(tabId);
  }

  await ensureContentScriptReady(tabId, aiKey);
  return tabId;
}

async function pingTab(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (res) => {
        if (chrome.runtime.lastError || !res) resolve(false);
        else resolve(true);
      });
    } catch (e) { resolve(false); }
  });
}

async function ensureContentScriptReady(tabId, label) {
  let alive = await pingTab(tabId);
  if (alive) { console.log(`[${label}] Content script is active.`); return; }

  console.log(`[${label}] Content script not responding. Reloading tab...`);
  await chrome.tabs.reload(tabId);
  await waitForTabLoad(tabId);

  for (let i = 0; i < 6; i++) {
    alive = await pingTab(tabId);
    if (alive) { console.log(`[${label}] Alive after reload (attempt ${i+1}).`); return; }
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error(`Could not connect to ${label}. Please make sure you are logged into ${label} in your browser.`);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (chatTabId) {
    try { await chrome.tabs.update(chatTabId, { active: true }); return; }
    catch (e) { chatTabId = null; }
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
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res) return reject(new Error('No response returned from content script.'));
      resolve(res);
    });
  });
}

async function handleSingleAgent(agentKey, prompt) {
  try {
    const agentName = agentKey === 'chatgpt' ? 'ChatGPT' : (agentKey === 'claude' ? 'Claude' : 'Gemini');
    sendUiUpdate({ status: `Connecting to ${agentName}...`, currentAgent: agentName });
    
    const tabId = await getAiTabReady(agentKey);
    sendUiUpdate({ status: `Sending prompt to ${agentName}...`, currentAgent: agentName });
    
    const response = await sendPromptWithTabSwitch(tabId, prompt, agentName);
    console.log(`[${agentName}] Response received:`, response);
    
    sendUiUpdate({ 
      status: `${agentName} responded.`, 
      currentAgent: agentName, 
      text: response.text 
    });
    sendUiUpdate({ status: 'Idle', currentAgent: null });
  } catch (error) {
    console.error(`[${agentKey}] Error:`, error);
    if (chatTabId) {
      try { await chrome.tabs.update(chatTabId, { active: true }); } catch (e) {}
    }
    const errorMsg = (error && error.message) ? error.message : String(error);
    sendUiUpdate({ status: `Error: ${errorMsg}`, currentAgent: null });
  }
}

// Helper: activate AI tab, send prompt, switch back to extension
async function sendPromptWithTabSwitch(tabId, prompt, agentName) {
  const savedExtTabId = chatTabId;
  try {
    await chrome.tabs.update(tabId, { active: true });
    await new Promise(r => setTimeout(r, 500));
  } catch (e) {
    console.warn(`[${agentName}] Could not activate tab:`, e.message);
  }

  const response = await sendPromptToTab(tabId, prompt);

  if (savedExtTabId) {
    try { await chrome.tabs.update(savedExtTabId, { active: true }); } catch (e) {}
  }
  return response;
}

async function handleBroadcast(initialPrompt) {
  try {
    sendUiUpdate({ status: 'Preparing AI tabs...' });
    const gptTabId = await getAiTabReady('chatgpt');
    
    // Turn 1: ChatGPT
    sendUiUpdate({ status: 'Sending to ChatGPT...', currentAgent: 'ChatGPT' });
    const gptPrompt = `${SYSTEM_INSTRUCTION}\n\nUser Prompt: ${initialPrompt}`;
    const gptResponse = await sendPromptWithTabSwitch(gptTabId, gptPrompt, 'ChatGPT');
    console.log('[ChatGPT] Response:', gptResponse);
    sendUiUpdate({ status: 'ChatGPT finished.', currentAgent: 'ChatGPT', text: gptResponse.text });

    // Turn 2: Claude
    try {
      const claudeTabId = await getAiTabReady('claude');
      sendUiUpdate({ status: 'Sending to Claude...', currentAgent: 'Claude' });
      const claudePrompt = `${SYSTEM_INSTRUCTION}\n\nThe user asked: "${initialPrompt}"\nChatGPT responded: "${gptResponse.text}"\nWhat is your perspective on this?`;
      const claudeResponse = await sendPromptWithTabSwitch(claudeTabId, claudePrompt, 'Claude');
      console.log('[Claude] Response:', claudeResponse);
      sendUiUpdate({ status: 'Claude finished.', currentAgent: 'Claude', text: claudeResponse.text });

      // Turn 3: Gemini
      try {
        const geminiTabId = await getAiTabReady('gemini');
        sendUiUpdate({ status: 'Sending to Gemini...', currentAgent: 'Gemini' });
        const geminiPrompt = `${SYSTEM_INSTRUCTION}\n\nUser asked: "${initialPrompt}"\nChatGPT said: "${gptResponse.text}"\nClaude said: "${claudeResponse.text}"\nProvide a final synthesis or concluding thoughts.`;
        const geminiResponse = await sendPromptWithTabSwitch(geminiTabId, geminiPrompt, 'Gemini');
        console.log('[Gemini] Response:', geminiResponse);
        sendUiUpdate({ status: 'Round complete.', currentAgent: 'Gemini', text: geminiResponse.text });
      } catch (geminiErr) {
        console.error('Gemini turn error:', geminiErr);
        sendUiUpdate({ status: `Gemini turn skipped: ${geminiErr.message}`, currentAgent: 'Gemini', text: `(Gemini unavailable: ${geminiErr.message})` });
      }
    } catch (claudeErr) {
      console.error('Claude turn error:', claudeErr);
      sendUiUpdate({ status: `Claude turn skipped: ${claudeErr.message}`, currentAgent: 'Claude', text: `(Claude unavailable: ${claudeErr.message})` });
    }

    sendUiUpdate({ status: 'Idle', currentAgent: null });

  } catch (error) {
    console.error('Broadcast Error:', error);
    if (chatTabId) {
      try { await chrome.tabs.update(chatTabId, { active: true }); } catch (e) {}
    }
    let errorMsg = (error && error.message) ? error.message : String(error);
    sendUiUpdate({ status: `Error: ${errorMsg}`, currentAgent: null });
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_BROADCAST') {
    if (sender.tab && sender.tab.id) chatTabId = sender.tab.id;
    handleBroadcast(request.prompt);
    sendResponse({ status: 'started' });
  } else if (request.type === 'START_SINGLE_AGENT') {
    if (sender.tab && sender.tab.id) chatTabId = sender.tab.id;
    handleSingleAgent(request.agent || 'chatgpt', request.prompt);
    sendResponse({ status: 'started' });
  }
  return true;
});

