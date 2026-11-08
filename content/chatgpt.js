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
        'button[data-testid*="send"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="send"]',
        'form button[type="submit"]'
    ];

    const STOP_BUTTON_SELECTORS = [
        'button[data-testid="stop-button"]',
        'button[data-testid="composer-stop-button"]',
        'button[data-testid*="stop"]',
        'button[aria-label="Stop generating"]',
        'button[aria-label="Stop streaming"]',
        'button[aria-label="Stop response"]',
        'button[aria-label*="Stop generating"]',
        'button[aria-label*="Stop streaming"]',
        'button[aria-label*="Stop"]'
    ];

    // ─── Helpers ────────────────────────────────────────────────────────

    function isUserElement(el) {
        if (!el) return false;
        if (el.closest('[data-message-author-role="user"]')) return true;
        if (el.closest('[data-message-role="user"]')) return true;
        if (el.closest('[data-author-role="user"]')) return true;
        if (el.closest('[data-role="user"]')) return true;
        if (el.closest('[data-user-message="true"]')) return true;
        if (el.closest('.font-user-message')) return true;

        // User turns typically contain an Edit button
        const container = el.closest('[data-testid*="conversation-turn"]') || el.closest('article') || el;
        if (container) {
            const editBtn = container.querySelector('button[aria-label*="Edit"], [data-testid*="edit"]');
            if (editBtn) return true;
        }
        return false;
    }

    // ─── Text Extraction ───────────────────────────────────────────────

    function getAssistantTurnCount() {
        const selectors = [
            '[data-message-author-role="assistant"]',
            '[data-message-role="assistant"]',
            '[data-author-role="assistant"]',
            '[data-role="assistant"]',
            '[data-message-id][data-message-author-role="assistant"]',
            '[data-testid*="conversation-turn"]',
            'article',
            '.agent-turn'
        ];

        const seen = new Set();
        for (const sel of selectors) {
            try {
                document.querySelectorAll(sel).forEach(el => {
                    if (isUserElement(el)) return;
                    const container = el.closest('[data-testid*="conversation-turn"]') ||
                                      el.closest('article') ||
                                      el.closest('[data-message-author-role]') ||
                                      el;
                    seen.add(container);
                });
            } catch (e) {}
        }

        if (seen.size > 0) return seen.size;

        const markdowns = Array.from(document.querySelectorAll('.markdown, .prose, [class*="markdown"], [class*="prose"]'));
        const assistantMarkdowns = markdowns.filter(el => !isUserElement(el));
        return assistantMarkdowns.length;
    }

    function getLatestAssistantText() {
        // Strategy 1: Find all assistant-role containers across document (newest first)
        const assistantSelectors = [
            '[data-message-author-role="assistant"]',
            '[data-message-role="assistant"]',
            '[data-author-role="assistant"]',
            '[data-role="assistant"]',
            '[data-message-id][data-message-author-role="assistant"]'
        ];

        for (const sel of assistantSelectors) {
            try {
                const els = Array.from(document.querySelectorAll(sel));
                for (let i = els.length - 1; i >= 0; i--) {
                    const text = extractText(els[i]);
                    if (text && text.length > 0) {
                        return text;
                    }
                }
            } catch (e) {}
        }

        // Strategy 2: Find all markdown/prose/content containers not belonging to user
        const contentSelectors = [
            '[data-message-content]',
            'div.markdown',
            '.markdown',
            'div.prose',
            '.prose',
            '[class*="markdown"]',
            '[class*="prose"]',
            'div.text-message',
            '[class*="text-message"]'
        ];

        for (const sel of contentSelectors) {
            try {
                const blocks = Array.from(document.querySelectorAll(sel));
                const assistantBlocks = blocks.filter(el => !isUserElement(el));
                for (let i = assistantBlocks.length - 1; i >= 0; i--) {
                    const text = extractText(assistantBlocks[i]);
                    if (text && text.length > 0) {
                        return text;
                    }
                }
            } catch (e) {}
        }

        // Strategy 3: Check conversation turns from newest to oldest
        const turnSelectors = [
            '[data-testid^="conversation-turn-"]',
            '[data-testid*="conversation-turn"]',
            '.group\\/conversation-turn',
            'article'
        ];

        for (const sel of turnSelectors) {
            try {
                const turns = Array.from(document.querySelectorAll(sel));
                for (let i = turns.length - 1; i >= 0; i--) {
                    const turn = turns[i];
                    if (isUserElement(turn)) continue;
                    const text = extractText(turn);
                    if (text && text.length > 0) {
                        return text;
                    }
                }
            } catch (e) {}
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
            '[data-message-content], .markdown, .prose, [class*="markdown"], [class*="prose"], ' +
            'div.text-message, [class*="text-message"], .whitespace-pre-wrap'
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
            'Copy code', 'Memory updated', 'Temporary Chat'
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

    // ─── Generating Detection ──────────────────────────────────────────

    function isGenerating() {
        const utils = window.AIBridgeUtils;
        if (utils.findStopButton(STOP_BUTTON_SELECTORS)) return true;
        if (document.querySelector('.result-streaming, [class*="result-streaming"]')) return true;
        return false;
    }

    function hasFinishedGenerating() {
        // When ChatGPT finishes generating a response, the action bar (Copy, thumbs, share) appears on the latest assistant turn
        const turnSelectors = [
            '[data-message-author-role="assistant"]',
            '[data-message-role="assistant"]',
            '[data-author-role="assistant"]',
            '[data-role="assistant"]',
            '[data-testid*="conversation-turn"]',
            'article'
        ];

        for (const sel of turnSelectors) {
            try {
                const turns = Array.from(document.querySelectorAll(sel));
                for (let i = turns.length - 1; i >= 0; i--) {
                    const turn = turns[i];
                    if (isUserElement(turn)) continue;
                    const actions = turn.querySelector(
                        'button[aria-label="Copy"], button[aria-label*="Copy"], ' +
                        'button[aria-label="Good response"], button[aria-label="Bad response"], ' +
                        'button[aria-label="Share"], button[aria-label*="Share"], ' +
                        '[data-testid*="copy"], [data-testid*="action"]'
                    );
                    if (actions && window.AIBridgeUtils.isElementVisible(actions)) {
                        return true;
                    }
                    break; // Only inspect the latest assistant turn
                }
            } catch (e) {}
        }
        return false;
    }

    function getRawLatestAssistantText() {
        const assistantSelectors = [
            '[data-message-author-role="assistant"]',
            '[data-message-role="assistant"]',
            '[data-author-role="assistant"]',
            '[data-role="assistant"]',
            '[data-message-id][data-message-author-role="assistant"]'
        ];
        for (const sel of assistantSelectors) {
            const els = Array.from(document.querySelectorAll(sel));
            if (els.length > 0) {
                return els[els.length - 1].textContent || '';
            }
        }
        const markdowns = Array.from(document.querySelectorAll('.markdown, .prose'));
        const nonUser = markdowns.filter(el => !isUserElement(el));
        if (nonUser.length > 0) {
            return nonUser[nonUser.length - 1].textContent || '';
        }
        return '';
    }

    // ─── Prompt Injection ──────────────────────────────────────────────

    window.AIBridgeUtils.setupMessageListener(
        async (promptText) => {
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

            // 3. Wait for new response (90s timeout matching Claude)
            console.log('[ChatGPT] Waiting for response...');
            const response = await waitForResponse(turnCountBefore, textBefore, promptText, 90000);
            console.log('[ChatGPT] Response captured:', response.substring(0, 100));
            return response || 'Error: Could not extract ChatGPT response.';
        },
        () => {
            // Refetch callback to re-scrape latest response instantly
            return getLatestAssistantText();
        }
    );

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

                // Has ChatGPT produced genuine NEW text for this turn?
                // MUST NOT match previous turn's text or the prompt or intermediate status!
                const isNew = (
                    !isIntermediary &&
                    currentText.length >= 10 &&
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

                    // Check if model opened a [MESSAGE] tag that has not been closed yet
                    const rawText = getRawLatestAssistantText();
                    const hasOpenMessageTag = rawText.includes('[MESSAGE]') && !rawText.includes('[/MESSAGE]');

                    // Condition 1: Action/feedback buttons appear under response + stable for 2 polls + not currently generating + tag closed
                    if (!hasOpenMessageTag && !generating && hasFinishedGenerating() && stableCount >= 2 && elapsed > 1500) {
                        console.log('[ChatGPT Poll] Finished generation detected via action buttons.');
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }

                    // Condition 2: Observed generating and now stopped, text stable for 2 polls (~700ms) + tag closed
                    if (!hasOpenMessageTag && sawGenerating && !generating && stableCount >= 2) {
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }

                    // Condition 3: Not generating, text stable for 2 polls, and at least 1500ms elapsed + tag closed
                    if (!hasOpenMessageTag && !generating && stableCount >= 2 && elapsed > 1500) {
                        clearInterval(poll);
                        resolve(currentText);
                        return;
                    }

                    // Condition 4: Safety finish: text stable for 4 consecutive polls and substantial + not generating + tag closed
                    if (!hasOpenMessageTag && !generating && stableCount >= 4 && currentText.length > 25 && elapsed > 2000) {
                        console.log('[ChatGPT Poll] Text stable for 4 consecutive polls, resolving.');
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
                        // Last-resort extraction across all selectors before failing
                        const finalText = getLatestAssistantText();
                        if (finalText && finalText !== textBefore && finalText !== promptText.trim() && !isIntermediaryText(finalText)) {
                            resolve(finalText);
                        } else {
                            resolve('Error: ChatGPT generation timed out.');
                        }
                    }
                }
            }, 350);
        });
    }
})();
