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

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[ChatGPT] Starting...');

        // Save current URL to detect when ChatGPT creates a new conversation
        const urlBefore = window.location.href;

        // 1. Find and fill input
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[ChatGPT] Input found:', input.tagName, input.id);
        utils.simulateInput(input, promptText);

        // 2. Wait then click send
        await new Promise(r => setTimeout(r, 1000));
        const sendBtn = utils.findSendButton(SEND_BUTTON_SELECTORS);
        if (sendBtn) {
            utils.clickButton(sendBtn);
            console.log('[ChatGPT] Sent via button');
        } else {
            console.log('[ChatGPT] Send button not found, trying Enter...');
            input.focus();
            input.dispatchEvent(new KeyboardEvent('keydown', { 
                key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true 
            }));
        }

        // 3. Wait for URL to change (ChatGPT redirects to /c/xxxx on new conversation)
        console.log('[ChatGPT] Waiting for conversation to start...');
        await waitForUrlChange(urlBefore, 15000);
        console.log('[ChatGPT] URL changed, conversation started.');

        // 4. POLL for response text every 2 seconds until we get something
        console.log('[ChatGPT] Polling for response text...');
        const responseText = await pollForResponse(60000);

        console.log('[ChatGPT] Final text length:', responseText.length);
        console.log('[ChatGPT] Full text:', responseText);
        return responseText || 'Error: Could not find ChatGPT response';
    });

    // Wait for the URL to change (indicates ChatGPT created a conversation)
    function waitForUrlChange(originalUrl, timeout) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                if (window.location.href !== originalUrl) {
                    resolve();
                } else if (Date.now() - start > timeout) {
                    console.log('[ChatGPT] URL did not change, proceeding anyway...');
                    resolve();
                } else {
                    setTimeout(check, 500);
                }
            };
            check();
        });
    }

    // Poll the DOM every 2 seconds looking for a response
    // Once found, wait 5 more seconds for it to finish, then scrape
    function pollForResponse(timeout) {
        return new Promise((resolve) => {
            const start = Date.now();
            let lastFoundText = '';
            let stableCount = 0;

            const check = () => {
                const text = tryScrapResponse();

                if (text.length > 10) {
                    // We found something! Check if it's stable (same as last check)
                    if (text === lastFoundText) {
                        stableCount++;
                        // If the text hasn't changed for 3 consecutive checks (6 seconds), it's done
                        if (stableCount >= 3) {
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
                    // Timeout — return whatever we have
                    resolve(lastFoundText || text || '');
                    return;
                }

                setTimeout(check, 2000);
            };

            // Give ChatGPT a few seconds to start generating before first check
            setTimeout(check, 3000);
        });
    }

    // Try multiple strategies to find the response text
    function tryScrapResponse() {
        let text = '';

        // Strategy 1: assistant role containers
        let els = document.querySelectorAll('[data-message-author-role="assistant"]');
        if (els.length > 0) {
            const last = els[els.length - 1];
            const markdown = last.querySelector('.markdown') || last.querySelector('.prose') || last;
            text = markdown.innerText.trim();
            if (text.length > 5) {
                console.log('[ChatGPT] Found via assistant role, length:', text.length);
                return text;
            }
        }

        // Strategy 2: .markdown inside articles
        els = document.querySelectorAll('article .markdown, article .prose');
        if (els.length > 0) {
            text = els[els.length - 1].innerText.trim();
            if (text.length > 5) {
                console.log('[ChatGPT] Found via article .markdown, length:', text.length);
                return text;
            }
        }

        // Strategy 3: any .markdown or .prose
        els = document.querySelectorAll('.markdown, .prose');
        if (els.length > 0) {
            text = els[els.length - 1].innerText.trim();
            if (text.length > 5) {
                console.log('[ChatGPT] Found via .markdown/.prose, length:', text.length);
                return text;
            }
        }

        // Strategy 4: Look for the second "turn" in the conversation
        // ChatGPT alternates user/assistant turns
        els = document.querySelectorAll('[data-testid^="conversation-turn"]');
        if (els.length >= 2) {
            const lastTurn = els[els.length - 1];
            text = lastTurn.innerText.trim();
            if (text.length > 5) {
                console.log('[ChatGPT] Found via conversation-turn, length:', text.length);
                return text;
            }
        }

        // Strategy 5: Brute-force — find text blocks inside <main> that aren't the prompt
        const main = document.querySelector('main');
        if (main) {
            const divs = main.querySelectorAll('div');
            for (let i = divs.length - 1; i >= 0; i--) {
                const t = divs[i].innerText.trim();
                if (t.length > 15 && 
                    t.length < 3000 &&
                    !t.includes('[SYSTEM INSTRUCTION') && 
                    !t.includes('User Prompt:') &&
                    !t.includes('ChatGPT can make mistakes') &&
                    !t.includes('Ask anything') &&
                    !t.includes('New chat')) {
                    // Check this isn't a parent of the prompt
                    if (!divs[i].querySelector('#prompt-textarea')) {
                        text = t;
                        console.log('[ChatGPT] Found via brute-force, length:', text.length);
                        return text;
                    }
                }
            }
        }

        return text;
    }
})();
