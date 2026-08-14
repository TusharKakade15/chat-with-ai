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

    function cleanExtractedText(rawText) {
        if (!rawText) return '';
        const lines = rawText.split('\n');
        const cleanedLines = lines.filter(line => {
            const trimmed = line.trim();
            if (!trimmed) return false;
            if (/^<?\s*\d+\s*\/\s*\d+\s*>?$/.test(trimmed)) return false;
            if (trimmed.includes('[SYSTEM INSTRUCTION')) return false;
            if (trimmed.includes('The user asked:')) return false;
            if (trimmed.includes('ChatGPT responded:')) return false;
            if (trimmed.includes('What is your perspective')) return false;
            if (trimmed === 'Claude is AI and can make mistakes. Please double-check responses.') return false;
            if (trimmed === 'Copy' || trimmed === 'Retry' || trimmed === 'Edit') return false;
            return true;
        });
        return cleanedLines.join('\n').trim();
    }

    function extractClaudeTextDirectly() {
        // Look for Claude message containers
        const messageEls = document.querySelectorAll('.font-claude-message, [data-is-streaming], .grid-cols-1 .prose');
        if (messageEls.length > 0) {
            const last = messageEls[messageEls.length - 1];
            const text = cleanExtractedText(last.innerText);
            if (text.length > 0) return text;
        }
        return '';
    }

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Claude] Starting prompt injection...');

        const mainEl = document.querySelector('main') || document.body;
        const textBefore = mainEl.innerText;

        // 1. Find the input field
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[Claude] Input found:', input.tagName, input.className);

        // 2. Type text into Claude's ProseMirror editor
        input.focus();
        await new Promise(r => setTimeout(r, 300));

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

        if ((input.textContent || '').trim().length < 10) {
            console.log('[Claude] Trying paragraph insertion...');
            input.innerHTML = '';
            const p = document.createElement('p');
            p.textContent = promptText;
            input.appendChild(p);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 3. Send once (prefer send button, fallback to Enter)
        await new Promise(r => setTimeout(r, 800));
        const sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (sendBtn) {
            console.log('[Claude] Sending via send button (single click)...');
            utils.clickButton(sendBtn);
        } else {
            console.log('[Claude] Pressing Enter to send...');
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
            }));
        }

        // 4. Poll for response
        console.log('[Claude] Polling for response...');
        const responseText = await pollForClaudeResponse(textBefore, promptText, 90000);

        console.log('[Claude] Final response length:', responseText.length);
        console.log('[Claude] Response:', responseText);
        return responseText || 'Error: Could not find Claude response';
    });

    function pollForClaudeResponse(textBefore, promptText, timeout) {
        return new Promise((resolve) => {
            const start = Date.now();
            const beforeLines = new Set(textBefore.split('\n').map(l => l.trim()).filter(l => l.length > 0));
            const promptLines = new Set(promptText.split('\n').map(l => l.trim()).filter(l => l.length > 0));
            
            let lastFoundText = '';
            let stableCount = 0;

            const check = () => {
                let text = extractClaudeTextDirectly();

                if (!text || text.length < 5) {
                    const mainEl = document.querySelector('main') || document.body;
                    const afterLines = mainEl.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    const newLines = afterLines.filter(line => {
                        if (beforeLines.has(line)) return false;
                        if (promptLines.has(line)) return false;
                        return true;
                    });
                    text = cleanExtractedText(newLines.join('\n'));
                }

                if (text.length > 10) {
                    if (text === lastFoundText) {
                        stableCount++;
                        if (stableCount >= 3) {
                            console.log('[Claude] Response stable after', stableCount, 'polls');
                            resolve(text);
                            return;
                        }
                    } else {
                        stableCount = 0;
                        lastFoundText = text;
                    }
                }

                if (Date.now() - start > timeout) {
                    console.log('[Claude] Polling timeout reached');
                    resolve(lastFoundText || text || '');
                    return;
                }

                setTimeout(check, 2000);
            };

            setTimeout(check, 4000);
        });
    }
})();
