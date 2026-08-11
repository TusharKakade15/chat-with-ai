// Gemini Content Script

(function() {
    const INPUT_SELECTORS = [
        '.ql-editor[contenteditable="true"]',
        'rich-textarea [contenteditable="true"]',
        '.text-input-field [contenteditable="true"]',
        'div[contenteditable="true"]',
    ];

    const SEND_BUTTON_SELECTORS = [
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button.send-button',
    ];

    const RESPONSE_SELECTORS = [
        'message-content .markdown',
        'message-content',
        '.model-response-text',
        '.response-container',
    ];

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Gemini] Starting...');

        // 1. Count existing responses
        const before = utils.countElements(RESPONSE_SELECTORS);
        console.log('[Gemini] Existing responses:', before.count);

        // 2. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[Gemini] Input found:', input.tagName, input.className);
        utils.simulateInput(input, promptText);

        // 3. Wait for send button
        await new Promise(r => setTimeout(r, 1000));

        // 4. Click send
        const sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (!sendBtn) throw new Error('Gemini send button not found');
        utils.clickButton(sendBtn);
        console.log('[Gemini] Prompt sent!');

        // 5. Wait for a NEW response
        console.log('[Gemini] Waiting for response...');
        const newResponseEl = await utils.waitForNewElement(
            before.count > 0 ? before.selector : RESPONSE_SELECTORS,
            before.count,
            60000
        );
        console.log('[Gemini] New response appeared!');

        // 6. Wait for generation to finish
        await utils.waitForMutationToStop(newResponseEl.parentElement || newResponseEl, 3000, 120000);
        console.log('[Gemini] Generation complete.');

        // 7. Grab the last response
        const finalEl = utils.getLastMatch(RESPONSE_SELECTORS);
        const text = finalEl ? finalEl.innerText.trim() : 'Error: Could not scrape response';
        console.log('[Gemini] Scraped:', text.substring(0, 100) + '...');
        return text;
    });
})();
