// Claude Content Script — Rewritten for latest Claude UI (Aug 2026)
// The latest Claude uses: .font-claude-response, .font-claude-response-body,
// .standard-markdown, [data-is-streaming], [data-test-render-count]

(function() {
    const INPUT_SELECTORS = [
        'div.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"].ProseMirror',
        'div[data-testid="chat-input"][contenteditable="true"]',
        'fieldset [contenteditable="true"]',
        'div[contenteditable="true"]',
        'textarea'
    ];

    const SEND_BUTTON_SELECTORS = [
        'button[aria-label="Send Message"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button[data-testid="send-button"]'
    ];

    const STOP_BUTTON_SELECTORS = [
        'button[aria-label="Stop Response"]',
        'button[aria-label="Stop response"]',
        'button[aria-label="Stop generating"]',
        'button[aria-label*="Stop"]',
        '[data-is-streaming="true"]'
    ];

    // ─── Turn Counting ────────────────────────────────────────────────

    function getAssistantTurnCount() {
        // Count all Claude response containers using a Set to avoid double-counting
        const selectors = [
            '[data-is-streaming]',
            '.font-claude-response',
            '.font-claude-response-body',
            '.font-claude-message',
            '[data-message-author="claude"]',
            '[data-message-author="assistant"]',
            'div[data-test-render-count]'
        ];
        const seen = new Set();
        for (const sel of selectors) {
            document.querySelectorAll(sel).forEach(el => {
                const container = el.closest('[data-is-streaming]') ||
                                  el.closest('[data-test-render-count]') ||
                                  el.closest('.group') ||
                                  el;
                seen.add(container);
            });
        }
        return seen.size;
    }

    // ─── Text Extraction ──────────────────────────────────────────────

    function getLatestAssistantText() {
        // Strategy 1: Find the last standard-markdown or font-claude-response block
        const responseBlocks = Array.from(document.querySelectorAll(
            '.standard-markdown, .progressive-markdown, .font-claude-response'
        ));
        const assistantBlocks = responseBlocks.filter(el => {
            if (el.closest('[data-message-author="human"]')) return false;
            if (el.closest('.font-user-message')) return false;
            if (el.closest('[data-cds="UserMessage"]')) return false;
            return true;
        });
        if (assistantBlocks.length > 0) {
            const last = assistantBlocks[assistantBlocks.length - 1];
            const text = extractText(last);
            if (text.length > 0) return text;
        }

        // Strategy 2: font-claude-response-body paragraphs directly
        const bodyParas = Array.from(document.querySelectorAll('.font-claude-response-body'));
        if (bodyParas.length > 0) {
            const lastPara = bodyParas[bodyParas.length - 1];
            const responseContainer = lastPara.closest('[data-is-streaming]') ||
                                      lastPara.closest('[data-test-render-count]') ||
                                      lastPara.closest('.group') ||
                                      lastPara.parentElement;
            if (responseContainer) {
                const text = extractText(responseContainer);
                if (text.length > 0) return text;
            }
        }

        // Strategy 3: Broad fallback — prose/markdown blocks not belonging to user
        const main = document.querySelector('main') || document.body;
        const proseMsgs = Array.from(main.querySelectorAll(
            '.prose, [class*="prose"], .markdown, div[class*="message-content"]'
        ));
        for (let i = proseMsgs.length - 1; i >= 0; i--) {
            const el = proseMsgs[i];
            if (el.closest('[data-message-author="human"]') || el.closest('.font-user-message')) continue;
            if (el.closest('[data-cds="UserMessage"]')) continue;
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
            '.action-bar, .feedback-container, fieldset, ' +
            '[data-cds="MessageActions"], [data-cds="RelativeTime"], ' +
            'time, [data-reveal]'
        ).forEach(n => n.remove());

        const raw = clone.textContent || '';
        return cleanText(raw);
    }

    function cleanText(raw) {
        if (!raw) return '';

        const junkExact = new Set([
            'Claude is AI and can make mistakes. Please double-check responses.',
            'Claude can make mistakes.',
            'Copy', 'Retry', 'Edit', 'Share',
            'Good response', 'Bad response', 'Read aloud',
            'Write your prompt to Claude'
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
                if (/^\d+\s+(second|minute|hour|day)s?\s+ago$/.test(l)) return false;
                return true;
            });

        return lines.join('\n').trim();
    }

    // ─── Generating Detection ─────────────────────────────────────────

    function isGenerating() {
        const utils = window.AIBridgeUtils;
        const stopBtn = utils.findStopButton(STOP_BUTTON_SELECTORS);
        if (stopBtn) return true;

        const streaming = document.querySelector('[data-is-streaming="true"]');
        if (streaming) return true;

        return false;
    }

    // ─── Prompt Injection & Lifecycle ──────────────────────────────────

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Claude] Prompt injection starting...');

        const turnCountBefore = getAssistantTurnCount();
        const textBefore = getLatestAssistantText();
        console.log('[Claude] Turns before:', turnCountBefore, '| Text before length:', textBefore.length);

        // 1. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS, 15000);
        console.log('[Claude] Input found:', input.tagName, input.className);
        utils.simulateInput(input, promptText);

        // 2. Allow ProseMirror to update, then click send
        let sent = false;
        for (let attempt = 0; attempt < 20; attempt++) {
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

        // 3. Wait for new response (increased timeout to 90s for Claude)
        console.log('[Claude] Waiting for response...');
        const response = await waitForResponse(turnCountBefore, textBefore, promptText, 90000);
        console.log('[Claude] Final response length:', response.length);
        console.log('[Claude] Response:', response.substring(0, 200));
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
                    isNew,
                    preview: currentText.substring(0, 60)
                });

                if (isNew) {
                    chrome.runtime.sendMessage({ type: 'STREAM_UPDATE', text: currentText, agent: 'Claude' }).catch(() => {});
                    if (currentText === lastText) {
                        stableCount++;
                    } else {
                        stableCount = 0;
                        lastText = currentText;
                    }

                    // Done when: not generating and text is stable for 3 consecutive polls
                    if (!generating && stableCount >= 3) {
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }

                    // Or when: not generating, stable for 1 poll, and > 4s elapsed
                    if (!generating && stableCount >= 1 && elapsed > 4000) {
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
            }, 400);
        });
    }
})();
