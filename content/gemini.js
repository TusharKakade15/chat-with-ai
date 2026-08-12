// Gemini Content Script
// Uses TEXT-DIFF approach same as ChatGPT — captures text before, finds new text after

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

        // 1. Capture ALL text on the page BEFORE sending
        const textBefore = document.body.innerText;
        console.log('[Gemini] Page text before (length):', textBefore.length);

        // 2. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[Gemini] Input found:', input.tagName, input.className);
        utils.simulateInput(input, promptText);

        // 3. Wait then send
        await new Promise(r => setTimeout(r, 1000));
        let sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (sendBtn) {
            utils.clickButton(sendBtn);
            console.log('[Gemini] Sent via button');
        } else {
            console.log('[Gemini] Trying Enter key...');
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', { 
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true 
            }));
        }

        // 4. Poll for NEW text that wasn't on the page before
        console.log('[Gemini] Polling for new text...');
        const responseText = await pollForNewText(textBefore, promptText, 90000);

        console.log('[Gemini] Final response length:', responseText.length);
        console.log('[Gemini] Response:', responseText);
        return responseText || 'Error: Could not find Gemini response';
    });

    function pollForNewText(textBefore, promptText, timeout) {
        return new Promise((resolve) => {
            const start = Date.now();
            const beforeLines = new Set(textBefore.split('\n').map(l => l.trim()).filter(l => l.length > 0));
            const promptLines = new Set(promptText.split('\n').map(l => l.trim()).filter(l => l.length > 0));
            
            let lastNewText = '';
            let stableCount = 0;

            const check = () => {
                const textAfter = document.body.innerText;
                const afterLines = textAfter.split('\n').map(l => l.trim()).filter(l => l.length > 0);

                const newLines = afterLines.filter(line => {
                    if (beforeLines.has(line)) return false;
                    if (promptLines.has(line)) return false;
                    // Skip Gemini UI chrome
                    if (line === 'Gemini is AI and can make mistakes.') return false;
                    if (line === 'Gemini can make mistakes.') return false;
                    if (line === 'Ask Gemini') return false;
                    if (line.length < 3) return false;
                    // Skip system instruction fragments
                    if (line.includes('[SYSTEM INSTRUCTION')) return false;
                    if (line.includes('User asked:')) return false;
                    if (line.includes('ChatGPT said:')) return false;
                    if (line.includes('Claude said:')) return false;
                    if (line.includes('Provide a final synthesis')) return false;
                    return true;
                });

                const newText = newLines.join('\n').trim();
                console.log('[Gemini] Poll: found', newLines.length, 'new lines, length:', newText.length);

                if (newText.length > 10) {
                    if (newText === lastNewText) {
                        stableCount++;
                        if (stableCount >= 3) {
                            console.log('[Gemini] Response stable for', stableCount, 'polls');
                            resolve(newText);
                            return;
                        }
                    } else {
                        stableCount = 0;
                        lastNewText = newText;
                    }
                }

                if (Date.now() - start > timeout) {
                    console.log('[Gemini] Timeout reached');
                    resolve(lastNewText || newText || '');
                    return;
                }

                setTimeout(check, 2000);
            };

            setTimeout(check, 5000);
        });
    }
})();
