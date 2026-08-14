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

    // Universal background-safe input simulation
    simulateInput: function(element, text) {
        element.focus();

        if (element.contentEditable === 'true' || element.getAttribute('contenteditable') === 'true') {
            let inserted = false;
            try {
                const selection = window.getSelection();
                if (selection) {
                    const range = document.createRange();
                    range.selectNodeContents(element);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    inserted = document.execCommand('insertText', false, text);
                }
            } catch (e) {
                inserted = false;
            }

            if (!inserted || element.textContent.trim().length === 0) {
                element.innerHTML = '';
                const lines = text.split('\n');
                lines.forEach(line => {
                    const p = document.createElement('p');
                    if (line.trim() === '') {
                        p.innerHTML = '<br>';
                    } else {
                        p.textContent = line;
                    }
                    element.appendChild(p);
                });
            }

            element.dispatchEvent(new Event('focus', { bubbles: true }));
            element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
            element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
            ).set;
            if (setter) {
                setter.call(element, text);
            } else {
                element.value = text;
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }
    },

    // Find a send button using multiple selectors
    findSendButton: function(selectors) {
        if (!selectors) return null;
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        for (const sel of selectorList) {
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
        return null;
    },

    // Click a button safely
    clickButton: function(btn) {
        if (!btn) return;
        if (btn.disabled) {
            btn.disabled = false;
            btn.removeAttribute('disabled');
        }
        if (btn.getAttribute('aria-disabled') === 'true') {
            btn.setAttribute('aria-disabled', 'false');
        }
        btn.focus();
        btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
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
