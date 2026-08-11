// ChatGPT Content Script

(function() {
    const INPUT_SELECTORS = [
        '#prompt-textarea',                          // main textarea/div
        'div[id="prompt-textarea"]',                  // explicit div
        '#prompt-textarea p',                        // paragraph inside prosemirror
        'form textarea',                             // fallback textarea
        '.ProseMirror[contenteditable="true"]',       // ProseMirror editor
    ];

    const SEND_BUTTON_SELECTORS = [
        'button[data-testid="send-button"]',          // primary
        'button[aria-label="Send prompt"]',            // aria label variant
        'button[aria-label="Send"]',                   // short aria label
        'form button:not([disabled])',                 // generic form button
    ];

    const RESPONSE_SELECTORS = [
        '[data-message-author-role="assistant"] .markdown',     // assistant markdown blocks
        '[data-message-author-role="assistant"]',               // assistant message container
        '.markdown.prose',                                       // legacy selector
        '.agent-turn .markdown',                                 // agent turn blocks
        'article .markdown',                                     // article-wrapped markdown
    ];

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[ChatGPT] Starting prompt injection...');

        // 1. Find the input field
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[ChatGPT] Found input:', input.tagName, input.id, input.className);

        // 2. Inject text
        utils.simulateInput(input, promptText);
        console.log('[ChatGPT] Text injected, waiting for send button...');

        // 3. Wait a moment for the send button to become active
        await new Promise(r => setTimeout(r, 800));

        // 4. Find and click send button
        const sendBtn = await utils.waitForElement(SEND_BUTTON_SELECTORS, 5000);
        console.log('[ChatGPT] Found send button:', sendBtn.tagName, sendBtn.className);
        sendBtn.click();
        console.log('[ChatGPT] Send button clicked. Waiting for response...');

        // 5. Wait for new response to appear
        await new Promise(r => setTimeout(r, 2000));

        // 6. Wait for the response to finish generating
        // Look for a "stop generating" button to disappear, or just watch mutations
        let responseEl = utils.getLastMatch(RESPONSE_SELECTORS);
        if (!responseEl) {
            console.log('[ChatGPT] No response element found yet, waiting...');
            responseEl = await utils.waitForElement(RESPONSE_SELECTORS, 30000);
        }

        // Observe the response for changes to stop
        await utils.waitForMutationToStop(
            responseEl.parentElement || responseEl,
            { childList: true, characterData: true, subtree: true },
            3000, 120000
        );
        console.log('[ChatGPT] Response generation appears complete.');

        // 7. Grab the final text from the LAST response
        const finalEl = utils.getLastMatch(RESPONSE_SELECTORS);
        const text = finalEl ? finalEl.innerText.trim() : 'Error: Could not find response text.';
        console.log('[ChatGPT] Scraped text length:', text.length);

        return text;
    });
})();
