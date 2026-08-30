// Gemini Content Script — Complete Modern Rewrite
// Follows the same robust architecture as ChatGPT & Claude

(function() {
    const INPUT_SELECTORS = [
        'rich-textarea [contenteditable="true"]',
        '.ql-editor[contenteditable="true"]',
        '.text-input-field [contenteditable="true"]',
        'div.ql-editor',
        'div[contenteditable="true"]',
        'textarea'
    ];

    const SEND_BUTTON_SELECTORS = [
        'button[aria-label="Send message"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="send"]',
        'button.send-button',
        '.send-button-container button',
        'rich-textarea ~ * button',
        'button:has(mat-icon[fonticon="send"])'
    ];

    const STOP_BUTTON_SELECTORS = [
        'button[aria-label="Stop response"]',
        'button[aria-label="Stop generating"]',
        'button[data-test-id="stop-button"]',
        'button.stop-button',
        '.stop-button-container button'
    ];

    // ─── Turn Counting & Extraction ────────────────────────────────────

    function getAssistantTurnCount() {
        const responseEls = document.querySelectorAll('model-response, .model-response, message-content:not(user-query message-content)');
        return responseEls.length;
    }

    function getLatestAssistantText() {
        // Strategy 1: Target model-response elements
        const responseEls = Array.from(document.querySelectorAll('model-response, .model-response, message-content:not(user-query message-content)'));
        if (responseEls.length > 0) {
            const last = responseEls[responseEls.length - 1];
            return extractText(last);
        }

        // Strategy 2: Target response-content or markdown containers in main
        const main = document.querySelector('.conversation-container, main') || document.body;
        const markdowns = Array.from(main.querySelectorAll('.model-response-text, .response-content, .markdown, [class*="markdown"]'));
        if (markdowns.length > 0) {
            const last = markdowns[markdowns.length - 1];
            if (!last.closest('user-query')) {
                return extractText(last);
            }
        }

        return '';
    }

    function extractText(el) {
        if (!el) return '';
        const clone = el.cloneNode(true);

        // Strip non-content / intermediate state elements (thinking boxes, extension chips, tool status, actions)
        clone.querySelectorAll(
            'script, style, noscript, template, button, nav, svg, ' +
            '[role="button"], .sr-only, [data-test-id*="action"], ' +
            'thought-box, gds-thought-expansion, model-thought, .thought-container, ' +
            '.sources-container, sources-carousel, source-list, citation-container, ' +
            '.citation-tag, search-summary, .status-container, .tool-status, ' +
            'extensions-call-chip, extension-status, extension-card, extension-chip, ' +
            'extensions-carousel, extension-header, .extension-status, .extension-content, ' +
            '[class*="extension"], [class*="grounding"], mat-chip, .mat-mdc-chip, .gds-chip, ' +
            '.tool-chip, .tool-pill, .status-pill, .tool-container, ' +
            '[data-test-id*="extension"], [data-test-id*="tool"], [data-test-id*="grounding"], ' +
            'mat-progress-spinner, mat-spinner, .model-response-header, .response-feedback, ' +
            'mat-icon, gds-icon'
        ).forEach(n => n.remove());

        // Find primary markdown or content container
        const content = clone.querySelector(
            '.markdown, [class*="markdown"], .model-response-text, .response-content, .message-content, div.text-message, .whitespace-pre-wrap'
        ) || clone;

        // Use textContent for safety
        const raw = content.textContent || '';
        return cleanText(raw);
    }

    function cleanText(raw) {
        if (!raw) return '';
        const utils = window.AIBridgeUtils;
        const textToProcess = utils && utils.extractDelimitedText ? utils.extractDelimitedText(raw) : raw;

        const junkExact = new Set([
            'Gemini is AI and can make mistakes.',
            'Gemini can make mistakes.',
            'Ask Gemini',
            'Searching the web',
            'Searching Google',
            'Synthesizing Roundtable Inputs',
            'Synthesizing...',
            'Answer now',
            'Thinking...',
            'Thought Process',
            'Show drafts',
            'New chat',
            'Search chats',
            'Upgrade',
            'Notebooks',
            'New notebook',
            'Recents',
            'Flash',
            'Copy',
            'Share',
            'Good response',
            'Bad response',
            'Modify response',
            'Export response',
            'Listen',
            'Double-check response'
        ]);

        const lines = textToProcess.split('\n')
            .map(l => l.trim())
            .filter(l => {
                if (!l) return false;
                if (junkExact.has(l)) return false;
                if (/^Draft\s+\d+$/i.test(l)) return false;
                if (/^Thought\s+for\s+\d+\s+seconds?$/i.test(l)) return false;
                if (/^<\s*\d+\s*\/\s*\d+\s*>$/.test(l)) return false;
                if (/^(connecting to|searching|looking up|checking|loading|fetching|browsing|working on|using|calling|thinking|thought|synthesizing|show drafts|draft \d+|answer now)\b/i.test(l)) return false;
                if (l.startsWith('{function') || l.includes('__oai_')) return false;
                if (l.includes('[SYSTEM INSTRUCTION')) return false;
                if (l.startsWith('User asked:') || l.startsWith('ChatGPT said:') || l.startsWith('Claude said:')) return false;
                if (l.startsWith('Provide a final synthesis')) return false;
                if (l.startsWith('Gemini said:') || l.startsWith('You said:')) return false;
                return true;
            });

        return lines.join('\n').trim();
    }

    function isIntermediaryText(text) {
        if (!text || text.trim().length === 0) return true;
        const trimmed = text.trim();
        if (/^(connecting to|searching|looking up|checking|loading|fetching|browsing|working on|using|calling|thinking|thought|synthesizing|show drafts|draft \d+|answer now)\b/i.test(trimmed)) {
            return true;
        }
        return false;
    }

    function isGenerating() {
        const utils = window.AIBridgeUtils;
        const stopBtn = utils.findStopButton(STOP_BUTTON_SELECTORS);
        if (stopBtn) return true;

        const streamingEl = document.querySelector('.result-streaming, .is-streaming, [data-is-streaming="true"], mat-progress-spinner, mat-spinner, extensions-call-chip, [class*="extension-status"]');
        if (streamingEl && utils.isElementVisible(streamingEl)) return true;

        return false;
    }

    function hasFinishedGenerating() {
        // When Gemini finishes generating, feedback/action buttons appear under the latest response
        const lastResponse = document.querySelector('model-response:last-of-type, .model-response:last-of-type');
        if (lastResponse) {
            const actions = lastResponse.querySelector('response-feedback, .response-feedback, [aria-label="Good response"], [aria-label="Bad response"], [aria-label="Share response"], [aria-label="Share"], [aria-label*="Copy"]');
            if (actions && window.AIBridgeUtils.isElementVisible(actions)) return true;
        }
        return false;
    }

    // ─── Prompt Injection & Lifecycle ──────────────────────────────────

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Gemini] Prompt injection starting...');

        // Snapshot state before sending
        const turnCountBefore = getAssistantTurnCount();
        const textBefore = getLatestAssistantText();
        console.log('[Gemini] Turns before:', turnCountBefore, '| Text before length:', textBefore.length);

        // 1. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS, 15000);
        console.log('[Gemini] Input found:', input.tagName, input.className);
        utils.simulateInput(input, promptText);

        // 2. Allow Angular/Quill change detection to settle, then click send
        let sent = false;
        for (let attempt = 0; attempt < 15; attempt++) {
            await new Promise(r => setTimeout(r, 300));
            const sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
            if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
                console.log('[Gemini] Send button ready, clicking.');
                utils.clickButton(sendBtn);
                sent = true;
                break;
            }
        }

        if (!sent) {
            console.log('[Gemini] Send button not found or disabled, sending via Enter key.');
            utils.pressEnter(input);
        }

        // 3. Wait for new response
        console.log('[Gemini] Waiting for response...');
        const response = await waitForResponse(turnCountBefore, textBefore, promptText, 60000);
        console.log('[Gemini] Final response length:', response.length);
        console.log('[Gemini] Response:', response.substring(0, 100));
        return response || 'Error: Could not extract Gemini response.';
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
                const isIntermediary = isIntermediaryText(currentText);

                const isNew = (
                    !isIntermediary &&
                    currentText.length >= 10 &&
                    currentText !== promptText.trim() &&
                    currentText !== textBefore
                );

                console.log('[Gemini Poll]', {
                    elapsed: elapsed + 'ms',
                    generating,
                    sawGenerating,
                    turns: turnCountBefore + '→' + turnCountNow,
                    textLen: currentText.length,
                    isNew
                });

                if (isNew) {
                    chrome.runtime.sendMessage({ type: 'STREAM_UPDATE', text: currentText, agent: 'Gemini' }).catch(() => {});
                    if (currentText === lastText) {
                        stableCount++;
                    } else {
                        stableCount = 0;
                        lastText = currentText;
                    }

                    // Condition 1: Action/feedback buttons appear under response (Gemini UI officially completed)
                    if (hasFinishedGenerating() && stableCount >= 1) {
                        console.log('[Gemini Poll] Finished generation detected via feedback buttons.');
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }

                    // Condition 2: Saw generation start, and now generation has stopped, text stable for 2 polls (~700ms)
                    if (sawGenerating && !generating && stableCount >= 2) {
                        console.log('[Gemini Poll] Generation completed after active streaming.');
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }

                    // Condition 3: Substantial text stable for 5 consecutive polls (~1.75s) and elapsed > 3000ms
                    if (!generating && stableCount >= 5 && currentText.length > 25 && elapsed > 3000) {
                        console.log('[Gemini Poll] Text stable for 5 consecutive polls, resolving.');
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }
                }

                // Timeout
                if (elapsed >= timeoutMs) {
                    clearInterval(poll);
                    if (lastText && lastText !== textBefore && lastText !== promptText.trim() && !isIntermediaryText(lastText)) {
                        resolve(lastText);
                    } else if (currentText && currentText !== textBefore && currentText !== promptText.trim() && !isIntermediaryText(currentText)) {
                        resolve(currentText);
                    } else {
                        resolve('Error: Gemini generation timed out.');
                    }
                }
            }, 350);
        });
    }
})();
