// Background Service Worker

console.log('[VEO Automation] Background service worker initialized');

// Global variables
let countdownInterval = null;
let pendingFilenames = []; // Array Queue for concurrent downloads!
let pinged = false;

// ---- CHỨC NĂNG ĐẾM LƯỢT CÀI ĐẶT EXTENSION (Đã gỡ bỏ theo yêu cầu) ----
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[VEO Automation] Extension installed');
        chrome.storage.local.set({
            veoSettings: { defaultMode: 'text-to-video', downloadFolder: 'VeoVideos', language: 'vi' }
        });
        
        // Tạo ID máy ẩn danh (Có thể dùng cho logic chống spam thiết bị nếu cần)
        const uid = crypto.randomUUID();
        chrome.storage.local.set({ machine_uid: uid });
    }

    // Auto-reload Flow tabs on extension update/reload (for development)
    if (details.reason === 'update' || details.reason === 'install') {
        console.log('[VEO Automation] Extension updated/reloaded, reloading Flow tabs...');
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                if (tab.url && (tab.url.includes('labs.google/fx/') || tab.url.includes('aitestkitchen.withgoogle.com/tools/veo') || tab.url.includes('labs.google.com/fx/') || tab.url.includes('flow.google.com'))) {
                    chrome.tabs.reload(tab.id);
                    console.log(`[VEO Automation] Reloaded tab: ${tab.id}`);
                }
            });
        });
    }

    // Open side panel on action click
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
            .catch((error) => console.error(error));
    }
});

// Handle custom download folder AND filename
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    chrome.storage.local.get('veoSettings').then(({ veoSettings }) => {
        let finalName = item.filename;
        
        // Google Flow xuất video ra dạng blob/storage URL không có referrer chuẩn xác,
        // nên ta bỏ qua chặn URL. Cứ có trong hàng đợi là lấy ra áp dụng rename!
        if (pendingFilenames.length > 0) {
            const nextName = pendingFilenames.shift(); // Pull oldest from Queue
            
            if (nextName === '__SKIP_RENAME__') {
                console.log(`[VEO DL] Bỏ qua ép tên nội bộ, giữ nguyên tên Cloud: ${finalName}`);
                chrome.tabs.query({}, (tabs) => {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, { action: 'DOWNLOAD_STARTED', filename: '__SKIP_RENAME__' }).catch(() => {});
                    });
                });
            } else {
                // Keep the original extension just in case, though we assume mp4
                const ext = item.filename.split('.').pop() || 'mp4';
                finalName = nextName.endsWith(`.${ext}`) ? nextName : `${nextName}.${ext}`;
                console.log(`[VEO DL] Áp dụng tên file từ hàng đợi: ${finalName}`);

                // Broadcast back to content script that this specific file has safely entered Chrome's Native DL
                chrome.tabs.query({}, (tabs) => {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, { action: 'DOWNLOAD_STARTED', filename: nextName }).catch(() => {});
                    });
                });
            }
        }

        // Apply folder routing ALWAYS (DISABLED PER USER REQUEST)
        if (veoSettings && veoSettings.downloadFolder) {
            // Sanitize folder name
            const safeFolder = veoSettings.downloadFolder.replace(/[<>:"/\\|?*]/g, '_').trim();
            if (safeFolder) {
                // finalName = `${safeFolder}/${finalName}`; // BỎ TẠO THƯ MỤC
            }
        }
        
        console.log(`[VEO DL] Saving to: ${finalName}`);
        suggest({ filename: finalName, conflictAction: 'uniquify' });
    });
    return true; // Async
});

