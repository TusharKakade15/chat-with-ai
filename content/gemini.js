// Gemini Content Script

(function() {
    const INPUT_SELECTORS = [
        '.ql-editor[contenteditable="true"]',
        'rich-textarea [contenteditable="true"]',
        '.text-input-field [contenteditable="true"]',
        'div.ql-editor',
        'div[contenteditable="true"]',
    ];

    const SEND_BUTTON_SELECTORS = [
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button.send-button',
    ];

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Gemini] Starting...');

        // 1. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[Gemini] Input found:', input.tagName, input.className);
        utils.simulateInput(input, promptText);

        // 2. Wait then send
        await new Promise(r => setTimeout(r, 1000));

        let sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (sendBtn) {
            utils.clickButton(sendBtn);
            console.log('[Gemini] Sent via button');
        } else {
            console.log('[Gemini] Send button not found, trying Enter...');
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', { 
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true 
            }));
        }

        // 3. Poll for MODEL response text (NOT user message)
        console.log('[Gemini] Polling for model response...');
        const responseText = await pollForGeminiResponse(60000);

        console.log('[Gemini] Final text length:', responseText.length);
        console.log('[Gemini] Full text:', responseText);
        return responseText || 'Error: Could not find Gemini response';
    });

    // Poll the DOM every 2 seconds looking for Gemini's MODEL response
    function pollForGeminiResponse(timeout) {
        return new Promise((resolve) => {
            const start = Date.now();
            let lastFoundText = '';
            let stableCount = 0;

            const check = () => {
                const text = tryScrapGeminiResponse();

                if (text.length > 10) {
                    if (text === lastFoundText) {
                        stableCount++;
                        if (stableCount >= 3) {
                            console.log('[Gemini] Response stable after', stableCount, 'checks');
                            resolve(text);
                            return;
                        }
                    } else {
                        stableCount = 0;
                        lastFoundText = text;
                    }
                }

                if (Date.now() - start > timeout) {
                    resolve(lastFoundText || text || '');
                    return;
                }

                setTimeout(check, 2000);
            };

            setTimeout(check, 3000);
        });
    }

    function tryScrapGeminiResponse() {
        let text = '';

        // Log all potential elements for debugging
        const debugTags = ['model-response', 'message-content', 'user-query', '.response-container'];
        for (const sel of debugTags) {
            const count = document.querySelectorAll(sel).length;
            if (count > 0) console.log(`[Gemini] "${sel}" found: ${count}`);
        }

        // Strategy 1: model-response web component (THE correct Gemini element)
        let els = document.querySelectorAll('model-response');
        if (els.length > 0) {
            text = els[els.length - 1].innerText.trim();
            if (text.length > 5) {
                console.log('[Gemini] Found via model-response tag, length:', text.length);
                return text;
            }
        }

        // Strategy 2: message-content web component
        els = document.querySelectorAll('message-content');
        if (els.length > 0) {
            // Filter out user messages — only take the LAST message-content
            // that is NOT inside a user-query element
            for (let i = els.length - 1; i >= 0; i--) {
                if (!els[i].closest('user-query')) {
                    text = els[i].innerText.trim();
                    if (text.length > 5) {
                        console.log('[Gemini] Found via message-content (non-user), length:', text.length);
                        return text;
                    }
                }
            }
        }

        // Strategy 3: .markdown class (common for rendered responses)
        els = document.querySelectorAll('.markdown');
        if (els.length > 0) {
            text = els[els.length - 1].innerText.trim();
            if (text.length > 5) {
                console.log('[Gemini] Found via .markdown, length:', text.length);
                return text;
            }
        }

        // Strategy 4: Specific Gemini response containers
        els = document.querySelectorAll('.response-container, .model-response-text, .response-content');
        if (els.length > 0) {
            text = els[els.length - 1].innerText.trim();
            if (text.length > 5) {
                console.log('[Gemini] Found via response containers, length:', text.length);
                return text;
            }
        }

        // Strategy 5: Brute-force — find text inside main that's NOT the user prompt
        // and NOT UI chrome
        const mainArea = document.querySelector('main') || document.querySelector('.conversation-container') || document.body;
        const allDivs = mainArea.querySelectorAll('div, p, span');
        
        for (let i = allDivs.length - 1; i >= 0; i--) {
            const el = allDivs[i];
            const t = el.innerText.trim();
            
            // Skip if this is inside a user query / input area
            if (el.closest('user-query') || 
                el.closest('rich-textarea') || 
                el.closest('.input-area') ||
                el.closest('[contenteditable]')) {
                continue;
            }
            
            // Skip prompt text and UI chrome
            if (t.length > 20 && 
                t.length < 3000 &&
                !t.includes('[SYSTEM INSTRUCTION') &&
                !t.includes('User asked:') &&
                !t.includes('ChatGPT said:') &&
                !t.includes('Claude said:') &&
                !t.includes('Provide a final synthesis') &&
                !t.includes('Ask Gemini') &&
                !t.includes('Gemini can make mistakes')) {
                text = t;
                console.log('[Gemini] Found via brute-force, length:', text.length);
                return text;
            }
        }

        return text;
    }
})();
