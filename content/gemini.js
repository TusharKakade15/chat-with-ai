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

    // Gemini uses custom web components — these are the actual tag/class names for responses
    const RESPONSE_SELECTORS = [
        'model-response',                              // custom web component tag
        'message-content',                             // message content web component
        '.model-response-text',
        '.response-container-content',
        '.conversation-container model-response',
    ];

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Gemini] Starting...');

        // 1. Count existing responses
        const before = utils.countElements(RESPONSE_SELECTORS);
        console.log('[Gemini] Existing responses:', before.count, 'using:', before.selector);

        // 2. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[Gemini] Input found:', input.tagName, input.className);
        utils.simulateInput(input, promptText);

        // 3. Wait then send
        await new Promise(r => setTimeout(r, 1000));

        // Try button first
        let sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (sendBtn) {
            utils.clickButton(sendBtn);
            console.log('[Gemini] Sent via button click');
        } else {
            // Fallback: press Enter
            console.log('[Gemini] Send button not found, trying Enter key...');
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', { 
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true 
            }));
        }

        console.log('[Gemini] Prompt sent!');

        // 4. Wait for response to appear and complete
        console.log('[Gemini] Waiting for response...');
        await new Promise(r => setTimeout(r, 3000));

        // Wait for any "thinking" or streaming to finish
        // Gemini shows a progress indicator or "thinking" animation
        await waitForGeminiResponse();

        // 5. Scrape the response using multiple approaches
        let text = '';

        // Approach 1: model-response web component
        let els = document.querySelectorAll('model-response');
        if (els.length > 0) {
            text = els[els.length - 1].innerText.trim();
            console.log('[Gemini] Found via model-response tag, length:', text.length);
        }

        // Approach 2: message-content web component
        if (!text || text.length < 5) {
            els = document.querySelectorAll('message-content');
            if (els.length > 0) {
                text = els[els.length - 1].innerText.trim();
                console.log('[Gemini] Found via message-content tag, length:', text.length);
            }
        }

        // Approach 3: .markdown inside any response container
        if (!text || text.length < 5) {
            els = document.querySelectorAll('.markdown');
            if (els.length > 0) {
                text = els[els.length - 1].innerText.trim();
                console.log('[Gemini] Found via .markdown, length:', text.length);
            }
        }

        // Approach 4: Brute-force — find the last substantial text block
        if (!text || text.length < 5) {
            const allTextBlocks = document.querySelectorAll('p, .response-content, [class*="response"]');
            for (let i = allTextBlocks.length - 1; i >= 0; i--) {
                const t = allTextBlocks[i].innerText.trim();
                if (t.length > 30 && !t.includes('[SYSTEM INSTRUCTION')) {
                    text = t;
                    console.log('[Gemini] Found via brute-force, length:', text.length);
                    break;
                }
            }
        }

        console.log('[Gemini] Final text length:', text.length);
        console.log('[Gemini] First 200 chars:', text.substring(0, 200));
        return text || 'Error: Could not scrape Gemini response';
    });

    async function waitForGeminiResponse() {
        const maxWait = 120000;
        const start = Date.now();

        while (Date.now() - start < maxWait) {
            // Check if Gemini is still generating (look for progress/loading indicators)
            const thinking = document.querySelector(
                '.loading-indicator, .thinking-indicator, mat-progress-bar, ' +
                '[class*="loading"], [class*="thinking"], [class*="progress"]'
            );

            if (!thinking) {
                // No loading indicator — wait a bit more to be safe
                await new Promise(r => setTimeout(r, 3000));
                // Double check
                const stillThinking = document.querySelector(
                    '.loading-indicator, .thinking-indicator, mat-progress-bar, ' +
                    '[class*="loading"], [class*="thinking"], [class*="progress"]'
                );
                if (!stillThinking) {
                    console.log('[Gemini] No loading indicator found — generation likely complete.');
                    return;
                }
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        console.log('[Gemini] Max wait reached.');
    }
})();
