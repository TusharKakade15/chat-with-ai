document.addEventListener('DOMContentLoaded', () => {
    const promptInput = document.getElementById('prompt-input');
    const broadcastBtn = document.getElementById('broadcast-btn');
    const messagesContainer = document.getElementById('messages-container');
    const statusText = document.getElementById('connection-status');
    const statusSubtitle = document.getElementById('action-subtitle');
    
    const agents = {
        'ChatGPT': document.getElementById('agent-gpt'),
        'Claude': document.getElementById('agent-claude'),
        'Gemini': document.getElementById('agent-gemini')
    };

    let isBroadcasting = false;

    // Auto-resize textarea
    promptInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if(this.value.trim() === '') {
            this.style.height = '44px';
        }
    });

    // Handle Enter key (Shift+Enter for new line)
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            startBroadcast();
        }
    });

    broadcastBtn.addEventListener('click', startBroadcast);

    function startBroadcast() {
        const text = promptInput.value.trim();
        if (!text || isBroadcasting) return;

        // Clear welcome message if it exists
        const welcome = document.querySelector('.welcome-message');
        if (welcome) welcome.remove();

        // Disable input
        isBroadcasting = true;
        promptInput.value = '';
        promptInput.style.height = '44px';
        promptInput.disabled = true;
        broadcastBtn.disabled = true;

        // Render user message
        appendMessage('You', text, 'user');

        // Send to background script
        chrome.runtime.sendMessage({ type: 'START_BROADCAST', prompt: text }, (response) => {
            console.log('Broadcast started:', response);
        });
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
    }

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
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // Listen for updates from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'UI_UPDATE') {
            
            // Update status text
            if (message.status) {
                statusSubtitle.textContent = message.status;
            }

            // Update active agent highlights in sidebar
            Object.values(agents).forEach(el => el.classList.remove('active'));
            if (message.currentAgent && agents[message.currentAgent]) {
                agents[message.currentAgent].classList.add('active');
                setTypingIndicator(message.currentAgent);
            } else if (!message.currentAgent) {
                removeTypingIndicator();
                
                // If currentAgent is null, broadcast is over (idle or error)
                if (isBroadcasting && (message.status === 'Idle' || (message.status && message.status.startsWith('Error:')))) {
                    isBroadcasting = false;
                    promptInput.disabled = false;
                    broadcastBtn.disabled = false;
                    promptInput.focus();
                    if (message.status === 'Idle') {
                        statusSubtitle.textContent = 'Enter a new prompt to start another round.';
                    }
                }
            }

            // If text is provided, the agent finished generating
            if (message.text !== undefined && message.text !== null && message.currentAgent) {
                removeTypingIndicator();
                const agentClass = message.currentAgent.toLowerCase();
                const displayText = message.text || '(No response captured)';
                appendMessage(message.currentAgent, displayText, 'ai', agentClass);
            }
        }
    });
});
