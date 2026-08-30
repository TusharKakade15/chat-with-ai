// AI Web UI Bridge - Background Service Worker

let chatTabId = null;

// Flat conversation log — each AI gets only the last 3 entries (sliding window)
let conversationLog = [];
let currentRoundNumber = 0;

const PERSONAS = {
  user: {
    name: 'You',
    title: '',
    displayName: 'You'
  },
  chatgpt: {
    key: 'chatgpt',
    service: 'ChatGPT',
    name: 'Alex',
    title: '',
    displayName: 'Alex',
    rolePrompt: 'You are an expert analyst. Your tone is direct, objective, and highly structured. Prioritize actionable insights and avoid conversational filler.'
  },
  claude: {
    key: 'claude',
    service: 'Claude',
    name: 'Morgan',
    title: '',
    displayName: 'Morgan',
    rolePrompt: 'You are a seasoned editor and creative collaborator. Your responses should be nuanced, empathetic, and elegantly phrased. Focus on narrative flow and conceptual depth.'
  },
  gemini: {
    key: 'gemini',
    service: 'Gemini',
    name: 'Jordan',
    title: '',
    displayName: 'Jordan',
    rolePrompt: 'You are a comprehensive researcher. Pull from diverse disciplines, connect disparate concepts, and present information with clear citations and expansive context.'
  }
};

const DEFAULT_TURN_PROMPT = `Now respond.`;
const DEFAULT_MAX_CHARACTERS = 500;

let customMaxCharacters = DEFAULT_MAX_CHARACTERS;
let customTurnPrompt = DEFAULT_TURN_PROMPT;

function applyCustomPersonas(custom) {
  if (!custom) return;
  if (custom.user) {
    if (custom.user.name) PERSONAS.user.name = custom.user.name.replace(/\s*\([^)]*\)/g, '').trim() || 'You';
    PERSONAS.user.title = (custom.user.role || custom.user.title || '').replace(/\s*\([^)]*\)/g, '').trim();
    PERSONAS.user.displayName = PERSONAS.user.name;
  }
  if (custom.chatgpt || custom.ChatGPT) {
    const src = custom.chatgpt || custom.ChatGPT;
    if (src.name) PERSONAS.chatgpt.name = src.name.replace(/\s*\([^)]*\)/g, '').trim() || 'Alex';
    PERSONAS.chatgpt.title = '';
    PERSONAS.chatgpt.displayName = PERSONAS.chatgpt.name;
    if (src.rolePrompt !== undefined) {
      PERSONAS.chatgpt.rolePrompt = src.rolePrompt;
    }
  }
  if (custom.claude || custom.Claude) {
    const src = custom.claude || custom.Claude;
    if (src.name) PERSONAS.claude.name = src.name.replace(/\s*\([^)]*\)/g, '').trim() || 'Morgan';
    PERSONAS.claude.title = '';
    PERSONAS.claude.displayName = PERSONAS.claude.name;
    if (src.rolePrompt !== undefined) {
      PERSONAS.claude.rolePrompt = src.rolePrompt;
    }
  }
  if (custom.gemini || custom.Gemini) {
    const src = custom.gemini || custom.Gemini;
    if (src.name) PERSONAS.gemini.name = src.name.replace(/\s*\([^)]*\)/g, '').trim() || 'Jordan';
    PERSONAS.gemini.title = '';
    PERSONAS.gemini.displayName = PERSONAS.gemini.name;
    if (src.rolePrompt !== undefined) {
      PERSONAS.gemini.rolePrompt = src.rolePrompt;
    }
  }
  console.log('[AIBridge] Personas updated (parameter-friendly, no role suffixes):', JSON.stringify(PERSONAS, null, 2));
}

let enabledAgents = { chatgpt: true, claude: true, gemini: true };

const DEFAULT_RULES = `1. Contribute concisely from your designated perspective (under {limit} characters).
2. Jump straight into your analysis without generic introductions or conversational filler.
3. Address colleagues by name when building upon, questioning, or critiquing their points.
4. Wrap your exact response between [MESSAGE] and [/MESSAGE] tags.`;

let customRules = DEFAULT_RULES;

