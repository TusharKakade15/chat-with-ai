// Claude Content Script
// Uses TEXT-DIFF approach — captures text before, finds new text after

(function() {
    const INPUT_SELECTORS = [
        'div.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"].ProseMirror',
        'fieldset [contenteditable="true"]',
        'div[contenteditable="true"]',
    ];

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Claude] Starting...');

        // 1. Capture ALL text on the page BEFORE sending
        const textBefore = document.body.innerText;
        console.log('[Claude] Page text before (length):', textBefore.length);

        // 2. Find the input field
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[Claude] Input found:', input.tagName, input.className);

        // 3. Type text into Claude's ProseMirror editor
        input.focus();
        await new Promise(r => setTimeout(r, 300));

        // Select all and paste
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);

        try {
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', promptText);
            input.dispatchEvent(new ClipboardEvent('paste', {
                bubbles: true, cancelable: true, clipboardData: clipboardData
            }));
            console.log('[Claude] Pasted via ClipboardEvent');
        } catch (e) {
            console.log('[Claude] ClipboardEvent failed');
        }

        await new Promise(r => setTimeout(r, 500));

        // Fallback if paste didn't work
        if ((input.textContent || '').trim().length < 10) {
            console.log('[Claude] Trying paragraph insertion...');
            input.innerHTML = '';
            const p = document.createElement('p');
            p.textContent = promptText;
            input.appendChild(p);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 4. Wait then send via Enter key
        await new Promise(r => setTimeout(r, 1000));
        console.log('[Claude] Pressing Enter to send...');
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
        }));
        input.dispatchEvent(new KeyboardEvent('keypress', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
        }));
        input.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
        }));

        // Also try clicking send button as backup
        await new Promise(r => setTimeout(r, 500));
        const sendBtn = utils.findSendButton([
            'button[aria-label="Send Message"]',
            'button[aria-label="Send message"]',
            'button[aria-label="Send"]',
        ]);
        if (sendBtn) {
            console.log('[Claude] Also clicking send button...');
            utils.clickButton(sendBtn);
        }

        // 5. Poll for NEW text using text-diff
        console.log('[Claude] Polling for new text...');
        const responseText = await pollForNewText(textBefore, promptText, 90000);

        console.log('[Claude] Final response length:', responseText.length);
        console.log('[Claude] Response:', responseText);
        return responseText || 'Error: Could not find Claude response';
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
                    if (line.length < 3) return false;
                    if (line.includes('[SYSTEM INSTRUCTION')) return false;
                    if (line.includes('The user asked:')) return false;
                    if (line.includes('ChatGPT responded:')) return false;
                    if (line.includes('What is your perspective')) return false;
                    if (line === 'Claude is AI and can make mistakes. Please double-check responses.') return false;
                    return true;
                });

                const newText = newLines.join('\n').trim();
                console.log('[Claude] Poll: found', newLines.length, 'new lines, length:', newText.length);

                if (newText.length > 10) {
                    if (newText === lastNewText) {
                        stableCount++;
                        if (stableCount >= 3) {
                            resolve(newText);
                            return;
                        }
                    } else {
                        stableCount = 0;
                        lastNewText = newText;
                    }
                }

                if (Date.now() - start > timeout) {
                    resolve(lastNewText || newText || '');
                    return;
                }

                setTimeout(check, 2000);
            };

            setTimeout(check, 5000);
        });
    }
})();
