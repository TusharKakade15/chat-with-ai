// AI Web UI Bridge - Shared Utilities for Content Scripts

window.AIBridgeUtils = {
    // Wait for an element to appear in the DOM, trying multiple selectors
    waitForElement: function(selectors, timeout = 15000) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        return new Promise((resolve, reject) => {
            // Check immediately
            for (const sel of selectorList) {
                const el = document.querySelector(sel);
                if (el) {
                    console.log('[AIBridge] Found element with selector:', sel);
                    return resolve(el);
                }
            }

            const observer = new MutationObserver(() => {
                for (const sel of selectorList) {
                    const el = document.querySelector(sel);
                    if (el) {
                        console.log('[AIBridge] Found element with selector:', sel);
                        observer.disconnect();
                        return resolve(el);
                    }
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                console.error('[AIBridge] Timeout waiting for any of these selectors:', selectorList);
                reject(new Error(`Timeout waiting for element. Tried: ${selectorList.join(', ')}`));
            }, timeout);
        });
    },

    // Wait for an element to stop changing (text generation finishing)
    waitForMutationToStop: function(targetNode, config, debounceMs = 3000, maxWaitMs = 120000) {
        return new Promise((resolve) => {
            let timer;
            let timeoutTimer;

            const observer = new MutationObserver(() => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    observer.disconnect();
                    clearTimeout(timeoutTimer);
                    resolve();
                }, debounceMs);
            });

            observer.observe(targetNode, config);

            // Initial timer in case no mutations happen at all
            timer = setTimeout(() => {
                observer.disconnect();
                clearTimeout(timeoutTimer);
                resolve();
            }, debounceMs * 2);

            // Global timeout
            timeoutTimer = setTimeout(() => {
                observer.disconnect();
                clearTimeout(timer);
                console.warn('[AIBridge] waitForMutationToStop hit max wait time');
                resolve();
            }, maxWaitMs);
        });
    },

    // Simulate typing into a contenteditable div or textarea
    // Uses execCommand for ProseMirror compatibility
    simulateInput: function(element, text) {
        element.focus();

        if (element.contentEditable === 'true' || element.getAttribute('contenteditable') === 'true') {
            // ProseMirror / contenteditable approach
            // Clear existing content
            element.innerHTML = '';
            element.focus();

            // Use execCommand which works with ProseMirror's event system
            const inserted = document.execCommand('insertText', false, text);
            if (!inserted) {
                // Fallback: set innerText and dispatch events
                element.innerText = text;
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            // Standard textarea approach
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
            ).set;
            nativeInputValueSetter.call(element, text);
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }
    },

    // Get the last element matching any of the selectors
    getLastMatch: function(selectors) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        for (const sel of selectorList) {
            const all = document.querySelectorAll(sel);
            if (all.length > 0) {
                console.log(`[AIBridge] Found ${all.length} elements for: ${sel}`);
                return all[all.length - 1];
            }
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
                console.log('[AIBridge] Received INJECT_PROMPT');
                injectLogicCallback(request.prompt)
                    .then(text => {
                        console.log('[AIBridge] Response scraped, length:', text.length);
                        sendResponse({ text: text });
                    })
                    .catch(err => {
                        console.error('[AIBridge] Injection Error:', err);
                        sendResponse({ text: `Error: ${err.message}` });
                    });
                
                return true; // Keep channel open for async response
            }
        });
        console.log('[AIBridge] Content script loaded on:', window.location.href);
    }
};
