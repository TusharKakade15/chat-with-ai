// AI Web UI Bridge - Background Service Worker

let chatTabId = null;

// Flat conversation log — each AI gets only the last 3 entries (sliding window)
let conversationLog = [];
let currentRoundNumber = 0;

const DEFAULT_SYSTEM_INSTRUCTION = `[SYSTEM INSTRUCTION: You are participating in a multi-AI roundtable discussion with other AI models. Keep your response concise, conversational, and direct (under 150 words). Do not output massive blocks of text. Acknowledge points made by others if provided, and build upon them or critique them briefly.]`;
const DEFAULT_TURN_PROMPT = `What is your perspective? Respond conversationally.`;

let customSystemInstruction = DEFAULT_SYSTEM_INSTRUCTION;
let customTurnPrompt = DEFAULT_TURN_PROMPT;

// Load stored custom prompts if present
if (chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(['systemInstruction', 'turnPrompt'], (res) => {
    if (res.systemInstruction) customSystemInstruction = res.systemInstruction;
    if (res.turnPrompt) customTurnPrompt = res.turnPrompt;
  });

  // Listen for real-time storage updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.systemInstruction) customSystemInstruction = changes.systemInstruction.newValue || DEFAULT_SYSTEM_INSTRUCTION;
      if (changes.turnPrompt) customTurnPrompt = changes.turnPrompt.newValue || DEFAULT_TURN_PROMPT;
    }
  });
}

const AI_CONFIG = {
  chatgpt: { searchPrefix: 'https://chatgpt.com', newChatUrl: 'https://chatgpt.com/' },
  claude:  { searchPrefix: 'https://claude.ai',   newChatUrl: 'https://claude.ai/new' },
  gemini:  { searchPrefix: 'https://gemini.google.com', newChatUrl: 'https://gemini.google.com/app' }
};

// ─── Side Panel Behavior ──────────────────────────────────────────────
// Top-level: runs every time the service worker starts (not just on install)
if (chrome.sidePanel) {
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionIconClick: true }).catch(() => {});
  } catch (e) {
    console.warn('[AIBridge] SidePanel behavior setting failed:', e.message);
  }
}

// Fallback: if setPanelBehavior doesn't take effect, explicitly open on click
chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

// ─── Tab Lifecycle ────────────────────────────────────────────────────

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
    const newTab = await chrome.tabs.create({ url: config.newChatUrl, active: false, pinned: true });
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

// ─── Messaging Helpers ────────────────────────────────────────────────

