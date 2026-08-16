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
            const text = extractText(last);
            if (text.length > 0) return text;
        }

        // Strategy 2: Find conversation turns, walk backwards to find non-user turn
        const turns = Array.from(document.querySelectorAll(
            '[data-testid^="conversation-turn-"], article'
        ));
        for (let i = turns.length - 1; i >= 0; i--) {
            const turn = turns[i];
            // Skip user turns
            if (turn.querySelector('[data-message-author-role="user"]')) continue;
            if (turn.querySelector('button[aria-label*="Edit"]')) continue;
            const text = extractText(turn);
            if (text.length > 0) return text;
        }

        // Strategy 3: Find .markdown or .prose containers
        const markdowns = Array.from(main.querySelectorAll('.markdown, .prose, [class*="markdown"]'));
        for (let i = markdowns.length - 1; i >= 0; i--) {
            const parent = markdowns[i].closest('[data-testid^="conversation-turn-"]') || markdowns[i].closest('article');
            if (parent && parent.querySelector('[data-message-author-role="user"]')) continue;
            const text = extractText(markdowns[i]);
            if (text.length > 0) return text;
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
            '[class*="gizmo"], [class*="action-bar"]'
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

        return raw.split('\n')
            .map(l => l.trim())
            .filter(l => {
                if (!l) return false;
                if (junk.has(l)) return false;
                if (l.startsWith('{function') || l.includes('__oai_')) return false;
                if (l.includes('[SYSTEM INSTRUCTION')) return false;
                if (l.startsWith('ChatGPT said:') || l.startsWith('You said:')) return false;
                return true;
            })
            .join('\n')
            .trim();
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

                // Is this genuinely new content?
                const isNew = (
                    currentText.length > 0 &&
                    currentText !== promptText.trim() &&
                    (turnCountNow > turnCountBefore || currentText !== textBefore)
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

                    // Done: not generating and text is stable for 3 polls (~1s)
                    if (!generating && stableCount >= 3) {
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }
                    // Fast path: not generating, stable for 1 poll, and > 3.5s elapsed
                    if (!generating && stableCount >= 1 && elapsed > 3500) {
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }
                }

                // Timeout
                if (elapsed >= timeoutMs) {
                    clearInterval(poll);
                    const fallback = (lastText && lastText !== promptText.trim()) ? lastText : currentText;
                    resolve(fallback || 'Error: ChatGPT generation timed out.');
                }
            }, 350);
        });
    }
})();