async function ensureSettingsLoaded() {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.local) return resolve();
    chrome.storage.local.get(['maxCharacters', 'turnPrompt', 'custom_personas', 'custom_rules', 'chat_conversation_log', 'chat_last_round', 'enabled_agents'], (res) => {
      if (res.maxCharacters) customMaxCharacters = res.maxCharacters;
      if (res.turnPrompt) customTurnPrompt = res.turnPrompt;
      if (res.custom_personas) applyCustomPersonas(res.custom_personas);
      if (res.custom_rules) customRules = res.custom_rules;
      if (res.enabled_agents) enabledAgents = { ...enabledAgents, ...res.enabled_agents };
      if (res.chat_conversation_log && Array.isArray(res.chat_conversation_log)) {
        conversationLog = res.chat_conversation_log;
      }
      if (res.chat_last_round !== undefined) {
        currentRoundNumber = res.chat_last_round;
      }
      resolve();
    });
  });
}

// Initial load on startup
ensureSettingsLoaded();

// Listen for real-time storage updates
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.maxCharacters) customMaxCharacters = changes.maxCharacters.newValue || DEFAULT_MAX_CHARACTERS;
      if (changes.turnPrompt) customTurnPrompt = changes.turnPrompt.newValue || DEFAULT_TURN_PROMPT;
      if (changes.custom_personas) applyCustomPersonas(changes.custom_personas.newValue);
      if (changes.custom_rules) customRules = changes.custom_rules.newValue || DEFAULT_RULES;
      if (changes.enabled_agents) enabledAgents = { ...enabledAgents, ...changes.enabled_agents.newValue };
      if (changes.chat_conversation_log) conversationLog = changes.chat_conversation_log.newValue || [];
      if (changes.chat_last_round !== undefined) currentRoundNumber = changes.chat_last_round.newValue || 0;
    }
  });
}

function saveConversationState() {
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({
      chat_conversation_log: conversationLog,
      chat_last_round: currentRoundNumber
    });
  }
}

function getRolePrompt(agentKey) {
  const p = PERSONAS[agentKey];
  if (!p) return '';
  const limit = customMaxCharacters || DEFAULT_MAX_CHARACTERS;
  const cleanName = (p.name || agentKey).replace(/\s*\([^)]*\)/g, '').trim();
  
  let personaIdentity = '';
  if (p.rolePrompt && p.rolePrompt.trim()) {
    personaIdentity = `You are contributing as ${cleanName}. ${p.rolePrompt.trim()} We are in a roundtable discussion with your colleagues.`;
  } else {
    personaIdentity = `You are contributing as ${cleanName}. We are in a roundtable discussion with your colleagues.`;
  }

  let rulesText = (customRules && customRules.trim()) ? customRules.trim() : DEFAULT_RULES;
  rulesText = rulesText.replace(/\{name\}/gi, cleanName).replace(/\{limit\}/gi, limit);

  return `[Discussion Context: ${personaIdentity}
Guidelines:
${rulesText}]`;
}

