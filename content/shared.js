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

    // Wait until the count of elements matching selector increases
    waitForNewElement: function(selectors, previousCount, timeout = 60000) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        return new Promise((resolve, reject) => {
            const check = () => {
                for (const sel of selectorList) {
                    const all = document.querySelectorAll(sel);
                    if (all.length > previousCount) {
                        return all[all.length - 1];
                    }
                }
                return null;
            };

            const found = check();
            if (found) return resolve(found);

            const observer = new MutationObserver(() => {
                const found = check();
                if (found) {
                    observer.disconnect();
                    resolve(found);
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                const found = check();
                if (found) return resolve(found);
                reject(new Error(`Timeout waiting for new response element`));
            }, timeout);
        });
    },

    // Count elements matching any of the selectors
    countElements: function(selectors) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        for (const sel of selectorList) {
            const count = document.querySelectorAll(sel).length;
            if (count > 0) return { selector: sel, count };
        }
        return { selector: selectorList[0], count: 0 };
    },

    // Wait for mutations to stop (text generation finishing)
    waitForMutationToStop: function(targetNode, debounceMs = 3000, maxWaitMs = 120000) {
        return new Promise((resolve) => {
            let timer;
            const config = { childList: true, characterData: true, subtree: true };

            const observer = new MutationObserver(() => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    observer.disconnect();
                    resolve();
                }, debounceMs);
            });

            observer.observe(targetNode, config);

            timer = setTimeout(() => {
                observer.disconnect();
                resolve();
            }, debounceMs * 2);

            setTimeout(() => {
                observer.disconnect();
                clearTimeout(timer);
                resolve();
            }, maxWaitMs);
        });
    },

    // Type into a contenteditable or textarea using multiple strategies
    simulateInput: function(element, text) {
        element.focus();

        if (element.contentEditable === 'true' || element.getAttribute('contenteditable') === 'true') {
            // Strategy 1: Select all and insert via execCommand (best for ProseMirror)
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(element);
            selection.removeAllRanges();
            selection.addRange(range);

            const inserted = document.execCommand('insertText', false, text);
            if (!inserted) {
                // Strategy 2: Fallback - set innerText
                element.textContent = text;
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            // Textarea
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
        // Strategy 1: Try direct selectors
        for (const sel of selectors) {
            const btn = document.querySelector(sel);
            if (btn) {
                console.log('[AIBridge] Send button found via:', sel);
                // Walk up to button if we matched a child element
                let target = btn;
                while (target && target.tagName !== 'BUTTON') {
                    target = target.parentElement;
                }
                return target || btn;
            }
        }

        // Strategy 2: Brute-force scan all buttons
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

    // Click a button robustly (multiple event strategies)
    clickButton: function(btn) {
        // Try multiple click strategies for React/Vue/Angular apps
        btn.focus();
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        btn.click();
        console.log('[AIBridge] Button clicked with all strategies');
    },

    // Get the last element matching selectors
    getLastMatch: function(selectors) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        for (const sel of selectorList) {
            const all = document.querySelectorAll(sel);
            if (all.length > 0) return all[all.length - 1];
        }
        return null;
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
