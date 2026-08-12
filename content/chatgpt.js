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

    // Selector for the "stop generating" button — if visible, response is still streaming
    const STOP_BUTTON_SELECTORS = [
        'button[data-testid="stop-button"]',
        'button[aria-label="Stop generating"]',
        'button[aria-label="Stop"]',
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
        console.log('[ChatGPT] Existing responses:', before.count);

        // 2. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[ChatGPT] Input found:', input.tagName, input.id);
        utils.simulateInput(input, promptText);

        // 3. Wait then click send
        await new Promise(r => setTimeout(r, 1000));
        const sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (!sendBtn) {
            // Fallback: try pressing Enter
            console.log('[ChatGPT] Send button not found, trying Enter key...');
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        } else {
            utils.clickButton(sendBtn);
        }
        console.log('[ChatGPT] Prompt sent!');

        // 4. Wait for a NEW response element to appear
        await new Promise(r => setTimeout(r, 2000));
        const activeSelector = before.count > 0 ? before.selector : RESPONSE_SELECTORS;
        console.log('[ChatGPT] Waiting for new response...');
        const newResponseEl = await utils.waitForNewElement(activeSelector, before.count, 60000);
        console.log('[ChatGPT] New response element appeared!');

        // 5. Wait for the "stop generating" button to disappear (means streaming is done)
        console.log('[ChatGPT] Waiting for generation to complete...');
        await waitForStreamingToFinish(utils);

        // 6. Extra safety: wait for mutations to stop
        const latestEl = utils.getLastMatch(RESPONSE_SELECTORS);
        if (latestEl) {
            await utils.waitForMutationToStop(latestEl.parentElement || latestEl, 5000, 120000);
        }

        // 7. Grab the LAST response text
        const finalEl = utils.getLastMatch(RESPONSE_SELECTORS);
        const text = finalEl ? finalEl.innerText.trim() : 'Error: Could not scrape response';
        console.log('[ChatGPT] Final scraped text length:', text.length);
        console.log('[ChatGPT] First 200 chars:', text.substring(0, 200));
        return text;
    });

    // Wait until the stop button disappears (ChatGPT is done generating)
    async function waitForStreamingToFinish(utils) {
        const maxWait = 120000;
        const start = Date.now();

        while (Date.now() - start < maxWait) {
            let stopBtn = null;
            for (const sel of STOP_BUTTON_SELECTORS) {
                stopBtn = document.querySelector(sel);
                if (stopBtn) break;
            }

            if (!stopBtn) {
                // No stop button found — either generation finished or hasn't started
                // Wait a bit more to be safe
                await new Promise(r => setTimeout(r, 2000));
                // Check again
                let stillThere = null;
                for (const sel of STOP_BUTTON_SELECTORS) {
                    stillThere = document.querySelector(sel);
                    if (stillThere) break;
                }
                if (!stillThere) {
                    console.log('[ChatGPT] Stop button gone — generation complete.');
                    return;
                }
            }

            await new Promise(r => setTimeout(r, 1000));
        }
        console.log('[ChatGPT] Max wait reached for streaming.');
    }
})();
