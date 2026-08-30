document.addEventListener('DOMContentLoaded', () => {
    const promptInput = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('send-btn');
    const continueBtn = document.getElementById('continue-btn');
    const currentAction = document.getElementById('current-action');
    const messagesContainer = document.getElementById('messages-container');
    const statusText = document.getElementById('connection-status');
    const statusSubtitle = document.getElementById('action-subtitle');
    const newThreadBtn = document.getElementById('new-thread-btn');
    
    // Nav Items & Panels
    const navChat = document.getElementById('nav-chat');
    const navPersonas = document.getElementById('nav-personas');
    const navHistory = document.getElementById('nav-history');
    const navSettings = document.getElementById('nav-settings');
    const personasPanel = document.getElementById('personas-panel');
    const clearAllHistoryBtn = document.getElementById('clear-all-history-btn');
    const closePanelBtn = document.getElementById('close-panel-btn');

    // View Panels & Personas Elements
    const chatView = document.getElementById('chat-view');
    const personasView = document.getElementById('personas-view');
    const historyView = document.getElementById('history-view');
    const settingsView = document.getElementById('settings-view');
    const historyCardsList = document.getElementById('history-cards-list');
    const historySearchInput = document.getElementById('history-search-input');
    const historyCountBadge = document.getElementById('history-count-badge');
    const backToChatFromHistoryBtn = document.getElementById('back-to-chat-from-history-btn');
    const backToChatFromSettingsBtn = document.getElementById('back-to-chat-from-settings-btn');
    const cancelPersonasBtn = document.getElementById('cancel-personas-btn');
    const savePersonasBtn = document.getElementById('save-personas-btn');
    const resetPersonasBtn = document.getElementById('reset-personas-btn');
    const personasSavedMsg = document.getElementById('personas-saved-msg');
    const personaUserName = document.getElementById('persona-user-name');
    const personaUserRole = document.getElementById('persona-user-role');
    const personaGptName = document.getElementById('persona-gpt-name');
    const personaGptPrompt = document.getElementById('persona-gpt-prompt');
    const personaClaudeName = document.getElementById('persona-claude-name');
    const personaClaudePrompt = document.getElementById('persona-claude-prompt');
    const personaGeminiName = document.getElementById('persona-gemini-name');
    const personaGeminiPrompt = document.getElementById('persona-gemini-prompt');
    const personaCharacterLimit = document.getElementById('persona-character-limit');
    const personaRulesInput = document.getElementById('persona-rules-input');
    const confirmModalOverlay = document.getElementById('confirm-modal-overlay');
    const confirmModalTitle = document.querySelector('.confirm-modal-title');
    const confirmModalDesc = document.querySelector('.confirm-modal-desc');
    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');

    const agents = {
        'ChatGPT': document.getElementById('agent-gpt'),
        'Claude': document.getElementById('agent-claude'),
        'Gemini': document.getElementById('agent-gemini')
    };

    const DEFAULT_RULES = `1. Contribute concisely from your designated perspective (under {limit} characters).
2. Jump straight into your analysis without generic introductions or conversational filler.
3. Address colleagues by name when building upon, questioning, or critiquing their points.
4. Wrap your exact response between [MESSAGE] and [/MESSAGE] tags.`;

    const DEFAULT_PERSONAS = {
        user: {
            name: 'You',
            role: 'Discussion Lead',
            service: 'User',
            monogram: 'YOU'
        },
        chatgpt: {
            name: 'Alex',
            role: '',
            rolePrompt: 'You are an expert analyst. Your tone is direct, objective, and highly structured. Prioritize actionable insights and avoid conversational filler.',
            service: 'ChatGPT',
            monogram: 'AL'
        },
        claude: {
            name: 'Morgan',
            role: '',
            rolePrompt: 'Act as our lead editor and creative collaborator. Share nuanced, structured, and insightful editorial perspectives with conceptual depth and clarity.',
            service: 'Claude',
            monogram: 'MO'
        },
        gemini: {
            name: 'Jordan',
            role: '',
            rolePrompt: 'You are a comprehensive researcher. Pull from diverse disciplines, connect disparate concepts, and present information with clear citations and expansive context.',
            service: 'Gemini',
            monogram: 'JO'
        }
    };

    let PERSONA_MAP = {
        'user':    { ...DEFAULT_PERSONAS.user },
        'chatgpt': { ...DEFAULT_PERSONAS.chatgpt },
        'claude':  { ...DEFAULT_PERSONAS.claude },
        'gemini':  { ...DEFAULT_PERSONAS.gemini },
        'ChatGPT': { ...DEFAULT_PERSONAS.chatgpt },
        'Claude':  { ...DEFAULT_PERSONAS.claude },
        'Gemini':  { ...DEFAULT_PERSONAS.gemini }
    };

    const ROUND_THEMES = [
        'ARCHITECTURE REVIEW',
        'IMPLEMENTATION & DEPLOYMENT',
        'SECURITY & RESILIENCE',
        'OPTIMIZATION & MONITORING',
        'FINAL SYNTHESIS'
    ];

    let isBusy = false;
    let threads = [];              // All saved threads
    let activeThreadId = null;     // ID of the currently loaded thread
    let conversationLog = [];      // Flat log of current discussion (sliding window source)
    let savedFeedItems = [];       // Visual messages history list for current discussion
    let isRoundComplete = false;   // True when a broadcast round just finished
    let lastRoundNumber = 0;       // Track which round we're on
    let enabledAgents = { chatgpt: true, claude: true, gemini: true }; // Active AI pool toggle states

    function generateThreadId() {
        return 'thread_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    }

    function renderWelcomeMessage() {
        messagesContainer.innerHTML = `
            <div class="welcome-message">
                <div class="welcome-icon-wrapper">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path><path d="M12 12 2.1 7.1"></path><path d="M12 12l9.9 4.9"></path></svg>
                </div>
                <h3>Multi-Agent Neural Roundtable</h3>
                <p id="action-subtitle">Enter a prompt to initiate precision discussion among ChatGPT, Claude, and Gemini.</p>
            </div>
        `;
    }

    function formatThreadDate(timestamp) {
        if (!timestamp) return 'Recent';
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        if (isToday) {
            return 'Today, ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // ─── Multi-Thread Persistence ──────────────────────────────────────
    function saveCurrentThreadState() {
        if (!chrome.storage || !chrome.storage.local) return;
        if (savedFeedItems.length === 0) return;

        if (!activeThreadId) {
            activeThreadId = generateThreadId();
        }

        let existingIndex = threads.findIndex(t => t.id === activeThreadId);
        let title = 'Discussion ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const firstUserMsg = savedFeedItems.find(item => item.msgType === 'user');
        if (firstUserMsg && firstUserMsg.text) {
            const clean = firstUserMsg.text.replace(/\s+/g, ' ').trim();
            title = clean.slice(0, 34) + (clean.length > 34 ? '...' : '');
        }

        const threadData = {
            id: activeThreadId,
            title: title,
            updatedAt: Date.now(),
            feedItems: savedFeedItems,
            conversationLog: conversationLog,
            lastRoundNumber: lastRoundNumber,
            isRoundComplete: isRoundComplete
        };

        if (existingIndex >= 0) {
            threads[existingIndex] = { ...threads[existingIndex], ...threadData };
        } else {
            threadData.createdAt = Date.now();
            threads.unshift(threadData);
        }

        threads.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        chrome.storage.local.set({
            chat_threads: threads,
            active_thread_id: activeThreadId
        });

        renderHistoryView();
    }

    function loadAllThreadsFromStorage() {
        if (!chrome.storage || !chrome.storage.local) return;
        chrome.storage.local.get(['chat_threads', 'active_thread_id'], (res) => {
            if (res.chat_threads && Array.isArray(res.chat_threads)) {
                threads = res.chat_threads;
            }
            if (res.active_thread_id && threads.some(t => t.id === res.active_thread_id)) {
                loadThread(res.active_thread_id);
            } else if (threads.length > 0) {
                loadThread(threads[0].id);
            } else {
                activeThreadId = generateThreadId();
                renderWelcomeMessage();
            }
            renderHistoryView();
        });
    }

    function loadThread(threadId, switchView = true) {
        const thread = threads.find(t => t.id === threadId);
        if (!thread) return;

        if (switchView) {
            showChatView();
        }
        activeThreadId = thread.id;
        savedFeedItems = thread.feedItems || [];
        conversationLog = thread.conversationLog || [];
        lastRoundNumber = thread.lastRoundNumber || 0;
        isRoundComplete = thread.isRoundComplete || false;

        updateModeUI();

        messagesContainer.innerHTML = '';
        removeTypingIndicator();
        Object.values(agents).forEach(el => el && el.classList.remove('active'));

        if (savedFeedItems.length > 0) {
            savedFeedItems.forEach(item => {
                if (item.type === 'sep') {
                    renderRoundSeparatorDOM(item.roundNumber);
                } else if (item.type === 'msg') {
                    renderMessageDOM(item.sender, item.text, item.msgType, item.agentClass, item.personaInfo, item.timeStr);
                }
            });
            if (isRoundComplete) {
                showContinueButton();
                promptInput.placeholder = 'Contribute to the roundtable, or press Continue Round ▶...';
                if (statusSubtitle) {
                    statusSubtitle.textContent = `Round ${lastRoundNumber} complete. Reply or continue roundtable.`;
                }
            } else {
                hideContinueButton();
            }
            scrollToBottom();
        } else {
            renderWelcomeMessage();
        }

        isBusy = false;
        if (promptInput) {
            promptInput.disabled = false;
            promptInput.value = '';
            promptInput.style.height = 'auto';
            if (switchView) {
                promptInput.focus();
            }
        }
        if (sendBtn) sendBtn.disabled = false;

        chrome.runtime.sendMessage({
            type: 'SYNC_THREAD',
            conversationLog: conversationLog,
            roundNumber: lastRoundNumber
        }).catch(() => {});

        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ active_thread_id: activeThreadId });
        }

        const searchVal = historySearchInput ? historySearchInput.value.trim() : '';
        renderHistoryView(searchVal);
    }

    function deleteThread(threadId) {
        threads = threads.filter(t => t.id !== threadId);
        if (activeThreadId === threadId) {
            if (threads.length > 0) {
                loadThread(threads[0].id, false);
            } else {
                resetChatSession();
            }
        }
        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({
                chat_threads: threads,
                active_thread_id: activeThreadId
            });
        }
        const searchVal = historySearchInput ? historySearchInput.value.trim() : '';
        renderHistoryView(searchVal);
    }

    function clearAllThreads() {
        threads = [];
        activeThreadId = null;
        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.remove(['chat_threads', 'active_thread_id']);
        }
        resetChatSession();
        renderHistoryView();
    }

    function formatDetailedDate(dateValue) {
        if (!dateValue) return '';
        const d = new Date(dateValue);
        if (isNaN(d.getTime())) return '';
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (isToday) {
            return `Today • ${timePart}`;
        }
        const datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        return `${datePart} • ${timePart}`;
    }

    function renderHistoryView(searchTerm = '') {
        if (!historyCardsList) return;

        let filtered = threads || [];
        if (searchTerm) {
            const query = searchTerm.toLowerCase();
            filtered = filtered.filter(t => {
                const titleMatch = (t.title || '').toLowerCase().includes(query);
                const snippetMatch = (t.feedItems || []).some(item => (item.text || '').toLowerCase().includes(query));
                return titleMatch || snippetMatch;
            });
        }

        if (historyCountBadge) {
            historyCountBadge.textContent = `${filtered.length} ${filtered.length === 1 ? 'SESSION' : 'SESSIONS'}`;
        }

        if (filtered.length === 0) {
            if (searchTerm) {
                historyCardsList.innerHTML = `
                    <div class="editorial-empty-state">
                        <div class="empty-icon-ring">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                        </div>
                        <h3 class="empty-title">No Matching Sessions</h3>
                        <p class="empty-subtitle">No conversations found matching "${escapeHtml(searchTerm)}". Try searching for different terms.</p>
                    </div>
                `;
            } else {
                historyCardsList.innerHTML = `
                    <div class="editorial-empty-state">
                        <div class="empty-icon-ring">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        </div>
                        <h3 class="empty-title">No Saved Discussions Yet</h3>
                        <p class="empty-subtitle">Start a multi-agent roundtable or individual conversation to build your archive.</p>
                    </div>
                `;
            }
            return;
        }

        historyCardsList.innerHTML = '';
        filtered.forEach(t => {
            const card = document.createElement('div');
            const isActive = t.id === activeThreadId;
            card.className = `history-thread-card ${isActive ? 'is-active-thread' : ''}`;
            card.dataset.threadId = t.id;

            const timeStr = formatDetailedDate(t.updatedAt || t.createdAt);
            const isDirect = t.mode === 'chatgpt';
            const modeLabel = isDirect ? 'ChatGPT Direct' : 'Roundtable';
            const modeClass = isDirect ? 'mode-direct' : 'mode-roundtable';
            const roundsLabel = t.lastRoundNumber 
                ? `${t.lastRoundNumber} ${t.lastRoundNumber === 1 ? 'Round' : 'Rounds'}` 
                : `${(t.feedItems || []).length} Msgs`;

            // Extract preview snippet
            let snippet = 'No messages in this session.';
            if (t.feedItems && t.feedItems.length > 0) {
                const msgs = t.feedItems.filter(i => i.type === 'msg');
                if (msgs.length > 0) {
                    const lastMsg = msgs[msgs.length - 1];
                    const senderPrefix = lastMsg.sender ? `${lastMsg.sender}: ` : '';
                    snippet = `${senderPrefix}${lastMsg.text || ''}`;
                }
            }

            const participantsSummary = isDirect 
                ? 'You · Alex (ChatGPT)' 
                : 'You · Alex (ChatGPT) · Morgan (Claude) · Jordan (Gemini)';

            card.innerHTML = `
                <div class="thread-card-top">
                    <div class="thread-card-meta">
                        <span class="thread-mode-tag ${modeClass}">${modeLabel}</span>
                        <span class="thread-rounds-tag">${roundsLabel}</span>
                        ${isActive ? `<span class="thread-active-pill">ACTIVE NOW</span>` : ''}
                    </div>
                    <div class="thread-card-actions">
                        <span class="thread-card-time">${timeStr}</span>
                        <button type="button" class="thread-card-delete-btn" title="Delete discussion">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                        </button>
                    </div>
                </div>

                <h3 class="thread-card-title">${escapeHtml(t.title || 'Untitled Discussion')}</h3>

                <p class="thread-card-snippet">${escapeHtml(snippet)}</p>

                <div class="thread-card-bottom">
                    <div class="thread-participants-row">
                        <span class="participant-dot dot-user" title="You"></span>
                        <span class="participant-dot dot-gpt" title="ChatGPT"></span>
                        ${!isDirect ? `
                            <span class="participant-dot dot-claude" title="Claude"></span>
                            <span class="participant-dot dot-gemini" title="Gemini"></span>
                        ` : ''}
                        <span class="participant-names">${escapeHtml(participantsSummary)}</span>
                    </div>
                    <div class="thread-resume-cta">
                        <span>Resume Discussion</span>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                    </div>
                </div>
            `;

            card.addEventListener('click', (e) => {
                if (e.target.closest('.thread-card-delete-btn')) return;
                loadThread(t.id, true);
            });

            const delBtn = card.querySelector('.thread-card-delete-btn');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const threadTitle = t.title || 'Untitled Discussion';
                    showConfirmModal(
                        'Delete Discussion?',
                        `This will permanently delete "${threadTitle}" and its message history.`,
                        'Delete Discussion',
                        () => {
                            deleteThread(t.id);
                        }
                    );
                });
            }

            historyCardsList.appendChild(card);
        });
    }

    // ─── Mode & Header UI ─────────────────────────────────────────────
    function updateModeUI() {
        if (currentAction) currentAction.textContent = 'Aether Chat';
        if (statusSubtitle) statusSubtitle.textContent = 'Enter a prompt to initiate precision discussion among ChatGPT, Claude, and Gemini.';
        if (promptInput) promptInput.placeholder = isRoundComplete ? 'Contribute to the roundtable, or press Continue Round ▶...' : 'Contribute to the roundtable...';
    }

    // ─── New Thread (Clear & Reset) ────────────────────────────────────
    if (newThreadBtn) {
        newThreadBtn.addEventListener('click', () => {
            if (isBusy) return;
            resetChatSession();
        });
    }

    let pendingDeleteAction = null;

    function showConfirmModal(title, desc, confirmBtnText, onConfirm) {
        if (confirmModalTitle) confirmModalTitle.textContent = title || 'Delete Discussion?';
        if (confirmModalDesc) confirmModalDesc.textContent = desc || 'Are you sure you want to delete this session?';
        if (confirmDeleteBtn) confirmDeleteBtn.textContent = confirmBtnText || 'Delete';
        pendingDeleteAction = onConfirm;
        if (confirmModalOverlay) confirmModalOverlay.classList.remove('hidden');
    }

    function hideConfirmModal() {
        pendingDeleteAction = null;
        if (confirmModalOverlay) confirmModalOverlay.classList.add('hidden');
    }

    if (clearAllHistoryBtn) {
        clearAllHistoryBtn.addEventListener('click', () => {
            if (isBusy) return;
            showConfirmModal(
                'Clear All History?',
                'This will permanently delete all discussion threads, roundtable sessions, and message history stored in the application.',
                'Clear All History',
                () => {
                    clearAllThreads();
                }
            );
        });
    }

    if (confirmCancelBtn) {
        confirmCancelBtn.addEventListener('click', hideConfirmModal);
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', () => {
            if (pendingDeleteAction) {
                pendingDeleteAction();
            }
            hideConfirmModal();
        });
    }

    if (confirmModalOverlay) {
        confirmModalOverlay.addEventListener('click', (e) => {
            if (e.target === confirmModalOverlay) hideConfirmModal();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && confirmModalOverlay && !confirmModalOverlay.classList.contains('hidden')) {
            hideConfirmModal();
        }
    });

    function resetChatSession() {
        showChatView();
        activeThreadId = generateThreadId();
        conversationLog = [];
        savedFeedItems = [];
        isRoundComplete = false;
        lastRoundNumber = 0;
        hideContinueButton();
        removeTypingIndicator();
        Object.values(agents).forEach(el => el && el.classList.remove('active'));

        chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' }).catch(() => {});

        renderWelcomeMessage();
        promptInput.value = '';
        promptInput.style.height = 'auto';
        promptInput.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        promptInput.focus();

        renderHistoryView();
    }

    // ─── Navigation Listeners ──────────────────────────────────────────
    if (navSettings) {
        navSettings.addEventListener('click', () => {
            showSettingsView();
        });
    }

    if (backToChatFromSettingsBtn) {
        backToChatFromSettingsBtn.addEventListener('click', () => {
            showChatView();
        });
    }

    if (closePanelBtn) {
        closePanelBtn.addEventListener('click', () => {
            window.close();
        });
    }

    // ─── Theme Management (Light, Dark, System) ────────────────────────
    const themeCards = document.querySelectorAll('.theme-option-card');
    let currentTheme = 'system';

    function applyTheme(themeName, save = true) {
        currentTheme = themeName || 'system';
        
        let effectiveTheme = currentTheme;
        if (currentTheme === 'system') {
            const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            effectiveTheme = isDark ? 'dark' : 'light';
        }

        document.documentElement.setAttribute('data-theme', effectiveTheme);
        if (document.body) {
            document.body.classList.toggle('dark-theme', effectiveTheme === 'dark');
        }

        // Update active class on theme cards in settings
        if (themeCards && themeCards.length > 0) {
            themeCards.forEach(card => {
                if (card.dataset.themeValue === currentTheme) {
                    card.classList.add('active');
                } else {
                    card.classList.remove('active');
                }
            });
        }

        if (save && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ app_theme: currentTheme });
        }
    }

    function setupThemeListeners() {
        if (themeCards && themeCards.length > 0) {
            themeCards.forEach(card => {
                card.addEventListener('click', () => {
                    const themeVal = card.dataset.themeValue;
                    applyTheme(themeVal, true);
                });
            });
        }

        // Auto-switch if system theme changes
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                if (currentTheme === 'system') {
                    applyTheme('system', false);
                }
            });
        }
    }

    function loadThemeFromStorage() {
        if (!chrome.storage || !chrome.storage.local) {
            applyTheme('system', false);
            return;
        }
        chrome.storage.local.get(['app_theme'], (res) => {
            if (res.app_theme) {
                applyTheme(res.app_theme, false);
            } else {
                applyTheme('system', false);
            }
        });
    }

    // ─── View Screen Transitions (Chat vs Personas vs History vs Settings) ─
    function showChatView() {
        if (personasView) personasView.classList.add('hidden');
        if (historyView) historyView.classList.add('hidden');
        if (settingsView) settingsView.classList.add('hidden');
        if (chatView) chatView.classList.remove('hidden');
        if (navChat) navChat.classList.add('active');
        if (navPersonas) navPersonas.classList.remove('active');
        if (navHistory) navHistory.classList.remove('active');
        if (navSettings) navSettings.classList.remove('active');
        if (currentAction) {
            currentAction.textContent = 'Aether Chat';
        }
    }

    function showPersonasView() {
        if (chatView) chatView.classList.add('hidden');
        if (historyView) historyView.classList.add('hidden');
        if (settingsView) settingsView.classList.add('hidden');
        if (personasView) personasView.classList.remove('hidden');
        if (navPersonas) navPersonas.classList.add('active');
        if (navChat) navChat.classList.remove('active');
        if (navHistory) navHistory.classList.remove('active');
        if (navSettings) navSettings.classList.remove('active');
        if (currentAction) currentAction.textContent = 'Configure Personas';

        if (personaUserName) personaUserName.value = (PERSONA_MAP.user && PERSONA_MAP.user.name) ? PERSONA_MAP.user.name : DEFAULT_PERSONAS.user.name;
        if (personaUserRole) personaUserRole.value = (PERSONA_MAP.user && PERSONA_MAP.user.role) ? PERSONA_MAP.user.role : DEFAULT_PERSONAS.user.role;
        if (personaGptName) personaGptName.value = PERSONA_MAP.chatgpt ? PERSONA_MAP.chatgpt.name : DEFAULT_PERSONAS.chatgpt.name;
        if (personaGptPrompt) personaGptPrompt.value = (PERSONA_MAP.chatgpt && PERSONA_MAP.chatgpt.rolePrompt) ? PERSONA_MAP.chatgpt.rolePrompt : DEFAULT_PERSONAS.chatgpt.rolePrompt;
        if (personaClaudeName) personaClaudeName.value = PERSONA_MAP.claude ? PERSONA_MAP.claude.name : DEFAULT_PERSONAS.claude.name;
        if (personaClaudePrompt) personaClaudePrompt.value = (PERSONA_MAP.claude && PERSONA_MAP.claude.rolePrompt) ? PERSONA_MAP.claude.rolePrompt : DEFAULT_PERSONAS.claude.rolePrompt;
        if (personaGeminiName) personaGeminiName.value = PERSONA_MAP.gemini ? PERSONA_MAP.gemini.name : DEFAULT_PERSONAS.gemini.name;
        if (personaGeminiPrompt) personaGeminiPrompt.value = (PERSONA_MAP.gemini && PERSONA_MAP.gemini.rolePrompt) ? PERSONA_MAP.gemini.rolePrompt : DEFAULT_PERSONAS.gemini.rolePrompt;

        if (personaCharacterLimit && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['maxCharacters'], (res) => {
                if (res.maxCharacters) personaCharacterLimit.value = res.maxCharacters;
            });
        }
    }

    function showHistoryView() {
        if (chatView) chatView.classList.add('hidden');
        if (personasView) personasView.classList.add('hidden');
        if (settingsView) settingsView.classList.add('hidden');
        if (historyView) historyView.classList.remove('hidden');
        if (navHistory) navHistory.classList.add('active');
        if (navChat) navChat.classList.remove('active');
        if (navPersonas) navPersonas.classList.remove('active');
        if (navSettings) navSettings.classList.remove('active');
        if (currentAction) currentAction.textContent = 'Discussion Archive';
        const searchVal = historySearchInput ? historySearchInput.value.trim() : '';
        renderHistoryView(searchVal);
    }

    function showSettingsView() {
        if (chatView) chatView.classList.add('hidden');
        if (personasView) personasView.classList.add('hidden');
        if (historyView) historyView.classList.add('hidden');
        if (settingsView) settingsView.classList.remove('hidden');
        if (navSettings) navSettings.classList.add('active');
        if (navChat) navChat.classList.remove('active');
        if (navPersonas) navPersonas.classList.remove('active');
        if (navHistory) navHistory.classList.remove('active');
        if (currentAction) currentAction.textContent = 'Settings & Preferences';
    }

    function updateSidebarPersonaLabels() {
        const gptRow = document.querySelector('#agent-gpt .persona-name');
        const claudeRow = document.querySelector('#agent-claude .persona-name');
        const geminiRow = document.querySelector('#agent-gemini .persona-name');

        if (gptRow && PERSONA_MAP.chatgpt) gptRow.textContent = `${PERSONA_MAP.chatgpt.name} (ChatGPT)`;
        if (claudeRow && PERSONA_MAP.claude) claudeRow.textContent = `${PERSONA_MAP.claude.name} (Claude)`;
        if (geminiRow && PERSONA_MAP.gemini) geminiRow.textContent = `${PERSONA_MAP.gemini.name} (Gemini)`;

        updateToggleUI();
    }

    function updateToggleUI() {
        const toggles = document.querySelectorAll('.ai-toggle-input');
        toggles.forEach(input => {
            const agent = input.dataset.agent;
            if (agent && enabledAgents[agent] !== undefined) {
                input.checked = enabledAgents[agent];
                const row = input.closest('.persona-row');
                if (row) {
                    if (enabledAgents[agent]) {
                        row.classList.remove('is-excluded');
                    } else {
                        row.classList.add('is-excluded');
                    }
                }
            }
        });
    }

    function setupToggleListeners() {
        const toggles = document.querySelectorAll('.ai-toggle-input');
        toggles.forEach(input => {
            input.addEventListener('change', () => {
                const agent = input.dataset.agent;
                if (!agent) return;

                // Ensure at least one AI remains active
                const futureState = { ...enabledAgents, [agent]: input.checked };
                const activeCount = Object.values(futureState).filter(Boolean).length;

                if (activeCount === 0) {
                    input.checked = true;
                    showSettingsMessage('At least one AI model must remain active.');
                    return;
                }

                enabledAgents[agent] = input.checked;
                updateToggleUI();

                if (chrome.storage && chrome.storage.local) {
                    chrome.storage.local.set({ enabled_agents: enabledAgents });
                }

                chrome.runtime.sendMessage({
                    type: 'UPDATE_ENABLED_AGENTS',
                    enabledAgents: enabledAgents
                }).catch(() => {});
            });
        });
    }

    function loadEnabledAgentsFromStorage() {
        if (!chrome.storage || !chrome.storage.local) return;
        chrome.storage.local.get(['enabled_agents'], (res) => {
            if (res.enabled_agents && typeof res.enabled_agents === 'object') {
                enabledAgents = { ...enabledAgents, ...res.enabled_agents };
                updateToggleUI();
            }
        });
    }

    // ─── Font Size Zoom Scaling ─────────────────────────────────────────
    const fontDecreaseBtn = document.getElementById('font-decrease-btn');
    const fontIncreaseBtn = document.getElementById('font-increase-btn');
    const fontSizeLabel = document.getElementById('font-size-label');

    const FONT_SCALES = [
        { label: '80%',  rootSize: '92%' },
        { label: '90%',  rootSize: '103.5%' },
        { label: '100%', rootSize: '115%' }, // Default: 115% base font size
        { label: '115%', rootSize: '132%' },
        { label: '130%', rootSize: '150%' },
        { label: '150%', rootSize: '172%' },
        { label: '170%', rootSize: '195%' }
    ];
    let currentFontScaleIndex = 2; // Default index for 100% (115% root size)

    function applyFontScale(index) {
        if (index < 0) index = 0;
        if (index >= FONT_SCALES.length) index = FONT_SCALES.length - 1;
        currentFontScaleIndex = index;

        const scale = FONT_SCALES[currentFontScaleIndex];
        document.documentElement.style.fontSize = scale.rootSize;

        if (fontSizeLabel) {
            fontSizeLabel.textContent = scale.label;
        }

        if (fontDecreaseBtn) {
            fontDecreaseBtn.disabled = (currentFontScaleIndex === 0);
        }
        if (fontIncreaseBtn) {
            fontIncreaseBtn.disabled = (currentFontScaleIndex === FONT_SCALES.length - 1);
        }

        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ chat_font_scale_index: currentFontScaleIndex });
        }
    }

    function setupFontScaleListeners() {
        if (fontDecreaseBtn) {
            fontDecreaseBtn.addEventListener('click', () => {
                if (currentFontScaleIndex > 0) {
                    applyFontScale(currentFontScaleIndex - 1);
                }
            });
        }

        if (fontIncreaseBtn) {
            fontIncreaseBtn.addEventListener('click', () => {
                if (currentFontScaleIndex < FONT_SCALES.length - 1) {
                    applyFontScale(currentFontScaleIndex + 1);
                }
            });
        }
    }

    function loadFontScaleFromStorage() {
        if (!chrome.storage || !chrome.storage.local) return;
        chrome.storage.local.get(['chat_font_scale_index'], (res) => {
            if (res.chat_font_scale_index !== undefined && res.chat_font_scale_index >= 0 && res.chat_font_scale_index < FONT_SCALES.length) {
                applyFontScale(res.chat_font_scale_index);
            } else {
                applyFontScale(2);
            }
        });
    }

    function applyPersonasToMap(custom) {
        if (!custom) return;
        if (custom.user) {
            const rawName = custom.user.name || DEFAULT_PERSONAS.user.name;
            const name = rawName.replace(/\s*\([^)]*\)/g, '').trim() || 'You';
            const role = (custom.user.role || '').replace(/\s*\([^)]*\)/g, '').trim();
            PERSONA_MAP.user = { name, role, service: 'User', monogram: 'YOU' };
        }
        if (custom.chatgpt || custom.ChatGPT) {
            const src = custom.chatgpt || custom.ChatGPT;
            const rawName = src.name || DEFAULT_PERSONAS.chatgpt.name;
            const name = rawName.replace(/\s*\([^)]*\)/g, '').trim() || 'Alex';
            const role = '';
            const rolePrompt = (src.rolePrompt !== undefined) ? src.rolePrompt : DEFAULT_PERSONAS.chatgpt.rolePrompt;
            const monogram = name.substring(0, 2).toUpperCase();
            PERSONA_MAP.chatgpt = { name, role, rolePrompt, service: 'ChatGPT', monogram };
            PERSONA_MAP.ChatGPT = PERSONA_MAP.chatgpt;
        }
        if (custom.claude || custom.Claude) {
            const src = custom.claude || custom.Claude;
            const rawName = src.name || DEFAULT_PERSONAS.claude.name;
            const name = rawName.replace(/\s*\([^)]*\)/g, '').trim() || 'Morgan';
            const role = '';
            const rolePrompt = (src.rolePrompt !== undefined) ? src.rolePrompt : DEFAULT_PERSONAS.claude.rolePrompt;
            const monogram = name.substring(0, 2).toUpperCase();
            PERSONA_MAP.claude = { name, role, rolePrompt, service: 'Claude', monogram };
            PERSONA_MAP.Claude = PERSONA_MAP.claude;
        }
        if (custom.gemini || custom.Gemini) {
            const src = custom.gemini || custom.Gemini;
            const rawName = src.name || DEFAULT_PERSONAS.gemini.name;
            const name = rawName.replace(/\s*\([^)]*\)/g, '').trim() || 'Jordan';
            const role = '';
            const rolePrompt = (src.rolePrompt !== undefined) ? src.rolePrompt : DEFAULT_PERSONAS.gemini.rolePrompt;
            const monogram = name.substring(0, 2).toUpperCase();
            PERSONA_MAP.gemini = { name, role, rolePrompt, service: 'Gemini', monogram };
            PERSONA_MAP.Gemini = PERSONA_MAP.gemini;
        }
        updateSidebarPersonaLabels();
    }

    function savePersonasConfig() {
        const custom = {
            user: {
                name: (personaUserName && personaUserName.value.trim()) || DEFAULT_PERSONAS.user.name,
                role: (personaUserRole && personaUserRole.value.trim()) || DEFAULT_PERSONAS.user.role
            },
            chatgpt: {
                name: (personaGptName && personaGptName.value.trim()) || DEFAULT_PERSONAS.chatgpt.name,
                role: '',
                rolePrompt: (personaGptPrompt && personaGptPrompt.value.trim()) || DEFAULT_PERSONAS.chatgpt.rolePrompt
            },
            claude: {
                name: (personaClaudeName && personaClaudeName.value.trim()) || DEFAULT_PERSONAS.claude.name,
                role: '',
                rolePrompt: (personaClaudePrompt && personaClaudePrompt.value.trim()) || DEFAULT_PERSONAS.claude.rolePrompt
            },
            gemini: {
                name: (personaGeminiName && personaGeminiName.value.trim()) || DEFAULT_PERSONAS.gemini.name,
                role: '',
                rolePrompt: (personaGeminiPrompt && personaGeminiPrompt.value.trim()) || DEFAULT_PERSONAS.gemini.rolePrompt
            }
        };

        applyPersonasToMap(custom);

        const limitVal = (personaCharacterLimit && parseInt(personaCharacterLimit.value, 10)) || 500;
        const rulesVal = (personaRulesInput && personaRulesInput.value.trim()) || DEFAULT_RULES;

        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({
                custom_personas: custom,
                maxCharacters: limitVal,
                custom_rules: rulesVal
            });
        }

        chrome.runtime.sendMessage({
            type: 'UPDATE_PERSONAS',
            customPersonas: custom,
            maxCharacters: limitVal,
            customRules: rulesVal
        }).catch(() => {});

        if (personasSavedMsg) {
            personasSavedMsg.classList.remove('hidden');
            setTimeout(() => {
                personasSavedMsg.classList.add('hidden');
                showChatView();
            }, 650);
        } else {
            showChatView();
        }
    }

    function resetPersonasConfig() {
        if (personaUserName) personaUserName.value = DEFAULT_PERSONAS.user.name;
        if (personaUserRole) personaUserRole.value = DEFAULT_PERSONAS.user.role;
        if (personaGptName) personaGptName.value = DEFAULT_PERSONAS.chatgpt.name;
        if (personaGptPrompt) personaGptPrompt.value = DEFAULT_PERSONAS.chatgpt.rolePrompt;
        if (personaClaudeName) personaClaudeName.value = DEFAULT_PERSONAS.claude.name;
        if (personaClaudePrompt) personaClaudePrompt.value = DEFAULT_PERSONAS.claude.rolePrompt;
        if (personaGeminiName) personaGeminiName.value = DEFAULT_PERSONAS.gemini.name;
        if (personaGeminiPrompt) personaGeminiPrompt.value = DEFAULT_PERSONAS.gemini.rolePrompt;
        if (personaCharacterLimit) personaCharacterLimit.value = '500';
        if (personaRulesInput) personaRulesInput.value = DEFAULT_RULES;
    }

    function loadPersonasFromStorage() {
        if (!chrome.storage || !chrome.storage.local) return;
        chrome.storage.local.get(['custom_personas', 'maxCharacters', 'custom_rules'], (res) => {
            if (res.custom_personas) {
                applyPersonasToMap(res.custom_personas);
            } else {
                updateSidebarPersonaLabels();
            }
            if (personaCharacterLimit && res.maxCharacters) {
                personaCharacterLimit.value = res.maxCharacters;
            }
            if (personaRulesInput) {
                personaRulesInput.value = res.custom_rules || DEFAULT_RULES;
            }
        });
    }

    if (navChat) {
        navChat.addEventListener('click', () => {
            showChatView();
        });
    }

    if (navPersonas) {
        navPersonas.addEventListener('click', () => {
            showPersonasView();
        });
    }

    if (cancelPersonasBtn) {
        cancelPersonasBtn.addEventListener('click', () => {
            showChatView();
        });
    }

    if (savePersonasBtn) {
        savePersonasBtn.addEventListener('click', savePersonasConfig);
    }

    if (resetPersonasBtn) {
        resetPersonasBtn.addEventListener('click', resetPersonasConfig);
    }

    if (navHistory) {
        navHistory.addEventListener('click', () => {
            showHistoryView();
        });
    }

    if (backToChatFromHistoryBtn) {
        backToChatFromHistoryBtn.addEventListener('click', () => {
            showChatView();
        });
    }

    if (historySearchInput) {
        historySearchInput.addEventListener('input', (e) => {
            renderHistoryView(e.target.value.trim());
        });
    }

    // ─── Mention Autocomplete & Tagging ────────────────────────────────
    const mentionPopup = document.getElementById('mention-popup');
    const mentionPopupList = document.getElementById('mention-popup-list');
    let mentionActiveIndex = 0;
    let currentMentionCandidates = [];

    function detectTaggedAgents(promptText) {
        if (!promptText) return [];
        const text = promptText.toLowerCase();
        const tagged = [];

        const gptName = (PERSONA_MAP.chatgpt && PERSONA_MAP.chatgpt.name ? PERSONA_MAP.chatgpt.name.toLowerCase() : 'alex');
        const claudeName = (PERSONA_MAP.claude && PERSONA_MAP.claude.name ? PERSONA_MAP.claude.name.toLowerCase() : 'morgan');
        const geminiName = (PERSONA_MAP.gemini && PERSONA_MAP.gemini.name ? PERSONA_MAP.gemini.name.toLowerCase() : 'jordan');

        // Word-boundary match to avoid false positives (e.g. @al matching @alex)
        function hasTag(name) {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp('(?:^|\\s)@' + escaped + '(?:\\s|$|[,;.!?])', 'i').test(text);
        }

        const hasGpt = hasTag('chatgpt') || hasTag('gpt') || hasTag(gptName);
        const hasClaude = hasTag('claude') || hasTag(claudeName);
        const hasGemini = hasTag('gemini') || hasTag(geminiName);

        if (hasGpt && enabledAgents.chatgpt !== false) tagged.push('chatgpt');
        if (hasClaude && enabledAgents.claude !== false) tagged.push('claude');
        if (hasGemini && enabledAgents.gemini !== false) tagged.push('gemini');

        return tagged;
    }

    function getMentionCandidates() {
        const list = [];
        if (enabledAgents.chatgpt !== false) {
            list.push({
                key: 'chatgpt',
                name: (PERSONA_MAP.chatgpt && PERSONA_MAP.chatgpt.name) ? PERSONA_MAP.chatgpt.name : 'Alex',
                service: 'ChatGPT',
                cls: 'chatgpt',
                monogram: (PERSONA_MAP.chatgpt && PERSONA_MAP.chatgpt.monogram) ? PERSONA_MAP.chatgpt.monogram : 'AL'
            });
        }
        if (enabledAgents.claude !== false) {
            list.push({
                key: 'claude',
                name: (PERSONA_MAP.claude && PERSONA_MAP.claude.name) ? PERSONA_MAP.claude.name : 'Morgan',
                service: 'Claude',
                cls: 'claude',
                monogram: (PERSONA_MAP.claude && PERSONA_MAP.claude.monogram) ? PERSONA_MAP.claude.monogram : 'MO'
            });
        }
        if (enabledAgents.gemini !== false) {
            list.push({
                key: 'gemini',
                name: (PERSONA_MAP.gemini && PERSONA_MAP.gemini.name) ? PERSONA_MAP.gemini.name : 'Jordan',
                service: 'Gemini',
                cls: 'gemini',
                monogram: (PERSONA_MAP.gemini && PERSONA_MAP.gemini.monogram) ? PERSONA_MAP.gemini.monogram : 'JO'
            });
        }
        return list;
    }

    function showMentionPopup(query) {
        if (!mentionPopup || !mentionPopupList) return;
        const q = (query || '').toLowerCase().trim();
        const allCandidates = getMentionCandidates();
        currentMentionCandidates = allCandidates.filter(c => {
            if (!q) return true;
            return c.name.toLowerCase().includes(q) || c.service.toLowerCase().includes(q);
        });

        if (currentMentionCandidates.length === 0) {
            hideMentionPopup();
            return;
        }

        mentionActiveIndex = 0;
        renderMentionPopupItems();
        mentionPopup.classList.remove('hidden');
    }

    function hideMentionPopup() {
        if (mentionPopup) {
            mentionPopup.classList.add('hidden');
        }
        currentMentionCandidates = [];
    }

    function renderMentionPopupItems() {
        if (!mentionPopupList) return;
        mentionPopupList.innerHTML = '';

        currentMentionCandidates.forEach((cand, idx) => {
            const item = document.createElement('div');
            item.className = `mention-item ${idx === mentionActiveIndex ? 'active' : ''}`;
            item.innerHTML = `
                <div class="mention-avatar ${cand.cls}">${escapeHtml(cand.monogram)}</div>
                <div class="mention-info">
                    <div class="mention-name">@${escapeHtml(cand.name)}</div>
                    <div class="mention-service">${escapeHtml(cand.service)}</div>
                </div>
            `;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectMention(cand);
            });
            mentionPopupList.appendChild(item);
        });
    }

    function updateMentionActiveItem() {
        if (!mentionPopupList) return;
        const items = mentionPopupList.querySelectorAll('.mention-item');
        items.forEach((it, idx) => {
            if (idx === mentionActiveIndex) {
                it.classList.add('active');
                it.scrollIntoView({ block: 'nearest' });
            } else {
                it.classList.remove('active');
            }
        });
    }

    function selectMention(candidate) {
        if (!promptInput || !candidate) return;
        const text = promptInput.value;
        const cursorPos = promptInput.selectionStart || text.length;
        const textBeforeCursor = text.substring(0, cursorPos);
        const textAfterCursor = text.substring(cursorPos);

        const atIndex = textBeforeCursor.lastIndexOf('@');
        if (atIndex !== -1) {
            const newBefore = textBeforeCursor.substring(0, atIndex) + `@${candidate.name} `;
            promptInput.value = newBefore + textAfterCursor;
            const newCursor = newBefore.length;
            promptInput.setSelectionRange(newCursor, newCursor);
        } else {
            promptInput.value = text + `@${candidate.name} `;
        }

        hideMentionPopup();
        promptInput.focus();
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
    }

    // ─── Auto-resize textarea & Mention trigger ────────────────────────
    promptInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 140) + 'px';

        const cursorPos = this.selectionStart;
        const textUpToCursor = this.value.substring(0, cursorPos);
        const match = textUpToCursor.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);

        if (match) {
            showMentionPopup(match[1]);
        } else {
            hideMentionPopup();
        }
    });

    promptInput.addEventListener('keydown', (e) => {
        if (mentionPopup && !mentionPopup.classList.contains('hidden') && currentMentionCandidates.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                mentionActiveIndex = (mentionActiveIndex + 1) % currentMentionCandidates.length;
                updateMentionActiveItem();
                return;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                mentionActiveIndex = (mentionActiveIndex - 1 + currentMentionCandidates.length) % currentMentionCandidates.length;
                updateMentionActiveItem();
                return;
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                selectMention(currentMentionCandidates[mentionActiveIndex]);
                return;
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hideMentionPopup();
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    document.addEventListener('click', (e) => {
        if (mentionPopup && !mentionPopup.contains(e.target) && e.target !== promptInput) {
            hideMentionPopup();
        }
    });

    if (sendBtn) {
        sendBtn.addEventListener('click', handleSend);
    }

    if (continueBtn) {
        continueBtn.addEventListener('click', handleContinue);
    }

    // ─── Messaging & Round Handlers ────────────────────────────────────
    function handleSend() {
        const text = promptInput.value.trim();
        if (!text || isBusy) return;

        const welcome = document.querySelector('.welcome-message');
        if (welcome) welcome.remove();

        const taggedAgents = detectTaggedAgents(text);
        hideMentionPopup();

        isBusy = true;
        promptInput.value = '';
        promptInput.style.height = 'auto';
        promptInput.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        hideContinueButton();

        // Render user message
        appendMessage('You', text, 'user');

        const limitVal = (personaCharacterLimit && parseInt(personaCharacterLimit.value, 10)) || 500;
        const rulesVal = (personaRulesInput && personaRulesInput.value.trim()) || DEFAULT_RULES;

        if (isRoundComplete) {
            isRoundComplete = false;
            addRoundSeparator(lastRoundNumber + 1);
            chrome.runtime.sendMessage({ 
                type: 'CONTINUE_WITH_INPUT', 
                prompt: text,
                taggedAgents: taggedAgents.length > 0 ? taggedAgents : null,
                enabledAgents: enabledAgents,
                conversationLog: conversationLog,
                customPersonas: PERSONA_MAP,
                maxCharacters: limitVal,
                customRules: rulesVal
            }, (response) => {
                console.log('Continue with input started:', response);
            });
        } else {
            isRoundComplete = false;
            conversationLog = [];
            lastRoundNumber = 0;
            addRoundSeparator(1);
            chrome.runtime.sendMessage({ 
                type: 'START_BROADCAST', 
                prompt: text,
                taggedAgents: taggedAgents.length > 0 ? taggedAgents : null,
                enabledAgents: enabledAgents,
                customPersonas: PERSONA_MAP,
                maxCharacters: limitVal,
                customRules: rulesVal
            }, (response) => {
                console.log('Broadcast started:', response);
            });
        }
    }

    function handleContinue() {
        if (isBusy || !isRoundComplete) return;

        isBusy = true;
        isRoundComplete = false;
        promptInput.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        hideContinueButton();

        addRoundSeparator(lastRoundNumber + 1);

        const limitVal = (personaCharacterLimit && parseInt(personaCharacterLimit.value, 10)) || 500;
        const rulesVal = (personaRulesInput && personaRulesInput.value.trim()) || DEFAULT_RULES;

        chrome.runtime.sendMessage({
            type: 'CONTINUE_BROADCAST',
            conversationLog: conversationLog,
            enabledAgents: enabledAgents,
            customPersonas: PERSONA_MAP,
            maxCharacters: limitVal,
            customRules: rulesVal
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

    function renderRoundSeparatorDOM(roundNumber) {
        const themeIndex = Math.min(roundNumber - 1, ROUND_THEMES.length - 1);
        const theme = ROUND_THEMES[themeIndex] || 'CONTINUED DISCUSSION';
        const sep = document.createElement('div');
        sep.className = 'round-separator';
        sep.innerHTML = `<span class="round-label">ROUND ${roundNumber}: ${theme}</span>`;
        messagesContainer.appendChild(sep);
        scrollToBottom();
    }

    function addRoundSeparator(roundNumber, shouldSave = true) {
        renderRoundSeparatorDOM(roundNumber);
        if (shouldSave) {
            savedFeedItems.push({
                type: 'sep',
                roundNumber
            });
            saveCurrentThreadState();
        }
    }

    function formatTimeNow() {
        const now = new Date();
        return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function renderMessageDOM(sender, text, type, agentClass = '', personaInfo = null, timeStr = null) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message-row ${type} ${agentClass}`;
        const time = timeStr || formatTimeNow();
        
        if (type === 'user') {
            const uName = (PERSONA_MAP.user && PERSONA_MAP.user.name) ? PERSONA_MAP.user.name.replace(/\s*\([^)]*\)/g, '').trim().toUpperCase() : 'YOU';
            const userHeader = uName;

            msgDiv.innerHTML = `
                <div class="message-card user-card">
                    <div class="message-card-header">
                        <span class="message-agent-name user-name">${escapeHtml(userHeader)}</span>
                        <span class="message-time">${time}</span>
                    </div>
                    <div class="message-body">${escapeHtml(text)}</div>
                </div>
            `;
        } else {
            const pInfo = personaInfo || PERSONA_MAP[sender] || PERSONA_MAP[agentClass] || { name: sender, service: sender, monogram: sender.substring(0, 2).toUpperCase() };
            const cleanName = (pInfo.name || sender).replace(/\s*\([^)]*\)/g, '').trim().toUpperCase();
            const serviceName = (pInfo.service || agentClass || '').replace(/\s*\([^)]*\)/g, '').trim().toUpperCase();
            const displayName = (serviceName && serviceName !== cleanName) ? `${cleanName} (${serviceName})` : cleanName;
            const monogram = pInfo.monogram || cleanName.substring(0, 2).toUpperCase();
            const cls = (agentClass || (pInfo.service ? pInfo.service.toLowerCase() : 'ai')).toLowerCase();

            msgDiv.innerHTML = `
                <div class="message-avatar ${cls}">${monogram}</div>
                <div class="message-card ai-card ${cls}-card">
                    <div class="message-card-header">
                        <span class="message-agent-name ${cls}-name">${escapeHtml(displayName)}</span>
                        <span class="message-time">${time}</span>
                    </div>
                    <div class="message-body">${escapeHtml(text)}</div>
                </div>
            `;
        }
        
        messagesContainer.appendChild(msgDiv);
        scrollToBottom();
        return msgDiv;
    }

    function appendMessage(sender, text, type, agentClass = '', personaInfo = null, shouldSave = true) {
        const timeStr = formatTimeNow();
        const pInfo = personaInfo || (type !== 'user' ? (PERSONA_MAP[sender] || PERSONA_MAP[agentClass] || null) : null);
        const msgDiv = renderMessageDOM(sender, text, type, agentClass, pInfo, timeStr);

        if (shouldSave) {
            savedFeedItems.push({
                type: 'msg',
                sender,
                text,
                msgType: type,
                agentClass,
                personaInfo: pInfo,
                timeStr
            });
            saveCurrentThreadState();
        }
        return msgDiv;
    }

    let currentStreamDiv = null;
    let currentStreamAgent = null;

    function setTypingIndicator(agentName) {
        removeTypingIndicator();
        const pInfo = PERSONA_MAP[agentName] || { name: agentName };
        const div = document.createElement('div');
        div.id = 'typing-indicator';
        div.className = 'typing-indicator-row';
        div.innerHTML = `
            <div class="typing-pill">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <span>${pInfo.name} is formulating response...</span>
            </div>
        `;
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

    // ─── Background Runtime Listener ───────────────────────────────────
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'UI_UPDATE') {
            console.log('[UI_UPDATE]', message);

            if (message.status && statusSubtitle) {
                statusSubtitle.textContent = message.status;
            }

            // Update active persona indicator dots in sidebar
            Object.values(agents).forEach(el => el && el.classList.remove('active'));
            if (message.currentAgent && agents[message.currentAgent]) {
                agents[message.currentAgent].classList.add('active');
                setTypingIndicator(message.currentAgent);
            } else if (!message.currentAgent) {
                removeTypingIndicator();
            }

            // Final text arrived
            if (message.text !== undefined && message.text !== null && message.currentAgent) {
                removeTypingIndicator();
                const pInfo = PERSONA_MAP[message.currentAgent] || { 
                    name: message.personaName || message.currentAgent, 
                    role: message.personaTitle || 'Specialist', 
                    service: message.currentAgent 
                };
                const agentClass = message.currentAgent.toLowerCase();
                const displayText = message.text || '(No response captured)';

                if (currentStreamDiv && currentStreamAgent === message.currentAgent) {
                    const body = currentStreamDiv.querySelector('.message-body');
                    if (body) body.innerHTML = escapeHtml(displayText);
                    savedFeedItems.push({
                        type: 'msg',
                        sender: message.currentAgent,
                        text: displayText,
                        msgType: 'ai',
                        agentClass,
                        personaInfo: pInfo,
                        timeStr: formatTimeNow()
                    });
                    saveCurrentThreadState();
                    currentStreamDiv = null;
                    currentStreamAgent = null;
                } else {
                    appendMessage(message.currentAgent, displayText, 'ai', agentClass, pInfo, true);
                }
            }

            // Done flag
            if (message.done) {
                removeTypingIndicator();
                Object.values(agents).forEach(el => el && el.classList.remove('active'));

                if (message.roundComplete) {
                    if (message.conversationLog) {
                        conversationLog = message.conversationLog;
                    }
                    lastRoundNumber = message.roundNumber || lastRoundNumber + 1;
                    isRoundComplete = true;
                    saveCurrentThreadState();

                    enableInput();
                    showContinueButton();
                    promptInput.placeholder = 'Contribute to the roundtable, or press Continue Round ▶...';
                    if (statusSubtitle) {
                        statusSubtitle.textContent = `Round ${lastRoundNumber} complete. Reply or continue roundtable.`;
                    }
                } else {
                    enableInput();
                    hideContinueButton();
                    isRoundComplete = false;
                    saveCurrentThreadState();
                    if (statusSubtitle && (!message.status || !message.status.startsWith('Error:'))) {
                        statusSubtitle.textContent = 'Ready for new input.';
                    }
                }
            }

        } else if (message.type === 'STREAM_UPDATE') {
            removeTypingIndicator();
            const pInfo = PERSONA_MAP[message.agent] || { name: message.agent, role: 'Specialist', service: message.agent };

            if (!currentStreamDiv || currentStreamAgent !== message.agent) {
                currentStreamAgent = message.agent;
                currentStreamDiv = appendMessage(message.agent, message.text, 'ai', message.agent.toLowerCase(), pInfo, false);
            } else {
                const body = currentStreamDiv.querySelector('.message-body');
                if (body) body.innerHTML = escapeHtml(message.text);
                scrollToBottom();
            }
        }
    });

    // ─── Initial Load from Storage ─────────────────────────────────────
    setupThemeListeners();
    loadThemeFromStorage();
    setupFontScaleListeners();
    loadFontScaleFromStorage();
    setupToggleListeners();
    loadEnabledAgentsFromStorage();
    loadPersonasFromStorage();
    loadAllThreadsFromStorage();
});
