// Claude Content Script

(function() {
    const INPUT_SELECTORS = [
        'div.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"].ProseMirror',
        'fieldset [contenteditable="true"]',
        'div[contenteditable="true"]',
    ];

    const SEND_BUTTON_SELECTORS = [
        'button[aria-label="Send Message"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
    ];

    const RESPONSE_SELECTORS = [
        '[data-is-streaming]',
        '.font-claude-message',
        '.grid-cols-1 .prose',
        '.grid .whitespace-pre-wrap',
    ];

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Claude] Starting...');

        // 1. Count existing responses BEFORE sending
        const before = utils.countElements(RESPONSE_SELECTORS);
        console.log('[Claude] Existing responses:', before.count);

        // 2. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[Claude] Input found:', input.tagName, input.className);

        // For Claude's ProseMirror, we need a special approach:
        // Focus, clear, then use keyboard events to paste
        input.focus();
        await new Promise(r => setTimeout(r, 200));

        // Clear existing content
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);

        // Create a paste event with our text
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', promptText);
        const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboardData
        });
        input.dispatchEvent(pasteEvent);
        console.log('[Claude] Text pasted via ClipboardEvent');

        // Fallback: if paste didn't work, try execCommand
        await new Promise(r => setTimeout(r, 500));
        if (input.textContent.trim().length < 10) {
            console.log('[Claude] Paste may not have worked, trying execCommand...');
            input.innerHTML = '';
            input.focus();
            document.execCommand('insertText', false, promptText);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 3. Wait for send button to be enabled
        await new Promise(r => setTimeout(r, 1000));

        // 4. Find and click send
        const sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (!sendBtn) throw new Error('Claude send button not found');
        console.log('[Claude] Send button found, disabled?', sendBtn.disabled);

        // Try clicking multiple times with delays (Claude's button can be sluggish)
        utils.clickButton(sendBtn);
        await new Promise(r => setTimeout(r, 500));

        // Verify if the button is still clickable (meaning click didn't register)
        const stillThere = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (stillThere && !stillThere.disabled) {
            console.log('[Claude] Retrying click...');
            utils.clickButton(stillThere);
        }

        console.log('[Claude] Prompt sent!');

        // 5. Wait for a NEW response to appear
        console.log('[Claude] Waiting for response...');
        await new Promise(r => setTimeout(r, 3000));

        // For Claude, just wait for content to stabilize on the page
        // Watch the entire main content area
        const mainContent = document.querySelector('main') || document.body;
        await utils.waitForMutationToStop(mainContent, 4000, 120000);
        console.log('[Claude] Page stabilized.');

        // 6. Grab the last response
        // Try multiple approaches to find Claude's response text
        let text = '';

        // Approach 1: font-claude-message
        let els = document.querySelectorAll('.font-claude-message');
        if (els.length > 0) {
            text = els[els.length - 1].innerText.trim();
        }

        // Approach 2: data-is-streaming elements
        if (!text) {
            els = document.querySelectorAll('[data-is-streaming] .grid');
            if (els.length > 0) text = els[els.length - 1].innerText.trim();
        }

        // Approach 3: Look for the last large text block that's not the user message
        if (!text) {
            const allDivs = document.querySelectorAll('.prose, .whitespace-pre-wrap');
            if (allDivs.length > 0) text = allDivs[allDivs.length - 1].innerText.trim();
        }

        // Approach 4: Last resort - find the last long text block on the page
        if (!text) {
            const paragraphs = document.querySelectorAll('p');
            const longTexts = Array.from(paragraphs).filter(p => p.innerText.length > 50);
            if (longTexts.length > 0) text = longTexts[longTexts.length - 1].innerText.trim();
        }

        console.log('[Claude] Scraped:', text.substring(0, 100) + '...');
        return text || 'Error: Could not scrape Claude response';
    });
})();