function cleanMessageTags(raw) {
  if (!raw) return '';
  const match = raw.match(/\[MESSAGE\]([\s\S]*?)\[\/MESSAGE\]/i);
  if (match && match[1].trim()) return match[1].trim();
  return raw.replace(/\[MESSAGE\]/gi, '').replace(/\[\/MESSAGE\]/gi, '').trim();
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

// ─── Dynamic Agent Context ──────────────────────────────────────────
// Returns all conversation entries that occurred AFTER this agent's previous response,
// so the agent gets the complete intervening discussion as context.

function getContextForAgent(agentKey) {
  if (!conversationLog || conversationLog.length === 0) return '';

  const normalizedKey = agentKey.toLowerCase();
  
  // Find the index of this agent's most recent turn in conversationLog
  let lastIndex = -1;
  for (let i = conversationLog.length - 1; i >= 0; i--) {
    const entryKey = (conversationLog[i].aiKey || conversationLog[i].agent || '').toLowerCase();
    if (entryKey === normalizedKey || (normalizedKey === 'chatgpt' && entryKey.includes('gpt'))) {
      lastIndex = i;
      break;
    }
  }

  let relevantEntries = [];
  if (lastIndex === -1) {
    // This AI hasn't spoken yet in this thread; provide all recent turns (up to 6)
    relevantEntries = conversationLog.slice(-6);
  } else {
    // All entries that occurred AFTER this AI's last turn
    relevantEntries = conversationLog.slice(lastIndex + 1);
    // If there are very few entries, pull extra context from BEFORE this AI's last turn
    // (but never include the agent's own response — start from lastIndex-1 down to max 2 prior entries)
    if (relevantEntries.length < 2 && lastIndex > 0) {
      const priorStart = Math.max(0, lastIndex - 2);
      const priorEntries = conversationLog.slice(priorStart, lastIndex);
      relevantEntries = [...priorEntries, ...relevantEntries];
    }
    // Cap at last 8 entries to stay concise
    if (relevantEntries.length > 8) {
      relevantEntries = relevantEntries.slice(-8);
    }
  }

  return formatSlidingContext(relevantEntries);
}

function detectTaggedAgents(promptText) {
  if (!promptText) return [];
  const text = promptText.toLowerCase();
  const tagged = [];

  const gptName = (PERSONAS.chatgpt && PERSONAS.chatgpt.name ? PERSONAS.chatgpt.name.toLowerCase() : 'alex');
  const claudeName = (PERSONAS.claude && PERSONAS.claude.name ? PERSONAS.claude.name.toLowerCase() : 'morgan');
  const geminiName = (PERSONAS.gemini && PERSONAS.gemini.name ? PERSONAS.gemini.name.toLowerCase() : 'jordan');

  // Word-boundary match to avoid false positives (e.g. @al matching @alex)
  function hasTag(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(?:^|\\s)@' + escaped + '(?:\\s|$|[,;.!?])', 'i').test(text);
  }

  const hasGpt = hasTag('chatgpt') || hasTag('gpt') || hasTag(gptName);
  const hasClaude = hasTag('claude') || hasTag(claudeName);
  const hasGemini = hasTag('gemini') || hasTag(geminiName);

  if (hasGpt && (!enabledAgents || enabledAgents.chatgpt !== false)) tagged.push('chatgpt');
  if (hasClaude && (!enabledAgents || enabledAgents.claude !== false)) tagged.push('claude');
  if (hasGemini && (!enabledAgents || enabledAgents.gemini !== false)) tagged.push('gemini');

  return tagged;
}

function formatSlidingContext(entries) {
  if (!entries || entries.length === 0) return '';

  let formatted = '\n\nRecent team discussion:';
  for (const entry of entries) {
    let sender = '';
    const key = (entry.aiKey || entry.agent || '').toLowerCase();
    if (key === 'user') {
      sender = (PERSONAS.user && PERSONAS.user.name) ? PERSONAS.user.name : 'You';
    } else if (key === 'chatgpt' || key.includes('gpt')) {
      sender = (PERSONAS.chatgpt && PERSONAS.chatgpt.name) ? PERSONAS.chatgpt.name : 'Alex';
    } else if (key === 'claude') {
      sender = (PERSONAS.claude && PERSONAS.claude.name) ? PERSONAS.claude.name : 'Morgan';
    } else if (key === 'gemini') {
      sender = (PERSONAS.gemini && PERSONAS.gemini.name) ? PERSONAS.gemini.name : 'Jordan';
    } else {
      sender = entry.personaName || entry.displayName || entry.agent || 'Colleague';
    }
    // Strip any residual "(role)" or parenthesized suffixes from sender
    sender = sender.replace(/\s*\([^)]*\)/g, '').trim();
    formatted += `\n- ${sender}: "${entry.text}"`;
  }
  return formatted;
}

// ─── Single Agent Mode ────────────────────────────────────────────────

async function handleSingleAgent(agentKey, prompt, customPersonas = null, maxCharacters = null) {
  await ensureSettingsLoaded();
  if (customPersonas) applyCustomPersonas(customPersonas);
  if (maxCharacters) customMaxCharacters = maxCharacters;

  try {
    const persona = PERSONAS[agentKey] || { name: agentKey, title: 'AI Assistant', displayName: agentKey };
    const agentName = agentKey === 'chatgpt' ? 'ChatGPT' : (agentKey === 'claude' ? 'Claude' : 'Gemini');
    sendUiUpdate({ status: `Connecting to ${persona.displayName || persona.name}...`, currentAgent: agentName });
    
    const tabId = await getAiTabReady(agentKey);
    sendUiUpdate({ status: `Sending prompt to ${persona.name}...`, currentAgent: agentName });
    
    const rolePrompt = getRolePrompt(agentKey);
    const singlePrompt = rolePrompt ? `${rolePrompt}\n\nTask:\n${prompt}\n\n${customTurnPrompt}` : prompt;
    console.log(`[AIBridge] Sending prompt to ${agentName} (${persona.name}):\n${singlePrompt}`);
    
    const response = await sendPromptWithTabSwitch(tabId, singlePrompt, agentName);
    const cleanText = cleanMessageTags(response.text);
    console.log(`[${agentName}/${persona.name}] Response received:`, cleanText);
    
    // Send final response with done flag — textfield re-enables immediately
    sendUiUpdate({ 
      status: `${persona.displayName || persona.name} responded.`, 
      currentAgent: agentName, 
      personaName: persona.name,
      personaTitle: persona.title,
      displayName: persona.displayName,
      text: cleanText,
      done: true
    });
  } catch (error) {
    console.error(`[${agentKey}] Error:`, error);
    const errorMsg = (error && error.message) ? error.message : String(error);
    sendUiUpdate({ status: `Error: ${errorMsg}`, currentAgent: null, done: true });
  }
}

