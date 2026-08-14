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

    function cleanExtractedText(rawText) {
        if (!rawText) return '';
        const lines = rawText.split('\n');
        const cleanedLines = lines.filter(line => {
            const trimmed = line.trim();
            if (!trimmed) return false;
            // Filter pagination / attempt indicators like "2/2", "< 2/2 >", "1/2"
            if (/^<?\s*\d+\s*\/\s*\d+\s*>?$/.test(trimmed)) return false;
            // Filter system instructions & prompt headers
            if (trimmed.includes('[SYSTEM INSTRUCTION')) return false;
            if (trimmed.includes('User Prompt:')) return false;
            // Filter UI chrome & buttons
            if (trimmed === 'ChatGPT can make mistakes. Check important info.') return false;
            if (trimmed === 'Ask anything') return false;
            if (trimmed === 'Think') return false;
            if (trimmed === 'Copy' || trimmed === 'Read aloud' || trimmed === 'Bad response' || trimmed === 'Good response') return false;
            return true;
        });
        return cleanedLines.join('\n').trim();
    }

    function extractAssistantTextDirectly() {
        const assistantEls = document.querySelectorAll('[data-message-author-role="assistant"], article[data-testid*="conversation-turn"]');
        if (assistantEls.length > 0) {
            const lastAssistant = assistantEls[assistantEls.length - 1];
            
            // Prefer markdown container inside assistant message
            const md = lastAssistant.querySelector('.markdown, .prose, [class*="markdown"], [class*="prose"]');
            if (md) {
                const text = cleanExtractedText(md.innerText);
                if (text.length > 0) return text;
            }

            // Fallback: clone assistant element and remove buttons/navigation
            const clone = lastAssistant.cloneNode(true);
            clone.querySelectorAll('button, nav, svg, [role="button"], [aria-label]').forEach(el => el.remove());
            const text = cleanExtractedText(clone.innerText);
            if (text.length > 0) return text;
        }
        return '';
    }

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[ChatGPT] Starting prompt injection...');

        // Snapshot main content before prompt
        const mainEl = document.querySelector('main') || document.body;
        const textBefore = mainEl.innerText;

        // 1. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[ChatGPT] Input found:', input.tagName, input.id);
        utils.simulateInput(input, promptText);

        // 2. Wait for UI state to update, then click send ONCE
        await new Promise(r => setTimeout(r, 800));
        const sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (sendBtn) {
            utils.clickButton(sendBtn);
            console.log('[ChatGPT] Sent via send button (single click)');
        } else {
            console.log('[ChatGPT] Send button not found, sending via Enter key');
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', { 
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true 
            }));
        }

        // 3. Poll for response
        console.log('[ChatGPT] Polling for assistant response...');
        const responseText = await pollForAssistantResponse(textBefore, promptText, 90000);

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
                // Method A: Direct extraction from assistant container (accurate & avoids sidebar/headers)
                let text = extractAssistantTextDirectly();

                // Method B: Diff on <main> area (excludes sidebar titles)
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
                            console.log('[ChatGPT] Response stable after', stableCount, 'polls');
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

                setTimeout(check, 2000);
            };

            setTimeout(check, 4000);
        });
    }
})();
