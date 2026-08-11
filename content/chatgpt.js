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

    const RESPONSE_SELECTORS = [
        '[data-message-author-role="assistant"] .markdown',
        '[data-message-author-role="assistant"]',
        '.markdown.prose',
        'article .markdown',
    ];

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[ChatGPT] Starting...');

        // 1. Count existing responses BEFORE sending
        const before = utils.countElements(RESPONSE_SELECTORS);
        console.log('[ChatGPT] Existing responses:', before.count, 'using selector:', before.selector);

        // 2. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[ChatGPT] Input found:', input.tagName, input.id);
        utils.simulateInput(input, promptText);

        // 3. Wait for send button to activate
        await new Promise(r => setTimeout(r, 1000));

        // 4. Click send
        const sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (!sendBtn) throw new Error('ChatGPT send button not found');
        utils.clickButton(sendBtn);
        console.log('[ChatGPT] Prompt sent!');

        // 5. Wait for a NEW response element to appear (count increases)
        const activeSelector = before.count > 0 ? before.selector : RESPONSE_SELECTORS;
        console.log('[ChatGPT] Waiting for new response...');
        const newResponseEl = await utils.waitForNewElement(activeSelector, before.count, 60000);
        console.log('[ChatGPT] New response element appeared!');

        // 6. Wait for it to stop generating
        await utils.waitForMutationToStop(newResponseEl.parentElement || newResponseEl, 3000, 120000);
        console.log('[ChatGPT] Generation complete.');

        // 7. Grab the LAST response text
        const finalEl = utils.getLastMatch(RESPONSE_SELECTORS);
        const text = finalEl ? finalEl.innerText.trim() : 'Error: Could not scrape response';
        console.log('[ChatGPT] Scraped:', text.substring(0, 100) + '...');
        return text;
    });
})();