// ─── Broadcast Mode (Roundtable & Tagged Execution) ────────────────────

async function handleBroadcast(initialPrompt, customPersonas = null, maxCharacters = null, explicitTaggedAgents = null, customEnabledAgents = null) {
  await ensureSettingsLoaded();
  if (customPersonas) applyCustomPersonas(customPersonas);
  if (maxCharacters) customMaxCharacters = maxCharacters;
  if (customEnabledAgents) enabledAgents = { ...enabledAgents, ...customEnabledAgents };

  // Reset for a fresh broadcast
  conversationLog = [];
  currentRoundNumber = 0;

  // Add the user's prompt to the log with dynamic user persona
  conversationLog.push({
    agent: 'User',
    personaName: PERSONAS.user.name,
    personaTitle: PERSONAS.user.title,
    displayName: PERSONAS.user.displayName,
    text: initialPrompt.trim()
  });

  const tagged = (explicitTaggedAgents && explicitTaggedAgents.length > 0) 
    ? explicitTaggedAgents 
    : detectTaggedAgents(initialPrompt);

  await executeRound(tagged.length > 0 ? tagged : null);
}

async function handleContinueBroadcast(log, userInput, customPersonas = null, maxCharacters = null, explicitTaggedAgents = null, customEnabledAgents = null) {
  await ensureSettingsLoaded();
  if (customPersonas) applyCustomPersonas(customPersonas);
  if (maxCharacters) customMaxCharacters = maxCharacters;
  if (customEnabledAgents) enabledAgents = { ...enabledAgents, ...customEnabledAgents };

  // Restore log from the Side Panel's copy
  conversationLog = log || [];

  // Determine current round number from log
  currentRoundNumber = 0;
  for (const entry of conversationLog) {
    if (entry.round && entry.round > currentRoundNumber) currentRoundNumber = entry.round;
  }

  // Always add a user entry between rounds so the sliding window includes it
  const userText = (userInput && userInput.trim()) ? userInput.trim() : 'Continue the discussion with concrete next steps.';
  conversationLog.push({
    agent: 'User',
    personaName: PERSONAS.user.name,
    personaTitle: PERSONAS.user.title,
    displayName: PERSONAS.user.displayName,
    text: userText
  });

  const tagged = (explicitTaggedAgents && explicitTaggedAgents.length > 0) 
    ? explicitTaggedAgents 
    : detectTaggedAgents(userText);

  await executeRound(tagged.length > 0 ? tagged : null);
}

