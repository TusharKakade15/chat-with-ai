// ChatGPT Content Script — Clean rewrite
// This script runs in the ChatGPT tab. The background.js will activate this tab
// before sending a message, so we can rely on normal DOM APIs.

(function() {
    const INPUT_SELECTORS = [
        '#prompt-textarea',
        'div[id="prompt-textarea"]',
        'div[contenteditable="true"]#prompt-textarea',
        'div.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"]',
        'textarea[data-id="root"]',
        'form textarea'
    ];

    const SEND_BUTTON_SELECTORS = [
        'button[data-testid="send-button"]',
        'button[data-testid="composer-send-button"]',
        'button[data-testid="fruitjuice-send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button[aria-label*="Send"]',
        'form button[type="submit"]'
    ];

    const STOP_BUTTON_SELECTORS = [
        'button[data-testid="stop-button"]',
        'button[aria-label="Stop generating"]',
        'button[aria-label="Stop streaming"]',
        'button[aria-label*="Stop"]',
        'button[data-testid*="stop"]'
    ];

    // ─── Text Extraction ───────────────────────────────────────────────

    function getAssistantTurnCount() {
        const main = document.querySelector('main') || document.body;
        const assistantEls = main.querySelectorAll('[data-message-author-role="assistant"]');
        return assistantEls.length;
    }

    function getLatestAssistantText() {
        const main = document.querySelector('main') || document.body;

        // Strategy 1: Find the last element with data-message-author-role="assistant"
        const assistantEls = Array.from(main.querySelectorAll('[data-message-author-role="assistant"]'));
        if (assistantEls.length > 0) {
            const last = assistantEls[assistantEls.length - 1];
            return extractText(last);
        }

        // Strategy 2: Check the last conversation turn (do not walk backwards to older turns)
        const turns = Array.from(document.querySelectorAll(
            '[data-testid^="conversation-turn-"], article'
        ));
        if (turns.length > 0) {
            const lastTurn = turns[turns.length - 1];
            const isUser = lastTurn.querySelector('[data-message-author-role="user"]') || lastTurn.querySelector('button[aria-label*="Edit"]');
            if (!isUser) {
                return extractText(lastTurn);
            }
        }

        // Strategy 3: Find .markdown or .prose in the last turn
        const markdowns = Array.from(main.querySelectorAll('.markdown, .prose, [class*="markdown"]'));
        if (markdowns.length > 0) {
            const lastMarkdown = markdowns[markdowns.length - 1];
            const parent = lastMarkdown.closest('[data-testid^="conversation-turn-"]') || lastMarkdown.closest('article');
            if (!parent || !parent.querySelector('[data-message-author-role="user"]')) {
                return extractText(lastMarkdown);
            }
        }

        return '';
    }

    function extractText(el) {
        if (!el) return '';
        const clone = el.cloneNode(true);
        // Remove non-content elements
        clone.querySelectorAll(
            'script, style, noscript, template, button, nav, svg, ' +
            '[role="button"], .sr-only, [data-testid*="action"], ' +
            '[class*="gizmo"], [class*="action-bar"], [class*="thinking"], ' +
            '[class*="thought"], [data-testid*="thought"], [data-testid*="search"]'
        ).forEach(n => n.remove());

        // Find the content container
        const content = clone.querySelector(
            '.markdown, .prose, [class*="markdown"], [class*="prose"], ' +
            'div.text-message, .whitespace-pre-wrap'
        ) || clone;

        // Use textContent (works even in background tabs, unlike innerText)
        const raw = content.textContent || '';
        return cleanText(raw);
    }

    function cleanText(raw) {
        if (!raw) return '';
        const utils = window.AIBridgeUtils;
        const textToProcess = utils && utils.extractDelimitedText ? utils.extractDelimitedText(raw) : raw;

        const junk = new Set([
            'ChatGPT can make mistakes. Check important info.',
            'ChatGPT can make mistakes. Verify important info.',
            'Ask anything', 'Message ChatGPT',
            'Think', 'Thinking Process', 'Thought',
            'Show more', 'Read more', 'View more', 'More',
            'Copy', 'Copy message', 'Share', 'Edit', 'Edit message',
            'Read aloud', 'Bad response', 'Good response',
            'Copy code', 'Memory updated'
        ]);

        return textToProcess.split('\n')
            .map(l => l.trim())
            .filter(l => {
                if (!l) return false;
                if (junk.has(l)) return false;
                if (/^(connecting to|searching|looking up|checking|loading|fetching|browsing|working on|using|calling|thinking|thought|synthesizing)\b/i.test(l)) return false;
                if (l.startsWith('{function') || l.includes('__oai_')) return false;
                if (l.includes('[SYSTEM INSTRUCTION')) return false;
                if (l.startsWith('ChatGPT said:') || l.startsWith('You said:')) return false;
                return true;
            })
            .join('\n')
            .trim();
    }

    function isIntermediaryText(text) {
        if (!text || text.trim().length === 0) return true;
        const trimmed = text.trim();
        if (/^(connecting to|searching|looking up|checking|loading|fetching|browsing|working on|using|calling|thinking|thought|synthesizing)\b/i.test(trimmed)) {
            return true;
        }
        return false;
    }

    // ─── Prompt Injection ──────────────────────────────────────────────

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[ChatGPT] Prompt injection starting. Tab is active.');

        // Snapshot: count assistant turns BEFORE we send
        const turnCountBefore = getAssistantTurnCount();
        const textBefore = getLatestAssistantText();
        console.log('[ChatGPT] Turns before:', turnCountBefore, '| Text before length:', textBefore.length);

        // 1. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS, 15000);
        console.log('[ChatGPT] Input found:', input.tagName, input.id);
        utils.simulateInput(input, promptText);

        // 2. Click Send
        let sent = false;
        for (let attempt = 0; attempt < 15; attempt++) {
            await new Promise(r => setTimeout(r, 300));
            const sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
            if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
                console.log('[ChatGPT] Send button ready, clicking.');
                utils.clickButton(sendBtn);
                sent = true;
                break;
            }
        }
        if (!sent) {
            console.log('[ChatGPT] Send button not found, trying Enter key.');
            utils.pressEnter(input);
        }

        // 3. Wait for new response
        console.log('[ChatGPT] Waiting for response...');
        const response = await waitForResponse(turnCountBefore, textBefore, promptText, 60000);
        console.log('[ChatGPT] Response captured:', response.substring(0, 100));
        return response || 'Error: Could not extract ChatGPT response.';
    });

    // ─── Polling for Response ──────────────────────────────────────────

    function isGenerating() {
        const utils = window.AIBridgeUtils;
        if (utils.findStopButton(STOP_BUTTON_SELECTORS)) return true;
        if (document.querySelector('.result-streaming, [class*="result-streaming"]')) return true;
        return false;
    }

    function waitForResponse(turnCountBefore, textBefore, promptText, timeoutMs) {
        return new Promise((resolve) => {
            const start = Date.now();
            let lastText = '';
            let stableCount = 0;
            let sawGenerating = false;

            const poll = setInterval(() => {
                const elapsed = Date.now() - start;
                const generating = isGenerating();
                if (generating) sawGenerating = true;

                const turnCountNow = getAssistantTurnCount();
                const currentText = getLatestAssistantText();
                const isIntermediary = isIntermediaryText(currentText);

                // Has ChatGPT produced genuine NEW text for this turn?
                // MUST NOT match previous turn's text or the prompt or intermediate status!
                const isNew = (
                    !isIntermediary &&
                    currentText.length >= 10 &&
                    currentText !== promptText.trim() &&
                    currentText !== textBefore
                );

                console.log('[ChatGPT Poll]', {
                    elapsed: elapsed + 'ms',
                    generating,
                    sawGenerating,
                    turns: turnCountBefore + '→' + turnCountNow,
                    textLen: currentText.length,
                    isNew
                });

                if (isNew) {
                    chrome.runtime.sendMessage({ type: 'STREAM_UPDATE', text: currentText, agent: 'ChatGPT' }).catch(() => {});
                    if (currentText === lastText) {
                        stableCount++;
                    } else {
                        stableCount = 0;
                        lastText = currentText;
                    }

                    // Done: observed generating and now stopped, text stable for 2 polls (~700ms)
                    if (sawGenerating && !generating && stableCount >= 2) {
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }

                    // Done: not generating, text stable for 2 polls, and at least 1500ms elapsed
                    if (!generating && stableCount >= 2 && elapsed > 1500) {
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }

                    // Safety finish: text stable for 4 consecutive polls and substantial
                    if (stableCount >= 4 && currentText.length > 25 && elapsed > 2000) {
                        console.log('[ChatGPT Poll] Text stable for 4 consecutive polls, resolving.');
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }
                }

                // Timeout
                if (elapsed >= timeoutMs) {
                    clearInterval(poll);
                    if (lastText && lastText !== textBefore && lastText !== promptText.trim()) {
                        resolve(lastText);
                    } else if (currentText && currentText !== textBefore && currentText !== promptText.trim()) {
                        resolve(currentText);
                    } else {
                        resolve('Error: ChatGPT generation timed out.');
                    }
                }
            }, 350);
        });
    }
})();
