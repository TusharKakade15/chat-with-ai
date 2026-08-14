// Claude Content Script

(function() {
    const INPUT_SELECTORS = [
        'div.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"].ProseMirror',
        'fieldset [contenteditable="true"]',
        'div[contenteditable="true"]',
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
        const fontMsgs = document.querySelectorAll('.font-claude-message');
        if (fontMsgs.length > 0) {
            const last = fontMsgs[fontMsgs.length - 1];
            const text = cleanExtractedText(last.innerText);
            if (text.length > 5) return text;
        }

        const proseMsgs = document.querySelectorAll('[data-is-streaming] .grid, .grid-cols-1 .prose, .prose');
        if (proseMsgs.length > 0) {
            const last = proseMsgs[proseMsgs.length - 1];
            const text = cleanExtractedText(last.innerText);
            if (text.length > 5 && !text.includes('[SYSTEM INSTRUCTION')) return text;
        }

        const main = document.querySelector('main') || document.body;
        const preWraps = main.querySelectorAll('.whitespace-pre-wrap');
        if (preWraps.length > 0) {
            const last = preWraps[preWraps.length - 1];
            const text = cleanExtractedText(last.innerText);
            if (text.length > 5 && !text.includes('[SYSTEM INSTRUCTION')) return text;
        }

        return '';
    }

    function findClaudeSendButton() {
        // Direct aria selectors
        const selectors = [
            'button[aria-label="Send Message"]',
            'button[aria-label="Send message"]',
            'button[aria-label="Send"]',
            'fieldset button:last-of-type',
            'button[aria-label*="Send"]',
            'button[aria-label*="send"]',
        ];
        for (const sel of selectors) {
            const btn = document.querySelector(sel);
            if (btn) return btn;
        }

        // Search near ProseMirror
        const editor = document.querySelector('.ProseMirror');
        if (editor) {
            const container = editor.closest('fieldset') || editor.closest('form') || editor.parentElement?.parentElement;
            if (container) {
                const buttons = container.querySelectorAll('button');
                for (const b of buttons) {
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    if (aria.includes('send')) return b;
                }
                if (buttons.length > 0) return buttons[buttons.length - 1];
            }
        }

        return null;
    }

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Claude] Starting prompt injection...');

        const mainEl = document.querySelector('main') || document.body;
        const textBefore = mainEl.innerText;

        // 1. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[Claude] Input found:', input.tagName, input.className);
        utils.simulateInput(input, promptText);

        // 2. Wait then send
        await new Promise(r => setTimeout(r, 800));
        const sendBtn = findClaudeSendButton();
        if (sendBtn) {
            console.log('[Claude] Sending via send button...');
            utils.clickButton(sendBtn);
        } else {
            console.log('[Claude] Send button not found, pressing Enter to send...');
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
        }

        // 3. Fast polling for response
        console.log('[Claude] Polling for response...');
        const responseText = await pollForClaudeResponse(textBefore, promptText, 35000);

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
                        if (stableCount >= 2) {
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

                setTimeout(check, 1000);
            };

            setTimeout(check, 2500);
        });
    }
})();
