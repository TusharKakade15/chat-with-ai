// Claude Content Script

(function() {
    const INPUT_SELECTORS = [
        'div.ProseMirror[contenteditable="true"]',     // ProseMirror editor
        '[contenteditable="true"].ProseMirror',         // alternative order
        'fieldset [contenteditable="true"]',            // inside fieldset
        '[contenteditable="true"]',                     // generic contenteditable
    ];

    const SEND_BUTTON_SELECTORS = [
        'button[aria-label="Send Message"]',            // primary
        'button[aria-label="Send message"]',            // lowercase variant
        'button[aria-label="Send"]',                    // short variant
        'fieldset button[type="button"]:last-of-type',  // last button in fieldset
        'button svg polyline[points="22 2 15 22 11 13 2 9 20 2"]', // send icon path
    ];

    const RESPONSE_SELECTORS = [
        '.font-claude-message',                         // Claude message font class
        '[data-is-streaming] .grid',                    // streaming response grid
        '.prose',                                        // prose blocks
        '.grid .whitespace-pre-wrap',                    // response text
        '.grid-cols-1 > div:last-child',                 // last grid child
    ];

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Claude] Starting prompt injection...');

        // 1. Find the input field
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[Claude] Found input:', input.tagName, input.className);

        // 2. Inject text
        utils.simulateInput(input, promptText);
        console.log('[Claude] Text injected, waiting for send button...');

        // 3. Wait for send button to be ready
        await new Promise(r => setTimeout(r, 800));

        // 4. Find and click send button
        // For Claude, the send button might be inside a complex structure
        let sendBtn = null;
        for (const sel of SEND_BUTTON_SELECTORS) {
            sendBtn = document.querySelector(sel);
            if (sendBtn) {
                // If we matched an SVG child, walk up to the button
                while (sendBtn && sendBtn.tagName !== 'BUTTON') {
                    sendBtn = sendBtn.parentElement;
                }
                if (sendBtn) {
                    console.log('[Claude] Found send button via:', sel);
                    break;
                }
            }
        }

        if (!sendBtn) {
            // Last resort: find any button near the input that looks like send
            const allButtons = document.querySelectorAll('button');
            for (const btn of allButtons) {
                const label = (btn.getAttribute('aria-label') || '').toLowerCase();
                const text = btn.innerText.toLowerCase();
                if (label.includes('send') || text.includes('send')) {
                    sendBtn = btn;
                    console.log('[Claude] Found send button via text/aria search');
                    break;
                }
            }
        }

        if (!sendBtn) {
            throw new Error('Could not find Claude send button');
        }

        sendBtn.click();
        console.log('[Claude] Send button clicked. Waiting for response...');

        // 5. Wait for response to start
        await new Promise(r => setTimeout(r, 2000));

        // 6. Wait for response to finish
        let responseEl = utils.getLastMatch(RESPONSE_SELECTORS);
        if (!responseEl) {
            console.log('[Claude] No response element found yet, waiting...');
            responseEl = await utils.waitForElement(RESPONSE_SELECTORS, 30000);
        }

        await utils.waitForMutationToStop(
            responseEl.parentElement || responseEl,
            { childList: true, characterData: true, subtree: true },
            3000, 120000
        );
        console.log('[Claude] Response generation appears complete.');

        // 7. Grab the final text
        const finalEl = utils.getLastMatch(RESPONSE_SELECTORS);
        const text = finalEl ? finalEl.innerText.trim() : 'Error: Could not find response text.';
        console.log('[Claude] Scraped text length:', text.length);

        return text;
    });
})();
