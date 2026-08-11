// Gemini Content Script

(function() {
    const INPUT_SELECTORS = [
        '.ql-editor[contenteditable="true"]',             // Quill editor
        'rich-textarea [contenteditable="true"]',          // rich-textarea wrapper
        '.text-input-field [contenteditable="true"]',      // text input field
        'div[contenteditable="true"]',                     // generic contenteditable
        '.input-area textarea',                            // fallback textarea
    ];

    const SEND_BUTTON_SELECTORS = [
        'button[aria-label="Send message"]',               // primary
        'button[aria-label="Send"]',                       // short variant
        'button.send-button',                              // class-based
        '.input-area button',                              // input area button
    ];

    const RESPONSE_SELECTORS = [
        'message-content .markdown',                       // message-content with markdown
        'message-content',                                 // message-content element
        '.model-response-text',                            // model response text
        '.response-container',                             // response container
        '.message-body',                                   // message body
    ];

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Gemini] Starting prompt injection...');

        // 1. Find the input field
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[Gemini] Found input:', input.tagName, input.className);

        // 2. Inject text
        utils.simulateInput(input, promptText);
        console.log('[Gemini] Text injected, waiting for send button...');

        // 3. Wait for send button
        await new Promise(r => setTimeout(r, 800));

        // 4. Find and click send button
        let sendBtn = null;
        for (const sel of SEND_BUTTON_SELECTORS) {
            sendBtn = document.querySelector(sel);
            if (sendBtn) {
                console.log('[Gemini] Found send button via:', sel);
                break;
            }
        }

        if (!sendBtn) {
            // Brute-force search
            const allButtons = document.querySelectorAll('button');
            for (const btn of allButtons) {
                const label = (btn.getAttribute('aria-label') || '').toLowerCase();
                if (label.includes('send')) {
                    sendBtn = btn;
                    console.log('[Gemini] Found send button via brute-force search');
                    break;
                }
            }
        }

        if (!sendBtn) {
            throw new Error('Could not find Gemini send button');
        }

        sendBtn.click();
        console.log('[Gemini] Send button clicked. Waiting for response...');

        // 5. Wait for response
        await new Promise(r => setTimeout(r, 2000));

        // 6. Wait for the response to finish
        let responseEl = utils.getLastMatch(RESPONSE_SELECTORS);
        if (!responseEl) {
            console.log('[Gemini] No response element found yet, waiting...');
            responseEl = await utils.waitForElement(RESPONSE_SELECTORS, 30000);
        }

        await utils.waitForMutationToStop(
            responseEl.parentElement || responseEl,
            { childList: true, characterData: true, subtree: true },
            3000, 120000
        );
        console.log('[Gemini] Response generation appears complete.');

        // 7. Grab the final text
        const finalEl = utils.getLastMatch(RESPONSE_SELECTORS);
        const text = finalEl ? finalEl.innerText.trim() : 'Error: Could not find response text.';
        console.log('[Gemini] Scraped text length:', text.length);

        return text;
    });
})();
