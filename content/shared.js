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
                        console.log('[AIBridge] Found element via observer:', sel);
                        observer.disconnect();
                        return resolve(el);
                    }
                }
            });

            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout waiting for: ${selectorList.join(', ')}`));
            }, timeout);
        });
    },

    // Universal input simulation for ProseMirror (ChatGPT, Claude) and Quill (Gemini)
    simulateInput: function(element, text) {
        if (!element) return;
        element.focus();

        const isContentEditable = element.contentEditable === 'true' || 
                                  element.getAttribute('contenteditable') === 'true' ||
                                  element.classList.contains('ProseMirror') ||
                                  element.classList.contains('ql-editor');

        if (isContentEditable) {
            // Clear existing content first
            element.innerHTML = '';
            element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

            // Short pause to let framework react to the clear
            element.focus();

            // 1. Try execCommand (most reliable when tab is active/focused)
            let inserted = false;
            try {
                const selection = window.getSelection();
                if (selection) {
                    const range = document.createRange();
                    range.selectNodeContents(element);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    inserted = document.execCommand('insertText', false, text);
                    console.log('[AIBridge] execCommand insertText result:', inserted);
                }
            } catch (e) {
                console.warn('[AIBridge] execCommand failed:', e);
            }

            // 2. Verify text was actually inserted
            const currentText = (element.textContent || '').trim();
            if (!inserted || currentText.length === 0 || currentText !== text.trim()) {
                console.log('[AIBridge] execCommand did not work, using DOM fallback. Current:', currentText.length, 'Expected:', text.length);
                // Direct DOM manipulation fallback
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

            // 3. Dispatch events to notify all frameworks (React, ProseMirror, Quill, Angular/Lit)
            element.dispatchEvent(new Event('focus', { bubbles: true }));
            // InputEvent with data field is critical for ProseMirror and Quill to update internal state
            try {
                element.dispatchEvent(new InputEvent('beforeinput', {
                    bubbles: true, cancelable: true, composed: true,
                    inputType: 'insertText', data: text
                }));
                element.dispatchEvent(new InputEvent('input', {
                    bubbles: true, cancelable: true, composed: true,
                    inputType: 'insertText', data: text
                }));
            } catch (e) {
                element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            }
            element.dispatchEvent(new Event('change', { bubbles: true }));
            // Don't blur — keep focus so the Send button becomes enabled
            console.log('[AIBridge] Input simulation complete. Final text length:', (element.textContent || '').length);
        } else {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
            )?.set || Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
            )?.set;

            if (setter) {
                setter.call(element, text);
            } else {
                element.value = text;
            }
            element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        }
    },


    // Find a send button using multiple selectors
    findSendButton: function(selectors) {
        if (!selectors) return null;
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        for (const sel of selectorList) {
            const el = document.querySelector(sel);
            if (el) {
                let target = el;
                while (target && target.tagName !== 'BUTTON' && target !== document.body) {
                    if (target.getAttribute('role') === 'button') break;
                    target = target.parentElement;
                }
                const finalBtn = target || el;
                // Verify button is not hidden or disabled
                const style = window.getComputedStyle(finalBtn);
                if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                    console.log('[AIBridge] Active send button found via:', sel);
                    return finalBtn;
                }
            }
        }
        return null;
    },

    // Check if an element is genuinely rendered and visible on screen
    isElementVisible: function(el) {
        if (!el) return false;
        try {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        } catch (e) {
            return false;
        }
    },

    // Check if a stop button / streaming indicator is present
    findStopButton: function(selectors) {
        if (!selectors) return null;
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        for (const sel of selectorList) {
            const btn = document.querySelector(sel);
            if (btn && this.isElementVisible(btn)) {
                return btn;
            }
        }
        return null;
    },

    // Click a button safely
    clickButton: function(btn) {
        if (!btn) return false;
        try {
            if (btn.disabled) {
                btn.disabled = false;
                btn.removeAttribute('disabled');
            }
            if (btn.getAttribute('aria-disabled') === 'true') {
                btn.setAttribute('aria-disabled', 'false');
            }
            btn.focus();
            btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
            btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
            btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }));
            btn.click();
            console.log('[AIBridge] Button clicked');
            return true;
        } catch (e) {
            console.error('[AIBridge] Error clicking button:', e);
            return false;
        }
    },

    // Simulate pressing Enter to send
    pressEnter: function(element) {
        if (!element) return;
        element.focus();
        const eventParams = {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            composed: true
        };
        element.dispatchEvent(new KeyboardEvent('keydown', eventParams));
        element.dispatchEvent(new KeyboardEvent('keypress', eventParams));
        element.dispatchEvent(new KeyboardEvent('keyup', eventParams));
        console.log('[AIBridge] Dispatched Enter key events');
    },

    // Listen for messages from background script
    setupMessageListener: function(injectLogicCallback) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'PING') {
                sendResponse({ status: 'ok', url: window.location.href });
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
                        console.error('[AIBridge] Injection Error:', err);
                        sendResponse({ text: `Error: ${err.message || String(err)}` });
                    });
                return true; // Keep channel open for async response
            }
        });
        console.log('[AIBridge] Content script listener attached on:', window.location.href);
    },

    // Extract delimited message block ([MESSAGE]...[/MESSAGE]) or fallback cleanly
    extractDelimitedText: function(rawText) {
        if (!rawText) return '';
        // 1. Check for complete [MESSAGE]...[/MESSAGE] block
        const completeMatch = rawText.match(/\[MESSAGE\]([\s\S]*?)\[\/MESSAGE\]/i);
        if (completeMatch && completeMatch[1].trim()) {
            return completeMatch[1].trim();
        }
        // 2. Check for streaming/in-progress [MESSAGE] tag (tag started but not closed yet)
        const partialMatch = rawText.match(/\[MESSAGE\]([\s\S]*)$/i);
        if (partialMatch && partialMatch[1].trim()) {
            return partialMatch[1].trim();
        }
        // 3. Fallback: Strip any lingering tags if present
        return rawText.replace(/\[MESSAGE\]/gi, '').replace(/\[\/MESSAGE\]/gi, '').trim();
    }
};

