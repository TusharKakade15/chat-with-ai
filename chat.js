document.addEventListener('DOMContentLoaded', () => {
    const promptInput = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('send-btn') || document.getElementById('broadcast-btn');
    const continueBtn = document.getElementById('continue-btn');
    const modeSelect = document.getElementById('mode-select');
    const currentAction = document.getElementById('current-action');
    const messagesContainer = document.getElementById('messages-container');
    const statusText = document.getElementById('connection-status');
    const statusSubtitle = document.getElementById('action-subtitle');
    
    const agents = {
        'ChatGPT': document.getElementById('agent-gpt'),
        'Claude': document.getElementById('agent-claude'),
        'Gemini': document.getElementById('agent-gemini')
    };

    let isBusy = false;
    let conversationLog = [];      // Flat log of all messages (sliding window source)
    let isRoundComplete = false;   // True when a broadcast round just finished
    let lastRoundNumber = 0;       // Track which round we're on

    // Update UI based on mode selection
    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            const mode = modeSelect.value;
            if (mode === 'chatgpt') {
                if (currentAction) currentAction.textContent = 'Chat with ChatGPT';
                if (statusSubtitle) statusSubtitle.textContent = 'Send prompts directly to your active ChatGPT web tab.';
                if (sendBtn) sendBtn.textContent = 'Send to ChatGPT';
                if (promptInput) promptInput.placeholder = 'Type your prompt for ChatGPT...';
                hideContinueButton();
            } else {
                if (currentAction) currentAction.textContent = 'Roundtable Broadcast';
                if (statusSubtitle) statusSubtitle.textContent = 'Enter a prompt to initiate the multi-agent round-robin discussion.';
                if (sendBtn) sendBtn.textContent = 'Broadcast All';
                if (promptInput) promptInput.placeholder = 'Type your initial prompt to start the broadcast...';
            }
        });
    }

    // Auto-resize textarea
    promptInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.value.trim() === '') {
            this.style.height = '44px';
        }
    });

    // Handle Enter key (Shift+Enter for new line)
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    if (sendBtn) {
        sendBtn.addEventListener('click', handleSend);
    }

    // Continue button click handler
    if (continueBtn) {
        continueBtn.addEventListener('click', handleContinue);
    }

    // ─── Prompt Settings (Custom System Instruction & Turn Prompt) ─────
    const DEFAULT_SYSTEM_INSTRUCTION = `[SYSTEM INSTRUCTION: You are participating in a multi-AI roundtable discussion with other AI models. Keep your response concise, conversational, and direct (under 150 words). Do not output massive blocks of text. Acknowledge points made by others if provided, and build upon them or critique them briefly.]`;
    const DEFAULT_TURN_PROMPT = `What is your perspective? Respond conversationally.`;

    const toggleSettingsBtn = document.getElementById('toggle-settings-btn');
    const settingsBody = document.getElementById('settings-body');
    const settingsChevron = document.getElementById('settings-chevron');
    const systemInstructionInput = document.getElementById('system-instruction-input');
    const turnPromptInput = document.getElementById('turn-prompt-input');
    const savePromptsBtn = document.getElementById('save-prompts-btn');
    const resetPromptsBtn = document.getElementById('reset-prompts-btn');
    const settingsSavedMsg = document.getElementById('settings-saved-msg');

    // Load initial prompt settings from chrome.storage.local
    if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['systemInstruction', 'turnPrompt'], (res) => {
            if (systemInstructionInput) {
                systemInstructionInput.value = res.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;
            }
            if (turnPromptInput) {
                turnPromptInput.value = res.turnPrompt || DEFAULT_TURN_PROMPT;
            }
        });
    }

    // Toggle Prompt Settings Accordion
    if (toggleSettingsBtn && settingsBody) {
        toggleSettingsBtn.addEventListener('click', () => {
            const isHidden = settingsBody.classList.contains('hidden');
            if (isHidden) {
                settingsBody.classList.remove('hidden');
                if (settingsChevron) settingsChevron.textContent = '▼';
            } else {
                settingsBody.classList.add('hidden');
                if (settingsChevron) settingsChevron.textContent = '▶';
            }
        });
    }

    // Save custom prompts
    if (savePromptsBtn) {
        savePromptsBtn.addEventListener('click', () => {
            const sys = (systemInstructionInput ? systemInstructionInput.value.trim() : '') || DEFAULT_SYSTEM_INSTRUCTION;
            const turn = (turnPromptInput ? turnPromptInput.value.trim() : '') || DEFAULT_TURN_PROMPT;
            if (chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ systemInstruction: sys, turnPrompt: turn }, () => {
                    showSettingsMessage('Saved!');
                });
            }
        });
    }

    // Reset prompts to default
    if (resetPromptsBtn) {
        resetPromptsBtn.addEventListener('click', () => {
            if (systemInstructionInput) systemInstructionInput.value = DEFAULT_SYSTEM_INSTRUCTION;
            if (turnPromptInput) turnPromptInput.value = DEFAULT_TURN_PROMPT;
            if (chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ systemInstruction: DEFAULT_SYSTEM_INSTRUCTION, turnPrompt: DEFAULT_TURN_PROMPT }, () => {
                    showSettingsMessage('Reset to defaults!');
                });
            }
        });
    }

    let saveMsgTimer = null;
    function showSettingsMessage(msg) {
        if (!settingsSavedMsg) return;
        settingsSavedMsg.textContent = msg;
        settingsSavedMsg.classList.remove('hidden');
        if (saveMsgTimer) clearTimeout(saveMsgTimer);
        saveMsgTimer = setTimeout(() => {
            settingsSavedMsg.classList.add('hidden');
        }, 2000);
    }

    function handleSend() {
        const text = promptInput.value.trim();
        if (!text || isBusy) return;

        // Clear welcome message if it exists
        const welcome = document.querySelector('.welcome-message');
        if (welcome) welcome.remove();

        // Disable input
        isBusy = true;
        promptInput.value = '';
        promptInput.style.height = '44px';
        promptInput.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        hideContinueButton();

        // Render user message
        appendMessage('You', text, 'user');

        const mode = modeSelect ? modeSelect.value : 'chatgpt';

        if (isRoundComplete && mode === 'broadcast') {
            // User typed a message during round-complete state → continue with input
            isRoundComplete = false;
            addRoundSeparator(lastRoundNumber + 1);
            chrome.runtime.sendMessage({ 
                type: 'CONTINUE_WITH_INPUT', 
                prompt: text,
                conversationLog: conversationLog
            }, (response) => {
                console.log('Continue with input started:', response);
            });
        } else if (mode === 'chatgpt') {
            // Reset round state when switching to single agent
            isRoundComplete = false;
            conversationLog = [];
            lastRoundNumber = 0;
            chrome.runtime.sendMessage({ 
                type: 'START_SINGLE_AGENT', 
                agent: 'chatgpt', 
                prompt: text 
            }, (response) => {
                console.log('Single agent task started:', response);
            });
        } else {
            // Fresh broadcast
            isRoundComplete = false;
            conversationLog = [];
            lastRoundNumber = 0;
            addRoundSeparator(1);
            chrome.runtime.sendMessage({ 
                type: 'START_BROADCAST', 
                prompt: text 
            }, (response) => {
                console.log('Broadcast started:', response);
            });
        }
    }

    function handleContinue() {
        if (isBusy || !isRoundComplete) return;

        // Disable input and hide continue
        isBusy = true;
        isRoundComplete = false;
        promptInput.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        hideContinueButton();

        addRoundSeparator(lastRoundNumber + 1);

        chrome.runtime.sendMessage({
            type: 'CONTINUE_BROADCAST',
            conversationLog: conversationLog
        }, (response) => {
            console.log('Continue broadcast started:', response);
        });
    }

    function showContinueButton() {
        if (continueBtn) {
            continueBtn.classList.remove('hidden');
        }
    }

    function hideContinueButton() {
        if (continueBtn) {
            continueBtn.classList.add('hidden');
        }
    }

    function addRoundSeparator(roundNumber) {
        const sep = document.createElement('div');
        sep.className = 'round-separator';
        sep.innerHTML = `<span class="round-label">Round ${roundNumber}</span>`;
        messagesContainer.appendChild(sep);
        scrollToBottom();
    }

    function appendMessage(sender, text, type, agentClass = '') {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${type} ${agentClass}`;
        
        msgDiv.innerHTML = `
            <div class="message-sender">${sender}</div>
            <div class="message-bubble">${escapeHtml(text)}</div>
        `;
        
        messagesContainer.appendChild(msgDiv);
        scrollToBottom();
        return msgDiv;
    }

    let currentStreamDiv = null;
    let currentStreamAgent = null;

    function setTypingIndicator(agentName) {
        removeTypingIndicator();
        const div = document.createElement('div');
        div.id = 'typing-indicator';
        div.className = 'typing-indicator';
        div.textContent = `${agentName} is thinking...`;
        messagesContainer.appendChild(div);
        scrollToBottom();
    }

    function removeTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();
    }

    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function escapeHtml(unsafe) {
        return (unsafe || '')
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    function enableInput() {
        isBusy = false;
        promptInput.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        promptInput.focus();
    }

    // Listen for updates from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'UI_UPDATE') {
            console.log('[UI_UPDATE]', message);

            // Update status text
            if (message.status && statusSubtitle) {
                statusSubtitle.textContent = message.status;
            }

            // Update active agent highlights in sidebar
            Object.values(agents).forEach(el => el && el.classList.remove('active'));
            if (message.currentAgent && agents[message.currentAgent]) {
                agents[message.currentAgent].classList.add('active');
                setTypingIndicator(message.currentAgent);
            } else if (!message.currentAgent) {
                removeTypingIndicator();
            }

            // If text is provided, the agent finished generating
            if (message.text !== undefined && message.text !== null && message.currentAgent) {
                removeTypingIndicator();
                if (currentStreamDiv && currentStreamAgent === message.currentAgent) {
                    const bubble = currentStreamDiv.querySelector('.message-bubble');
                    if (bubble) bubble.innerHTML = escapeHtml(message.text);
                    currentStreamDiv = null;
                    currentStreamAgent = null;
                } else {
                    const agentClass = message.currentAgent.toLowerCase();
                    const displayText = message.text || '(No response captured)';
                    appendMessage(message.currentAgent, displayText, 'ai', agentClass);
                }
            }

            // Handle done flag — immediately re-enable input
            if (message.done) {
                removeTypingIndicator();
                Object.values(agents).forEach(el => el && el.classList.remove('active'));

                if (message.roundComplete) {
                    // Broadcast round finished — save conversation log, show continue button
                    if (message.conversationLog) {
                        conversationLog = message.conversationLog;
                    }
                    lastRoundNumber = message.roundNumber || lastRoundNumber + 1;
                    isRoundComplete = true;

                    enableInput();
                    showContinueButton();
                    promptInput.placeholder = 'Add your thoughts, or press Continue Round ▶ to keep going...';
                    if (statusSubtitle) {
                        statusSubtitle.textContent = `Round ${lastRoundNumber} complete. Type a response or continue the discussion.`;
                    }
                } else {
                    // Single agent or error — just re-enable
                    enableInput();
                    hideContinueButton();
                    isRoundComplete = false;
                    if (message.status && message.status.startsWith('Error:')) {
                        // Keep error message visible
                    } else {
                        if (statusSubtitle) statusSubtitle.textContent = 'Enter a new prompt to continue.';
                    }
                }
            }

        } else if (message.type === 'STREAM_UPDATE') {
            removeTypingIndicator();
            if (!currentStreamDiv || currentStreamAgent !== message.agent) {
                currentStreamAgent = message.agent;
                currentStreamDiv = appendMessage(message.agent, message.text, 'ai', message.agent.toLowerCase());
            } else {
                const bubble = currentStreamDiv.querySelector('.message-bubble');
                if (bubble) bubble.innerHTML = escapeHtml(message.text);
                scrollToBottom();
            }
        }
    });
});
