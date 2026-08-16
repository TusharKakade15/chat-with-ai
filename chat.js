document.addEventListener('DOMContentLoaded', () => {
    const promptInput = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('send-btn') || document.getElementById('broadcast-btn');
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

    // Update UI based on mode selection
    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            const mode = modeSelect.value;
            if (mode === 'chatgpt') {
                if (currentAction) currentAction.textContent = 'Chat with ChatGPT';
                if (statusSubtitle) statusSubtitle.textContent = 'Send prompts directly to your active ChatGPT web tab.';
                if (sendBtn) sendBtn.textContent = 'Send to ChatGPT';
                if (promptInput) promptInput.placeholder = 'Type your prompt for ChatGPT...';
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

        // Render user message
        appendMessage('You', text, 'user');

        const mode = modeSelect ? modeSelect.value : 'chatgpt';

        if (mode === 'chatgpt') {
            chrome.runtime.sendMessage({ 
                type: 'START_SINGLE_AGENT', 
                agent: 'chatgpt', 
                prompt: text 
            }, (response) => {
                console.log('Single agent task started:', response);
            });
        } else {
            chrome.runtime.sendMessage({ 
                type: 'START_BROADCAST', 
                prompt: text 
            }, (response) => {
                console.log('Broadcast started:', response);
            });
        }
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
                
                // If currentAgent is null, operation is over (idle or error)
                if (isBusy && (message.status === 'Idle' || (message.status && message.status.startsWith('Error:')))) {
                    isBusy = false;
                    promptInput.disabled = false;
                    if (sendBtn) sendBtn.disabled = false;
                    promptInput.focus();
                    if (message.status === 'Idle') {
                        statusSubtitle.textContent = 'Enter a new prompt to continue.';
                    }
                }
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

