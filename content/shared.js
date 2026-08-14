// AI Web UI Bridge - Shared Utilities for Content Scripts

window.AIBridgeUtils = {
    // Wait for an element to appear, trying multiple selectors
    waitForElement: function(selectors, timeout = 15000) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        return new Promise((resolve, reject) => {
            for (const sel of selectorList) {
                const el = document.querySelector(sel);
                if (el) {
                    console.log('[AIBridge] Found element:', sel);
                    return resolve(el);
                }
            }

            const observer = new MutationObserver(() => {
                for (const sel of selectorList) {
                    const el = document.querySelector(sel);
                    if (el) {
                        console.log('[AIBridge] Found element:', sel);
                        observer.disconnect();
                        return resolve(el);
                    }
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout waiting for: ${selectorList.join(', ')}`));
            }, timeout);
        });
    },

    // Type into a contenteditable or textarea using multiple strategies
    simulateInput: function(element, text) {
        element.focus();

        if (element.contentEditable === 'true' || element.getAttribute('contenteditable') === 'true') {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(element);
            selection.removeAllRanges();
            selection.addRange(range);

            const inserted = document.execCommand('insertText', false, text);
            if (!inserted) {
                element.textContent = text;
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
            ).set;
            setter.call(element, text);
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }
    },

    // Find a send button using multiple strategies
    findSendButton: function(selectors) {
        for (const sel of selectors) {
            const btn = document.querySelector(sel);
            if (btn) {
                console.log('[AIBridge] Send button found via:', sel);
                let target = btn;
                while (target && target.tagName !== 'BUTTON') {
                    target = target.parentElement;
                }
                return target || btn;
            }
        }

        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
            const label = (btn.getAttribute('aria-label') || '').toLowerCase();
            const text = (btn.textContent || '').toLowerCase().trim();
            if (label.includes('send') || text === 'send') {
                console.log('[AIBridge] Send button found via brute-force:', label || text);
                return btn;
            }
        }

        return null;
    },

    // Click a button safely without duplicate events
    clickButton: function(btn) {
        btn.focus();
        btn.click();
        console.log('[AIBridge] Button clicked');
    },

    // Listen for messages from background script
    setupMessageListener: function(injectLogicCallback) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'PING') {
                sendResponse({ status: 'ok' });
                return true;
            }
            if (request.type === 'INJECT_PROMPT') {
                console.log('[AIBridge] Received INJECT_PROMPT on', window.location.href);
                injectLogicCallback(request.prompt)
                    .then(text => {
                        console.log('[AIBridge] Success, text length:', text.length);
                        sendResponse({ text: text });
                    })
                    .catch(err => {
                        console.error('[AIBridge] Error:', err);
                        sendResponse({ text: `Error: ${err.message}` });
                    });
                return true;
            }
        });
        console.log('[AIBridge] Content script ready on:', window.location.href);
    }
};