// Track when downloads actually finish saving to disk
chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && delta.state.current === 'complete') {
        chrome.downloads.search({ id: delta.id }, (results) => {
            if (results && results.length > 0) {
                const item = results[0];
                if (item.url.includes('googleusercontent.com') || item.referrer.includes('labs.google')) {
                    // Extract basename from absolute path
                    const basename = item.filename.split(/[\\/]/).pop();
                    console.log(`[VEO DL] Download literally finished: ${basename}`);
                    
                    // Broadcast success down to the active content script so it can increment the downloadedCount
                    chrome.tabs.query({}, (tabs) => {
                        tabs.forEach(tab => {
                            chrome.tabs.sendMessage(tab.id, { action: 'DOWNLOAD_COMPLETE', filename: basename }).catch(() => {});
                        });
                    });
                }
            }
        });
    }
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // console.log('[VEO Automation] Message received:', message);

    // Handle custom filename for next download
    if (message.action === 'SET_NEXT_FILENAME') {
        pendingFilenames.push(message.filename);
        console.log(`[VEO DL] Pushed to queue: ${message.filename}. Queue size: ${pendingFilenames.length}`);
        sendResponse({ success: true });
        return;
    }

    if (message.action === 'SET_TAB_ZOOM') {
        const zoom = parseFloat(message.zoom || 0.8);
        const targetTabId = message.tabId || (sender.tab ? sender.tab.id : null);
        if (targetTabId) {
            chrome.tabs.setZoom(targetTabId, zoom).then(() => {
                sendResponse({ success: true, zoom });
            }).catch(() => {
                sendResponse({ success: false });
            });
            return true;
        } else {
            chrome.tabs.query({ url: ['*://flow.google.com/*', '*://*.flow.google.com/*', '*://labs.google/*'] }, (tabs) => {
                if (tabs && tabs.length > 0) {
                    tabs.forEach(t => {
                        chrome.tabs.setZoom(t.id, zoom).catch(() => {});
                    });
                    sendResponse({ success: true, zoom });
                } else {
                    chrome.tabs.query({ active: true, currentWindow: true }, (actTabs) => {
                        if (actTabs && actTabs[0]?.id) {
                            chrome.tabs.setZoom(actTabs[0].id, zoom).catch(() => {});
                            sendResponse({ success: true, zoom });
                        } else {
                            sendResponse({ success: false });
                        }
                    });
                }
            });
            return true;
        }
    }

    if (message.action === 'CLOSE_CURRENT_TAB') {
        if (sender.tab && sender.tab.id) {
            chrome.tabs.remove(sender.tab.id);
        }
        sendResponse({ success: true });
        return;
    }

    // Forward messages between popup and content script
    if (message.action === 'UPDATE_PROGRESS' || message.action === 'LOG' || message.action === 'AUTOMATION_COMPLETE') {
        // These messages are already handled by popup.js
        // No need to do anything here
    }

    // Test Native Host connection
    if (message.action === 'TEST_NATIVE_HOST') {
        try {
            const port = chrome.runtime.connectNative('com.veo.automation.native');
            let shutdownSuccess = false;

            port.onMessage.addListener((response) => {
                console.log('[VEO Test] Response:', response);
                sendResponse({ success: true, message: 'Connected!' });
            });

            port.onDisconnect.addListener(() => {
                const error = chrome.runtime.lastError;
                if (error) {
                    let errorMsg = 'Connection failed: ';
                    if (error.message.includes('Specified native messaging host not found')) {
                        errorMsg += 'Not installed - Run install.bat';
                    } else if (error.message.includes('Access is denied')) {
                        errorMsg += 'Permission denied - Run install.bat as Admin';
                    } else if (error.message.includes('forbidden')) {
                        errorMsg += 'Extension ID mismatch - Check manifest.json';
                    } else {
                        errorMsg += error.message;
                    }
                    sendResponse({ success: false, error: errorMsg });
                }
            });

            // Send test ping
            port.postMessage({ action: 'ping' });

        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }

        return true; // Keep channel open for async response
    }

    // Handle auto-shutdown trigger
    if (message.action === 'TRIGGER_SHUTDOWN') {
        const delay = message.data?.delay || 60;
        console.log(`[VEO Automation] Triggering shutdown in ${delay} seconds...`);

        // Start countdown in extension log
        let remaining = delay;
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            remaining -= 10;
            if (remaining > 0) {
                chrome.runtime.sendMessage({
                    action: 'LOG',
                    type: 'warning',
                    message: `⏱️ Shutdown in ${remaining}s... (Run "shutdown /a" to cancel)`
                }).catch(() => { });
            } else {
                clearInterval(countdownInterval);
            }
        }, 10000); // Update every 10 seconds


        // Try native messaging first (automatic shutdown)
        try {
            // Log attempt
            chrome.runtime.sendMessage({
                action: 'LOG',
                type: 'info',
                message: `🔌 Connecting to Native Host...`
            }).catch(() => { });

            const port = chrome.runtime.connectNative('com.veo.automation.native');

            port.onMessage.addListener((response) => {
                console.log('[VEO Native] Response:', response);
                if (response.success) {
                    shutdownSuccess = true;
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icons/icon128.png',
                        title: 'VEO Automation Complete ✅',
                        message: `All prompts done! PC will shutdown in ${delay}s. Run "shutdown /a" to cancel.`,
                        priority: 2
                    });

                    // Log success
                    chrome.runtime.sendMessage({
                        action: 'LOG',
                        type: 'success',
                        message: `✅ Shutdown scheduled via Native Host!`
                    }).catch(() => { });
                } else if (response.error) {
                    // Log Native Host error
                    chrome.runtime.sendMessage({
                        action: 'LOG',
                        type: 'error',
                        message: `❌ Native Host error: ${response.error}`
                    }).catch(() => { });
                    clearInterval(countdownInterval);
                    fallbackShutdownBatch(delay);
                }
            });

            port.onDisconnect.addListener(() => {
                const error = chrome.runtime.lastError;
                if (error && !shutdownSuccess) {
                    console.log('[VEO Native] Disconnect error:', error);

                    // Detailed error logging
                    let errorMsg = '❌ Native Host connection failed: ';
                    if (error.message.includes('Specified native messaging host not found')) {
                        errorMsg += 'Not installed or not registered in Registry';
                    } else if (error.message.includes('Access is denied')) {
                        errorMsg += 'Permission denied - Run install.bat as Administrator';
                    } else if (error.message.includes('Invalid extension ID')) {
                        errorMsg += 'Extension ID mismatch - Re-run install.bat';
                    } else {
                        errorMsg += error.message;
                    }

                    chrome.runtime.sendMessage({
                        action: 'LOG',
                        type: 'error',
                        message: errorMsg
                    }).catch(() => { });

                    clearInterval(countdownInterval);
                    fallbackShutdownBatch(delay);
                }
            });

            // Send shutdown command
            port.postMessage({ action: 'shutdown', delay: delay });

        } catch (error) {
            console.log('[VEO Native] Exception:', error);

            chrome.runtime.sendMessage({
                action: 'LOG',
                type: 'error',
                message: `❌ Failed to connect to Native Host: ${error.message}`
            }).catch(() => { });

            clearInterval(countdownInterval);
            fallbackShutdownBatch(delay);
        }
    }

    // Handle cancel shutdown
    // Handle cancel shutdown
    if (message.action === 'CANCEL_SHUTDOWN') {
        // Stop timer immediately
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }

        try {
            const port = chrome.runtime.connectNative('com.veo.automation.native');

            port.onMessage.addListener((response) => {
                if (response.success) {
                    chrome.runtime.sendMessage({
                        action: 'LOG',
                        type: 'success',
                        message: '✅ Shutdown cancelled successfully!'
                    }).catch(() => { });

                    chrome.runtime.sendMessage({
                        action: 'SHUTDOWN_CANCELLED'
                    }).catch(() => { });
                } else {
                    chrome.runtime.sendMessage({
                        action: 'LOG',
                        type: 'error',
                        message: `❌ Cancel failed: ${response.message}`
                    }).catch(() => { });
                }
            });

            port.onDisconnect.addListener(() => {
                // Ignore disconnect errors
            });

            // Send cancel command (ONCE)
            port.postMessage({ action: 'cancel_shutdown' });

        } catch (error) {
            chrome.runtime.sendMessage({
                action: 'LOG',
                type: 'error',
                message: `❌ Cancel failed: ${error.message}`
            }).catch(() => { });
        }

        return true;
    }

    // ==================== MAIN WORLD INJECTION HANDLERS ====================
    // Content scripts cannot call chrome.scripting, so they send messages here.
    // Background then uses chrome.scripting.executeScript with world:'MAIN'
    // which can access React fiber and create trusted events.

    if (message.action === 'INJECT_PASTE') {
        const { text, tabId } = message.data;
        const targetTabId = tabId || sender.tab?.id;
        if (!targetTabId) {
            sendResponse({ ok: false, error: 'No tabId' });
            return true;
        }

            chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            world: 'MAIN',
            func: async (textToInsert) => {
                // This runs in PAGE context (MAIN world) - can access Slate internals.
                // KEY INSIGHT: Slate's onDOMBeforeInput handler does NOT check event.isTrusted.
                // So we dispatch a synthetic InputEvent('beforeinput') directly to the editor
                // and Slate will process it just like a real keyboard event.
                try {
                    // Find the prompt editor — must skip editors inside result cards (role="article")
                    // After images are generated, result cards can have their own Slate editors
                    // and document.querySelector() would pick those first (wrong element!)
                    let editorEl = null;

                    // Priority 0: New Google Flow UI (August 2024+)
                    const prosemirrorEditors = document.querySelectorAll('.ProseMirror[contenteditable="true"]');
                    for (const ed of prosemirrorEditors) {
                        if (!ed.closest('[role="article"]') && ed.offsetParent !== null) {
                            editorEl = ed;
                            break;
                        }
                    }

                    if (!editorEl) {
                        const allPasteEditors = document.querySelectorAll(
                            'div[data-slate-editor="true"][contenteditable="true"][aria-multiline="true"], ' +
                            'div[data-slate-editor="true"][contenteditable="true"][zindex="-1"], ' +
                            'div[data-slate-editor="true"][role="textbox"][contenteditable="true"]'
                        );
                        for (const ed of allPasteEditors) {
                            if (!ed.closest('[role="article"]') && ed.offsetParent !== null) {
                                editorEl = ed;
                                break;
                            }
                        }
                    }

                    if (!editorEl) return { ok: false, error: 'Prompt editor not found' };

                    // Step 1: Click + focus editor so Slate registers cursor
                    editorEl.click();
                    editorEl.focus();
                    await new Promise(r => setTimeout(r, 150));

                    // Step 2: Select ALL content in editor using Range API
                    const range = document.createRange();
                    range.selectNodeContents(editorEl);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                    await new Promise(r => setTimeout(r, 50));

                    if (editorEl.classList.contains('ProseMirror')) {
                        // === PROSEMIRROR PASTE LOGIC ===
                        // Try execCommand first (highly reliable in MAIN world for ProseMirror)
                        const success = document.execCommand('insertText', false, textToInsert);
                        if (!success) {
                            // Fallback: Dispatch synthetic paste event
                            const dt = new DataTransfer();
                            dt.setData('text/plain', textToInsert);
                            const pasteEvent = new ClipboardEvent('paste', {
                                clipboardData: dt,
                                bubbles: true,
                                cancelable: true
                            });
                            editorEl.dispatchEvent(pasteEvent);
                        }
                    } else {
                        // === SLATE PASTE LOGIC ===
                        // Dispatch synthetic 'beforeinput' with insertReplacementText
                        const replaceEvent = new InputEvent('beforeinput', {
                            bubbles: true,
                            cancelable: true,
                            inputType: 'insertReplacementText',
                            data: textToInsert
                        });
                        editorEl.dispatchEvent(replaceEvent);
                        await new Promise(r => setTimeout(r, 100));

                        // If insertReplacementText didn't work, try insertText as fallback
                        const hasZeroWidthAfterReplace = !!editorEl.querySelector('[data-slate-zero-width]');
                        if (hasZeroWidthAfterReplace) {
                            const insertEvent = new InputEvent('beforeinput', {
                                bubbles: true,
                                cancelable: true,
                                inputType: 'insertText',
                                data: textToInsert
                            });
                            editorEl.dispatchEvent(insertEvent);
                            await new Promise(r => setTimeout(r, 100));
                        }
                    }

                    // Dispatch standard input/change events to notify React hooks in Image mode
                    editorEl.dispatchEvent(new Event('input', { bubbles: true }));
                    editorEl.dispatchEvent(new Event('change', { bubbles: true }));
                    await new Promise(r => setTimeout(r, 50));

                    const hasZeroWidth = !!editorEl.querySelector('[data-slate-zero-width]');
                    const editorText = editorEl.textContent || '';

                    return {
                        ok: !hasZeroWidth,
                        hasZeroWidth,
                        editorText: editorText.substring(0, 50),
                        method: 'direct beforeinput InputEvent dispatch'
                    };
                } catch (e) {
                    return { ok: false, error: e.message };
                }
            },
            args: [text]
        }).then(results => {
            const result = results?.[0]?.result;
            sendResponse(result || { ok: false, error: 'Script injection failed' });
        }).catch(err => {
            sendResponse({ ok: false, error: err.message });
        });

        return true; // Keep channel open for async response
    }

    if (message.action === 'INJECT_CLICK_CREATE') {
        const { tabId } = message.data;
        const targetTabId = tabId || sender.tab?.id;
        if (!targetTabId) {
            sendResponse({ ok: false, error: 'No tabId' });
            return true;
        }

        chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            world: 'MAIN',
            func: () => {
                try {
                    // Find the CORRECT prompt editor:
                    let btn = null;

                    // Priority 0: New Google Flow UI (August 2024+)
                    const newBtn = document.querySelector('button.generate-icon-button');
                    if (newBtn && newBtn.offsetParent !== null && !newBtn.closest('[role="article"]')) {
                        btn = newBtn;
                    }

                    if (!btn) {
                        // querySelectorAll + skip editors inside image/video result cards (role="article").
                        let editorEl = null;
                        const allEditors = document.querySelectorAll(
                            'div[data-slate-editor="true"][aria-multiline="true"], div[data-slate-editor="true"][zindex="-1"]'
                        );
                        for (const ed of allEditors) {
                            if (!ed.closest('[role="article"]') && ed.offsetParent !== null) {
                                editorEl = ed;
                                break;
                            }
                        }

                        if (editorEl) {
                            // Walk up the DOM from editor to find the container with arrow_forward button
                            let container = editorEl.parentElement;
                            for (let i = 0; i < 15 && container && !btn; i++) {
                                const iconEls = container.querySelectorAll('i.google-symbols, i[class*="google-symbols"]');
                                for (const icon of iconEls) {
                                    if (icon.textContent.trim() === 'arrow_forward') {
                                        const candidate = icon.closest('button');
                                        if (candidate && candidate.offsetParent !== null) {
                                            btn = candidate;
                                            break;
                                        }
                                    }
                                }
                                container = container.parentElement;
                            }
                        }

                        // Fallback: global search for arrow_forward NOT inside a card
                        if (!btn) {
                            const iconEls = document.querySelectorAll('i.google-symbols, i[class*="google-symbols"]');
                            for (const icon of iconEls) {
                                if (icon.textContent.trim() === 'arrow_forward') {
                                    const candidate = icon.closest('button');
                                    if (candidate && candidate.offsetParent !== null && !candidate.closest('[role="article"]')) {
                                        btn = candidate;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    if (!btn) return { ok: false, error: 'Create button not found' };

                    // Check if button appears enabled
                    const style = window.getComputedStyle(btn);
                    const isDisabled = btn.disabled ||
                                       btn.getAttribute('aria-disabled') === 'true' ||
                                       style.pointerEvents === 'none' ||
                                       parseFloat(style.opacity) < 0.5;

                    // ── SMART CLICK STRATEGY ──
                    // Firing .click(), MouseEvents, and KeyboardEvents all at once causes 3-4 simultaneous submissions in Video mode.
                    // Image mode (Nano Banana Pro) ignores btn.click() because it checks event.isTrusted=true.
                    // Solution: Use React Fiber internal onClick exclusively if available (bypasses isTrusted). 
                    // Fallback to btn.click() only if React handler is not found.

                    let reactClicked = false;
                    try {
                        const invokeReact = (el) => {
                            for (const key in el) {
                                if (key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$')) {
                                    const props = el[key];
                                    if (props && typeof props.onClick === 'function') {
                                        props.onClick({
                                            preventDefault: () => {},
                                            stopPropagation: () => {},
                                            nativeEvent: { isTrusted: true },
                                            isTrusted: true,
                                            type: 'click',
                                            target: el,
                                            currentTarget: el
                                        });
                                        reactClicked = true;
                                        return true;
                                    }
                                }
                            }
                            return false;
                        };
                        
                        if (!invokeReact(btn)) {
                            const iconEl = btn.querySelector('i, svg');
                            if (iconEl) invokeReact(iconEl);
                        }
                    } catch(e) {}

                    if (!reactClicked) {
                        // NATIVE FALLBACK if React Fiber is inaccessible
                        // In Angular (Flow 2025), a simple click() is sufficient and prevents double-firing
                        // caused by manually dispatching mousedown/up/click events alongside btn.click()
                        btn.focus();
                        btn.click(); 
                    }

                    return { ok: true, wasDisabled: isDisabled, method: reactClicked ? 'react-fiber-onClick' : 'native-click' };
                } catch (e) {
                    return { ok: false, error: e.message };
                }
            },
            args: []
        }).then(results => {
            const result = results?.[0]?.result;
            sendResponse(result || { ok: false, error: 'Script injection failed' });
        }).catch(err => {
            sendResponse({ ok: false, error: err.message });
        });

        return true;
    }

    // ==================== INJECT_RENAME_INPUT ====================
    // Tương tự INJECT_PASTE nhưng cho <input type="text"> của React (Detail View rename)
    // Vấn đề: React controlled input không nhận update từ isolated world (isTrusted=false)
    // Giải pháp: Inject vào MAIN world, dùng nativeInputValueSetter + React Fiber focus events
    if (message.action === 'INJECT_RENAME_INPUT') {
        const { newName, tabId } = message.data;
        const targetTabId = tabId || sender.tab?.id;
        if (!targetTabId) {
            sendResponse({ ok: false, error: 'No tabId' });
            return true;
        }

        chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            world: 'MAIN',
            func: async (nameToSet) => {
                try {
                    // ── TÌM ĐÚNG Ô INPUT RENAME ──
                    //
                    // KEY INSIGHT: Rename input của Flow nằm trong Radix Popper portal:
                    //   <div data-radix-popper-content-wrapper style="position:fixed; ...">
                    //     <input type="text" .../>  ← CÁI CẦN TÌM
                    //   </div>
                    //
                    // Vì position:fixed → offsetParent=null → check offsetParent!==null FAIL
                    // → code cũ bỏ qua rename input, lấy nhầm project name input ở top-left
                    //
                    // Dấu hiệu phụ: body có data-scroll-locked="1" khi rename dialog mở
                    //
                    // CHIẾN LƯỢC (theo thứ tự ưu tiên):
                    //   1. Input trong [data-radix-popper-content-wrapper] (chính xác nhất)
                    //   2. document.activeElement nếu là input (auto-focused by Flow)
                    //   3. Input có getBoundingClientRect().width > 0, không ở header (top > 100px)

                    const isVisible = (el) => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0; // Works for fixed elements too
                    };

                    let input = null;
                    let inputDebug = '';

                    // Ưu tiên 1: Input trong Radix Popper Content Wrapper
                    // Flow render rename input qua Radix portal → position:fixed → offsetParent=null
                    const radixPoppers = document.querySelectorAll('[data-radix-popper-content-wrapper]');
                    for (const popper of radixPoppers) {
                        const popperInput = popper.querySelector('input[type="text"]');
                        if (popperInput && isVisible(popperInput)) {
                            input = popperInput;
                            inputDebug = `radix-popper top=${Math.round(popper.getBoundingClientRect().top)}px`;
                            break;
                        }
                    }

                    // Ưu tiên 2: document.activeElement (auto-focused by Flow)
                    if (!input) {
                        const activeEl = document.activeElement;
                        if (activeEl && activeEl.tagName === 'INPUT' &&
                            activeEl.type === 'text' && isVisible(activeEl)) {
                            input = activeEl;
                            inputDebug = `activeElement top=${Math.round(activeEl.getBoundingClientRect().top)}px`;
                        }
                    }

                    // Ưu tiên 3: Input bên dưới header (top > 100px, tránh project name)
                    // Và KHÔNG PHẢI search box!
                    if (!input) {
                        const candidates = Array.from(document.querySelectorAll('input[type="text"]'))
                            .filter(inp => isVisible(inp))
                            .filter(inp => inp.getBoundingClientRect().top > 100)
                            .filter(inp => {
                                const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
                                return !ph.includes('search') && !ph.includes('tìm kiếm');
                            });
                        if (candidates.length > 0) {
                            input = candidates[0];
                            inputDebug = `below-header top=${Math.round(input.getBoundingClientRect().top)}px`;
                        }
                    }

                    if (!input) return { ok: false, error: 'Rename input not found in MAIN world' };

                    // ── TRIGGER HOVER AN TOÀN BẰNG REACT (ĐỂ HIỆN NÚT V/X) ──
                    // Chỉ dùng React event để không làm treo UI như khi spam Native events
                    let hoverTriggered = false;
                    {
                        const popperRoot = input.closest('[data-radix-popper-content-wrapper]') || input.parentElement;
                        let el = input.parentElement;
                        while (el && el !== document.body) {
                            const pk = Object.keys(el).find(k => k.startsWith('__reactProps$'));
                            if (pk) {
                                const rp = el[pk];
                                const cOpts = { bubbles: false, cancelable: true, type: 'pointerenter' };
                                if (rp?.onPointerEnter) rp.onPointerEnter(cOpts);
                                else if (rp?.onMouseEnter) rp.onMouseEnter({ ...cOpts, type: 'mouseenter' });
                                hoverTriggered = true;
                            }
                            if (el === popperRoot) break;
                            el = el.parentElement;
                        }
                    }
                    await new Promise(r => setTimeout(r, hoverTriggered ? 400 : 100));

                    // ── CLICK INPUT ĐỂ CURSOR NHẤP NHÁY ──
                    const ir = input.getBoundingClientRect();
                    const ix = ir.left + ir.width - 8;
                    const iy = ir.top + ir.height / 2;
                    const cOpts = { view: window, bubbles: true, cancelable: true, clientX: ix, clientY: iy };
                    
                    input.dispatchEvent(new PointerEvent('pointerdown', { ...cOpts, button: 0, buttons: 1 }));
                    input.dispatchEvent(new MouseEvent('mousedown', { ...cOpts, button: 0, buttons: 1 }));
                    input.focus();
                    input.dispatchEvent(new PointerEvent('pointerup', { ...cOpts, button: 0, buttons: 0 }));
                    input.dispatchEvent(new MouseEvent('mouseup', { ...cOpts, button: 0, buttons: 0 }));
                    input.dispatchEvent(new MouseEvent('click', { ...cOpts, button: 0, buttons: 0 }));
                    await new Promise(r => setTimeout(r, 200));

                    let method = '';

                    // ── INJECT TEXT ──
                    try {
                        input.select();
                        const ok = document.execCommand('insertText', false, nameToSet);
                        await new Promise(r => setTimeout(r, 200));
                        if (ok && input.value === nameToSet) method = 'execCommand';
                    } catch (_) {}

                    if (!method) {
                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                        if (nativeSetter) nativeSetter.call(input, nameToSet);
                        else input.value = nameToSet;
                        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nameToSet }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        await new Promise(r => setTimeout(r, 200));
                        method = 'nativeSetter';
                    }

                    const currentValue = input.value;
                    if (currentValue !== nameToSet) {
                        return { ok: false, error: `Value hiện tại: "${currentValue}"` };
                    }

                    // ── ÉP HIỆN NÚT VÀ CLICK NÚT V (CHECKMARK) ──
                    // Ép hiển thị toàn bộ button trong popper bằng JS trực tiếp, 
                    // đảm bảo "hiện ra chắc chắn luôn" như user yêu cầu.
                    let checkBtnClicked = false;
                    let checkBtnDebug = '';
                    let checkBtnFound = false;

                    const poppers = document.querySelectorAll('[data-radix-popper-content-wrapper]');
                    for (const popper of poppers) {
                        if (!popper.querySelector('input')) continue;
                        
                        // Force CSS tất cả button/icon trong popper này
                        const allBtns = popper.querySelectorAll('button, [role="button"], span[class*="icon"], i');
                        for (const b of allBtns) {
                            b.style.setProperty('opacity', '1', 'important');
                            b.style.setProperty('visibility', 'visible', 'important');
                            b.style.setProperty('pointer-events', 'auto', 'important');
                            b.style.setProperty('display', 'flex', 'important');
                        }
                        
                        const btns = popper.querySelectorAll('button, [role="button"]');
                        let targetBtn = null;
                        let reason = '';

                        for (const btn of btns) {
                            const txt = btn.textContent.trim().toLowerCase();
                            if (txt === 'check' || txt === 'done' || txt === 'check_circle') {
                                targetBtn = btn; reason = 'icon text'; break;
                            }
                            const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
                            if (lbl.includes('confirm') || lbl.includes('save')) {
                                targetBtn = btn; reason = 'aria-label'; break;
                            }
                        }

                        if (!targetBtn && btns.length > 0) {
                            // Lấy button bên phải input
                            const inp2 = popper.querySelector('input');
                            if (inp2) {
                                for (const btn of btns) {
                                    if (btn.getBoundingClientRect().left > inp2.getBoundingClientRect().right - 5) {
                                        targetBtn = btn; reason = 'position right'; break;
                                    }
                                }
                            }
                        }

                        if (targetBtn) {
                            checkBtnFound = true;
                            try {
                                targetBtn.click();
                                checkBtnClicked = true;
                                checkBtnDebug = reason;
                                await new Promise(r => setTimeout(r, 400));
                            } catch (e) {
                                checkBtnDebug = e.message;
                            }
                            break;
                        }
                    }

                    if (!checkBtnFound) {
                        // Fallback cực đoan: Enter
                        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                        checkBtnDebug = 'Fallback Enter';
                    }

                    return { 
                        ok: true, method, inputDebug, 
                        checkBtnFound, checkBtnClicked, checkBtnDebug, value: currentValue 
                    };

                } catch (e) {
                    return { ok: false, error: e.message };
                }
            },
            args: [newName]
        }).then(results => {
            const result = results?.[0]?.result;
            sendResponse(result || { ok: false, error: 'Script injection failed' });
        }).catch(err => {
            sendResponse({ ok: false, error: err.message });
        });

        return true; // Keep channel open for async response
    }

    return true;
});

