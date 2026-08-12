// ChatGPT Content Script
// Uses TEXT-DIFF approach: captures page text before sending, then finds NEW text after

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

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[ChatGPT] Starting...');

        // 1. Capture ALL text on the page BEFORE sending
        const textBefore = document.body.innerText;
        console.log('[ChatGPT] Page text before (length):', textBefore.length);

        // 2. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[ChatGPT] Input found:', input.tagName, input.id);
        utils.simulateInput(input, promptText);

        // 3. Wait then click send
        await new Promise(r => setTimeout(r, 1000));
        const sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (sendBtn) {
            utils.clickButton(sendBtn);
            console.log('[ChatGPT] Sent via button');
        } else {
            console.log('[ChatGPT] Trying Enter key...');
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', { 
                key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true 
            }));
        }

        // 4. Poll for NEW text on the page (text-diff approach)
        console.log('[ChatGPT] Polling for new text on page...');
        const responseText = await pollForNewText(textBefore, promptText, 90000);

        console.log('[ChatGPT] Final response length:', responseText.length);
        console.log('[ChatGPT] Response:', responseText);
        return responseText || 'Error: Could not find ChatGPT response';
    });

    // Poll until new text appears on the page that wasn't there before
    function pollForNewText(textBefore, promptText, timeout) {
        return new Promise((resolve) => {
            const start = Date.now();
            const beforeLines = new Set(textBefore.split('\n').map(l => l.trim()).filter(l => l.length > 0));
            // Also exclude the prompt text lines
            const promptLines = new Set(promptText.split('\n').map(l => l.trim()).filter(l => l.length > 0));
            
            let lastNewText = '';
            let stableCount = 0;

            const check = () => {
                // Get current page text
                const textAfter = document.body.innerText;
                const afterLines = textAfter.split('\n').map(l => l.trim()).filter(l => l.length > 0);

                // Find lines that are NEW (not in the before snapshot and not part of the prompt)
                const newLines = afterLines.filter(line => {
                    if (beforeLines.has(line)) return false;
                    if (promptLines.has(line)) return false;
                    // Skip UI chrome
                    if (line === 'ChatGPT can make mistakes. Check important info.' ) return false;
                    if (line === 'Ask anything') return false;
                    if (line === 'Think') return false;
                    if (line.length < 3) return false;
                    // Skip the system instruction text
                    if (line.includes('[SYSTEM INSTRUCTION')) return false;
                    if (line.includes('User Prompt:')) return false;
                    return true;
                });

                const newText = newLines.join('\n').trim();
                console.log('[ChatGPT] Poll: found', newLines.length, 'new lines, total length:', newText.length);

                if (newText.length > 10) {
                    if (newText === lastNewText) {
                        stableCount++;
                        if (stableCount >= 3) {
                            console.log('[ChatGPT] Response stable for', stableCount, 'polls');
                            resolve(newText);
                            return;
                        }
                    } else {
                        stableCount = 0;
                        lastNewText = newText;
                    }
                }

                if (Date.now() - start > timeout) {
                    console.log('[ChatGPT] Timeout reached, returning what we have');
                    resolve(lastNewText || newText || '');
                    return;
                }

                setTimeout(check, 2000);
            };

            // Wait 5 seconds before first check to let ChatGPT start generating
            setTimeout(check, 5000);
        });
    }
})();
