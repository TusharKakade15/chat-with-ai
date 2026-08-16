// Claude Content Script — Complete Modern Rewrite
// Follows the same robust architecture as ChatGPT & Gemini

(function() {
    const INPUT_SELECTORS = [
        'div.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"].ProseMirror',
        'fieldset [contenteditable="true"]',
        'div[contenteditable="true"]',
        'textarea'
    ];

    const SEND_BUTTON_SELECTORS = [
        'button[aria-label="Send Message"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="send"]',
        'fieldset button:last-of-type',
        'button[data-testid="send-button"]'
    ];

    const STOP_BUTTON_SELECTORS = [
        'button[aria-label="Stop Response"]',
        'button[aria-label="Stop response"]',
        'button[aria-label="Stop generating"]',
        'button[aria-label*="Stop"]',
        '[data-is-streaming="true"]',
        '.is-streaming'
    ];

    // ─── Turn Counting & Extraction ────────────────────────────────────

    function getAssistantTurnCount() {
        const msgs = document.querySelectorAll('.font-claude-message, [data-is-streaming], div[data-test-render-id]');
        return msgs.length;
    }

    function getLatestAssistantText() {
        const main = document.querySelector('main') || document.body;

        // Strategy 1: Font Claude message elements
        const fontMsgs = Array.from(main.querySelectorAll('.font-claude-message'));
        if (fontMsgs.length > 0) {
            const last = fontMsgs[fontMsgs.length - 1];
            const text = extractText(last);
            if (text.length > 0) return text;
        }

        // Strategy 2: Prose / markdown blocks not belonging to user
        const proseMsgs = Array.from(main.querySelectorAll('.prose, [class*="prose"], div[class*="message-content"]'));
        for (let i = proseMsgs.length - 1; i >= 0; i--) {
            const el = proseMsgs[i];
            if (el.closest('[data-message-author="human"]') || el.closest('.font-user-message')) continue;
            const text = extractText(el);
            if (text.length > 0) return text;
        }

        return '';
    }

    function extractText(el) {
        if (!el) return '';
        const clone = el.cloneNode(true);

        clone.querySelectorAll(
            'script, style, noscript, template, button, nav, svg, ' +
            '[role="button"], .sr-only, [data-testid*="action"], ' +
            '.action-bar, .feedback-container'
        ).forEach(n => n.remove());

        const content = clone.querySelector(
            '.prose, [class*="prose"], .whitespace-pre-wrap'
        ) || clone;

        const raw = content.textContent || '';
        return cleanText(raw);
    }

    function cleanText(raw) {
        if (!raw) return '';

        const junkExact = new Set([
            'Claude is AI and can make mistakes. Please double-check responses.',
            'Claude can make mistakes.',
            'Copy', 'Retry', 'Edit', 'Share'
        ]);

        const lines = raw.split('\n')
            .map(l => l.trim())
            .filter(l => {
                if (!l) return false;
                if (junkExact.has(l)) return false;
                if (/^<\s*\d+\s*\/\s*\d+\s*>$/.test(l)) return false;
                if (l.startsWith('{function') || l.includes('__oai_')) return false;
                if (l.includes('[SYSTEM INSTRUCTION')) return false;
                if (l.startsWith('The user asked:') || l.startsWith('ChatGPT responded:')) return false;
                if (l.startsWith('What is your perspective')) return false;
                return true;
            });

        return lines.join('\n').trim();
    }

    function isGenerating() {
        const utils = window.AIBridgeUtils;
        const stopBtn = utils.findStopButton(STOP_BUTTON_SELECTORS);
        if (stopBtn) return true;

        const streaming = document.querySelector('[data-is-streaming="true"], .is-streaming');
        if (streaming) return true;

        return false;
    }

    // ─── Prompt Injection & Lifecycle ──────────────────────────────────

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Claude] Prompt injection starting...');

        // Snapshot state before sending
        const turnCountBefore = getAssistantTurnCount();
        const textBefore = getLatestAssistantText();
        console.log('[Claude] Turns before:', turnCountBefore, '| Text before length:', textBefore.length);

        // 1. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS, 15000);
        console.log('[Claude] Input found:', input.tagName, input.className);
        utils.simulateInput(input, promptText);

        // 2. Allow ProseMirror to update, then click send
        let sent = false;
        for (let attempt = 0; attempt < 15; attempt++) {
            await new Promise(r => setTimeout(r, 300));
            const sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
            if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
                console.log('[Claude] Send button ready, clicking.');
                utils.clickButton(sendBtn);
                sent = true;
                break;
            }
        }

        if (!sent) {
            console.log('[Claude] Send button not found, sending via Enter key.');
            utils.pressEnter(input);
        }

        // 3. Wait for new response
        console.log('[Claude] Waiting for response...');
        const response = await waitForResponse(turnCountBefore, textBefore, promptText, 60000);
        console.log('[Claude] Final response length:', response.length);
        console.log('[Claude] Response:', response.substring(0, 100));
        return response || 'Error: Could not extract Claude response.';
    });

    // ─── Polling for Response ──────────────────────────────────────────

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

                const isNew = (
                    currentText.length > 0 &&
                    currentText !== promptText.trim() &&
                    (turnCountNow > turnCountBefore || currentText !== textBefore)
                );

                console.log('[Claude Poll]', {
                    elapsed: elapsed + 'ms',
                    generating,
                    sawGenerating,
                    turns: turnCountBefore + '→' + turnCountNow,
                    textLen: currentText.length,
                    isNew
                });

                if (isNew) {
                    if (currentText === lastText) {
                        stableCount++;
                    } else {
                        stableCount = 0;
                        lastText = currentText;
                    }

                    // Done when: not generating and text is stable for 3 consecutive polls (~1s)
                    if (!generating && stableCount >= 3) {
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }

                    // Or when: not generating, stable for 1 poll, and > 3.5s elapsed
                    if (!generating && stableCount >= 1 && elapsed > 3500) {
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }
                }

                // Safety timeout
                if (elapsed >= timeoutMs) {
                    clearInterval(poll);
                    const fallback = (lastText && lastText !== promptText.trim()) ? lastText : currentText;
                    resolve(fallback || 'Error: Claude generation timed out.');
                }
            }, 350);
        });
    }
})();
