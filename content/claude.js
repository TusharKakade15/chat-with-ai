// Claude Content Script

(function() {
    const INPUT_SELECTORS = [
        'div.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"].ProseMirror',
        'fieldset [contenteditable="true"]',
        'div[contenteditable="true"]',
    ];

    const RESPONSE_SELECTORS = [
        '.font-claude-message',
        '[data-is-streaming]',
        '.grid-cols-1 .prose',
        '.whitespace-pre-wrap',
    ];

    window.AIBridgeUtils.setupMessageListener(async (promptText) => {
        const utils = window.AIBridgeUtils;
        console.log('[Claude] Starting...');

        // 1. Count existing responses BEFORE sending
        const before = utils.countElements(RESPONSE_SELECTORS);
        console.log('[Claude] Existing responses:', before.count);

        // 2. Find the input field
        const input = await utils.waitForElement(INPUT_SELECTORS);
        console.log('[Claude] Input found:', input.tagName, input.className);

        // 3. Type text into Claude's ProseMirror editor
        // Strategy: Focus, clear, paste via ClipboardEvent, then fallback to execCommand
        input.focus();
        await new Promise(r => setTimeout(r, 300));

        // Select all existing content
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);

        // Try Clipboard paste (ProseMirror handles this well)
        try {
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', promptText);
            const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: clipboardData
            });
            input.dispatchEvent(pasteEvent);
            console.log('[Claude] Pasted via ClipboardEvent');
        } catch (e) {
            console.log('[Claude] ClipboardEvent failed, using execCommand');
        }

        await new Promise(r => setTimeout(r, 500));

        // Check if text was actually inserted
        const inputText = input.textContent || input.innerText || '';
        if (inputText.trim().length < 10) {
            console.log('[Claude] Paste may not have worked (text length:', inputText.length, '), trying execCommand...');
            input.focus();
            input.innerHTML = '';

            // Create a paragraph element with the text (ProseMirror expects <p> tags)
            const p = document.createElement('p');
            p.textContent = promptText;
            input.appendChild(p);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        console.log('[Claude] Input text length:', (input.textContent || '').length);

        // 4. Wait for UI to register the input
        await new Promise(r => setTimeout(r, 1000));

        // 5. Send the message using ENTER KEY (most reliable for Claude)
        // Claude sends on Enter (without Shift)
        console.log('[Claude] Pressing Enter to send...');
        input.focus();
        
        // Dispatch keydown Enter event
        const enterDown = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        });
        input.dispatchEvent(enterDown);
        
        const enterPress = new KeyboardEvent('keypress', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        });
        input.dispatchEvent(enterPress);
        
        const enterUp = new KeyboardEvent('keyup', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        });
        input.dispatchEvent(enterUp);

        // Also try clicking send button as backup
        await new Promise(r => setTimeout(r, 500));
        const sendBtn = utils.findSendButton([
            'button[aria-label="Send Message"]',
            'button[aria-label="Send message"]',
            'button[aria-label="Send"]',
        ]);
        if (sendBtn) {
            console.log('[Claude] Also clicking send button as backup...');
            utils.clickButton(sendBtn);
        }

        console.log('[Claude] Message sent!');

        // 6. Wait for response
        console.log('[Claude] Waiting for response...');
        await new Promise(r => setTimeout(r, 3000));

        // Wait for page to stabilize (watch for mutations to stop)
        const mainContent = document.querySelector('main') || document.body;
        await utils.waitForMutationToStop(mainContent, 5000, 120000);
        console.log('[Claude] Page stabilized.');

        // 7. Scrape the response using multiple strategies
        let text = '';

        // Strategy 1: font-claude-message (Claude's specific message class)
        let els = document.querySelectorAll('.font-claude-message');
        if (els.length > 0) {
            text = els[els.length - 1].innerText.trim();
            console.log('[Claude] Found via .font-claude-message, length:', text.length);
        }

        // Strategy 2: data-is-streaming blocks
        if (!text || text.length < 5) {
            els = document.querySelectorAll('[data-is-streaming]');
            if (els.length > 0) {
                text = els[els.length - 1].innerText.trim();
                console.log('[Claude] Found via [data-is-streaming], length:', text.length);
            }
        }

        // Strategy 3: Look for prose content blocks
        if (!text || text.length < 5) {
            els = document.querySelectorAll('.prose');
            if (els.length > 0) {
                text = els[els.length - 1].innerText.trim();
                console.log('[Claude] Found via .prose, length:', text.length);
            }
        }

        // Strategy 4: Any substantial text block that appeared after our message
        if (!text || text.length < 5) {
            els = document.querySelectorAll('.whitespace-pre-wrap, .break-words');
            for (let i = els.length - 1; i >= 0; i--) {
                const t = els[i].innerText.trim();
                if (t.length > 20 && !t.includes('[SYSTEM INSTRUCTION')) {
                    text = t;
                    console.log('[Claude] Found via fallback scan, length:', text.length);
                    break;
                }
            }
        }

        console.log('[Claude] Final text length:', text.length);
        console.log('[Claude] First 200 chars:', text.substring(0, 200));
        return text || 'Error: Could not scrape Claude response';
    });
})();
