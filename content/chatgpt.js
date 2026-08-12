// ChatGPT Content Script

(function() {
    const INPUT_SELECTORS = [
        '#prompt-textarea',
        'div[id="prompt-textarea"]',
        '.ProseMirror[contenteditable="true"]',
        'form textarea',
    ];

    const SEND_BUTTON_SELECTORS = [
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send"]',
    ];

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[ChatGPT] Starting...');

        // 1. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[ChatGPT] Input found:', input.tagName, input.id);
        utils.simulateInput(input, promptText);

        // 2. Wait then click send
        await new Promise(r => setTimeout(r, 1000));
        const sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (sendBtn) {
            utils.clickButton(sendBtn);
            console.log('[ChatGPT] Sent via button');
        } else {
            console.log('[ChatGPT] Send button not found, trying Enter...');
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }

        // 3. Wait for ChatGPT to finish responding
        //    Strategy: watch the ENTIRE page body for mutations to stop
        //    This is the most reliable way — when ChatGPT stops streaming, the DOM stops changing
        console.log('[ChatGPT] Waiting for response to complete...');
        
        // First wait a bit for streaming to start
        await new Promise(r => setTimeout(r, 3000));
        
        // Then wait for mutations to stop (generous 5s debounce)
        await utils.waitForMutationToStop(document.body, 5000, 120000);
        console.log('[ChatGPT] Page mutations stopped.');

        // 4. Extra wait to be absolutely safe
        await new Promise(r => setTimeout(r, 2000));

        // 5. SCRAPE: Try multiple strategies to find ChatGPT's response
        let text = '';

        // Log ALL potential response containers for debugging
        const debugSelectors = [
            '[data-message-author-role="assistant"]',
            '[data-message-author-role="assistant"] .markdown',
            '.markdown.prose',
            '.markdown',
            'article',
            '.text-base',
            '.min-h-8',
            '.agent-turn',
            '.prose',
        ];

        for (const sel of debugSelectors) {
            const count = document.querySelectorAll(sel).length;
            if (count > 0) {
                console.log(`[ChatGPT] Selector "${sel}" matched ${count} elements`);
            }
        }

        // Strategy 1: data-message-author-role="assistant" containers
        let els = document.querySelectorAll('[data-message-author-role="assistant"]');
        if (els.length > 0) {
            const lastAssistant = els[els.length - 1];
            // Try to find markdown content inside
            const markdown = lastAssistant.querySelector('.markdown');
            if (markdown) {
                text = markdown.innerText.trim();
                console.log('[ChatGPT] Strategy 1a (assistant > .markdown):', text.length, 'chars');
            }
            if (!text) {
                // Get all text from the assistant container, but exclude buttons/metadata
                text = lastAssistant.innerText.trim();
                console.log('[ChatGPT] Strategy 1b (assistant container):', text.length, 'chars');
            }
        }

        // Strategy 2: .markdown.prose
        if (!text || text.length < 5) {
            els = document.querySelectorAll('.markdown.prose');
            if (els.length > 0) {
                text = els[els.length - 1].innerText.trim();
                console.log('[ChatGPT] Strategy 2 (.markdown.prose):', text.length, 'chars');
            }
        }

        // Strategy 3: Just .markdown
        if (!text || text.length < 5) {
            els = document.querySelectorAll('.markdown');
            if (els.length > 0) {
                text = els[els.length - 1].innerText.trim();
                console.log('[ChatGPT] Strategy 3 (.markdown):', text.length, 'chars');
            }
        }

        // Strategy 4: article elements
        if (!text || text.length < 5) {
            els = document.querySelectorAll('article');
            if (els.length > 0) {
                text = els[els.length - 1].innerText.trim();
                console.log('[ChatGPT] Strategy 4 (article):', text.length, 'chars');
            }
        }

        // Strategy 5: .prose
        if (!text || text.length < 5) {
            els = document.querySelectorAll('.prose');
            if (els.length > 0) {
                text = els[els.length - 1].innerText.trim();
                console.log('[ChatGPT] Strategy 5 (.prose):', text.length, 'chars');
            }
        }

        // Strategy 6: BRUTE FORCE — scan ALL elements for the response text
        // ChatGPT's response should be a substantial text block that's NOT the user's prompt
        if (!text || text.length < 5) {
            console.log('[ChatGPT] Trying brute force scan...');
            const allElements = document.querySelectorAll('div, p, span, article, section');
            let bestText = '';
            for (const el of allElements) {
                const t = el.innerText.trim();
                // Find text blocks that are: substantial, not the prompt, and not UI elements
                if (t.length > 20 && 
                    t.length < 5000 && 
                    !t.includes('[SYSTEM INSTRUCTION') && 
                    !t.includes('User Prompt:') &&
                    !t.includes('ChatGPT can make mistakes') &&
                    !t.includes('Ask anything') &&
                    t.length > bestText.length) {
                    // Prefer elements that look like response content
                    const isChildOfMain = el.closest('main') !== null;
                    if (isChildOfMain && t.length > bestText.length) {
                        bestText = t;
                    }
                }
            }
            if (bestText.length > 20) {
                text = bestText;
                console.log('[ChatGPT] Strategy 6 (brute force):', text.length, 'chars');
            }
        }

        console.log('[ChatGPT] Final text length:', text.length);
        console.log('[ChatGPT] Full text:', text);
        return text || 'Error: Could not find ChatGPT response in the DOM';
    });
})();