function sendUiUpdate(update) {
  chrome.runtime.sendMessage({ type: 'UI_UPDATE', ...update }).catch(() => {});
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

// Helper: activate AI tab, send prompt
async function sendPromptWithTabSwitch(tabId, prompt, agentName) {
  try {
    await chrome.tabs.update(tabId, { active: true });
    await new Promise(r => setTimeout(r, 500));
  } catch (e) {
    console.warn(`[${agentName}] Could not activate tab:`, e.message);
  }
  return await sendPromptToTab(tabId, prompt);
}

// ─── Sliding Window Context ──────────────────────────────────────────
// Each AI gets only the last 3 entries from the conversation log.
// This keeps prompts short and avoids sending the whole history repeatedly.

function getLastNEntries(n) {
  return conversationLog.slice(-n);
}

function formatSlidingContext(entries) {
  if (entries.length === 0) return '';

  let formatted = '\n\nRecent conversation:';
  for (const entry of entries) {
    formatted += `\n- ${entry.agent}: "${entry.text}"`;
  }
  return formatted;
}

// ─── Single Agent Mode ────────────────────────────────────────────────

async function handleSingleAgent(agentKey, prompt) {
  try {
    const agentName = agentKey === 'chatgpt' ? 'ChatGPT' : (agentKey === 'claude' ? 'Claude' : 'Gemini');
    sendUiUpdate({ status: `Connecting to ${agentName}...`, currentAgent: agentName });
    
    const tabId = await getAiTabReady(agentKey);
    sendUiUpdate({ status: `Sending prompt to ${agentName}...`, currentAgent: agentName });
    
    const response = await sendPromptWithTabSwitch(tabId, prompt, agentName);
    console.log(`[${agentName}] Response received:`, response);
    
    // Send final response with done flag — textfield re-enables immediately
    sendUiUpdate({ 
      status: `${agentName} responded.`, 
      currentAgent: agentName, 
      text: response.text,
      done: true
    });
  } catch (error) {
    console.error(`[${agentKey}] Error:`, error);
    const errorMsg = (error && error.message) ? error.message : String(error);
    sendUiUpdate({ status: `Error: ${errorMsg}`, currentAgent: null, done: true });
  }
}

// ─── Broadcast Mode (Roundtable) ──────────────────────────────────────

async function handleBroadcast(initialPrompt) {
  // Reset for a fresh broadcast
  conversationLog = [];
  currentRoundNumber = 0;

  // Add the user's prompt to the log
  conversationLog.push({ agent: 'User', text: initialPrompt.trim() });

  await executeRound();
}

async function handleContinueBroadcast(log, userInput) {
  // Restore log from the Side Panel's copy
  conversationLog = log || [];

  // Determine current round number from log
  currentRoundNumber = 0;
  for (const entry of conversationLog) {
    if (entry.round && entry.round > currentRoundNumber) currentRoundNumber = entry.round;
  }

  // Always add a user entry between rounds so the sliding window includes it
  if (userInput && userInput.trim()) {
    conversationLog.push({ agent: 'User', text: userInput.trim() });
  } else {
    conversationLog.push({ agent: 'User', text: 'Continue the discussion.' });
  }

  await executeRound();
}

async function executeRound() {
  currentRoundNumber++;
  const roundNum = currentRoundNumber;

  try {
    sendUiUpdate({ status: 'Preparing AI tabs...', roundNumber: roundNum });

    // ── Turn 1: ChatGPT ──
    // ChatGPT gets the last 3 entries from the conversation log
    const gptTabId = await getAiTabReady('chatgpt');
    sendUiUpdate({ status: 'Sending to ChatGPT...', currentAgent: 'ChatGPT' });

    const gptContext = formatSlidingContext(getLastNEntries(3));
    const gptPrompt = `${customSystemInstruction}${gptContext}\n\n${customTurnPrompt}`;

    const gptResponse = await sendPromptWithTabSwitch(gptTabId, gptPrompt, 'ChatGPT');
    console.log('[ChatGPT] Response:', gptResponse);
    sendUiUpdate({ status: 'ChatGPT finished.', currentAgent: 'ChatGPT', text: gptResponse.text });

    conversationLog.push({ agent: 'ChatGPT', text: gptResponse.text, round: roundNum });

    // ── Turn 2: Claude ──
    // Claude gets the last 3 entries (which now includes ChatGPT's response)
    const claudeTabId = await getAiTabReady('claude');
    sendUiUpdate({ status: 'Sending to Claude...', currentAgent: 'Claude' });

    const claudeContext = formatSlidingContext(getLastNEntries(3));
    const claudePrompt = `${customSystemInstruction}${claudeContext}\n\n${customTurnPrompt}`;

    let claudeResponseText;
    try {
      const claudeResponse = await sendPromptWithTabSwitch(claudeTabId, claudePrompt, 'Claude');
      console.log('[Claude] Response:', claudeResponse);
      sendUiUpdate({ status: 'Claude finished.', currentAgent: 'Claude', text: claudeResponse.text });

      claudeResponseText = claudeResponse.text;
      conversationLog.push({ agent: 'Claude', text: claudeResponse.text, round: roundNum });
    } catch (claudeErr) {
      console.error('Claude turn error:', claudeErr);
      claudeResponseText = `(Claude unavailable: ${claudeErr.message})`;
      sendUiUpdate({ status: `Claude turn skipped: ${claudeErr.message}`, currentAgent: 'Claude', text: claudeResponseText });
      conversationLog.push({ agent: 'Claude', text: claudeResponseText, round: roundNum });
    }

    // ── Turn 3: Gemini ──
    // Gemini gets the last 3 entries (which now includes Claude's response)
    // Gemini is an EQUAL participant, not just for synthesis
    const geminiTabId = await getAiTabReady('gemini');
    sendUiUpdate({ status: 'Sending to Gemini...', currentAgent: 'Gemini' });

    const geminiContext = formatSlidingContext(getLastNEntries(3));
    const geminiPrompt = `${customSystemInstruction}${geminiContext}\n\n${customTurnPrompt}`;

    try {
      const geminiResponse = await sendPromptWithTabSwitch(geminiTabId, geminiPrompt, 'Gemini');
      console.log('[Gemini] Response:', geminiResponse);

      conversationLog.push({ agent: 'Gemini', text: geminiResponse.text, round: roundNum });

      // Final message: round complete with done flag
      sendUiUpdate({
        status: `Round ${roundNum} complete.`,
        currentAgent: 'Gemini',
        text: geminiResponse.text,
        roundComplete: true,
        roundNumber: roundNum,
        conversationLog: conversationLog,
        done: true
      });
    } catch (geminiErr) {
      console.error('Gemini turn error:', geminiErr);
      const errText = `(Gemini unavailable: ${geminiErr.message})`;
      conversationLog.push({ agent: 'Gemini', text: errText, round: roundNum });

      sendUiUpdate({
        status: `Gemini turn skipped: ${geminiErr.message}`,
        currentAgent: 'Gemini',
        text: errText,
        roundComplete: true,
        roundNumber: roundNum,
        conversationLog: conversationLog,
        done: true
      });
    }

  } catch (error) {
    console.error('Broadcast Error:', error);
    let errorMsg = (error && error.message) ? error.message : String(error);
    sendUiUpdate({ status: `Error: ${errorMsg}`, currentAgent: null, done: true });
  }
}

// ─── Message Listener ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_BROADCAST') {
    if (sender.tab && sender.tab.id) chatTabId = sender.tab.id;
    handleBroadcast(request.prompt);
    sendResponse({ status: 'started' });
  } else if (request.type === 'START_SINGLE_AGENT') {
    if (sender.tab && sender.tab.id) chatTabId = sender.tab.id;
    handleSingleAgent(request.agent || 'chatgpt', request.prompt);
    sendResponse({ status: 'started' });
  } else if (request.type === 'CONTINUE_BROADCAST') {
    handleContinueBroadcast(request.conversationLog, null);
    sendResponse({ status: 'started' });
  } else if (request.type === 'CONTINUE_WITH_INPUT') {
    handleContinueBroadcast(request.conversationLog, request.prompt);
    sendResponse({ status: 'started' });
  }
  return true;
});