// Fallback: Download batch file if native messaging not installed
function fallbackShutdownBatch(delay) {
    const batchContent = `@echo off
echo ========================================
echo VEO Automation - Auto Shutdown
echo ========================================
echo.
echo All prompts completed!
echo PC will shutdown in ${delay} seconds...
echo.
echo To CANCEL: Run "shutdown /a" in CMD
echo ========================================
echo.
shutdown /s /t ${delay}
`;

    // Use data URL instead of blob URL (Service Worker compatible)
    const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(batchContent);

    chrome.downloads.download({
        url: dataUrl,
        filename: 'VEO_AutoShutdown.bat',
        saveAs: false
    }, (downloadId) => {
        console.log('[VEO Automation] Shutdown script downloaded');

        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'VEO Automation Complete',
            message: `All prompts done! Double-click VEO_AutoShutdown.bat to shutdown`,
            priority: 2
        });

        // Log fallback
        chrome.runtime.sendMessage({
            action: 'LOG',
            type: 'warning',
            message: `⚠️ Native Host not available. Downloaded VEO_AutoShutdown.bat - Run it manually to shutdown!`
        }).catch(() => { });
    });
}

// Monitor tab updates (for F5 detection and automatic 80% browser zoom on Flow)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && (tab.url.includes('flow.google.com') || (tab.url.includes('labs.google/fx/') && tab.url.includes('/tools/flow')))) {
        if (tab.url.includes('veo_extra_window=true')) {
            // Extra tools popup window must have 100% zoom (1.0), not 80%!
            chrome.tabs.setZoomSettings(tabId, { scope: 'per-tab' }).then(() => {
                chrome.tabs.setZoom(tabId, 1.0);
            }).catch(() => {});
            return;
        }
        console.log('[VEO Automation] Flow page loaded/refreshed, setting tab zoom to 80%');
        chrome.storage.local.get(['veoSettings'], (result) => {
            const zoom = parseFloat(result?.veoSettings?.zoomLevel || 0.8);
            chrome.tabs.setZoom(tabId, zoom).catch((err) => {
                console.warn('[VEO] Could not set tab zoom:', err);
            });
        });
    }
});

// Keep service worker alive
setInterval(() => {
    console.log('[VEO Automation] Service worker heartbeat');
}, 20000);
