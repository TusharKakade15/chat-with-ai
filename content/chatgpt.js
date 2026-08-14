// ChatGPT Content Script

(function() {
    const INPUT_SELECTORS = [
        '#prompt-textarea',
        'div[id="prompt-textarea"]',
        '.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"]',
        'form textarea',
    ];

    const SEND_BUTTON_SELECTORS = [
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send"]',
        'form button[type="submit"]',
    ];

    function cleanExtractedText(rawText) {
        if (!rawText) return '';
        const lines = rawText.split('\n');
        const cleanedLines = lines.filter(line => {
            const trimmed = line.trim();
            if (!trimmed) return false;
            if (/^<?\s*\d+\s*\/\s*\d+\s*>?$/.test(trimmed)) return false;
            if (trimmed.includes('[SYSTEM INSTRUCTION')) return false;
            if (trimmed.includes('User Prompt:')) return false;
            if (trimmed === 'ChatGPT can make mistakes. Check important info.') return false;
            if (trimmed === 'Ask anything') return false;
            if (trimmed === 'Think') return false;
            if (trimmed === 'Show more' || trimmed === 'Read more' || trimmed === 'View more' || trimmed === 'More') return false;
            if (trimmed === 'Copy' || trimmed === 'Read aloud' || trimmed === 'Bad response' || trimmed === 'Good response') return false;
            return true;
        });
        const result = cleanedLines.join('\n').trim();
        if (result === 'Show more' || result === 'Read more' || result === 'More' || result.length < 5) return '';
        return result;
    }

    function extractAssistantTextDirectly() {
        const assistantEls = document.querySelectorAll('[data-message-author-role="assistant"]');
        if (assistantEls.length > 0) {
            const lastAssistant = assistantEls[assistantEls.length - 1];
            const md = lastAssistant.querySelector('.markdown, .prose, [class*="markdown"], [class*="prose"], div.text-message');
            if (md) {
                const text = cleanExtractedText(md.innerText);
                if (text.length > 5) return text;
            }
            const clone = lastAssistant.cloneNode(true);
            clone.querySelectorAll('button, nav, svg, [role="button"], [aria-label]').forEach(el => el.remove());
            const text = cleanExtractedText(clone.innerText);
            if (text.length > 10) return text;
        }

        const articles = document.querySelectorAll('article');
        if (articles.length > 1) {
            const lastArticle = articles[articles.length - 1];
            const md = lastArticle.querySelector('.markdown, .prose, [class*="markdown"]');
            if (md) {
                const text = cleanExtractedText(md.innerText);
                if (text.length > 5 && !text.includes('[SYSTEM INSTRUCTION')) return text;
            }
        }
        return '';
    }

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[ChatGPT] Starting prompt injection...');

        const mainEl = document.querySelector('main') || document.body;
        const textBefore = mainEl.innerText;

        // 1. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[ChatGPT] Input found:', input.tagName, input.id);
        utils.simulateInput(input, promptText);

        // 2. Wait for UI state, then send
        await new Promise(r => setTimeout(r, 800));
        const sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (sendBtn) {
            utils.clickButton(sendBtn);
            console.log('[ChatGPT] Sent via send button');
        } else {
            console.log('[ChatGPT] Send button not found, sending via Enter key');
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
        console.log('[ChatGPT] Polling for assistant response...');
        const responseText = await pollForAssistantResponse(textBefore, promptText, 35000);

        console.log('[ChatGPT] Final scraped text length:', responseText.length);
        console.log('[ChatGPT] Scraped text:', responseText);
        return responseText || 'Error: Could not find ChatGPT response';
    });

    function pollForAssistantResponse(textBefore, promptText, timeout) {
        return new Promise((resolve) => {
            const start = Date.now();
            const beforeLines = new Set(textBefore.split('\n').map(l => l.trim()).filter(l => l.length > 0));
            const promptLines = new Set(promptText.split('\n').map(l => l.trim()).filter(l => l.length > 0));

            let lastFoundText = '';
            let stableCount = 0;

            const check = () => {
                let text = extractAssistantTextDirectly();

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

                if (text.length > 10 && text !== 'Show more' && text !== 'Read more') {
                    if (text === lastFoundText) {
                        stableCount++;
                        if (stableCount >= 2) {
                            console.log('[ChatGPT] Response stable after', stableCount, 'checks');
                            resolve(text);
                            return;
                        }
                    } else {
                        stableCount = 0;
                        lastFoundText = text;
                    }
                }

                if (Date.now() - start > timeout) {
                    console.log('[ChatGPT] Polling timeout reached');
                    resolve(lastFoundText || text || '');
                    return;
                }

                setTimeout(check, 1000);
            };

            setTimeout(check, 2500);
        });
    }
})();