async function executeRound(explicitTaggedAgents = null) {
  currentRoundNumber++;
  const roundNum = currentRoundNumber;

  let activePool = ['chatgpt', 'claude', 'gemini'].filter(k => (!enabledAgents || enabledAgents[k] !== false));
  if (activePool.length === 0) {
    activePool = ['chatgpt'];
  }

  let agentsToRun = activePool;
  if (explicitTaggedAgents && explicitTaggedAgents.length > 0) {
    const filteredTagged = explicitTaggedAgents.filter(k => (!enabledAgents || enabledAgents[k] !== false));
    if (filteredTagged.length > 0) {
      agentsToRun = filteredTagged;
    }
  }

  try {
    const targetNames = agentsToRun.map(k => (PERSONAS[k] ? PERSONAS[k].name : k)).join(', ');
    sendUiUpdate({ status: `Consulting ${targetNames}...`, roundNumber: roundNum });

    for (let idx = 0; idx < agentsToRun.length; idx++) {
      const agentKey = agentsToRun[idx];
      const isLastAgent = (idx === agentsToRun.length - 1);
      const persona = PERSONAS[agentKey] || { name: agentKey, title: 'AI Assistant', displayName: agentKey };
      const agentName = agentKey === 'chatgpt' ? 'ChatGPT' : (agentKey === 'claude' ? 'Claude' : 'Gemini');

      sendUiUpdate({
        status: `Consulting ${persona.displayName || persona.name}...`,
        currentAgent: agentName,
        personaName: persona.name,
        personaTitle: persona.title
      });

      try {
        const tabId = await getAiTabReady(agentKey);
        const agentContext = getContextForAgent(agentKey);
        const prompt = `${getRolePrompt(agentKey)}${agentContext}\n\n${customTurnPrompt}`;
        console.log(`[AIBridge] Injected ${agentName} (${persona.name}) prompt:\n${prompt}`);

        const response = await sendPromptWithTabSwitch(tabId, prompt, agentName);
        const cleanText = cleanMessageTags(response.text);
        console.log(`[${agentName}/${persona.name}] Response:`, cleanText);

        conversationLog.push({
          agent: agentName,
          aiKey: agentKey,
          personaName: persona.name,
          personaTitle: persona.title,
          displayName: persona.displayName,
          text: cleanText,
          round: roundNum
        });
        saveConversationState();

        sendUiUpdate({
          status: isLastAgent ? (agentsToRun.length > 1 ? `Round ${roundNum} complete.` : `${persona.name} responded.`) : `${persona.displayName || persona.name} responded.`,
          currentAgent: agentName,
          personaName: persona.name,
          personaTitle: persona.title,
          displayName: persona.displayName,
          text: cleanText,
          roundComplete: isLastAgent,
          roundNumber: roundNum,
          conversationLog: conversationLog,
          done: isLastAgent
        });
      } catch (agentErr) {
        console.error(`${agentName} turn error:`, agentErr);
        const errText = `(${persona.displayName || persona.name} unavailable: ${agentErr.message})`;
        
        conversationLog.push({
          agent: agentName,
          aiKey: agentKey,
          personaName: persona.name,
          personaTitle: persona.title,
          displayName: persona.displayName,
          text: errText,
          round: roundNum
        });
        saveConversationState();

        sendUiUpdate({
          status: `${persona.name} skipped: ${agentErr.message}`,
          currentAgent: agentName,
          personaName: persona.name,
          personaTitle: persona.title,
          displayName: persona.displayName,
          text: errText,
          roundComplete: isLastAgent,
          roundNumber: roundNum,
          conversationLog: conversationLog,
          done: isLastAgent
        });
      }
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
    if (request.customRules) customRules = request.customRules;
    handleBroadcast(request.prompt, request.customPersonas, request.maxCharacters, request.taggedAgents, request.enabledAgents);
    sendResponse({ status: 'started' });
  } else if (request.type === 'START_SINGLE_AGENT') {
    if (sender.tab && sender.tab.id) chatTabId = sender.tab.id;
    if (request.customRules) customRules = request.customRules;
    handleSingleAgent(request.agent || 'chatgpt', request.prompt, request.customPersonas, request.maxCharacters);
    sendResponse({ status: 'started' });
  } else if (request.type === 'CONTINUE_BROADCAST') {
    if (request.customRules) customRules = request.customRules;
    handleContinueBroadcast(request.conversationLog, null, request.customPersonas, request.maxCharacters, request.taggedAgents, request.enabledAgents);
    sendResponse({ status: 'started' });
  } else if (request.type === 'CONTINUE_WITH_INPUT') {
    if (request.customRules) customRules = request.customRules;
    handleContinueBroadcast(request.conversationLog, request.prompt, request.customPersonas, request.maxCharacters, request.taggedAgents, request.enabledAgents);
    sendResponse({ status: 'started' });
  } else if (request.type === 'UPDATE_PERSONAS') {
    if (request.customPersonas) applyCustomPersonas(request.customPersonas);
    if (request.maxCharacters) customMaxCharacters = request.maxCharacters;
    if (request.customRules) customRules = request.customRules;
    sendResponse({ status: 'updated' });
  } else if (request.type === 'UPDATE_ENABLED_AGENTS') {
    if (request.enabledAgents) enabledAgents = { ...enabledAgents, ...request.enabledAgents };
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ enabled_agents: enabledAgents });
    }
    sendResponse({ status: 'updated' });
  } else if (request.type === 'CLEAR_HISTORY') {
    conversationLog = [];
    currentRoundNumber = 0;
    saveConversationState();
    sendResponse({ status: 'cleared' });
  } else if (request.type === 'SYNC_THREAD') {
    conversationLog = request.conversationLog || [];
    currentRoundNumber = request.roundNumber || 0;
    saveConversationState();
    sendResponse({ status: 'synced' });
  }
  return true;
});
