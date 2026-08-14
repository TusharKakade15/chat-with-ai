// Gemini Content Script

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
        'button[aria-label*="Send"]',
        'button[aria-label*="send"]',
        'button.send-button',
        '.send-button-container button',
        'rich-textarea ~ * button',
        'button:has(mat-icon[fonticon="send"])',
    ];

    function cleanExtractedText(rawText) {
        if (!rawText) return '';
        const lines = rawText.split('\n');
        const cleanedLines = lines.filter(line => {
            const trimmed = line.trim();
            if (!trimmed) return false;
            if (/^<?\s*\d+\s*\/\s*\d+\s*>?$/.test(trimmed)) return false;
            // Filter prompt text & headers
            if (trimmed.includes('[SYSTEM INSTRUCTION')) return false;
            if (trimmed.includes('User asked:')) return false;
            if (trimmed.includes('ChatGPT said:')) return false;
            if (trimmed.includes('Claude said:')) return false;
            if (trimmed.includes('Provide a final synthesis')) return false;
            // Filter Gemini turn headers & UI badges
            if (trimmed === 'You said' || trimmed === 'Gemini said') return false;
            if (trimmed === 'Show drafts' || trimmed.startsWith('Draft ')) return false;
            if (trimmed === 'Gemini is AI and can make mistakes.') return false;
            if (trimmed === 'Gemini can make mistakes.') return false;
            if (trimmed === 'Ask Gemini') return false;
            if (trimmed === 'New chat' || trimmed === 'Search chats') return false;
            if (trimmed === 'Copy' || trimmed === 'Share' || trimmed === 'Good response' || trimmed === 'Bad response' || trimmed === 'Modify response') return false;
            return true;
        });
        const result = cleanedLines.join('\n').trim();
        // If result is only the conversation title or turn headers, reject
        if (result === 'You said' || result === 'Gemini said' || result.length < 10) return '';
        return result;
    }

    function extractGeminiTextDirectly() {
        // Query Gemini's model response components
        const responseEls = document.querySelectorAll('model-response, message-content:not(user-query message-content), .model-response-text');
        if (responseEls.length > 0) {
            const last = responseEls[responseEls.length - 1];
            // Prefer inner markdown element which contains only the response body
            const md = last.querySelector('.markdown, [class*="markdown"], .response-content, p');
            if (md) {
                const text = cleanExtractedText(md.innerText);
                if (text.length > 10) return text;
            }
            const text = cleanExtractedText(last.innerText);
            if (text.length > 15) return text;
        }
        return '';
    }

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Gemini] Starting prompt injection...');

        const mainEl = document.querySelector('main') || document.body;
        const textBefore = mainEl.innerText;

        // 1. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[Gemini] Input found:', input.tagName, input.className);
        utils.simulateInput(input, promptText);

        // 2. Wait for Angular change detection, then send
        await new Promise(r => setTimeout(r, 800));

        let sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (sendBtn) {
            utils.clickButton(sendBtn);
            console.log('[Gemini] Sent via send button');
        } else {
            console.log('[Gemini] Send button not found, sending via Enter key...');
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

        // 3. Fast polling for model response
        console.log('[Gemini] Polling for model response...');
        const responseText = await pollForGeminiResponse(textBefore, promptText, 35000);

        console.log('[Gemini] Final response length:', responseText.length);
        console.log('[Gemini] Response:', responseText);
        return responseText || 'Error: Could not find Gemini response';
    });

    function pollForGeminiResponse(textBefore, promptText, timeout) {
        return new Promise((resolve) => {
            const start = Date.now();
            const beforeLines = new Set(textBefore.split('\n').map(l => l.trim()).filter(l => l.length > 0));
            const promptLines = new Set(promptText.split('\n').map(l => l.trim()).filter(l => l.length > 0));
            
            let lastFoundText = '';
            let stableCount = 0;

            const check = () => {
                let text = extractGeminiTextDirectly();

                if (!text || text.length < 10) {
                    const mainEl = document.querySelector('main') || document.body;
                    const afterLines = mainEl.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    const newLines = afterLines.filter(line => {
                        if (beforeLines.has(line)) return false;
                        if (promptLines.has(line)) return false;
                        return true;
                    });
                    text = cleanExtractedText(newLines.join('\n'));
                }

                if (text.length > 15 && !text.includes('You said\nGemini said')) {
                    if (text === lastFoundText) {
                        stableCount++;
                        if (stableCount >= 2) {
                            console.log('[Gemini] Response stable after', stableCount, 'polls');
                            resolve(text);
                            return;
                        }
                    } else {
                        stableCount = 0;
                        lastFoundText = text;
                    }
                }

                if (Date.now() - start > timeout) {
                    console.log('[Gemini] Polling timeout reached');
                    resolve(lastFoundText || text || '');
                    return;
                }

                setTimeout(check, 1000);
            };

            setTimeout(check, 2500);
        });
    }
})();
