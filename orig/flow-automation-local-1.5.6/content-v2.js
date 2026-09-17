// ==================== VEO AUTOMATION V2 - WORKER MODE ====================
// This script runs in the Flow page context. 
// It receives commands from the Side Panel and executes automation logic.

console.log('[VEO Automation] Content script loaded (Worker Mode)');

// If loaded inside an iframe (TVC Tool), attempt to hide the top header
console.log('[Veo] Content V2 Script Loaded');

    if (window !== window.top) {
        let maskInjected = false;

        // 0. Inject CSS to hide header and left sidebar instantly
        try {
            const style = document.createElement('style');
            style.id = 'veo-iframe-cleaner-style';
            style.textContent = `
                header, 
                flow-tile-view-header, 
                .header-base, 
                [role="banner"],
                mat-sidenav,
                .project-sidenav,
                flow-project-nav-list,
                mat-nav-list[role="navigation"],
                .mat-drawer.mat-sidenav {
                    display: none !important;
                }

                mat-sidenav-content, 
                .mat-drawer-content,
                .has-header-offset {
                    margin-left: 0 !important;
                    padding-left: 0 !important;
                    margin-top: 0 !important;
                    padding-top: 0 !important;
                }
            `;
            (document.head || document.documentElement).appendChild(style);
        } catch(e) {}

        // Advanced JS cleaner to find and hide the sidebar and maximize the embedded app container
        const layoutCleanerInterval = setInterval(() => {
            // 1. Hide the global black top header
            const headers = document.querySelectorAll('header, flow-tile-view-header, [role="banner"]');
            headers.forEach(h => h.style.setProperty('display', 'none', 'important'));

            // 2. Hide the left sidebar by tag / class
            const sidebars = document.querySelectorAll('mat-sidenav, .project-sidenav, flow-project-nav-list, mat-nav-list[role="navigation"]');
            sidebars.forEach(s => s.style.setProperty('display', 'none', 'important'));

            const sidenavContents = document.querySelectorAll('mat-sidenav-content, .mat-drawer-content');
            sidenavContents.forEach(c => {
                c.style.setProperty('margin-left', '0px', 'important');
                c.style.setProperty('padding-left', '0px', 'important');
            });

            // 3. Fallback scan via Material / Google symbols
            const icons = document.querySelectorAll('mat-icon, i.google-symbols, span.google-symbols, .google-symbols');
            for (let icon of icons) {
                const text = (icon.textContent || '').trim();
                if (text === 'dashboard' || text === 'left_panel_open' || text === 'left_panel_close' || text === 'image' || text === 'person' || text === 'videocam' || text === 'accessibility_new') {
                    let parent = icon.parentElement;
                    let depth = 0;
                    while (parent && depth < 12) {
                        const rect = parent.getBoundingClientRect();
                        // Sidebar is usually tall and narrow on the left edge
                        if (rect.width > 20 && rect.width < 280 && rect.height > window.innerHeight * 0.4 && rect.left < 50) {
                            // Prevent hiding sidebars inside modals/dialogs
                            if (parent.closest('[role="dialog"], dialog, [role="presentation"], [class*="modal"], [class*="dialog"], [data-radix-popper-content-wrapper]')) {
                                break;
                            }

                            parent.style.setProperty('display', 'none', 'important');
                            break;
                        }
                        parent = parent.parentElement;
                        depth++;
                    }
                }
            }

            // 4. Expand the iframe to fill the screen powerfully
            const appIframe = document.querySelector('iframe');
            if (appIframe) {
                appIframe.style.setProperty('position', 'fixed', 'important');
                appIframe.style.setProperty('top', '0', 'important');
                appIframe.style.setProperty('left', '0', 'important');
                appIframe.style.setProperty('z-index', '999999', 'important');
                appIframe.style.setProperty('width', '100vw', 'important');
                appIframe.style.setProperty('height', '100vh', 'important');
                appIframe.style.setProperty('margin', '0', 'important');
                appIframe.style.setProperty('padding', '0', 'important');
                appIframe.style.setProperty('border', 'none', 'important');
                
                // Try to hide the inner header inside the iframe
                try {
                    const iDoc = appIframe.contentDocument;
                    if (iDoc && !iDoc.getElementById('veo-iframe-style')) {
                        const style = iDoc.createElement('style');
                        style.id = 'veo-iframe-style';
                        style.textContent = `
                            header { display: none !important; }
                            nav { display: none !important; }
                            [role="banner"] { display: none !important; }
                        `;
                        iDoc.head.appendChild(style);
                    }
                } catch(e) {
                    // Cross-origin restriction might apply
                }
            }

            // 5. Fade out loading mask if injected
            const existingMask = document.getElementById('veo-loading-mask');
            if (existingMask && !existingMask.dataset.fading) {
                existingMask.dataset.fading = 'true';
                setTimeout(() => {
                    existingMask.style.opacity = '0';
                    setTimeout(() => existingMask.remove(), 500);
                }, 800);
            }
        }, 500);
    }

// Local fork: Authorization-header interception intentionally removed.
window.veoAuthToken = null;


// Local fork: network/WIZ response interception removed.
window.veoWizAt = null;
window.veoWizFSid = null;
window.lastBatchexecuteUrl = null;
window.lastBatchexecuteAtToken = null;
window.veoSniffedMediaIds = [];
window.veoSniffedMediaMap = {};

// ==================== CONSTANTS ====================
const PAGE_SESSION_ID = Math.random().toString(36).substring(2);

const STATUS = {
  WAITING: 'WAITING',      // Chờ paste
  PASTING: 'PASTING',      // Đang paste
  CREATING: 'CREATING',    // Đang tạo (có %)
  COMPLETED: 'COMPLETED',  // Đã xong
  ERROR: 'ERROR'           // Lỗi
};

const PASTE_DELAY = 5000;
const MAX_RETRIES = 5;
const CHECK_INTERVAL = 3000;
const SCROLL_INTERVAL = 10000;
const BATCH_SIZE = 5;
const MAX_DOWNLOAD_CONCURRENT = 4;

// ==================== STATE MANAGEMENT ====================
let state = {
  isRunning: false,
  prompts: [],
  settings: {
    addIndex: true,
    autoRename: true,
    maxRetries: 5,
    pasteDelay: 20000,
    outputCount: 2,
    autoDownload: true,
    downloadQuality: '1080p',
    mode: 'text-to-video',
    model: 'veo-3.1-fast',
    aspectRatio: '16:9',
    duration: '8',
    downloadFolder: 'VeoVideos',
    language: 'vi',
    randomScroll: false
  },
  currentPromptIndex: 0,
  processedCount: 0, // Not strictly used in logic but good for stats
  errorCount: 0,
  downloadedCount: 0,
  activeDownloads: 0,
  videos: [],
  // For saving/loading
  projectName: '',
  startTime: 0,
  _existingCards: new Set(),
  // Watchdog for detecting stuck automation
  _lastActivityTime: Date.now(),
  _lastCompletedCount: 0
};

let uiLock = false;

async function acquireUILock(reason) {
  let waited = 0;
  while (uiLock) {
      await wait(100);
      waited += 100;
      if (waited > 60000) {
          uiLock = false; // Force release after 60s
          break;
      }
  }
  uiLock = true;
}

function releaseUILock() {
  uiLock = false;
}

// Global Map to track waiting downloads
let pendingDownloads = new Map();

// ==================== MESSAGE LISTENER ====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_AUTOMATION') {
    handleStart(message.data);
  } else if (message.action === 'PAUSE_AUTOMATION') {
    state.isRunning = false;
    chrome.storage.local.remove('activeRunningProject');
    addLog('warning', '⏸️ Paused');
  } else if (message.action === 'RESUME_AUTOMATION') {
    if (!state.isRunning) {
      state.isRunning = true;
      addLog('success', '▶️ Resumed');
      mainLoop();
    }
  } else if (message.action === 'RESUME_LOADED_PROJECT') {
    if (!state.isRunning && state.videos && state.videos.length > 0) {
      state.settings = { ...state.settings, ...message.data.settings };
      state.isRunning = true;
      state._shutdownTriggered = false;
      addLog('success', `▶️ LÊN ĐƯỜNG! Đang tiếp tục dự án: ${state.projectName}`);
      updateUI();
      if (state.settings.runMode !== 'image') {
        switchToVideoMode().then(() => mainLoop());
      } else {
        mainLoop();
      }
    }
  } else if (message.action === 'RESET_AUTOMATION') {
    resetState();
  } else if (message.action === 'LOAD_PROJECT') {
    loadProject(message.data.projectName);
  } else if (message.action === 'DELETE_PROJECT') {
    deleteProject(message.data.projectName);
  } else if (message.action === 'UPDATE_SETTINGS') {
    state.settings = { ...state.settings, ...message.data };

  } else if (message.action === 'ENFORCE_GROUP_MODE') {
    if (message.data && message.data.zoomLevel) {
      applyPageZoom(message.data.zoomLevel);
    } else {
      applyPageZoom();
    }
    switchToGridView(false);
  } else if (message.action === 'START_PICKING') {
    startElementPicking(message.data.targetType);
  }
});

function applyPageZoom(zoomVal) {
  try {
    if (window.location.search.includes('veo_extra_window=true') || window !== window.top) {
      document.body.style.zoom = '1';
      return;
    }
    const zoom = zoomVal || state.settings?.zoomLevel || '0.8';
    document.body.style.zoom = zoom;
  } catch (e) {}
}

let _hasConfiguredGroupView = false;
async function switchToGridView(force = false) {
  await applyGroupViewSettings(force);
}

async function applyGroupViewSettings(force = false) {
  try {
    applyPageZoom('0.8');
    if (_hasConfiguredGroupView && !force) return;

    // 1. Kiểm tra xem dropdown cài đặt hiển thị đã mở chưa
    let dropdown = document.querySelector('.dropdown-content');
    let settingsGearBtn = null;

    if (!dropdown || dropdown.offsetParent === null) {
      // Tìm nút bánh răng cài đặt trên toolbar (thử tối đa 5 lần nếu trang đang khởi tạo)
      for (let attempt = 0; attempt < 5; attempt++) {
        const buttons = Array.from(document.querySelectorAll('button'));
        settingsGearBtn = buttons.find(b => {
          const icon = b.querySelector('mat-icon, i');
          const iconText = (icon?.textContent || '').trim();
          const aria = (b.getAttribute('aria-label') || b.getAttribute('title') || '').toLowerCase();
          return (['settings_2', 'settings'].includes(iconText) || aria.includes('cài đặt lưới') || aria.includes('grid setting')) && b.offsetParent !== null;
        });
        if (settingsGearBtn) break;
        await wait(300);
      }

      if (settingsGearBtn) {
        settingsGearBtn.click();
        await wait(350);
        dropdown = document.querySelector('.dropdown-content');
      }
    }

    if (!dropdown) {
      // Fallback nếu không mở được dropdown
      const iconEls = document.querySelectorAll('i.google-symbols, i.material-icons, mat-icon');
      for (const icon of iconEls) {
        const iconText = (icon.textContent || '').trim().toLowerCase();
        if (['campaign_all', 'settings_2'].includes(iconText)) {
          const btn = icon.closest('button');
          if (btn && btn.offsetParent !== null) {
            btn.click();
            await wait(300);
            break;
          }
        }
      }
      return;
    }

    // 2. Chế độ xem: Chọn "Theo nhóm" (icon: campaign_all hoặc text "Theo nhóm")
    const groupToggleBtn = dropdown.querySelector('mat-button-toggle#mat-button-toggle-1 button') ||
      Array.from(dropdown.querySelectorAll('mat-button-toggle')).find(t => {
        const txt = (t.textContent || '').toLowerCase();
        const icon = t.querySelector('mat-icon');
        return txt.includes('theo nhóm') || (icon && icon.textContent.trim() === 'campaign_all');
      })?.querySelector('button');

    if (groupToggleBtn) {
      const isChecked = groupToggleBtn.getAttribute('aria-checked') === 'true' || 
                        groupToggleBtn.closest('mat-button-toggle')?.classList.contains('mat-button-toggle-checked');
      if (!isChecked) {
        groupToggleBtn.click();
        await wait(200);
      }
    }

    // 3. Kích thước lưới: Chọn "N" (Nhỏ)
    const sizeGroups = dropdown.querySelectorAll('flow-toggles');
    let sizeGroup = null;
    for (const fg of sizeGroups) {
      const aria = (fg.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('kích thước') || aria.includes('size')) {
        sizeGroup = fg;
        break;
      }
    }
    const targetSizeContainer = sizeGroup || dropdown;
    const nBtn = targetSizeContainer.querySelector('mat-button-toggle#mat-button-toggle-2 button') ||
      Array.from(targetSizeContainer.querySelectorAll('mat-button-toggle')).find(t => {
        const txt = (t.querySelector('.toggle-text')?.textContent || t.textContent || '').trim();
        return txt === 'N';
      })?.querySelector('button');

    if (nBtn) {
      const isChecked = nBtn.getAttribute('aria-checked') === 'true' || 
                        nBtn.closest('mat-button-toggle')?.classList.contains('mat-button-toggle-checked');
      if (!isChecked) {
        nBtn.click();
        await wait(200);
      }
    }

    // 4. Các nút gạt (Slide toggles) chuẩn theo yêu cầu:
    // a. "Âm thanh khi di chuột" -> TẮT (false)
    const soundToggle = dropdown.querySelector('button[name="sound-on-hover"]');
    if (soundToggle && soundToggle.getAttribute('aria-checked') === 'true') {
      soundToggle.click();
      await wait(100);
    }

    // b. "Trả về video không có âm thanh" -> TẮT (false)
    const silentToggle = dropdown.querySelector('button[name="return-silent-videos"]');
    if (silentToggle && silentToggle.getAttribute('aria-checked') === 'true') {
      silentToggle.click();
      await wait(100);
    }

    // c. "Hiện thông tin chi tiết về ô" -> BẬT (true)
    const detailsToggle = dropdown.querySelector('button[name="show-tile-details"]');
    if (detailsToggle && detailsToggle.getAttribute('aria-checked') !== 'true') {
      detailsToggle.click();
      await wait(100);
    }

    // d. "Xoá câu lệnh sau khi gửi" -> BẬT (true)
    const clearPromptToggle = dropdown.querySelector('button[name="clear-prompt-on-submit"]');
    if (clearPromptToggle && clearPromptToggle.getAttribute('aria-checked') !== 'true') {
      clearPromptToggle.click();
      await wait(100);
    }

    // 5. Đóng dropdown lại (nhấn Escape và click backdrop nếu có)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    const backdrop = document.querySelector('.cdk-overlay-backdrop');
    if (backdrop) backdrop.click();
    await wait(200);
    _hasConfiguredGroupView = true;
    addLog('success', '👥 Đã thiết lập chuẩn: Chế độ [Theo nhóm], Kích thước [N], Chi tiết ô [BẬT], Xoá prompt [BẬT]');
  } catch (e) {
    console.warn('[VEO] applyGroupViewSettings error:', e);
  }
}




// ==================== ELEMENT PICKER ====================
let isPicking = false;
let pickingTarget = null;
let hoverOverlay = null;
let glassPane = null; // Full screen event blocker

function startElementPicking(targetType) {
  if (isPicking) return;
  isPicking = true;
  pickingTarget = targetType;
  document.body.style.cursor = 'crosshair';

  // 1. Visual Overlay (Highlight) - Pointer events NONE
  hoverOverlay = document.createElement('div');
  hoverOverlay.id = 'veo-hover-overlay';
  hoverOverlay.style.position = 'absolute';
  hoverOverlay.style.border = '2px solid #0ea5e9';
  hoverOverlay.style.background = 'rgba(14, 165, 233, 0.2)';
  hoverOverlay.style.pointerEvents = 'none'; // CRITICAL: Pass through logic
  hoverOverlay.style.zIndex = '2147483647'; // Topmost visual
  hoverOverlay.style.transition = 'all 0.05s';
  document.body.appendChild(hoverOverlay);

  // 2. Add document-level listeners (Capture Phase)
  // We do NOT use a glass pane anymore, to allow :hover on elements
  document.addEventListener('mousemove', handleDocumentMove, true); // Capture
  document.addEventListener('click', handleDocumentClick, true); // Capture
  document.addEventListener('mouseover', handleDocumentHover, true); // To help with some elements

  addLog('info', `👇 Click an element for: ${targetType} (Hover enabled)`);
}

function handleDocumentMove(e) {
  if (!isPicking) return;
  // We don't block anything here, just track
}

function handleDocumentHover(e) {
  if (!isPicking) return;
  const el = e.target;
  if (el === hoverOverlay || el.id === 'veo-hover-overlay') return;

  const rect = el.getBoundingClientRect();
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

  if (hoverOverlay) {
    hoverOverlay.style.top = (rect.top + scrollTop) + 'px';
    hoverOverlay.style.left = (rect.left + scrollLeft) + 'px';
    hoverOverlay.style.width = rect.width + 'px';
    hoverOverlay.style.height = rect.height + 'px';

    if (pickingTarget === 'cardContainer') {
      hoverOverlay.style.border = '2px dashed #facc15';
    } else {
      hoverOverlay.style.border = '2px solid #0ea5e9';
    }
  }
}

function handleDocumentClick(e) {
  if (!isPicking) return;

  // Stop default action immediately
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  let element = e.target;

  // Auto-select parent for interactive elements if clicked inner part
  const interactiveEl = element.closest('button, a, div[role="button"], span[role="button"]');
  if (interactiveEl) {
    addLog('info', `🎯 Precise Pick: ${interactiveEl.tagName}`);
    element = interactiveEl;
  }

  const selector = generateSelector(element);
  const target = pickingTarget;

  addLog('success', `✅ Picked (${target})`);

  stopPicking();

  chrome.runtime.sendMessage({
    action: 'PICK_RESULT',
    data: {
      targetType: target,
      selector: selector
    }
  }).catch(() => { });

  return false;
}

function stopPicking() {
  isPicking = false;
  pickingTarget = null;
  document.body.style.cursor = 'default';

  if (hoverOverlay) hoverOverlay.remove();

  // Remove document listeners
  document.removeEventListener('mousemove', handleDocumentMove, true);
  document.removeEventListener('click', handleDocumentClick, true);
  document.removeEventListener('mouseover', handleDocumentHover, true);
}

function generateSelector(el) {
  if (el.tagName === 'TEXTAREA') {
    if (el.id) return `#${el.id}`;
    if (el.placeholder) return `textarea[placeholder="${el.placeholder}"]`;
    return 'textarea';
  }

  if (el.id) return `#${el.id}`;

  // Improved class handling (filter dynamic looking ones)
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.split(/\s+/).filter(c =>
      c &&
      !c.includes('hover') &&
      !c.includes('active') &&
      !c.match(/^sc-/) && // styled-components often use sc- prefix
      !c.match(/^[a-zA-Z0-9]{6,}$/) // Random hash classes often look like this
    );
    if (classes.length > 0) return `.${classes.join('.')}`;
  }

  // Fallback to structural path
  let path = [];
  let current = el;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.nodeName.toLowerCase();
    if (current.id) {
      selector += '#' + current.id;
      path.unshift(selector);
      break;
    } else {
      let sib = current, nth = 1;
      while (sib = sib.previousElementSibling) {
        if (sib.nodeName.toLowerCase() === selector) nth++;
      }
      if (nth !== 1) selector += `:nth-of-type(${nth})`;
    }
    path.unshift(selector);
    current = current.parentNode;
  }
  return path.join(" > ");
}


// ==================== HELPER FUNCTIONS ====================

// Helper: Log to Side Panel
function addLog(type, message) {
  console.log(`[VEO ${type.toUpperCase()}] ${message}`);
  try {
    chrome.runtime.sendMessage({ action: 'LOG', type, message }).catch(() => { });
  } catch(e) {}
}

// Helper: Update UI (stats & table)
function updateUI() {
  const creating = state.videos.filter(v => v.status === STATUS.CREATING || v.status === STATUS.PASTING).length;
  const completed = state.videos.filter(v => v.status === STATUS.COMPLETED).length;
  const error = state.videos.filter(v => v.status === STATUS.ERROR).length;

  try {
    chrome.runtime.sendMessage({
      action: 'UPDATE_STATS',
      data: { creating, completed, error }
    }).catch(() => { });
  } catch(e) {
    console.warn("VEO Extension Context Invalidated. Please refresh the page.");
  }

  sendTableUpdate();
}

function sendTableUpdate() {
  // Main Table
  const rows = state.videos.map((v) => {
    // Chỉ hiển thị progress bar khi có % thực (> 2), placeholder 2% thì coi như 0
    const progressWidth = (v.progress > 2) ? v.progress : 0;

    // Video Sub-Status (Pills)
    let extraStatusHTML = '';
    if (v.subVideos && v.subVideos.length > 0) {
      extraStatusHTML = '<div style="margin-bottom: 4px; display: flex; flex-wrap: wrap; gap: 4px;">';
      v.subVideos.forEach((sv, idx) => {
        let pClass = 'veo-pill-waiting';
        let pText = '0%';

        if (sv.status === 'COMPLETED') {
          pClass = 'veo-pill-done';
          pText = 'Done';          // ✅ Green, clear label
        }
        else if (sv.status === 'ERROR') {
          pClass = 'veo-pill-error';
          pText = 'Fail';          // ❌ Red, no verbose reason
        }
        else if (sv.status === 'UPSCALING') {
          pClass = 'veo-pill-upscaling';
          pText = '⬆';
        }
        else if (sv.status === 'CREATING') {
          pClass = 'veo-pill-creating';
          // Nếu progress > 2 thì là % thực từ web, còn = 2 là placeholder (web không hiển thị %)
          pText = (sv.progress > 2) ? `${sv.progress}%` : '···';
        }

        const cardLetter = String.fromCharCode(65 + idx); // A, B, C...
        extraStatusHTML += `<span class="${pClass} veo-video-pill" title="Card ${idx+1}">${pText}</span>`;
      });
      extraStatusHTML += '</div>';
    } else {
      // DEBUG VISUAL FOR USER:
      // When 0 cards are found, explicitly show it so the user isn't left guessing!
      const isSearching = (v.status === STATUS.CREATING || v.status === STATUS.PASTING);
      if (v.status === STATUS.ERROR) {
         const errText = v.error || 'Unknown Error';
         const errShort = errText.length > 40 ? errText.substring(0, 38) + '...' : errText;
         extraStatusHTML = `<div style="margin-bottom: 4px; color: #ef4444; font-size: 11px; font-weight: bold; line-height: 1.3;" title="${errText.replace(/"/g, '&quot;')}">❌ FAIL<br><span style="font-size: 10px; font-weight: 500; opacity: 0.9;">(${errShort})</span></div>`;
      } else if (isSearching) {
         extraStatusHTML = `<div style="margin-bottom: 4px; color: #f59e0b; font-size: 11px; font-weight: bold;">[🔎 Đang dò tìm... ${v._isMissingTiles ? '(Bị khuất)' : '(Chưa thấy thẻ)'}]</div>`;
      } else {
         extraStatusHTML = `<div style="margin-bottom: 4px; color: #ef4444; font-size: 11px;">[0 thẻ]</div>`;
      }
    }

    return `
            <tr>
                <td>${v.promptIndex}</td>
                <td title="${v.promptText.replace(/"/g, '&quot;')}">${v.promptText.substring(0, 30)}...</td>
                <td>
                    ${extraStatusHTML}
                    <div class="veo-progress-bar">
                        <div class="veo-progress-fill" style="width: ${progressWidth}%; background-color: ${v.status === STATUS.ERROR ? '#ef4444' : '#3b82f6'}"></div>
                    </div>
                </td>
                <td style="text-align: center;">${state.settings.autoDownload ? `${v.downloadedCount || 0}/${v.totalVideos || '?'}` : 'N/A'}</td>
                <td style="text-align: center;">${v.retries}</td>
            </tr>
        `;
  }).join('');

  chrome.runtime.sendMessage({
    action: 'UPDATE_TABLE',
    data: rows
  }).catch(() => { });
}

function resetState() {
  state.isRunning = false;
  state.prompts = [];
  state.videos = [];
  state.startTime = 0; // Reset timer
  state.projectName = null; // Clear project name

  chrome.storage.local.remove('veoState');

  updateUI();
  addLog('success', '✅ Reset complete!');

  // Sync UI
  chrome.runtime.sendMessage({
    action: 'AUTOMATION_STOPPED'
  }).catch(() => { });
}

async function wait(ms) {
  return new Promise(resolve => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (!state.isRunning) {
        clearInterval(interval);
        resolve(); // break early
      }
      if (Date.now() - start >= ms) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
}

// ==================== START HANDLER ====================
function handleStart(data) {
  if (state.isRunning) return;

  // RESET STATE FOR NEW BATCH
  state.videos = [];
  state.currentIndex = 0;
  state.isPaused = false;
  state._shutdownTriggered = false;
  state._hasReloadedBeforeDownload = false;
  state._hasReloadedAfterRename = false;
  state._hasDownloadedZip = false;
  saveProject(); // Lỗi undefined do clearProject không tồn tại, đổi thành saveProject() để lưu state rỗng

  state.prompts = data.prompts || [];
  state.settings = { ...state.settings, ...data.settings };

  startAutomation(data.videosToCreate);
}

function handleResume(data) {
  if (state.isRunning) return;
  if (!state.videos || state.videos.length === 0) {
      addLog('error', '❌ Không có dữ liệu video để tiếp tục!');
      return;
  }

  state.settings = { ...state.settings, ...data.settings };
  state.isRunning = true;
  state._shutdownTriggered = false;
  if (state.projectName) chrome.storage.local.set({ activeRunningProject: state.projectName });
  
  chrome.runtime.sendMessage({ action: 'AUTOMATION_RESUMED' }).catch(() => {});
  
  addLog('success', `▶️ LÊN ĐƯỜNG! Đang tiếp tục dự án: ${state.projectName}`);
  updateUI();
  
  if (state.settings.runMode !== 'image') {
    switchToVideoMode().then(() => mainLoop());
  } else {
    mainLoop();
  }
}

// ==================== AUTOMATION LOGIC ====================

let isEnforcingGroupMode = false;
async function startAutomation(videosToCreate) {
  if (state.isRunning) return;

  if (!videosToCreate || videosToCreate.length === 0) {
    addLog('error', 'No prompts to process!');
    return;
  }
  
  // --- CROSS-MODE MISMATCH CHECK ---
  const url = window.location.href.toLowerCase();
  const isVideoSite = url.includes('video-generation') || document.title.toLowerCase().includes('video');
  const isImageSite = url.includes('image-generation') || document.title.toLowerCase().includes('imagen');

  if (state.settings.runMode === 'video' && isImageSite && !isVideoSite) {
    addLog('error', '🚨 LỖI NGHIÊM TRỌNG: Bạn chọn [Tạo Video] trên Tool, nhưng trang web rành rành là [Tạo Ảnh]! Bot tự động dừng để tránh vòng lặp tải xuống vô tận. Kẻo sai lè.');
    // Broadcast stop out
    chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED' }).catch(() => {});
    return;
  }
  if (state.settings.runMode === 'image' && isVideoSite && !isImageSite) {
    addLog('error', '🚨 LỖI NGHIÊM TRỌNG: Bạn chọn [Tạo Ảnh] trên Tool, nhưng trang web rành rành là [Tạo Video]! Bot tự động dừng ngay. Vui lòng chuyển đổi trên website cho khớp.');
    chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED' }).catch(() => {});
    return;
  }
  // ---------------------------------

  // Clear old videos (fresh start)
  state.videos = [];
  
  // Reset ZIP download flag for the new project run
  state._hasDownloadedZip = false;

  // Create project name
  state.projectName = state.projectName || `Project_${new Date().toISOString().slice(0, 10)}_${Date.now()}`;

  // Reset download queue
  downloadQueue = [];
  activeDownloads = 0;

  // Store existing cards snapshot so we don't map to old generations
  state._existingCards = new Set();
  state._existingTileIds = new Set(getAllTileIds());
  addLog('info', `Starting fresh (ignoring ${state._existingTileIds.size} existing tiles)`);

  for (const item of videosToCreate) {
    state.videos.push({
      id: `video_${Date.now()}_${item.index}`,
      promptText: item.text,
      promptIndex: item.index, // Display index (1-based)
      promptId: `pid_${Date.now()}_${item.index}`, // UNIQUE ID for DOM locking (data-fe-grid-id)
      status: STATUS.WAITING,
      progress: 0,
      retries: 0,
      cardElement: null,
      cardElements: [],
      trackedTileIds: [],
      _preClickTileIds: null,
      error: null,
      expectedVideos: state.settings.outputCount || 1, // Expected number of videos
      downloadedCount: 0,
      downloaded: false,
      _downloadQueued: false,
      _groupContainer: null,    // GROUP CONTAINER: the div wrapping all tiles for this prompt
      _preClickGroups: null,    // snapshot of groups before Create click
      createdAt: Date.now()
    });
  }

  if (state.videos.length === 0) {
    addLog('warning', '⚠️ No prompts to process!');
    return;
  }

  state.isRunning = true;
  state.startTime = Date.now(); // Start timer
  state._shutdownTriggered = false; // Reset shutdown flag
  if (state.projectName) chrome.storage.local.set({ activeRunningProject: state.projectName });
  addLog('success', `🚀 Starting automation: ${state.videos.length} prompts`);
  updateUI();
  saveProject();

  // Only switch to Video mode if NOT in image mode (avoid overriding user's Nano Banana/Image selection)
  if (state.settings.runMode !== 'image') {
    await switchToVideoMode();
  } else {
    addLog('info', '🖼️ Image mode detected — skipping switchToVideoMode to keep Nano Banana active.');
  }
  mainLoop();
}

// Helper to check if the current tab is the active tab in its window
async function isTabActive() {
    return new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'CHECK_TAB_ACTIVE' }, (isActive) => {
            resolve(isActive !== false); // Default to true if disconnected/error
        });
    });
}

// ==================== MAIN LOOP ====================
async function mainLoop() {
  while (state.isRunning) {
    state.settings.maxRetries = (!isNaN(parseInt(state.settings.maxRetries)) ? parseInt(state.settings.maxRetries) : 3);
    
    const pasting = state.videos.filter(v => v.status === STATUS.PASTING);
    const creating = state.videos.filter(v => v.status === STATUS.CREATING);
    const waiting = state.videos.filter(v => v.status === STATUS.WAITING);
    const errors = state.videos.filter(v => v.status === STATUS.ERROR && (v.retries || 0) < state.settings.maxRetries);
    
    // Tải xuống cho những video đã tạo xong nhưng chưa tải đủ
    const waitingDownload = state.videos.filter(v => v.status === STATUS.COMPLETED && !v.downloaded && (v.downloadedCount || 0) < (v.totalVideos || 0) && !v._downloadError);
    // Tải lại cho những video đã tải lỗi
    const errorDownload = state.videos.filter(v => v.status === STATUS.COMPLETED && !v.downloaded && v._downloadError && (v.downloadRetries || 0) < state.settings.maxRetries);

    let delay = 20000;
    if (state.settings.pasteDelayMin && state.settings.pasteDelayMax) {
      const min = state.settings.pasteDelayMin * 1000;
      const max = state.settings.pasteDelayMax * 1000;
      delay = Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    // Nếu là prompt cuối cùng thì không cần chờ lâu
    if (waiting.length === 1 && pasting.length === 0 && creating.length === 0 && errors.length === 0) {
      delay = 2000;
    }    
    
    // ── KIỂM TRA MẠNG & ACTIVE TAB TRƯỚC KHI THỰC THI ──
    if (!navigator.onLine) {
        addLog('warning', '⚠️ Mất mạng! Bot đang ngủ đông chờ kết nối...');
        await wait(5000);
        continue;
    }
    
    // Kiểm tra xem User có đang chuyển sang tab khác trong cùng cửa sổ không
    if (!(await isTabActive())) {
        addLog('warning', '⚠️ Bạn đã chuyển sang Tab khác! Bot tạm ngủ để tránh lỗi. Vui lòng quay lại Tab này để tiếp tục...');
        await wait(3000);
        continue;
    }

    if (uiLock) {
      await wait(1000);
      continue;
    }

    // ── GIAI ĐOẠN 1.5: MODULE ĐỔI TÊN ĐỘC LẬP (Independent Rename Module) ──
    // Chạy độc lập hoàn toàn, dù user có chọn tải xuống hay không tải xuống!
    if (state.settings.autoRename !== false) {
      const waitingRename = state.videos.filter(v => v.status === STATUS.COMPLETED && !v.renamedOnCloud && !v._renameError && !v._renameSkipped);
      if (waitingRename.length > 0) {
        const video = waitingRename[0];
        addLog('info', `⏳ [Đổi tên độc lập] Đang đổi tên cho prompt [${video.promptIndex}]...`);
        await acquireUILock('rename');
        try {
          await renameMediaOnCloud(video);
        } catch (rErr) {
          video._renameError = true;
          video._renameSkipped = true;
          addLog('warning', `[${video.promptIndex}] Lỗi đổi tên: ${rErr.message}`);
        } finally {
          releaseUILock();
        }
        await wait(1000);
        continue;
      }
    }

    // ── GIAI ĐOẠN 1: Tạo mới toàn bộ ──
    if (waiting.length > 0) {
      const video = waiting[0];
      addLog('info', `🆕 Đang tạo mới: [${video.promptIndex}]`);
      await acquireUILock('paste-new');
      try {
        await pastePrompt(video);
        state._promptsPastedSinceLastSweep = (state._promptsPastedSinceLastSweep || 0) + 1;
      } finally {
        releaseUILock();
      }
      // --- CHECKPOINT 10 PROMPT (Xử lý cuốn chiếu & Chống Stuck) ---
      const isEndOfBatch = waiting.length === 0;
      const shouldCheckpoint = (state._promptsPastedSinceLastSweep || 0) >= 10 || isEndOfBatch;
      
      if (shouldCheckpoint && creating.length > 0) {
          const now = Date.now();
          const latestPromptIndex = state.videos.reduce((max, v) => (v.status !== STATUS.WAITING && v.status !== STATUS.QUEUED) ? Math.max(max, v.promptIndex) : max, 0);
          
          let hasLocalMissing = false;
          
          // 1. Cắt tỉa (Pruning) - Đánh fail các thẻ cách xa >= 10 prompt
          for (const v of creating) {
              const distance = latestPromptIndex - v.promptIndex;
              if (distance >= 10) {
                  const timeoutLimit = state.settings.runMode === 'image' ? 120000 : (v.promptText?.includes('upscale') ? 180000 : 300000);
                  if (v._createStartTime && (now - v._createStartTime > timeoutLimit)) {
                      v.status = STATUS.ERROR;
                      v.error = "Timeout: Bị bỏ lại phía sau quá 10 prompt và quá thời gian chờ.";
                      addLog('error', `[${v.promptIndex}] Lỗi: Bị bỏ lại >10 prompt và quá hạn. Đánh FAIL tự động.`);
                      continue;
                  }
              }
              
              if (v._isMissingTiles || v._isStuck) {
                  hasLocalMissing = true;
              }
          }
          
          // --- RESTORE LOCAL SWEEP (Cuộn cục bộ tìm thẻ ẩn) ---
          if (hasLocalMissing) {
              addLog('info', `🧹 [CHECKPOINT] Kích hoạt rà soát sau khi dán ${state._promptsPastedSinceLastSweep || 'hết'} prompt. Cuộn XUỐNG tìm thẻ...`);
              
              // Nhả focus khỏi ô nhập liệu để cuộn được
              if (document.activeElement) document.activeElement.blur();
              document.body.focus();
              document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
              
              // Cuộn lặp lại tối đa 60s để tìm thẻ
              const sweepStartTime = Date.now();
              let lastScrollTop = -1;
              let scrollAttempts = 0;
              
              while (Date.now() - sweepStartTime < 60000 && scrollAttempts < 30) {
                  const currentMissing = state.videos.filter(v => v.status === STATUS.CREATING && (v._isMissingTiles || v._isStuck));
                  if (currentMissing.length === 0) {
                      addLog('success', `✅ [CHECKPOINT] Đã chốt xong toàn bộ trạng thái thẻ trong đợt này!`);
                      break;
                  }
                  
                  // Cuộn XUỐNG
                  if (typeof veoScrollBy === 'function') veoScrollBy(1000);
                  else window.scrollBy({ top: 1000, behavior: 'smooth' });
                  
                  scrollAttempts++;
                  await wait(2000);
                  
                  // Kiểm tra xem có kẹt ở cuối trang không
                  const newScrollTop = window.scrollY || document.documentElement.scrollTop;
                  if (newScrollTop === lastScrollTop) {
                      addLog('warning', `⚠️ [CHECKPOINT] Đã cuộn kịch sàn nhưng vẫn còn ${currentMissing.length} thẻ bị khuất/kẹt. Bỏ qua để dán tiếp.`);
                      break; // Đã cuộn kịch sàn
                  }
                  lastScrollTop = newScrollTop;
              }
          }
          
          state._promptsPastedSinceLastSweep = 0;
      }
      await wait(delay); // Đợi Paste Delay
      continue;
    }

    // ── GIAI ĐOẠN 2: CHỜ TOÀN BỘ TIẾN TRÌNH TẠO KẾT THÚC ──
    // Phải chờ tất cả Video đang chạy ngầm hoàn tất (thành công hoặc lỗi) mới được phép Retry!
    if (pasting.length > 0 || creating.length > 0) {
      if (Math.random() < 0.2) {
          addLog('info', `⏳ Đang chờ ${creating.length + pasting.length} tiến trình tạo ngầm hoàn tất...`);
      }
      
      // --- RESTORE BATCH SWEEP (Xử lý cuốn chiếu & Chống Stuck) ---
      const missingVideos = creating.filter(v => v._isMissingTiles || v._isStuck);
      // NGĂN CHẶN XUNG ĐỘT (FIX v1.5.6): Tuyệt đối không cuộn xuống Sweep nếu đang có thẻ vừa dán (PASTING) chờ lấy ID!
      if (missingVideos.length > 0 && pasting.length === 0) {
          if ((state._promptsPastedSinceLastSweep || 0) >= 5 || waiting.length === 0) {
              const now = Date.now();
              if (!state._lastSweepTime || (now - state._lastSweepTime > 60000)) { // 1 phút sweep 1 lần nếu stuck
                  state._lastSweepTime = now;
                  const reason = missingVideos.some(v => v._isStuck) ? 'cứu stuck' : 'tìm thẻ ẩn';
                  addLog('info', `🧹 [BATCH SWEEP] Kích hoạt rà soát sau khi dán ${state._promptsPastedSinceLastSweep || 'hết'} prompt. Cuộn trang để ${reason}...`);
                  
                  // NEW FIX: Cuộn nhiều nấc cho đến khi tìm thấy thẻ hoặc kịch sàn (giống Local Sweep)
                  const sweepStartTime = Date.now();
                  let lastScrollTop = -1;
                  let scrollAttempts = 0;
                  
                  while (Date.now() - sweepStartTime < 30000 && scrollAttempts < 20) {
                      const currentMissing = state.videos.filter(v => (v.status === STATUS.CREATING || v.status === STATUS.PASTING) && (v._isMissingTiles || v._isStuck));
                      if (currentMissing.length === 0) {
                          addLog('success', `✅ [BATCH SWEEP] Đã tìm thấy tất cả thẻ ẩn!`);
                          break;
                      }
                      
                      if (typeof veoScrollBy === 'function') veoScrollBy(1000);
                      else window.scrollBy({ top: 1000, behavior: 'smooth' });
                      
                      scrollAttempts++;
                      await wait(2000); // Đợi 2s cho DOM render và monitorCards quét 1 nhịp
                      
                      const newScrollTop = window.scrollY || document.documentElement.scrollTop;
                      if (newScrollTop === lastScrollTop) {
                          addLog('warning', `⚠️ [BATCH SWEEP] Đã cuộn kịch sàn nhưng vẫn còn thẻ khuất. Vui lòng kiểm tra lại.`);
                          break;
                      }
                      lastScrollTop = newScrollTop;
                  }
                  
                  state._promptsPastedSinceLastSweep = 0;
                  await wait(2000);
                  continue;
              }
          }
      }

      await wait(3000);
      continue;
    }

    // ── GIAI ĐOẠN 3: Thử lại các lỗi tạo (Sau khi đã tạo hết 1 vòng) ──
    const anyErrors = state.videos.filter(v => v.status === STATUS.ERROR);

    if (errors.length > 0) {
      let candidates = errors.filter(v => v.promptIndex > (state._lastRetriedPromptIndex || 0));
      if (candidates.length === 0) candidates = errors;
      
      const video = candidates[0];
      state._lastRetriedPromptIndex = video.promptIndex;
      video.retries = (video.retries || 0) + 1;
      
      addLog('warning', `🔄 Đang thử lại tạo: [${video.promptIndex}] (Lần ${video.retries}/${state.settings.maxRetries})`);
      await acquireUILock('paste-retry');
      try {
        await pastePrompt(video);
      } finally {
        releaseUILock();
      }
      await wait(delay);
      continue;
    }



    if (state.settings.autoDownload || state.settings.downloadZip) {
      if (state.settings.downloadZip) {
          if (!state._hasDownloadedZip) {
              state._hasDownloadedZip = true;
              addLog('info', '📦 Bắt đầu tải toàn bộ dự án dưới dạng ZIP...');
              await acquireUILock('download-zip');
              try {
                  await downloadProjectAsZip();
                   // Đánh dấu đã tải + cập nhật downloadedCount để cột 'Đã tải' hiển thị đúng
                   state.videos.forEach(v => {
                       if (v.status === STATUS.COMPLETED) {
                           v.downloaded = true;
                           v.downloadedCount = v.totalVideos || v.expectedVideos || v.downloadedCount || 0;
                       }
                   });
                   saveProject(); // Lưu ngay để reload không chạy lại
                   addLog('success', '✅ Tải ZIP thành công! Đã cập nhật cột Đã tải.');
               } catch (e) {
                   state._zipRetries = (state._zipRetries || 0) + 1;
                   addLog('error', '❌ Lỗi tải ZIP lần ' + state._zipRetries + '/3: ' + e.message);
                   if (state._zipRetries >= 3) {
                       addLog('error', 'Qua so lan retry ZIP. Dung tai - KHONG fallback sang Tai Le.');
                       state._hasDownloadedZip = true;
                   } else {
                       state._hasDownloadedZip = false;
                       addLog('warning', 'Se thu tai ZIP lai sau 5 giay...');
                   }
               } finally {
                   releaseUILock();
               }
               await wait(5000);
          }
      } else {
        const hasAnyDownloadWork = waitingDownload.length > 0 || errorDownload.length > 0;
        
        // --- THEO GỢI Ý CỦA USER: TỰ ĐỘNG F5 ĐỂ XÓA RÁC LỖI TRƯỚC KHI TẢI ---
        if (hasAnyDownloadWork && !state._hasReloadedBeforeDownload) {
            state._hasReloadedBeforeDownload = true;
            addLog('info', '🔄 Chuẩn bị Tải Xuống! Tự động Reload trang (F5) để dọn sạch các thẻ lỗi khỏi màn hình...');
            await saveProject();
            await chrome.storage.local.set({ autoResumeProject: state.projectName, activeRunningProject: state.projectName }); // THIẾT LẬP AUTO-RESUME SAU KHI RELOAD
            await wait(2000);
            location.reload();
            return; // Ngừng vòng lặp để trình duyệt load lại
        }

      if (waitingDownload.length > 0) {
        const video = waitingDownload[0];
        addLog('info', `📥 Bắt đầu tải tệp (video/ảnh) [${video.promptIndex}]...`);
        await acquireUILock('download');
        let searchBox = null;
        try {
          searchBox = findFlowSearchBox();
          if (searchBox) {
              const displayIndex = getPromptIndexNumber(video.promptIndex);
              // LUÔN LUÔN TÌM KIẾM THEO PROMPT (KHÔNG TÌM THEO TÊN FILE RENAMED)
              const rawPrompt = (state.settings.addIndex ? `${displayIndex}. ${video.promptText}` : video.promptText) || '';
              const filterText = rawPrompt.replace(/\s+/g, ' ').trim();
              addLog('info', `🔍 Kích hoạt bộ lọc tìm kiếm: "${filterText}"`);
              
              // MỞ RỘNG KHUNG SEARCH NẾU ĐANG THU GỌN
              searchBox.focus();
              searchBox.click();
              const siblingBtn = searchBox.parentElement?.querySelector('button');
              if (siblingBtn && siblingBtn.textContent.includes('search')) {
                  siblingBtn.click();
              }
              await wait(500);

              await setNativeValue(searchBox, filterText);
              await wait(500);
              searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              searchBox.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              await wait(2500); // 2.5s for React/Angular to render the filtered cards
              
              // Bốc toàn bộ thẻ của Prompt này trên màn hình
              let visibleTiles = getOuterTiles().filter(t => t.offsetParent !== null || t.offsetWidth > 0);
              for (let attempt = 0; attempt < 3 && visibleTiles.length === 0; attempt++) {
                  await wait(1000);
                  visibleTiles = getOuterTiles().filter(t => t.offsetParent !== null || t.offsetWidth > 0);
              }

              if (visibleTiles.length > 0) {
                  video.cardElements = visibleTiles;
                  video.trackedTileIds = visibleTiles.map(t => extractTileId(t) || t.getAttribute('data-tile-id')).filter(Boolean);
                  video.totalVideos = visibleTiles.length;
                  addLog('success', `[${video.promptIndex}] 🔗 Đã bốc ${visibleTiles.length} thẻ trực tiếp từ bộ lọc Search!`);
              } else {
                  addLog('warning', `[${video.promptIndex}] Bộ lọc Search trống không, hãy cẩn thận!`);
              }
          }
          await startDownloadForVideo(video);
        } catch(e) {
          video._downloadError = true;
          video.downloadRetries = (video.downloadRetries || 0) + 1;
          addLog('error', `[${video.promptIndex}] Lỗi tải: ${e.message}`);
        } finally {
          if (searchBox) {
              await setNativeValue(searchBox, "");
              addLog('info', `🧹 Đã trả lại giao diện gốc...`);
              await wait(1500);
          }
          releaseUILock();
        }
        await wait(3000);
        continue;
      }

      // ── GIAI ĐOẠN 5: TẢI LẠI (Retry Downloads) ──
      // Chỉ chạy khi đã quét tải hết 1 lượt toàn bộ các video thường
      if (errorDownload.length > 0) {
        const video = errorDownload[0];
        video.downloadRetries = (video.downloadRetries || 0) + 1;
        video._downloadError = false; // Xóa cờ lỗi để Retry lại
        addLog('warning', `🔄 Thử lại tải video [${video.promptIndex}] (Lần ${video.downloadRetries}/${state.settings.maxRetries})`);
        await acquireUILock('download-retry');
        let searchBox = null;
        try {
          searchBox = findFlowSearchBox();
          if (searchBox) {
              const displayIndex = getPromptIndexNumber(video.promptIndex);
              // LUÔN LUÔN TÌM KIẾM THEO PROMPT (KHÔNG TÌM THEO TÊN FILE RENAMED)
              const rawPrompt = (state.settings.addIndex ? `${displayIndex}. ${video.promptText}` : video.promptText) || '';
              const filterText = rawPrompt.replace(/\s+/g, ' ').trim();
              addLog('info', `🔍 Kích hoạt bộ lọc tìm kiếm (Retry): "${filterText}"`);

              // MỞ RỘNG KHUNG SEARCH NẾU ĐANG THU GỌN
              searchBox.focus();
              searchBox.click();
              const siblingBtn = searchBox.parentElement?.querySelector('button');
              if (siblingBtn && siblingBtn.textContent.includes('search')) {
                  siblingBtn.click();
              }
              await wait(500);

              await setNativeValue(searchBox, filterText);
              await wait(500);
              searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              searchBox.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              await wait(2500); 
              
              let visibleTiles = getOuterTiles().filter(t => t.offsetParent !== null || t.offsetWidth > 0);
              for (let attempt = 0; attempt < 3 && visibleTiles.length === 0; attempt++) {
                  await wait(1000);
                  visibleTiles = getOuterTiles().filter(t => t.offsetParent !== null || t.offsetWidth > 0);
              }

              if (visibleTiles.length > 0) {
                  video.cardElements = visibleTiles;
                  video.trackedTileIds = visibleTiles.map(t => extractTileId(t) || t.getAttribute('data-tile-id')).filter(Boolean);
                  video.totalVideos = visibleTiles.length;
                  addLog('success', `[${video.promptIndex}] 🔗 Đã bốc ${visibleTiles.length} thẻ trực tiếp từ bộ lọc Search (Retry)!`);
              }
          }
          await startDownloadForVideo(video);
        } catch(e) {
          video._downloadError = true;
        } finally {
          if (searchBox) {
              await setNativeValue(searchBox, "");
              await wait(1500);
          }
          releaseUILock();
        }
        await wait(3000);
        continue;
      }
      } // End of else (legacy download)
    }

    // ── KẾT THÚC TOÀN BỘ ──
    const remainingWork = state.videos.filter(v =>
        v.status === STATUS.WAITING ||
        v.status === STATUS.PASTING ||
        v.status === STATUS.CREATING ||
        (v.status === STATUS.ERROR && (v.retries || 0) < state.settings.maxRetries) ||
        (state.settings.autoRename !== false && v.status === STATUS.COMPLETED && !v.renamedOnCloud && !v._renameError && !v._renameSkipped) ||
        ((state.settings.autoDownload || state.settings.downloadZip) && v.status === STATUS.COMPLETED && !v.downloaded && !v._downloadFinalFailed && (!v._downloadError || (v.downloadRetries || 0) < state.settings.maxRetries))
    );
    
    if (remainingWork.length === 0) {
        // --- AUDIT FINAL MEDIA ---
        if (state.settings.autoDownload) {
            let hasMissingMedia = false;
            for (const v of state.videos) {
                if (v.status === STATUS.COMPLETED && !v.downloaded && !v._downloadFinalFailed) {
                    v._finalAuditRetries = (v._finalAuditRetries || 0) + 1;
                    if (v._finalAuditRetries <= 3) {
                        v._downloadError = false;
                        v._downloadFinalFailed = false;
                        v.downloadRetries = 0;
                        hasMissingMedia = true;
                        addLog('warning', `⚠️ AUDIT CUỐI: Dự án ${v.promptIndex} tải thiếu. Retry toàn diện lần ${v._finalAuditRetries}/3...`);
                    } else {
                         v._downloadFinalFailed = true; // Đánh dấu vĩnh viễn thất bại để loại khỏi vòng lặp
                         addLog('error', `🚫 Dự án ${v.promptIndex} đã thất bại tải xuống hoàn toàn sau mọi nỗ lực Audit.`);
                    }
                }
            }
            if (hasMissingMedia) {
                addLog('info', '♻️ Kích hoạt lại vòng lặp để sửa lỗi tải thiếu.');
                await wait(2000);
                continue; 
            }
        }

        // --- RELOAD LÚC KẾT THÚC (F5) ĐỂ ĐỒNG BỘ TÊN FILE LÊN CLOUD ---
        // Nếu user tắt Tự Động Tải, web vẫn cần F5 1 lần để lưu các file đã đổi tên trên server.
        // Nếu user đã Bật Tự Động Tải, web đã được F5 ở bước trước khi tải rồi, không reload thừa.
        if (!state._hasReloadedBeforeDownload && !state._hasReloadedAtEnd) {
            state._hasReloadedAtEnd = true;
            addLog('info', '🔄 Hoàn tất tạo thẻ! Tự động Reload trang (F5) để đồng bộ tên file lên Cloud...');
            await saveProject();
            await chrome.storage.local.set({ autoResumeProject: state.projectName, activeRunningProject: state.projectName });
            await wait(2000);
            location.reload();
            return;
        }

        const total = state.videos.length;
        const successCount = state.videos.filter(v => v.status === STATUS.COMPLETED).length;
        
        const failedCreation = state.videos.filter(v => v.status === STATUS.ERROR).map(v => v.promptIndex);
        const failedRename = state.videos.filter(v => v._renameError || v._renameSkipped).map(v => v.promptIndex);
        const failedDownload = state.videos.filter(v => v._downloadError || v._downloadFinalFailed).map(v => v.promptIndex);

        let summaryMsg = `✅ TỔNG KẾT DỰ ÁN:\n- Tạo thành công: ${successCount}/${total} prompt.`;
        let htmlSummary = `<b>✅ TỔNG KẾT DỰ ÁN:</b><br>- Tạo thành công: <b>${successCount}/${total}</b> prompt.`;
        
        if (failedCreation.length > 0) {
            summaryMsg += `\n❌ Lỗi tạo Video (Bỏ qua): Prompt số [${failedCreation.join(', ')}].`;
            htmlSummary += `<br><span style="color: #ef4444;">❌ Lỗi tạo Video (Bỏ qua): Prompt số [${failedCreation.join(', ')}].</span>`;
        }
        if (failedRename.length > 0) {
            summaryMsg += `\n⚠️ Lỗi Đổi Tên (Bỏ qua): Prompt số [${failedRename.join(', ')}] -> Hãy tự đổi tên thủ công các file này.`;
            htmlSummary += `<br><span style="color: #fbbf24;">⚠️ Lỗi Đổi Tên (Bỏ qua): Prompt số [${failedRename.join(', ')}] -> Hãy tự đổi tên thủ công các file này.</span>`;
        }
        if (failedDownload.length > 0 && (state.settings.autoDownload || state.settings.downloadZip)) {
            summaryMsg += `\n📥 Lỗi Tải Xuống (Bỏ qua): Prompt số [${failedDownload.join(', ')}].`;
            htmlSummary += `<br><span style="color: #3b82f6;">📥 Lỗi Tải Xuống (Bỏ qua): Prompt số [${failedDownload.join(', ')}].</span>`;
        }

        state.isRunning = false;
        addLog('success', summaryMsg);
        updateUI();
        await saveProject();
        await chrome.storage.local.remove(['activeRunningProject', 'autoResumeProject']);
        chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED', summary: htmlSummary }).catch(() => { });

        // Kích hoạt CheckShutdown (nó sẽ tự xử lý tắt script/PC)
        await checkAutoShutdown();
        return;
    }

    addLog('info', `💤 Idle... waiting for tasks to sync.`);
    await wait(3000);
  }
}

// ==================== PASTE PROMPT ====================
async function pastePrompt(video) {
  try {
    addLog('info', `[${video.promptIndex}] 🔍 Starting paste...`);
    video._pasteTime = Date.now();
    video._sniffStartIndex = window.veoSniffedMediaIds ? window.veoSniffedMediaIds.length : 0;

    // ── UI MODE VALIDATION ──
    const modeBtn = findSettingsDropdownButton();
    if (modeBtn) {
      const btnText = modeBtn.textContent.trim().toLowerCase();
      // Flow's Video mode always contains "video". Image mode (Nano Banana, Imagen) doesn't.
      const isUIVideo = btnText.includes('video');
      
      if (state.settings.runMode === 'video' && !isUIVideo) {
        alert(`🚨 LỖI GIAO DIỆN:\n\nBạn đang chọn chế độ [Treo Video] trên Extension.\nNhưng Web của Google lại đang là [${modeBtn.textContent.trim()}].\n\nBot đã dừng! Vui lòng nhấp vào chữ [${modeBtn.textContent.trim()}] trên web và đổi thành thẻ [Video] trước khi chạy tiếp.`);
        state.isRunning = false;
        chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED' }).catch(() => {});
        throw new Error(`Bot tự động dừng: Sai chế độ giao diện (Yêu cầu Video).`);
      }
      if (state.settings.runMode === 'image' && isUIVideo) {
        alert(`🚨 LỖI GIAO DIỆN:\n\nBạn đang chọn chế độ [Treo Ảnh] trên Extension.\nNhưng Web của Google lại đang là [${modeBtn.textContent.trim()}].\n\nBot đã dừng! Vui lòng nhấp vào chữ [${modeBtn.textContent.trim()}] trên web và đổi thành thẻ Tạo Ảnh (ví dụ: Nano Banana Pro) trước khi chạy tiếp.`);
        state.isRunning = false;
        chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED' }).catch(() => {});
        throw new Error(`Bot tự động dừng: Sai chế độ giao diện (Yêu cầu Ảnh).`);
      }
    }

    // Clear stale state from previous attempt so UI shows fresh/retrying state
    video.error = null;
    video.subVideos = [];         // clears old pills
    video.cardElement = null;
    video.cardElements = [];      // legacy compat
    video.trackedTileIds = [];    // clear old tile IDs
    // KEEP video.promptId — it persists across retries for DOM locking
    video._preClickTileIds = null;
    video._groupContainer = null; // clear old group container reference
    video.progress = 0;
    video.status = STATUS.WAITING;
    updateUI();

    // ── STEP 1: Find the prompt textarea ──
    const textarea = findPromptTextarea();
    if (!textarea) {
      addLog('error', `[${video.promptIndex}] ❌ Textarea not found!`);
      throw new Error('Textarea not found');
    }
    addLog('info', `[${video.promptIndex}] ✅ Found textarea`);

    // ── PRE-STEP: Parse @Characters ──
    // FIX: Always use original prompt from state.prompts so retries don't lose the @ tags
    let originalPrompt = state.prompts && state.prompts[video.promptIndex - 1] ? state.prompts[video.promptIndex - 1] : (video._originalPrompt || video.promptText);
    video._originalPrompt = originalPrompt;
    let textToPaste = originalPrompt;
    let requiredChars = [];
    
    if (state.settings.keyframeSync) {
        // Detect new format: (@start, @end, ...) at the beginning of the prompt. Ignore any extra tags inside ()
        const match = originalPrompt.match(/^\s*\(\s*@?([\p{L}\p{N}_-]+)\s*,\s*@?([\p{L}\p{N}_-]+)[^\)]*\)\s*([\s\S]*)/u);
        if (match) {
            requiredChars = [match[1], match[2]];
            textToPaste = match[3]; // The actual prompt text without the tags
        } else {
            // Fallback to old format: @start ... @end anywhere in text. Only take max 2.
            const matches = Array.from(originalPrompt.matchAll(/@([\p{L}\p{N}_-]+)/gu));
            requiredChars = [...new Set(matches.map(m => m[1]))].slice(0, 2);
            
            requiredChars.forEach(char => {
                textToPaste = textToPaste.replace(new RegExp(`@${char}(?![\\p{L}\\p{N}_-])`, 'gu'), char);
            });
        }
        
        if (requiredChars.length < 2) {
            addLog('error', `[${video.promptIndex}] ❌ Lỗi Khung hình: Bạn cần dùng cú pháp (@bắt_đầu, @kết_thúc) ở đầu Prompt!`);
        }
        
        video.promptText = textToPaste;
    } else if (state.settings.charSync) {
        // Extract all @Names matching letters, numbers, and underscores (including unicode for VI like @Văn)
        const matches = Array.from(originalPrompt.matchAll(/@([\p{L}\p{N}_]+)/gu));
        requiredChars = [...new Set(matches.map(m => m[1]))];
        
        if (requiredChars.length === 0) {
            addLog('info', `[${video.promptIndex}] ℹ️ Prompt không có tag @Tên, bỏ qua bước gắn nhân vật.`);
        }

        // Clean the prompt text by removing the @ but keeping the name
        textToPaste = originalPrompt.replace(/@([\p{L}\p{N}_]+)/gu, '$1'); 
        
        // CẬP NHẬT LẠI PROMPT TEXT GỐC ĐỂ VÒNG LẶP THEO DÕI (monitorCards) CÓ THỂ ĐỌC ĐÚNG CHỮ
        video.promptText = textToPaste;
    }

    if (state.settings.addIndex) {
      const displayIndex = getPromptIndexNumber(video.promptIndex);
      textToPaste = `${displayIndex}. ${textToPaste}`;
    }
    video.pastedPromptText = textToPaste;

    
    // Helper to safely switch tabs in popup and return the search input
    const switchToTabAndGetSearchInput = async (tabWords, waitFunc) => {
        const findSearchInput = async () => {
            const searchWords = ['tìm kiếm', 'search', '검색', '検索', '搜索', '搜尋', 'rechercher', 'buscar', 'поиск'];
            for (let i = 0; i < 30; i++) {
                const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
                const searchInput = inputs.find(input => {
                    if (!input.offsetParent) return false;
                    const p = (input.placeholder || '').toLowerCase();
                    const a = (input.getAttribute('aria-label') || '').toLowerCase();
                    return searchWords.some(w => p.includes(w) || a.includes(w));
                });
                if (searchInput) return searchInput;
                await waitFunc(100);
            }
            return null;
        };

        let searchInput = await findSearchInput();
        if (!searchInput) return null; // popup didn't open or search not found

        const allElements = Array.from(document.querySelectorAll('*')).reverse();
        let targetTab = null;
        for (const el of allElements) {
            if (!el.offsetParent) continue;
            for (const child of el.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    const txt = (child.textContent || '').trim().toLowerCase();
                    if (tabWords.includes(txt)) {
                        const clickable = el.closest('button, div[role="menuitem"], div[role="tab"], li, a, mat-list-item, [role="tab"]');
                        if (clickable) {
                            targetTab = clickable;
                            break;
                        }
                    }
                }
            }
            if (targetTab) break;
        }

        if (targetTab) {
            // Check if already selected
            const isSelected = targetTab.getAttribute('aria-selected') === 'true' || targetTab.classList.contains('selected') || targetTab.classList.contains('active');
            if (!isSelected) {
                targetTab.scrollIntoView({ behavior: 'smooth', block: 'center' });
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                    targetTab.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
                });
                targetTab.click();
                await waitFunc(800);
                searchInput = await findSearchInput(); // re-find after tab switch
            }
        }
        return searchInput;
    };

    // ── STEP 1.5: Character/Reference Image Selection ──
    if (state.settings.charSync && !state.settings.keyframeSync && requiredChars.length > 0) {
      try {
        for (let charName of requiredChars) {
          const addBtnRaw = document.querySelector('.add-menu-trigger, .add-menu-icon, flow-add-menu button, mat-icon.add-menu-icon');
          const addBtn = addBtnRaw 
              ? (addBtnRaw.closest('button, [role="button"], flow-add-menu') || addBtnRaw)
              : Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]')).find(b => 
                  b.classList.contains('add-menu-trigger') || 
                  (b.querySelector('mat-icon, i.google-symbols')?.textContent || '').trim() === 'add' || 
                  (b.querySelector('i.google-symbols')?.textContent || '').includes('add_2') ||
                  b.textContent.trim() === 'add'
              );
          
          if (!addBtn) throw new Error("Không tìm thấy nút dấu [+] trên giao diện");
          
          addLog('info', `[${video.promptIndex}] 🧑 Tìm nhân vật: ${charName}...`);
          addBtn.click();
          
          // Wait up to 2 seconds for the popup menu to render
          let menuRendered = false;
          for (let i = 0; i < 20; i++) {
              await wait(100);
              if (document.querySelector('input[type="text"], input[type="search"], button, [role="menuitem"]')) {
                  menuRendered = true;
                  break;
              }
          }

          // Switch to "Hình ảnh" (Images) Tab to find characters securely
          const allTabs = Array.from(document.querySelectorAll('.add-menu-popover-container [role="tab"], .cdk-overlay-container [role="tab"], mat-list-item[role="tab"]'));
          const imageTab = allTabs.find(t => {
              const icon = t.querySelector('mat-icon, i.google-symbols');
              return icon && icon.textContent.trim() === 'image';
          });
          const charTab = allTabs.find(t => {
              const icon = t.querySelector('mat-icon, i.google-symbols');
              return icon && icon.textContent.trim() === 'accessibility_new';
          });
          
          const forceClickTab = (el, isMenuTab = false) => {
              if (!el) return;
              if (isMenuTab) {
                  const isSelected = el.getAttribute('aria-selected') === 'true' || el.classList.contains('selected') || el.classList.contains('active');
                  if (isSelected) return;
              }
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
              });
              el.click();
          };

          if (imageTab) {
              forceClickTab(imageTab, true);
              await wait(800);
          }

          // Find input search robustly (wait up to 3 seconds)
          let searchInput = null;
          const searchWords = ['tìm kiếm', 'search', '검색', '検索', '搜索', '搜尋', 'rechercher', 'buscar', 'поиск'];
          for (let i = 0; i < 30; i++) {
              const inputs = Array.from(document.querySelectorAll('.add-menu-popover-container input.search-input, .cdk-overlay-container input.search-input, .add-menu-popover-container input[type="text"], .add-menu-popover-container input[type="search"], .cdk-overlay-container input[type="text"]'));
              searchInput = inputs.find(input => {
                  if (!input.offsetParent) return false;
                  if (input.classList.contains('search-input')) return true;
                  const p = (input.placeholder || '').toLowerCase();
                  const a = (input.getAttribute('aria-label') || '').toLowerCase();
                  return searchWords.some(w => p.includes(w) || a.includes(w));
              });
              
              if (searchInput) break;
              await wait(100);
          }

          if (searchInput) {
              await setNativeValue(searchInput, charName);
              await wait(1500); // wait for filter to apply (increased to 1.5s for slower machines)
              
              let charItems = Array.from(document.querySelectorAll('button.asset-item, div.asset-item-container, div[data-item-index]'));
              
              // Fallback to "Nhân vật" tab if no results in "Hình ảnh"
              if (charItems.length === 0 && charTab) {
                  addLog('info', `[${video.promptIndex}] 🧑 Không thấy ảnh, thử tìm trong tab Nhân vật...`);
                  forceClickTab(charTab);
                  await wait(800);
                  await setNativeValue(searchInput, charName); // Ensure search is still applied
                  await wait(1500);
                  charItems = Array.from(document.querySelectorAll('button.asset-item, div.asset-item-container, div[data-item-index]'));
              }

              if (charItems.length > 0) {
                  let targetItem = null;
                  const cleanCharName = charName.toLowerCase().replace(/\.(jpeg|jpg|png|webp|mp4|mov|gif)/gi, '').trim();

                  for (const item of charItems) {
                      let textToUse = item.innerText || item.textContent || "";
                      // Remove all known metadata text that appears on the card in 9 languages
                      const cleanText = textToUse.toLowerCase().replace(/(check_circle|check|done|movie|image|hình ảnh|nhân vật|video|캐릭터|이미지|동영상|画像|キャラクター|動画|图片|图像|角色|视频|圖片|影片|personnage|vidéo|personaje|vídeo|персонаж|изображение)/gi, '').replace(/\.(jpeg|jpg|png|webp|mp4|mov|gif)/gi, '').trim();
                      if (cleanText === cleanCharName) {
                          targetItem = item;
                          break;
                      }
                  }

                  if (!targetItem) {
                      addLog('warning', `⚠️ Không tìm thấy ảnh khớp 100% với tên: ${charName}. Tự động chọn ảnh đầu tiên tìm được.`);
                      targetItem = charItems[0];
                  }

                  let isSelected = targetItem.getAttribute('aria-selected') === 'true' || targetItem.getAttribute('aria-checked') === 'true';
                  const icon = targetItem.querySelector('i.google-symbols');
                  if (icon && (icon.textContent.includes('check') || icon.textContent.includes('done'))) {
                      isSelected = true;
                  }

                  const enterEventDict = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
                  const forceClickItem = (el) => {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      const clickable = el.querySelector('[role="button"], [role="checkbox"], button, div') || el;
                      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                          clickable.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
                      });
                      clickable.click();
                  };

                  if (isSelected) {
                      forceClickItem(targetItem); // click once to deselect if somehow selected but we need to trigger state? Actually just leave it or toggle it.
                      await wait(400);
                  }
                  
                  // ALWAYS use force click directly on the item, rather than pressing Enter on the search box
                  forceClickItem(targetItem);
                  await wait(400);
                  // Ensure it registers by dispatching Enter on it as well
                  targetItem.focus();
                  targetItem.dispatchEvent(new KeyboardEvent('keydown', enterEventDict));
                  targetItem.dispatchEvent(new KeyboardEvent('keypress', enterEventDict));
                  targetItem.dispatchEvent(new KeyboardEvent('keyup', enterEventDict));
                  await wait(400);



                  // CẦN CLICK VÀO NÚT "Thêm vào câu lệnh"
                  const addBtns = Array.from(document.querySelectorAll('.add-menu-popover-container button.detail-add-to-prompt-btn, .cdk-overlay-container button.detail-add-to-prompt-btn, .add-menu-popover-container button, .cdk-overlay-container button')).filter(b => {
                      if (b.classList.contains('detail-add-to-prompt-btn')) return true;
                      const txt = b.textContent.trim().toLowerCase();
                      return txt.includes('thêm vào câu lệnh') || txt.includes('add to prompt') || txt === 'thêm';
                  });
                  if (addBtns.length > 0) {
                      addBtns[addBtns.length - 1].click();
                  } else {
                      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                  }
                  
                  addLog('success', `[${video.promptIndex}] 🧑 Đã đính kèm ảnh: ${charName}`);
                  await wait(800);
              } else {
                  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                  throw new Error(`Kho Flow thiếu ảnh nhân vật: ${charName}`);
              }
          } else {
              addLog('error', `[${video.promptIndex}] ❌ Không tìm thấy ô tìm kiếm (Search Box) trong bảng chọn Nhân vật.`);
              throw new Error("Không tìm thấy ô tìm kiếm Hình ảnh/Nhân vật. Giao diện Flow có thể đã bị thay đổi hoặc đổi ngôn ngữ (do máy chậm hoặc lỗi mạng).");
          }
        }
      } catch (err) {
          addLog('error', `[${video.promptIndex}] ❌ Lỗi Đồng nhất Nhân vật: ${err.message}`);
          throw err; 
      }
    }

    // ── STEP 1.5b: Keyframe Image Selection ──
    if (state.settings.keyframeSync) {
      if (requiredChars.length < 2) {
          addLog('error', `[${video.promptIndex}] ❌ Lỗi Khung hình: Bạn cần gắn thẻ 2 ảnh (@bắt_đầu @kết_thúc) trong Prompt!`);
          throw new Error(`Cần 2 thẻ @ảnh cho chế độ Khung hình`);
      }
      try {
        // Define logic to find the Start/End buttons structurally
        const findKeyframeBtn = async (isStart) => {
            for (let i = 0; i < 50; i++) {
                const swapIcons = Array.from(document.querySelectorAll('mat-icon, i.google-symbols')).filter(i => i.textContent.includes('swap_horiz'));
                if (swapIcons.length > 0) {
                    const swapBtn = swapIcons[0].closest('button, [role="button"]');
                    if (swapBtn && swapBtn.parentElement) {
                        const children = Array.from(swapBtn.parentElement.children);
                        const swapIdx = children.indexOf(swapBtn);
                        if (swapIdx > 0 && swapIdx < children.length - 1) {
                            let targetEl = isStart ? children[swapIdx - 1] : children[swapIdx + 1];
                            const btn = targetEl.tagName === 'BUTTON' ? targetEl : (targetEl.querySelector('button, [role="button"]') || targetEl);
                            if (btn && btn.offsetParent !== null) return btn;
                        }
                    }
                }
                
                // Fallback: look for empty-chip or media-chip directly
                const chips = Array.from(document.querySelectorAll('.keyframe-container > *'));
                if (chips.length >= 3) {
                    let targetEl = isStart ? chips[0] : chips[chips.length - 1];
                    const btn = targetEl.tagName === 'BUTTON' ? targetEl : (targetEl.querySelector('button, [role="button"]') || targetEl);
                    if (btn && btn.offsetParent !== null) return btn;
                }
                
                await wait(100);
            }
            return null;
        };

        const selectImageForBtn = async (btn, imgName) => {
          if (!btn) return;
          addLog('info', `[${video.promptIndex}] 🎞️ Tìm ảnh cho ${btn.textContent.trim()}: ${imgName}...`);
          
          const forceClickTab = (el, isMenuTab = false) => {
              if (!el) return;
              if (isMenuTab) {
                  const isSelected = el.getAttribute('aria-selected') === 'true' || el.classList.contains('selected') || el.classList.contains('active');
                  if (isSelected) return;
              }
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              const clickable = el.querySelector('button, [role="button"]') || el;
              
              const rect = clickable.getBoundingClientRect();
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              
              ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                  clickable.dispatchEvent(new MouseEvent(type, { 
                      bubbles: true, cancelable: true, view: window, 
                      clientX: cx, clientY: cy, buttons: 1 
                  }));
              });
              
              if (clickable !== el) el.click();
              
              clickable.focus();
              clickable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
              clickable.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          };

          forceClickTab(btn, false);
          await wait(1000); // wait for popup

          // Modal defaults to images, no need to switch tabs
          // Just wait a little extra for the modal to fully render
          await wait(800);

          // Find input search robustly (wait up to 3 seconds)
          let searchInput = null;
          const searchWords = ['tìm kiếm', 'search', '검색', '検索', '搜索', '搜尋', 'rechercher', 'buscar', 'поиск'];
          for (let i = 0; i < 30; i++) {
              const inputs = Array.from(document.querySelectorAll('.add-menu-popover-container input.search-input, .cdk-overlay-container input.search-input, .add-menu-popover-container input[type="text"], .add-menu-popover-container input[type="search"], .cdk-overlay-container input[type="text"]'));
              searchInput = inputs.find(input => {
                  if (!input.offsetParent) return false;
                  if (input.classList.contains('search-input')) return true;
                  const p = (input.placeholder || '').toLowerCase();
                  const a = (input.getAttribute('aria-label') || '').toLowerCase();
                  return searchWords.some(w => p.includes(w) || a.includes(w));
              });
              
              if (searchInput) break;
              await wait(100);
          }

          if (searchInput) {
              await setNativeValue(searchInput, imgName);
              await wait(1500); // wait for filter to apply
              
              let charItems = Array.from(document.querySelectorAll('button.asset-item, div.asset-item-container, div[data-item-index]'));
              
              // Fallback to "Nhân vật" tab if no results in "Hình ảnh"
              if (charItems.length === 0 && charTab) {
                  addLog('info', `[${video.promptIndex}] 🎞️ Không thấy ảnh, thử tìm trong tab Nhân vật...`);
                  forceClickTab(charTab);
                  await wait(800);
                  await setNativeValue(searchInput, imgName);
                  await wait(1500);
                  charItems = Array.from(document.querySelectorAll('button.asset-item, div.asset-item-container, div[data-item-index]'));
              }

              if (charItems.length > 0) {
                  // Find the item with EXACT matching text
                  let targetItem = null;
                  const cleanImgName = imgName.toLowerCase().replace(/\.(jpeg|jpg|png|webp|mp4|mov|gif)/gi, '').trim();

                  for (const item of charItems) {
                      let textToUse = item.innerText || item.textContent || "";
                      const cleanText = textToUse.toLowerCase().replace(/(check_circle|check|done|movie|image|hình ảnh|nhân vật|video|캐릭터|이미지|동영상|画像|キャラクター|動画|图片|图像|角色|视频|圖片|影片|personnage|vidéo|personaje|vídeo|персонаж|изображение)/gi, '').replace(/\.(jpeg|jpg|png|webp|mp4|mov|gif)/gi, '').trim();
                      if (cleanText === cleanImgName) {
                          targetItem = item;
                          break;
                      }
                  }

                  if (!targetItem) {
                      addLog('warning', `⚠️ Không tìm thấy ảnh khớp 100% với tên: ${imgName}. Tự động chọn ảnh đầu tiên tìm được.`);
                      targetItem = charItems[0];
                  }

                  let isSelected = targetItem.getAttribute('aria-selected') === 'true' || targetItem.getAttribute('aria-checked') === 'true';
                  const icon = targetItem.querySelector('i.google-symbols');
                  if (icon && (icon.textContent.includes('check') || icon.textContent.includes('done'))) {
                      isSelected = true;
                  }

                  const enterEventDict = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
                  const forceClickItem = (el) => {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      const clickable = el.querySelector('[role="button"], [role="checkbox"], button, div') || el;
                      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                          clickable.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
                      });
                      clickable.click();
                  };

                  if (isSelected) {
                      forceClickItem(targetItem);
                      await wait(400);
                  }
                  
                  forceClickItem(targetItem);
                  await wait(400);
                  targetItem.focus();
                  targetItem.dispatchEvent(new KeyboardEvent('keydown', enterEventDict));
                  targetItem.dispatchEvent(new KeyboardEvent('keypress', enterEventDict));
                  targetItem.dispatchEvent(new KeyboardEvent('keyup', enterEventDict));
                  await wait(400);

                  // CẦN CLICK VÀO NÚT "Thêm vào câu lệnh"
                  const addBtns = Array.from(document.querySelectorAll('.add-menu-popover-container button.detail-add-to-prompt-btn, .cdk-overlay-container button.detail-add-to-prompt-btn, .add-menu-popover-container button, .cdk-overlay-container button')).filter(b => {
                      if (b.classList.contains('detail-add-to-prompt-btn')) return true;
                      const txt = b.textContent.trim().toLowerCase();
                      const addWords = ['thêm', 'add', '추가', '追加', '添加', '新增', 'ajouter', 'añadir', 'agregar', 'добавить'];
                      return addWords.some(w => txt.includes(w));
                  });
                  if (addBtns.length > 0) {
                      const addBtn = addBtns[addBtns.length - 1];
                      const rect = addBtn.getBoundingClientRect();
                      const cx = rect.left + rect.width / 2;
                      const cy = rect.top + rect.height / 2;
                      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                          addBtn.dispatchEvent(new MouseEvent(type, { 
                              bubbles: true, cancelable: true, view: window, 
                              clientX: cx, clientY: cy, buttons: 1 
                          }));
                      });
                      if (document.activeElement !== addBtn) addBtn.focus();
                      addBtn.click();
                  } else {
                      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                  }
                  
                  addLog('success', `[${video.promptIndex}] 🎞️ Đã đính kèm ảnh: ${imgName}`);
                  await wait(800);
              } else {
                  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                  throw new Error(`Kho Flow thiếu ảnh khung hình: ${imgName}`);
              }
          } else {
              addLog('error', `[${video.promptIndex}] ❌ Không tìm thấy ô tìm kiếm (Search Box) cho Khung hình.`);
              throw new Error("Không tìm thấy ô tìm kiếm Khung hình. Giao diện Flow có thể đã bị thay đổi.");
          }
        };

        if (requiredChars[0]) {
            const currentStartBtn = await findKeyframeBtn(true);
            if (currentStartBtn) {
                await selectImageForBtn(currentStartBtn, requiredChars[0]);
            } else {
                addLog('error', `[${video.promptIndex}] ❌ Không tìm thấy nút Bắt đầu (Start) để click.`);
                throw new Error("Không tìm thấy nút Bắt đầu trên giao diện.");
            }
        }
        
        await wait(1000); // Wait for the first popup to fully close and DOM to re-render

        if (requiredChars[1]) {
            // Re-fetch endBtn because the DOM re-renders after the first image is selected
            const currentEndBtn = await findKeyframeBtn(false);
            if (currentEndBtn) {
                await selectImageForBtn(currentEndBtn, requiredChars[1]);
            } else {
                addLog('error', `[${video.promptIndex}] ❌ Không tìm thấy nút Kết thúc (End) để click.`);
                throw new Error("Không tìm thấy nút Kết thúc trên giao diện.");
            }
        }
      } catch (err) {
          addLog('error', `[${video.promptIndex}] ❌ Lỗi Khung hình: ${err.message}`);
          throw err; 
      }
    }

    // ── STEP 1.6: Voice Selection ──
    if (state.settings.runMode !== 'image' && state.settings.voiceSync && state.settings.voiceSelect && !state.settings.keyframeSync) {
      try {
          const addBtnRaw = document.querySelector('.add-menu-trigger, .add-menu-icon, flow-add-menu button, mat-icon.add-menu-icon');
          const addBtn = addBtnRaw 
              ? (addBtnRaw.closest('button, [role="button"], flow-add-menu') || addBtnRaw)
              : Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]')).find(b => 
                  b.classList.contains('add-menu-trigger') || 
                  (b.querySelector('mat-icon, i.google-symbols')?.textContent || '').trim() === 'add' || 
                  (b.querySelector('i.google-symbols')?.textContent || '').includes('add_2') ||
                  b.textContent.trim() === 'add'
              );
          
          if (!addBtn) throw new Error("Không tìm thấy nút dấu [+] trên giao diện");
          
          addLog('info', `[${video.promptIndex}] 🎙️ Tìm giọng nói: ${state.settings.voiceSelect}...`);
          addBtn.click();
          await wait(1000); // wait for popup

          // Switch to Voice Tab
          const allTabs = Array.from(document.querySelectorAll('.add-menu-popover-container [role="tab"], .cdk-overlay-container [role="tab"], mat-list-item[role="tab"]'));
          const voiceTab = allTabs.find(t => {
              const icon = t.querySelector('mat-icon, i.google-symbols');
              return icon && icon.textContent.trim() === 'voice_selection';
          }) || allTabs[3]; // Fallback to index 3 if icon not found

          if (voiceTab) {
              const forceClickTab = (el, isMenuTab = false) => {
                  if (!el) return;
                  if (isMenuTab) {
                      const isSelected = el.getAttribute('aria-selected') === 'true' || el.classList.contains('selected') || el.classList.contains('active');
                      if (isSelected) return;
                  }
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
                  });
                  el.click();
              };
              forceClickTab(voiceTab, true);
              await wait(800);
          }

          // Find input search
          let searchInput = null;
          const searchWords = ['tìm kiếm', 'search', '검색', '検索', '搜索', '搜尋', 'rechercher', 'buscar', 'поиск'];
          for (let i = 0; i < 30; i++) {
              const inputs = Array.from(document.querySelectorAll('.add-menu-popover-container input.search-input, .cdk-overlay-container input.search-input, .add-menu-popover-container input[type="text"], .add-menu-popover-container input[type="search"], .cdk-overlay-container input[type="text"]'));
              searchInput = inputs.find(input => {
                  if (!input.offsetParent) return false;
                  if (input.classList.contains('search-input')) return true;
                  const p = (input.placeholder || '').toLowerCase();
                  const a = (input.getAttribute('aria-label') || '').toLowerCase();
                  return searchWords.some(w => p.includes(w) || a.includes(w));
              });
              if (searchInput) break;
              await wait(100);
          }

          if (searchInput) {
              await setNativeValue(searchInput, state.settings.voiceSelect);
              await wait(1500); // wait for filter to apply
              
              const voiceItems = Array.from(document.querySelectorAll('button.asset-item, div.asset-item-container, div[data-item-index]'));
              if (voiceItems.length > 0) {
                  const forceClickItem = (el) => {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      const clickable = el.querySelector('[role="button"], [role="checkbox"], button, div') || el;
                      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                          clickable.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
                      });
                      clickable.click();
                  };
                                    // Phục hồi lại cơ chế hoạt động hoàn hảo của bản 1.4.7: Enter ngay trên ô Search để auto-select
                  const enterEventDict = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
                  searchInput.focus();
                  searchInput.dispatchEvent(new KeyboardEvent('keydown', enterEventDict));
                  searchInput.dispatchEvent(new KeyboardEvent('keypress', enterEventDict));
                  searchInput.dispatchEvent(new KeyboardEvent('keyup', enterEventDict));
                  
                  await wait(500);
                  
                  // Ngoài ra click phòng hờ vào item
                  forceClickItem(voiceItems[0]);
                  await wait(500);

                  addLog('success', `[${video.promptIndex}] 🎙️ Đã chọn giọng: ${state.settings.voiceSelect}`);
                  await wait(800); 
                  
                  // CẦN CLICK VÀO NÚT "Thêm vào câu lệnh" cho Voice (nếu có)
                  const addBtns = Array.from(document.querySelectorAll('.add-menu-popover-container button.detail-add-to-prompt-btn, .cdk-overlay-container button.detail-add-to-prompt-btn, .add-menu-popover-container button, .cdk-overlay-container button')).filter(b => {
                      if (b.classList.contains('detail-add-to-prompt-btn')) return true;
                      const txt = b.textContent.trim().toLowerCase();
                      return txt.includes('thêm vào câu lệnh') || txt.includes('add to prompt') || txt === 'thêm';
                  });
                  if (addBtns.length > 0) {
                      addBtns[addBtns.length - 1].click();
                  } else {
                      // Nhấn Escape để đóng bảng chọn giọng nói (Google tự động lưu khi bấm Escape nếu không có nút thêm)
                      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                  }
                  await wait(500);
              } else {
                  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                  throw new Error(`Kho Flow thiếu giọng nói: ${state.settings.voiceSelect}`);
              }
          } else {
              addLog('error', `[${video.promptIndex}] ❌ Không tìm thấy ô tìm kiếm (Search Box) cho Giọng nói.`);
              throw new Error("Không tìm thấy ô tìm kiếm Giọng nói. Giao diện Flow có thể đã bị thay đổi.");
          }
      } catch (err) {
          addLog('error', `[${video.promptIndex}] ❌ Lỗi Chọn Giọng nói: ${err.message}`);
          throw err;
      }
    }

    // ── STEP 2: Paste text using execCommand insertText ──
    // Note: User should set their preferred settings (Video mode, aspect, count)
    // ONCE manually on Flow. Extension keeps those settings as-is.
    await setNativeValue(textarea, textToPaste);
    await wait(500);
    // Force Angular/ProseMirror to detect the change and enable the Create button
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    await wait(300);

    // ── STEP 3: Verify paste ──
    const zeroWidthAfter = textarea.querySelector('[data-slate-zero-width]');
    if (zeroWidthAfter) {
      addLog('warning', `[${video.promptIndex}] ⚠️ Zero-width still present - Slate may not have accepted text`);
      // Don't throw - continue and try to click Create anyway
    } else {
      addLog('info', `[${video.promptIndex}] 📝 Paste verified by Slate ✅`);
    }


    // ── STEP 5: Find and click Create button ──
    // Editor is still focused from paste step (we did NOT blur)
    const createBtn = findCreateButton();
    if (!createBtn) {
      addLog('error', `[${video.promptIndex}] ❌ Create button not found!`);
      throw new Error('Create button not found');
    }
    
    // Đột phá: Ép nút Create bật lên (trường hợp Angular không tự nhận diện được chữ trong ProseMirror)
    createBtn.disabled = false;
    createBtn.removeAttribute('disabled');
    createBtn.classList.remove('mat-mdc-button-disabled');
    
    addLog('info', `[${video.promptIndex}] ✅ Found create button`);

    // Snapshot TOP TILES before clicking Create.
    // New generations always appear at the top of the grid.
    // We only need to monitor the first few tiles to find the new IDs.
    // This is immune to lazy-rendered history at the bottom.
    video._preClickTopIds = new Set(
        getOuterTiles().slice(0, 10).map(t => t.getAttribute('data-tile-id'))
    );
    // ── Snapshot Grid Containers before click ──
    // This is the MOST ROBUST way to track batches. We snapshot all existing grid containers.
    // When a new one appears, we tag it with our promptId so monitorCards never mixes them up.
    const getGridContainers = () => Array.from(document.querySelectorAll('.batch-tiles-section, flow-grid-tile-container'));
    video._preClickGrids = new Set(getGridContainers());
    // ANTI-FALSE-POSITIVE: Save text fingerprints of ALL existing grids.
    // These persist even when DOM elements are recycled by virtual scroll.
    // monitorCards text matching will skip any grid whose fingerprint matches this snapshot.
    video._preClickGridSnapshot = new Set(
        getGridContainers().map(gc => gc.textContent.substring(0, 200))
    );
    // ── Also snapshot image count for IMAGE MODE (Nano Banana) detection ──
    video._preClickImageCount = document.querySelectorAll('[data-tile-id] img, a[href*="/edit/"] img').length;
    // ── Click Create via MAIN world injection ──
    // Isolated world clicks are ignored by React. Route through background.js.
    addLog('info', `[${video.promptIndex}] 🖱️ Clicking Create via MAIN world...`);
    const clickResult = await chrome.runtime.sendMessage({
      action: 'INJECT_CLICK_CREATE',
      data: { tabId: null }
    });

    if (!clickResult || !clickResult.ok) {
      addLog('warning', `[${video.promptIndex}] ⚠️ INJECT_CLICK_CREATE issue: ${clickResult?.error || 'unknown'}`);
      // Fall back to direct click as last resort
      createBtn.click();
    } else {
      addLog('info', `[${video.promptIndex}] 🖱️ Create clicked (wasDisabled: ${clickResult.wasDisabled})`);
    }

    // ── STEP 6: Verify Create was accepted (Dynamic Polling) ──
    // Strategy 1: New video tile appeared (data-tile-id) → Video mode
    // Strategy 2: Textarea was cleared by Flow after submit → any mode
    // Strategy 3: New image count increased → Image mode
    let clickAccepted = false;
    let hasNewVideoTile = false;
    let textareaCleared = false;
    let hasNewImageCard = false;
    let currentText = "";
    let isInDOM = false;

    const cleanPrompt = video.promptText.substring(0, 150).replace(/\s+/g, ' ').toLowerCase();

    // Poll up to 10 seconds (10 x 1s) to allow slow networks to process the click
    for (let check = 0; check < 10; check++) {
        await wait(1000);

        const currentTopIds = getOuterTiles().slice(0, 10).map(t => t.getAttribute('data-tile-id'));
        hasNewVideoTile = currentTopIds.some(id => id && !video._preClickTopIds.has(id));

        const freshTextarea = findPromptTextarea() || textarea;
        isInDOM = document.body.contains(freshTextarea);
        currentText = (isInDOM ? freshTextarea : textarea).textContent.replace(/\uFEFF/g, '').trim();
        
        // NEW UI Fix: The placeholder 'Bạn muốn tạo những gì?' or 'What do you want to create?' is inside the textContent!
        // We consider it cleared if it's empty, <= 2 chars, or matches known placeholders.
        textareaCleared = currentText.length <= 2 || 
                          currentText.includes('Bạn muốn tạo những gì') || 
                          currentText.includes('What do you want to create');

        const preClickImageCount = video._preClickImageCount || 0;
        const currentImageCount = document.querySelectorAll('img, a[href*="/edit/"] img').length; // Removed [data-tile-id] to work with new UI
        hasNewImageCard = currentImageCount > preClickImageCount;

        // ── THE ULTIMATE CHECK: Did a NEW grid container appear? ──
        const currentGrids = getGridContainers();
        const newGrids = currentGrids.filter(g => !video._preClickGrids.has(g));
        
        let hasNewBatch = false;
        let hasNewPendingTile = false;

        if (newGrids.length > 0) {
            // STAMP IT! This permanently links this grid container to our promptId.
            // monitorCards will instantly pick this up.
            newGrids[0].setAttribute('data-fe-grid-id', video.promptId);
            hasNewBatch = true;
            addLog('success', `[${video.promptIndex}] 🎯 Successfully stamped new grid with ID ${video.promptId}`);
        } else {
            // Fallback: Text matching (Risky if prompts are very similar!)
            hasNewBatch = Array.from(document.querySelectorAll('.batch-tiles-section .subtitle, .batch-tiles-section .text-part')).some(el => {
                return (el.textContent || '').replace(/\s+/g, ' ').toLowerCase().includes(cleanPrompt);
            });
            hasNewPendingTile = !hasNewBatch && Array.from(document.querySelectorAll('flow-pending-tile .subtitle')).some(el => {
                return (el.textContent || '').replace(/\s+/g, ' ').toLowerCase().includes(cleanPrompt);
            });
        }

        if (hasNewVideoTile || textareaCleared || (state.settings.runMode === 'image' && hasNewImageCard) || hasNewBatch || hasNewPendingTile) {
            clickAccepted = true;
            break;
        }
    }

    // Diagnostic log to see exactly which check triggered
    addLog('info', `[${video.promptIndex}] 🔎 Verify: newTile=${hasNewVideoTile}, txtCleared=${textareaCleared}(len=${currentText.length}), newImg=${hasNewImageCard}, newBatch=${clickAccepted && !hasNewVideoTile && !textareaCleared && !hasNewImageCard}, inDOM=${isInDOM}`);

    // Nếu chưa có thẻ mới XUẤT HIỆN, VÀ chữ vẫn còn nguyên trong khung -> Mới được phép Click Lại
    if (!clickAccepted) {
      addLog('warning', `[${video.promptIndex}] ⚠️ Cú click Tạo bị kẹt, đang thử khôi phục...`);

      // ── PHASE A: Re-focus browser tab (user may have been typing in another app) ──
      try { window.focus(); } catch(e) {}
      await wait(500);

      // ── PHASE B: Verify textarea still has OUR prompt ──
      const freshTextarea = findPromptTextarea() || textarea;
      freshTextarea.focus();
      await wait(300);
      
      const currentContent = (document.body.contains(freshTextarea) ? freshTextarea : textarea)
          .textContent.replace(/\uFEFF/g, '').trim();
      const ourPromptSnippet = video.promptText.substring(0, 50).replace(/\s+/g, ' ').trim();
      const textareaHasOurPrompt = currentContent.includes(ourPromptSnippet);
      
      // ── PHASE C: If textarea is empty or corrupted, RE-PASTE our prompt ──
      if (!textareaHasOurPrompt && currentContent.length <= 5) {
          addLog('warning', `[${video.promptIndex}] ⚠️ Textarea trống/sai. Re-paste prompt...`);
          try {
              freshTextarea.focus();
              // Select all and delete existing content
              document.execCommand('selectAll', false, null);
              document.execCommand('delete', false, null);
              await wait(200);
              // Re-paste original prompt
              await setNativeValue(freshTextarea, textToPaste);
              await wait(500);
              freshTextarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              freshTextarea.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
              freshTextarea.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
              await wait(300);
              addLog('info', `[${video.promptIndex}] ✅ Re-paste thành công`);
          } catch(e) {
              addLog('error', `[${video.promptIndex}] ❌ Re-paste thất bại: ${e.message}`);
          }
      } else if (textareaHasOurPrompt) {
          addLog('info', `[${video.promptIndex}] ✅ Textarea vẫn chứa đúng prompt gốc, chỉ cần click lại`);
          // Wake up React state by typing a space
          try {
              freshTextarea.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
              document.execCommand('insertText', false, ' ');
              freshTextarea.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
              freshTextarea.dispatchEvent(new Event('input', { bubbles: true }));
              await wait(500);
          } catch(e) {}
      }

      // ── PHASE D: Re-enable Create button and click again ──
      const retryBtn = findCreateButton();
      if (retryBtn) {
          retryBtn.disabled = false;
          retryBtn.removeAttribute('disabled');
          retryBtn.classList.remove('mat-mdc-button-disabled');
      }

      addLog('info', `[${video.promptIndex}] 🖱️ Retry: Clicking Create lần 2...`);
      const clickResult2 = await chrome.runtime.sendMessage({
        action: 'INJECT_CLICK_CREATE',
        data: { tabId: null }
      });
      await wait(2000);

      const finalTopIds = getOuterTiles().slice(0, 10).map(t => t.getAttribute('data-tile-id'));
      const hasNewTileFinal = finalTopIds.some(id => id && !video._preClickTopIds.has(id));
      const freshTextarea2 = findPromptTextarea() || textarea;
      currentText = (document.body.contains(freshTextarea2) ? freshTextarea2 : textarea).textContent.replace(/\uFEFF/g, '').trim();
      const textareaCleared2 = currentText.length <= 2 || 
                                currentText.includes('Bạn muốn tạo những gì') || 
                                currentText.includes('What do you want to create');
      const currentImageCount2 = document.querySelectorAll('img, a[href*="/edit/"] img').length;
      const hasNewImageCard2 = currentImageCount2 > (video._preClickImageCount || 0);
      const hasNewBatchFinal = Array.from(document.querySelectorAll('.batch-tiles-section .subtitle, flow-pending-tile .subtitle, flow-pending-tile')).some(el => {
          return (el.textContent || '').replace(/\s+/g, ' ').toLowerCase().includes(cleanPrompt);
      });

      addLog('info', `[${video.promptIndex}] 🔎 Retry verify: newTile=${hasNewTileFinal}, txtCleared=${textareaCleared2}(len=${currentText.length}), newImg=${hasNewImageCard2}`);

      if (state.settings.runMode !== 'image' && !hasNewTileFinal && !textareaCleared2 && !hasNewImageCard2 && !hasNewBatchFinal && currentText.length > 5) {
        throw new Error('Nút Tạo không nhận lệnh sau 2 lần bấm (có thể do lỗi Giao diện hoặc nội dung cấm)');
      }
    }

    // ── STEP 7: Mark as creating — tile discovery happens in monitorCards ──
    // We purposely do NOT search for tile IDs here. monitorCards runs every 2s
    // and will discover tiles as they appear, handling staggered rendering and
    // div→<a> transitions without any timing race conditions.
    video._expectedVideoCount = getExpectedVideoCount();
    addLog('info', `[${video.promptIndex}] ✅ Create accepted — monitoring for ${video._expectedVideoCount} tiles...`);

    // ── Success ──
    video.status = STATUS.CREATING;
    video.sessionStarted = PAGE_SESSION_ID;
    video._createStartTime = Date.now();
    video._lastProgress = 0;
    video._lastProgressTime = Date.now();
    // CRITICAL FIX: Do NOT increment retries on success!
    updateUI();
    saveProject();

    // ── CRITICAL: Scroll to TOP to keep new grid in viewport ──
    // Prevents virtual scroll from unmounting the newly stamped grid.
    // Without this, user scrolling can cause data-fe-grid-id stamp to be lost.
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const scrollContainers = [
        document.querySelector('c-wiz[data-is-scrollable="true"]'),
        document.querySelector('[role="main"]')
    ];
    for (const sc of scrollContainers) {
        if (sc && typeof sc.scrollTo === 'function') sc.scrollTo({ top: 0, behavior: 'smooth' });
        else if (sc) sc.scrollTop = 0;
    }
    await wait(800);
  } catch (error) {
    video.status = STATUS.ERROR;
    video.error = error.message;
    video._pasteTime = null;
    addLog('error', `[${video.promptIndex}] ${error.message}`);
    updateUI();
  } finally {
    releaseUILock();
  }
}

// UI LOCK is defined at top of file

// ==================== GROUP STATUS AGGREGATOR ====================
// Reads status from EACH individual card in video.cardElements[]
// and aggregates into a single status object for the whole prompt.
function getGroupStatus(video) {
  const elements = (video.cardElements && video.cardElements.length > 0)
    ? video.cardElements.filter(el => document.body.contains(el))
    : (video.cardElement && document.body.contains(video.cardElement) ? [video.cardElement] : []);

  if (elements.length === 0) {
    return { status: 'CREATING', progress: video.progress || 2, videos: [], error: null };
  }

  // Get status from EACH individual card slot
  const perSlot = elements.map((el, i) => {
    const s = getCardStatus(el, video.promptText);
    // If getCardStatus returned no sub-videos, synthesize one from top-level
    const videos = s.videos && s.videos.length > 0
      ? s.videos
      : [{ id: i, status: s.status, progress: s.progress || 0 }];
    return { status: s.status, progress: s.progress || 0, videos, error: s.error };
  });

  const allSlotStatuses = perSlot.flatMap(s => s.videos);
  
  const allDone = allSlotStatuses.every(v => v.status === 'COMPLETED');
  const allError = allSlotStatuses.every(v => v.status === 'ERROR');
  const anyDone = allSlotStatuses.some(v => v.status === 'COMPLETED');
  const allFinished = allSlotStatuses.every(v => v.status === 'COMPLETED' || v.status === 'ERROR');
  const anyQueued = allSlotStatuses.some(v => v.status === 'QUEUED');

  let finalStatus = 'CREATING';
  if (allError) {
    finalStatus = 'ERROR';
  } else if (anyDone && allFinished) {
    // Nếu ít nhất 1 video đã thành công và số còn lại đã xong/lỗi -> Bỏ qua lỗi, báo Thành công chung
    finalStatus = 'COMPLETED';
  } else if (allDone) {
    finalStatus = 'COMPLETED';
  } else if (anyQueued) {
    finalStatus = 'QUEUED';
  }

  const avgProgress = Math.round(
    allSlotStatuses.reduce((sum, v) => sum + (v.progress || 0), 0) / (allSlotStatuses.length || 1)
  );

  return {
    status: finalStatus,
    progress: avgProgress,
    videos: allSlotStatuses,
    error: allError ? (perSlot.find(p => p.error)?.error || 'Lỗi toàn bộ Video') : null
  };
}

function recoverLostTiles(video) {
  // Filter out tiles claimed by OTHER active/completed videos from this session
  const allClaimedIds = new Set(
      state.videos.filter(v => v !== video).flatMap(v => v.trackedTileIds || [])
  );

  let foundCard = null;
  if (state.settings.addIndex) {
      const displayIndex = getPromptIndexNumber(video.promptIndex);
      const indexedPrompt = `${displayIndex}. ${video.promptText.replace(/^\d+[\.\)]\s*/, '')}`;
      foundCard = findNewCardByPrompt(indexedPrompt, true, true, allClaimedIds);
  }
  if (!foundCard) {
      foundCard = findNewCardByPrompt(video.promptText, true, true, allClaimedIds); // Fallback tìm không kèm STT
  }
  if (!foundCard) return [];

  const outermostTile = foundCard.closest('[data-tile-id]');
  if (!outermostTile) return [];

  const group = getGroupContainer(outermostTile);
  let recoveredTiles = [];
  if (group) {
      recoveredTiles = getOuterTilesWithin(group);
  } else {
      recoveredTiles = [outermostTile];
  }

  recoveredTiles = recoveredTiles.filter(t => {
      const id = t.getAttribute('data-tile-id');
      return id && !allClaimedIds.has(id);
  });

  if (recoveredTiles.length > 0) {
      video.trackedTileIds = recoveredTiles.map(t => t.getAttribute('data-tile-id'));
      addLog('success', `[${video.promptIndex}] 🔗 Nối lại luồng sau Reload thành công! (${recoveredTiles.length} thẻ)`);
  }
  return recoveredTiles;
}

// ==================== MONITOR CARDS ====================
let _isMonitoring = false;
async function monitorCards() {
  if (!state.isRunning || _isMonitoring) return;
  _isMonitoring = true;
  
  // FIX: Timeout bảo vệ 30s — nếu monitorCards treo (API call không trả về),
  // buộc reset lock để lần chạy tiếp không bị chặn vĩnh viễn.
  const _monitorTimeout = setTimeout(() => {
      if (_isMonitoring) {
          console.warn('[VEO] monitorCards timeout 30s — force reset lock');
          _isMonitoring = false;
      }
  }, 30000);
  
  try {

  for (const video of state.videos) {
    if (video.status === STATUS.WAITING) continue;
    if (video.status === STATUS.COMPLETED && video.downloaded) continue;

    // ── Tile Discovery: Batch Tracking (New UI) & Positional (Old UI) ──
    const expectedCount = video._expectedVideoCount || getExpectedVideoCount();
    let currentTiles = [];
    let expectedLength = 0;
    
    // NEW UI vs OLD UI Check
    // New Angular UI uses Web Components: flow-tile-container, flow-pending-tile, flow-image-tile, flow-batch-info
    // IMPORTANT: CSS classes like .batch-tiles-section, .subtitle, .loading-percentage may NOT exist at runtime
    // despite appearing in Angular template HTML dumps. We must use tag-based selectors.
    const isNewUI = document.querySelector('flow-tile-container') !== null || document.querySelector('flow-pending-tile') !== null || document.querySelector('.batch-tiles-section') !== null || document.querySelector('flow-grid-tile-container') !== null;
    // Use a longer snippet (120 chars) to prevent mismatch between similar prompts.
    // Strip leading numbers from BOTH the prompt text and the grid text so they can match!
    const cleanPromptRaw = video.promptText.replace(/\s+/g, ' ').trim().toLowerCase();
    const cleanPromptSnippet = cleanPromptRaw.replace(/^\d+[\.\-]?\s*/, '');
    const expectedDisplayIndex = getPromptIndexNumber(video.promptIndex);
    
    if (isNewUI) {
        // --- NEW UI DISCOVERY (Angular Flow 2025) ---
        // TRUTH: EVERY generation job (1 or N images) is wrapped in ONE <flow-grid-tile-container>.
        // The text prompt is inside this grid container.
        // Inside this grid container, the actual cards are either <flow-tile-container> (done) or <flow-pending-tile> (generating).
        
        let matchingGrid = null;
        
        // 1. 🎯 NEW ROBUST CHECK: Try to find the explicitly stamped grid
        // pastePrompt now assigns data-fe-grid-id to the new grid immediately after clicking Create.
        // If we find it, we know with 100% certainty this grid belongs to this prompt.
        if (video.promptId) {
            matchingGrid = document.querySelector(`.batch-tiles-section[data-fe-grid-id="${video.promptId}"], flow-grid-tile-container[data-fe-grid-id="${video.promptId}"]`);
        }

        if (!matchingGrid) {
            // Get all grids and REVERSE them to prefer the NEWEST grid (which Google Flow appends at the bottom).
            // This prevents locking onto an old grid.
            const allGridContainers = Array.from(document.querySelectorAll('.batch-tiles-section')).reverse();
            
            // FIX BUG 3: Exclude grids ONLY by data-fe-grid-id attribute.
            // DO NOT use cardElements (stale DOM references cause false negatives).
            const claimedGrids = new Set();
            for (const v of state.videos) {
                if (v !== video && v.promptId) {
                    const claimed = document.querySelector(`.batch-tiles-section[data-fe-grid-id="${v.promptId}"]`);
                    if (claimed) claimedGrids.add(claimed);
                }
            }

            for (const gc of allGridContainers) {
                if (claimedGrids.has(gc)) continue; // Skip grids claimed by other videos
                
                // If this grid is already explicitly locked to another promptId, skip it
                if (gc.hasAttribute('data-fe-grid-id') && gc.getAttribute('data-fe-grid-id') !== video.promptId) continue;
            
                // CRITICAL FIX: If we are REDISCOVERING a grid (already trackedBatch) and we HAVE workflowIds,
                // we MUST strictly match by workflowIds to prevent stealing another prompt's grid!
                if (video.trackedBatch && video.workflowIds && video.workflowIds.length > 0) {
                    const hasMyTile = video.workflowIds.some(id => gc.querySelector(`[data-tile-id="${id}"]`));
                    if (hasMyTile) {
                        matchingGrid = gc;
                        if (video.promptId) gc.setAttribute('data-fe-grid-id', video.promptId);
                        break;
                    }
                    continue; // Skip this grid if it doesn't contain our IDs
                }

            // Flow adds "1. ", "2. " prefix to prompt text in the grid.
            // If the text is truncated like "1. luffy 3D...", it will fail to match "luffy 3d animation"
            // because "luffy 3d animation" does NOT include "1. luffy 3D". We MUST strip the prefix!
            const gcTextRaw = (gc.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const gcIndexMatch = gcTextRaw.match(/^(\d+)[\.\)]\s*/);

            // FIX BẢO VỆ STT: Khi bật addIndex, thẻ trên Flow mang STT cụ thể (ví dụ 15. , 16. ).
            // Tuyệt đối không cho phép video nhận vơ grid mang STT khác!
            if (state.settings.addIndex && gcIndexMatch) {
                const gcIndex = parseInt(gcIndexMatch[1]);
                if (gcIndex !== expectedDisplayIndex) {
                    continue; // Skip: Grid này mang STT khác, không phải của prompt này!
                }
            }

            const gcText = gcTextRaw.replace(/^\d+\.\s*/, ''); // removes "1. "
            
            if (gcText.includes(cleanPromptSnippet) || cleanPromptSnippet.includes(gcText.replace('...', '').trim())) {
                // CRITICAL FIX: If we haven't tracked this batch yet, we MUST ensure we don't accidentally
                // lock onto an OLD, already-completed grid from a previous manual run.
                // A new job will always have pending tiles initially.
                if (!video.trackedBatch) {
                    const hasPending = gc.querySelector('flow-pending-tile') !== null;
                    if (!hasPending) {
                        continue; // Skip this old grid! It's already done, so it can't be our new job.
                    }
                    // ANTI-FALSE-POSITIVE: Also skip grids that existed BEFORE we clicked Create.
                    // This prevents matching old grids with similar prompt text.
                    if (video._preClickGridSnapshot && video._preClickGridSnapshot.has(gc.textContent.substring(0, 200))) {
                        continue; // This grid existed before our click — not our new job!
                    }
                }

                matchingGrid = gc;
                // Lock this grid to this video!
                if (video.promptId) {
                    gc.setAttribute('data-fe-grid-id', video.promptId);
                }
                break; // Found the newest unclaimed grid!
            }
        }
        } // Closing brace for if (!matchingGrid)

        if (matchingGrid) {
            // Extract the actual cards (pending or completed)
            // Flow UI uses a mix of flow-tile-container, flow-pending-tile, flow-image-tile, flow-video-tile.
            // Some might wrap each other. To get exactly the top-level cards, we query all,
            // then filter out any that are children of another matched node.
            const allNodes = Array.from(matchingGrid.querySelectorAll('flow-tile-container, flow-pending-tile, flow-image-tile, flow-video-tile'));
            currentTiles = allNodes.filter(node => {
                let parent = node.parentElement;
                while (parent && parent !== matchingGrid) {
                    if (allNodes.includes(parent)) return false;
                    parent = parent.parentElement;
                }
                return true;
            });
            
            // Đảm bảo gán ID (fe_id_) để phục hồi DOM khi bị cuộn mất (Virtual Scroll)
            video.trackedTileIds = video.trackedTileIds || [];
            currentTiles.forEach((tile, idx) => {
                let id = tile.getAttribute('data-tile-id') || extractTileId(tile) || getIdFromNgCtx(tile);
                if (!id) {
                    if (video.trackedTileIds[idx]) {
                        id = video.trackedTileIds[idx];
                    } else {
                        id = `fe_id_${crypto.randomUUID()}`;
                        video.trackedTileIds[idx] = id;
                        addLog('info', `[${video.promptIndex}] 🎴 New tile at top: ${id.substring(0, 15)}...`);
                    }
                }
                
                // Luôn cập nhật lại data-tile-id để nếu lấy được ID xịn sẽ override ID fe_id_ cũ
                tile.setAttribute('data-tile-id', id);
                
                if (video.trackedTileIds[idx] !== id) {
                    video.trackedTileIds[idx] = id;
                }
            });
            
            // DYNAMIC EXPECTED LENGTH: Do not hardcode to expectedCount because the user might have clicked "x2" instead of "x4".
            // Adapt to whatever Flow actually spawned!
            if (currentTiles.length > 0) {
                video._maxSeenTiles = Math.max(video._maxSeenTiles || 0, currentTiles.length);
                expectedLength = video._maxSeenTiles;
            } else {
                expectedLength = expectedCount;
            }
            
            video.trackedBatch = true;
            if (!video.notifiedBatch) {
                const isVideo = matchingGrid.querySelector('flow-video-tile') !== null;
                video.mediaType = isVideo ? 'videos' : 'ảnh';
                addLog('info', `[${video.promptIndex}] 🎴 Tìm thấy thẻ Lưới (Grid) chứa prompt! (${currentTiles.length} ${video.mediaType})`);
                video.notifiedBatch = true;
            }
        } else if (video.trackedBatch) {
            // Found before, but missing now (virtualization)
            expectedLength = video._maxSeenTiles || expectedCount;
            currentTiles = []; // forces _isMissingTiles = true
        }
    } else {
        // --- OLD UI DISCOVERY ---
        if (video._preClickTopIds && (video.status === STATUS.CREATING || video.status === STATUS.PASTING)) {
          // Look at the top 10 tiles for any NEW IDs that weren't there before we clicked
          const topTiles = getOuterTiles().slice(0, 10);
          
          const newIdsAtTop = topTiles
            .filter(t => {
              const id = t.getAttribute('data-tile-id');
              if (!id || video._preClickTopIds.has(id)) return false;
              
              const tileText = (t.textContent || '').replace(/\s+/g, ' ').toLowerCase();
              return tileText.includes(cleanPromptSnippet);
            })
            .map(t => t.getAttribute('data-tile-id'));

          // Exclude IDs already claimed by other active videos
          const claimed = new Set(
            state.videos.filter(v => v !== video).flatMap(v => v.trackedTileIds || [])
          );
          
          const candidates = newIdsAtTop.filter(id => !claimed.has(id));
          const currentTracked = new Set(video.trackedTileIds || []);

          for (const id of candidates) {
            if (!currentTracked.has(id) && (video.trackedTileIds || []).length < expectedCount) {
              video.trackedTileIds = [...(video.trackedTileIds || []), id];
              currentTracked.add(id);
              addLog('info', `[${video.promptIndex}] 🎴 New tile at top: ${id.substring(0, 15)}... (${video.trackedTileIds.length}/${expectedCount})`);
            }
          }
        }

        expectedLength = video.trackedTileIds ? video.trackedTileIds.length : 0;
        currentTiles = (video.trackedTileIds || [])
          .map(id => getTileById(id))
          .filter(el => el && document.body.contains(el));
    }

    // --- LOCK TRẠNG THÁI (STATE LOCK) ---
    // Nếu đã hoàn tất (COMPLETED) hoặc LỖI (ERROR), tuyệt đối KHÔNG ĐƯỢC PHÉP hạ cấp hay cập nhật lại giao diện.
    if (video.status === STATUS.COMPLETED || video.status === STATUS.ERROR) {
        continue; 
    }

    // ── HELPER: Lay workflowId tu sniffer neu chua co ──
    // Giai quyet chicken-and-egg: workflowIds chi gan khi COMPLETED, nhung can wfId de detect COMPLETED qua API
    function ensureWorkflowId(vid) {
        let wfId = (vid.workflowIds || [])[0];
        if (!wfId && typeof vid._sniffStartIndex === 'number' && window.veoSniffedMediaIds) {
            const sniffed = window.veoSniffedMediaIds[vid._sniffStartIndex];
            if (sniffed) {
                vid.workflowIds = [sniffed];
                wfId = sniffed;
            }
        }
        return wfId;
    }

    // ── API STATUS CHECK: Goi batchexecute jwpduf kiem tra trang thai ──
    async function tryApiStatusCheck(vid) {
        const wfId = ensureWorkflowId(vid);
        if (!wfId) return false;
        if (vid._lastApiCheck && Date.now() - vid._lastApiCheck < 15000) return false;
        vid._lastApiCheck = Date.now();
        try {
            const apiResult = await checkWorkflowStatusViaAPI(wfId);
            if (apiResult && apiResult.isCompleted) {
                vid.status = STATUS.COMPLETED;
                vid.progress = 100;
                vid._isMissingTiles = false;
                vid._isStuck = false;
                if (apiResult.mediaId) {
                    vid.workflowIds = vid.workflowIds || [];
                    if (!vid.workflowIds.includes(apiResult.mediaId))
                        vid.workflowIds.push(apiResult.mediaId);
                }
                addLog('success', `[${vid.promptIndex}] ✅ Tạo xong! (Thẻ nằm ngoài màn hình nhưng hệ thống xác nhận thành công)`);
                saveProject();
                return true;
            }
            if (Math.random() < 0.15) {
                addLog('info', `[${vid.promptIndex}] ⏳ Thẻ nằm ngoài màn hình. Đang kiểm tra tiến độ qua hệ thống... (chưa xong)`);
            }
        } catch(e) { /* silent */ }
        return false;
    }

    // CASE 1: The bi che khuat boi Virtual Scroll (da tung track, nhung gio bi an)
    if (expectedLength > 0 && currentTiles.length < expectedLength) {
        video._isMissingTiles = true;

        // API POLLING thay vi bo qua hoan toan
        if (await tryApiStatusCheck(video)) continue;

        // Timeout cung BACKUP
        const missingTime = Date.now() - (video._createStartTime || Date.now());
        const missingTimeout = state.settings.runMode === 'image' ? 120000 : 300000;
        if (video._createStartTime && missingTime > missingTimeout) {
            video.status = STATUS.ERROR;
            video.error = `Quá ${Math.round(missingTimeout/60000)} phút không hoàn thành. Sẽ thử lại tự động.`;
            addLog('error', `[${video.promptIndex}] ❌ Đã chờ ${Math.round(missingTimeout/60000)} phút mà chưa xong. Đánh lỗi để thử lại tự động.`);
        }
        continue;
    } else {
        video._isMissingTiles = false;
    }

    // CASE 2: Chua co the nao spawn (trackedTileIds rong)
    if (currentTiles.length === 0) {
      if (video.status === STATUS.CREATING || video.status === STATUS.PASTING) {
          
          if (expectedLength === 0) {
              // ── CHƯA CÓ THẺ NÀO SPAWN (HOẶC VỪA TẠO NHƯNG BỊ USER CUỘN KHUẤT MẤT) ──
              
              // NEW v1.5.6: ÉP CUỘN LÊN TOP ĐỂ HỐT ID NẾU THẺ BỊ KHUẤT NGAY TỪ ĐẦU
              // Vì Google luôn đẻ thẻ mới ở trên cùng, nếu ta không thấy thẻ đâu, khả năng cao User đã lỡ tay cuộn chuột xuống!
              const currentScroll = window.scrollY || document.documentElement.scrollTop;
              if (currentScroll > 100) {
                  addLog('warning', `[${video.promptIndex}] ⚠️ Không thấy thẻ mới! Ép cuộn lên Top để bắt ID...`);
                  window.scrollTo(0, 0);
                  await wait(1000); // Đợi DOM ở Top render
                  continue; // Quay lại đầu vòng lặp để monitorCards quét lại DOM và bắt ID
              }
              
              // Kể cả khi đã cuộn lên Top mà vẫn không thấy (lag server), thử gọi API (chỉ gọi được nếu sniffer đã bắt được gói tin mạng)
              if (await tryApiStatusCheck(video)) continue;

              // Timeout cu
              const maxWait = state.settings.runMode === 'image' ? 60000 : 120000;
              if (video._createStartTime && Date.now() - video._createStartTime > maxWait) {
                  video.status = STATUS.ERROR;
                  video.error = `Timeout: Không tìm thấy thẻ nào được tạo ra sau ${Math.round(maxWait/1000)}s`;
                  addLog('error', `[${video.promptIndex}] Lỗi: Google Flow không đẻ ra thẻ nào sau ${Math.round(maxWait/1000)}s!`);
              } else if (Math.random() < 0.1) {
                  addLog('info', `[${video.promptIndex}] ⏳ Đang chờ thẻ video mới xuất hiện trên giao diện...`);
              }
              continue; // Bo qua phan duoi vi chua co the
          }

          // ── RECOVERY FALLBACK (ĐÃ TỪNG CÓ THẺ NHƯNG BỊ CHE KHUẤT VÀ TẢI LẠI TRANG) ──
          // Chỉ gọi khi được load lại từ một session cũ (ví dụ F5 reload trang)
          if (video.sessionStarted !== PAGE_SESSION_ID) {
              const recovered = recoverLostTiles(video);
              if (recovered.length > 0) {
                  currentTiles.push(...recovered);
                  video.sessionStarted = PAGE_SESSION_ID; // Đánh dấu đã phục hồi, không gọi lại nữa
              } else {
                  // Đang tải lại từ session cũ nhưng không tìm thấy thẻ -> Đợi Sweep xử lý
                  continue;
              }
          } else {
              // Là session hiện tại -> Mất thẻ 100% là do ảo hóa DOM. Batch Sweep ở mainLoop sẽ lo liệu.
              continue;
          }
      } else {
          continue;
      }
    }

    // Pass live elements to getGroupStatus
    video.cardElements = currentTiles;
    video.cardElement = currentTiles[0];

    // Aggregate status from each individual tile
    const cardStatus = getGroupStatus(video);

    // Update sub-videos info
    video.subVideos = cardStatus.videos;

    // Check if any video is upscaling
    const hasUpscaling = video.subVideos && video.subVideos.some(v => v.status === 'UPSCALING');

    if (cardStatus.status === 'ERROR' && (!video.subVideos || video.subVideos.every(v => v.status === 'ERROR'))) {
      const timeSinceCreate = Date.now() - (video._createStartTime || 0);
      if (timeSinceCreate > 6000) {
          if (video.status !== STATUS.ERROR) {
            video.status = STATUS.ERROR;
            video.error = cardStatus.error;
            addLog('error', `[${video.promptIndex}] Error: ${cardStatus.error}`);
          }
      } else {
          video.status = STATUS.CREATING;
      }
    } else if (cardStatus.status === 'CREATING' || cardStatus.status === 'QUEUED' || hasUpscaling) {
      video.status = STATUS.CREATING;

      // Update progress if changed
      // We use average progress from all videos
      if (cardStatus.progress > (video._maxProgress || -1)) {
          video._maxProgress = cardStatus.progress;
          video._lastProgressTime = Date.now();
          video._isStuck = false; // Reset stuck flag
        }
        video._lastProgress = cardStatus.progress;
        // FIX BUG 4: Progress Floor — progress chỉ được tăng, KHÔNG BAO GIỜ được giảm.
        // Ngăn chặn trường hợp quét nhầm card khác hoặc DOM stale trả về progress thấp hơn.
        const newProgress = Math.round(cardStatus.progress);
        if (cardStatus.status === 'QUEUED' && (video.progress || 0) > 50) {
            // Có khả năng nhận nhầm grid — KHÔNG áp dụng Progress Floor
            addLog('warning', `[${video.promptIndex}] ⚠️ Phát hiện progress giảm đột ngột (${video.progress}% → ${newProgress}%). Có thể nhận nhầm grid.`);
            // Giữ nguyên progress cũ, KHÔNG ghi đè
        } else {
            video.progress = Math.max(video.progress || 0, newProgress);
        }
        
        // Stuck Detection: AI Video generation can easily stay at the same % for 30-60 seconds.
        if (state.settings.runMode !== 'image' && !hasUpscaling && cardStatus.status !== 'QUEUED') {
            const timeStuck = Date.now() - (video._lastProgressTime || Date.now());
            
            // CƠ CHẾ CHỐNG STUCK: Báo cho Batch Sweep cuộn trang tới video này để "đánh thức" nó!
            if (timeStuck > 60000) {
                video._isStuck = true; 
            }
            
            // Timeout cứng nếu treo quá lâu (đã tăng lên 180s để chừa thời gian cho Sweep đánh thức)
            if (timeStuck > 180000) {
                video.status = STATUS.ERROR;
                video.error = `Stuck (${video.progress}%) > 180s`;
                addLog('error', `[${video.promptIndex}] Stuck at ${video.progress}% for 180s. Marked as Error.`);
            }
        }

      // Total Timeout: If creating takes > 5 phút (300s) for video, 2 phút (120s) for image
      // Extend timeout if upscaling (3 mins per video is enough)
      const timeoutLimit = state.settings.runMode === 'image' ? 120000 : (hasUpscaling ? 180000 : 300000);
      if (video._createStartTime && cardStatus.status !== 'QUEUED' && (Date.now() - video._createStartTime > timeoutLimit)) {
        video.status = STATUS.ERROR;
        video.error = hasUpscaling ? 'Upscale Timeout (> 3m)' : (state.settings.runMode === 'image' ? 'Timeout (> 2m)' : 'Timeout (> 5m)');
        addLog('error', `[${video.promptIndex}] Creation timed out.`);
      }

      // ABSOLUTE TIMEOUT: Bất kể trạng thái gì, nếu quá 6 phút → FAIL
      const ABSOLUTE_TIMEOUT = 360000; // 6 phút
      if (video._createStartTime && (Date.now() - video._createStartTime > ABSOLUTE_TIMEOUT)) {
          video.status = STATUS.ERROR;
          video.error = 'Absolute Timeout (> 6m)';
          addLog('error', `[${video.promptIndex}] ❌ Absolute timeout 6 phút. Buộc đánh lỗi.`);
      }

      // Nếu đang QUEUED và CHƯA BẮT ĐẦU CHẠY (progress = 0), update thời gian bắt đầu để reset đồng hồ timeout
      // Tuyệt đối KHÔNG reset nếu đang chạy dở (progress > 0) để tránh bị reset hẹn giờ oan!
      if (cardStatus.status === 'QUEUED' && (video.progress || 0) === 0) {
          video._createStartTime = Date.now();
          video._lastProgressTime = Date.now();
      }

    } else if (cardStatus.status === 'COMPLETED') {
      const completedCount = (cardStatus.videos || []).filter(v => v.status === 'COMPLETED').length;
      const prevTotal = video.totalVideos || 0;
      video.totalVideos = completedCount;

      if (video.totalVideos !== prevTotal) {
        addLog('info', `[${video.promptIndex}] Videos ready: ${video.totalVideos}`);
      }

      if (video.status !== STATUS.COMPLETED) {
        video.status = STATUS.COMPLETED;
        video.progress = 100;
        
        // ── BẮT WORKFLOW ID (ƯU TIÊN: SNIFFER, FALLBACK: DOM) ──
        video.workflowIds = [];
        
        // Cực kỳ quan trọng: CHỈ LƯU NHỮNG CARD DONE! BỎ QUA CARD FAIL!
        const successfulTiles = currentTiles ? currentTiles.filter(t => !getCardStatus(t).isFailed) : [];
        video.cardElements = successfulTiles;
        video.totalVideos = successfulTiles.length;
        
        // 1. ƯU TIÊN: Bắt từ Network Sniffer (IDs mới từ sau khi paste)
        if (window.veoSniffedMediaIds && window.veoSniffedMediaIds.length > 0) {
            const startIdx = (typeof video._sniffStartIndex === 'number') ? video._sniffStartIndex : 0;
            const newSniffed = window.veoSniffedMediaIds.slice(startIdx);
            if (newSniffed.length > 0) {
                const count = Math.max(successfulTiles.length, 1);
                video.workflowIds = newSniffed.slice(0, count);
                addLog('info', `[${video.promptIndex}] 🆔 Sniffer bắt ${video.workflowIds.length}/${count} ID: ${video.workflowIds.map(id=>id.substring(0,8)).join(', ')} (pool=${newSniffed.length})`);
            }
        }
        
        // 2. FALLBACK: Quét DOM tìm a[href*="/edit/"] hoặc ancestor
        if ((!video.workflowIds || video.workflowIds.length === 0) && successfulTiles.length > 0) {
            let ids = [];
            for (let retry = 0; retry < 10; retry++) {
                ids = [];
                for (let tile of successfulTiles) {
                    // Check child link
                    let aTag = tile.querySelector('a[href*="/edit/"]');
                    if (!aTag) aTag = tile.closest('a[href*="/edit/"]');
                    if (aTag) {
                        const m = aTag.href.match(/\/edit\/(?:workflow\/)?([a-z0-9\-]{36})/i);
                        if (m) { ids.push(m[1]); continue; }
                    }
                    // Check data-media-id
                    const mediaEl = tile.querySelector('[data-media-id]') || (tile.getAttribute('data-media-id') ? tile : null);
                    if (mediaEl) { ids.push(mediaEl.getAttribute('data-media-id')); continue; }
                    // Check data-tile-id (non-fe_id format)
                    const dtid = tile.getAttribute('data-tile-id');
                    if (dtid && !dtid.startsWith('fe_id_')) { ids.push(dtid); continue; }
                }
                if (ids.length === successfulTiles.length) break;
                await wait(200);
            }
            if (ids.length > 0) {
                video.workflowIds = ids;
                addLog('info', `[${video.promptIndex}] 🆔 DOM bắt ${ids.length} ID: ${ids.map(id=>id.substring(0,8)).join(', ')}`);
            }
        }
        
        // 3. FALLBACK CUỐI: Lấy từ pool sniffed gần nhất
        if ((!video.workflowIds || video.workflowIds.length === 0) && window.veoSniffedMediaIds && window.veoSniffedMediaIds.length > 0) {
            const count = Math.max(successfulTiles.length, 1);
            video.workflowIds = window.veoSniffedMediaIds.slice(-count);
            addLog('info', `[${video.promptIndex}] 🆔 Pool cuối: ${video.workflowIds.map(id=>id.substring(0,8)).join(', ')}`);
        }
        
        addLog('success', `[${video.promptIndex}] Completed! (${video.totalVideos} ${video.mediaType || 'media'}, captured ${video.workflowIds.length} IDs)`);
        saveProject();
      }
    }
  }

  // Removed checkAutoShutdown() from here. mainLoop is the only source of truth for completion.
  
  updateUI();
  } finally {
      clearTimeout(_monitorTimeout);
      _isMonitoring = false;
  }
}

// ==================== AUTO STOP & SHUTDOWN ====================
async function checkAutoShutdown() {
  // Hàm này giờ chỉ chịu trách nhiệm tắt máy tính (PC) khi được mainLoop gọi
  if (!state.settings.autoShutdown) {
    addLog('info', '✅ Automation hoàn tất. Auto-shutdown: TẮT');
    return;
  }

  // Prevent multiple shutdown triggers
  if (state._shutdownTriggered) return;
  state._shutdownTriggered = true;

  if (state.settings.downloadZip) {
      addLog('info', '⏳ Chờ thông báo nén ZIP xuất hiện và biến mất...');
      
      let toastFound = false;
      let trackedToastText = '';
      
      // Chờ toast xuất hiện (tối đa 15s)
      for (let i = 0; i < 15; i++) {
          // Các toast thông báo thường có role=alert, role=status, aria-live=polite hoặc aria-live=assertive, hoặc data-sonner-toast
          const toastSelector = '[role="alert"], [role="status"], [aria-live="polite"], [aria-live="assertive"], [class*="toast"], [class*="snackbar"], [data-sonner-toast]';
          const toasts = Array.from(document.querySelectorAll(toastSelector));
          for (const toast of toasts) {
              const text = toast.textContent.toLowerCase().trim();
              if (text.length > 5 && text.length < 150) {
                  // Chỉ cần chứa 1 vài từ khóa báo hiệu đang xử lý
                  if (text.includes('đang') || text.includes('chuẩn bị') || text.includes('nén') || text.includes('download') || text.includes('prepar') || text.includes('zip') || text.includes('mục xuống')) {
                      toastFound = true;
                      trackedToastText = text; // Lưu lại chính xác text của toast để theo dõi
                      break;
                  }
              }
          }
          if (toastFound) break;
          await wait(1000);
      }
      
      if (toastFound) {
          addLog('info', `🔄 Đã bắt được tiến trình: "${trackedToastText.substring(0, 50)}...". Đang chờ hoàn tất...`);
          let waitCycles = 0;
          const toastSelector = '[role="alert"], [role="status"], [aria-live="polite"], [aria-live="assertive"], [class*="toast"], [class*="snackbar"], [data-sonner-toast]';
          
          while (waitCycles < 600) { // Tối đa chờ 20 phút (600 * 2s)
              // Kiểm tra xem đoạn text đó còn xuất hiện trên màn hình không
              const isStillVisible = Array.from(document.querySelectorAll(toastSelector))
                  .some(el => el.textContent.toLowerCase().trim() === trackedToastText);
              
              if (!isStillVisible) {
                  // Wait 2s and double check to prevent false positives from flickering
                  await wait(2000);
                  const doubleCheck = Array.from(document.querySelectorAll(toastSelector))
                      .some(el => el.textContent.toLowerCase().trim() === trackedToastText);
                  if (!doubleCheck) break; // Thực sự đã mất toast -> tải xong
              }
              await wait(2000);
              waitCycles++;
          }
          if (waitCycles >= 600) {
              addLog('error', '⏳ Hết thời gian chờ 20 phút tải ZIP, có thể bị lỗi, tự động bỏ qua.');
          } else {
              addLog('success', '✅ Quá trình nén ZIP trên server đã hoàn tất!');
          }
      } else {
          // Tính toán thời gian chờ dự phòng dựa trên số lượng prompt
          const promptCount = (state.prompts && state.prompts.length > 0) ? state.prompts.length : 50;
          let backupWaitMinutes = Math.ceil(promptCount / 50);
          
          // Video nặng hơn ảnh rất nhiều nên nếu là mode Video -> x2 thời gian chờ nén
          const isVideoMode = state.settings.runMode === 'video';
          if (isVideoMode) {
              backupWaitMinutes *= 2;
          }
          
          const backupWaitMs = backupWaitMinutes * 60000;
          const modeName = isVideoMode ? "Video" : "Ảnh";
          
          addLog('warning', `⚠️ Không tìm thấy thông báo tải ZIP. Bật đếm giờ dự phòng: Chờ ${backupWaitMinutes} phút (${promptCount} prompts - Mode ${modeName})...`);
          await wait(backupWaitMs); 
      }
      await wait(8000); // Thêm 8s buffer cho trình duyệt xử lý lưu file vật lý vào máy
  }

  let delay = 60; // Trả lại 60s cơ bản để user có đủ thời gian thấy bảng đếm ngược và hủy nếu muốn

  addLog('warning', `💤 Auto-shutdown đã bật - Máy sẽ tắt sau ${delay} giây...`);
  addLog('info', '⚠️ Chạy "shutdown /a" trong CMD để hủy');

  // Show cancel button
  chrome.runtime.sendMessage({
    action: 'SHUTDOWN_TRIGGERED'
  }).catch(() => { });

  chrome.runtime.sendMessage({
    action: 'TRIGGER_SHUTDOWN',
    data: { delay: delay }
  }).catch(() => { });
}


// ==================== WATCHDOG ====================
// Detect stuck automation and auto-recover
function checkWatchdog() {
  if (!state.isRunning) return;

  const now = Date.now();
  const timeSinceActivity = now - state._lastActivityTime;
  const completedCount = state.videos.filter(v => v.status === STATUS.COMPLETED).length;

  // Update activity time if progress made
  if (completedCount > state._lastCompletedCount) {
    state._lastActivityTime = now;
    state._lastCompletedCount = completedCount;
    return;
  }

  // Check if stuck (no progress for 5 minutes)
  const STUCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  if (timeSinceActivity < STUCK_TIMEOUT) return;

  // Check if there's still work to do
  const totalPrompts = state.prompts.length;
  const creating = state.videos.filter(v => v.status === STATUS.CREATING || v.status === STATUS.PASTING).length;
  const hasMoreWork = completedCount + state.errorCount < totalPrompts;

  if (!hasMoreWork) return; // All done, not stuck

  addLog('warning', `⚠️ WATCHDOG: No progress for ${Math.round(timeSinceActivity / 60000)} minutes`);
  addLog('info', `📊 Status: ${completedCount} completed, ${creating} creating, ${state.errorCount} errors, ${totalPrompts} total`);

  // Re-scan all cards to detect missed completions
  addLog('info', `🔍 Re-scanning all cards...`);
  const cards = document.querySelectorAll('[role="article"]');
  let foundUpdates = 0;

  for (const card of cards) {
    const video = state.videos.find(v => v.cardElement === card);
    if (!video) continue;
    if (video.status === STATUS.COMPLETED || video.status === STATUS.ERROR) continue;

    // Check if actually completed
    const status = getCardStatus(card, video.promptText);
    if (status.hasError) {
      video.status = STATUS.ERROR;
      video.error = status.errorMessage || 'Unknown error';
      state.errorCount++;
      foundUpdates++;
      addLog('error', `[${video.promptIndex}] Found error: ${video.error}`);
    } else if (status.totalVideos > 0) {
      video.status = STATUS.COMPLETED;
      video.totalVideos = status.totalVideos;
      video.progress = 100;
      foundUpdates++;
      addLog('success', `[${video.promptIndex}] Found completed (${status.totalVideos} videos)`);
    }
  }

  // NOTE: Bỏ logic ép kill các thẻ đang chạy ngầm trên >2 phút ở đây!
  // Tính năng Force-kill do Watchdog trước đây xung đột với timeout chính (vốn >3 phút ở monitorCards)
  // Watchdog giờ chỉ dùng làm Check & Repair (đồng bộ DOM), tuyệt đối không xoá tiến trình đang chờ.

  if (foundUpdates > 0) {
    addLog('success', `✅ Watchdog found ${foundUpdates} updates, continuing...`);
    state._lastActivityTime = now;
    updateUI();
    saveProject();
  } else {
    addLog('info', `✅ Watchdog found no stuck/missed updates.`);
  }
}


// ==================== ELEMENT FINDERS ====================

function findFlowSearchBox() {
    // Tìm các thẻ input loại text hoặc search
    const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
    for (const input of inputs) {
        if (!input.offsetParent) continue; // Bỏ qua input đang bị ẩn!
        
        // Cách 1: Kiểm tra placeholder/aria-label
        const p = (input.placeholder || '').toLowerCase();
        const a = (input.getAttribute('aria-label') || '').toLowerCase();
        if (p.includes('search') || a.includes('search') || p.includes('tìm kiếm') || a.includes('tìm kiếm')) {
            return input;
        }

        // Cách 2: (Cho Flow 2025) Kiểm tra xem thẻ form/div chứa nó có cái icon kính lúp "search" hay "arrow_back" không
        const wrapper = input.closest('form') || input.parentElement;
        if (wrapper) {
            const icons = wrapper.querySelectorAll('i, .google-symbols');
            for (const icon of icons) {
                const txt = icon.textContent.trim().toLowerCase();
                if (txt === 'search' || txt === 'arrow_back') {
                    // addLog('info', `[Search Box] Tìm thấy ô Tìm kiếm qua Icon '${txt}'.`); // Không comment quá nhiều
                    return input;
                }
            }
        }
    }
    
    // Fallback: Tìm thẻ input text cuối cùng trên màn hình.
    // Vì ô báo "Tên project" thường xuất hiện đầu tiên (Bên trái), ô Search xuất hiện ở giữa/cuối.
    const visibleInputs = inputs.filter(i => i.offsetParent);
    if (visibleInputs.length > 0) {
        const fallback = visibleInputs[visibleInputs.length - 1];
        addLog('warning', `[Search Box] Đã dùng Fallback tìm ô input text cuỐI CÙNG.`);
        return fallback;
    }
    return null;
}

function getIdFromNgCtx(el) {
  if (!el) return null;
  const projectId2 = ((window.location.href.match(/project\/([a-z0-9\-]+)/i)||[])[1]||'').toLowerCase();
  const uuidRe = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const checkStr = (s) => {
      if (typeof s !== 'string') return null;
      if (uuidRe.test(s) && s.toLowerCase() !== projectId2) return s.toLowerCase();
      const m2 = s.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
      if (m2 && m2[1].toLowerCase() !== projectId2) return m2[1].toLowerCase();
      return null;
  };
  let cur = el;
  for (let depth = 0; depth < 4 && cur; depth++, cur = cur.parentElement) {
      try {
          const lv = cur.__ngContext__;
          if (!lv || !Array.isArray(lv)) continue;
          const comp = lv[8];
          if (!comp || typeof comp !== 'object') continue;
          const candidates2 = [
              comp.workflowId, comp.id, comp.mediaId,
              comp.workflow?.id, comp.workflow?.workflowId, comp.workflow?.name,
              comp.media?.id, comp.media?.name,
              comp.item?.id, comp.card?.id,
              comp.name, comp.resourceName,
          ];
          for (const v of candidates2) {
              const r = checkStr(v);
              if (r) return r;
          }
      } catch(e) {}
  }
  return null;
}

// Returns the OUTERMOST [data-tile-id] elements — one per video slot.
// Covers ALL card states:
//  - Completed: <a href="/edit/..."> wraps a <video>
//  - Error:     <div class="sc-25d34a31-0"> with 'Không thành công'
//  - Generating: <div> with % text
// We identify the outer tile by checking its parent has no [data-tile-id] ancestor.
function extractTileId(tile) {
  if (!tile) return null;
  if (tile.getAttribute('data-tile-id')) return tile.getAttribute('data-tile-id');
  if (tile.getAttribute('data-media-id')) return tile.getAttribute('data-media-id');
  const a = tile.matches('a[href*="/edit/"]') ? tile : tile.querySelector('a[href*="/edit/"]');
  if (a && a.getAttribute('href')) {
    const m = a.getAttribute('href').match(/\/edit\/(?:workflow\/)?([a-z0-9\-]{36})/i);
    if (m) return m[1];
  }
  const img = tile.querySelector('img[data-media-id]');
  if (img && img.getAttribute('data-media-id')) return img.getAttribute('data-media-id');
  return null;
}

function getOuterTiles() {
  // 1. New Google Flow UI (Angular custom elements)
  const containers = Array.from(document.querySelectorAll('flow-tile-container'));
  if (containers.length > 0) {
    return containers.filter(el => el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0);
  }
  
  const tiles = Array.from(document.querySelectorAll('flow-image-tile, flow-video-tile'));
  if (tiles.length > 0) {
    return tiles.filter(el => el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0);
  }

  // 2. Legacy Flow UI with data-tile-id
  const legacy = Array.from(document.querySelectorAll('[data-tile-id]'))
    .filter(el => !el.parentElement?.closest('[data-tile-id]'));
  if (legacy.length > 0) return legacy;

  // 3. Fallback to links with edit workflow
  return Array.from(document.querySelectorAll('a[href*="/edit/workflow/"]'))
    .map(a => a.closest('div[class*="tile"], div[class*="card"], [class*="container"]') || a)
    .filter(el => el.offsetParent !== null || el.offsetWidth > 0);
}

// Same as getOuterTiles but scoped to a specific container element.
function getOuterTilesWithin(container) {
  if (!container) return [];
  const containers = Array.from(container.querySelectorAll('flow-tile-container'));
  if (containers.length > 0) return containers;
  
  const tiles = Array.from(container.querySelectorAll('flow-image-tile, flow-video-tile'));
  if (tiles.length > 0) return tiles;

  return Array.from(container.querySelectorAll('[data-tile-id]'))
    .filter(el => !el.parentElement?.closest('[data-tile-id]'));
}

// ── NEW: Tile ID string helpers ──────────────────────────────────────────────
// Returns deduplicated list of all tile ID strings currently in the DOM.
function getAllTileIds() {
  const seen = new Set();
  const result = [];
  const tiles = getOuterTiles();
  for (const el of tiles) {
    const id = extractTileId(el);
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

// Query the CURRENT DOM element for a tile ID (always returns outermost wrapper,
// regardless of whether Flow has replaced div→a for that tile).
function getTileById(id) {
  if (!id) return null;
  let el = document.querySelector(`[data-tile-id="${id}"]`);
  if (el) return el;
  el = document.querySelector(`[data-media-id="${id}"]`);
  if (el) return el.closest('flow-tile-container') || el;
  el = document.querySelector(`a[href*="${id}"]`);
  if (el) return el.closest('flow-tile-container') || el;
  return null;
}

// ── GROUP CONTAINER: the div that wraps ALL tiles + prompt text for ONE Create click ──
// DOM structure (from observed HTML):
//   GROUP-OUTER div (sc-5c6add13-1)
//     GROUP-INNER div (sc-5c6add13-2)   ← we track THIS
//       TILES-CONTAINER div (sc-5c6add13-4)
//         slot div (height:154px)
//           [data-tile-id] outer tile
//       ...prompt text section...
//
// We walk UP from an outer tile 4 levels to reach GROUP-INNER.
// If the count is wrong due to DOM changes we try levels 3-6 and pick the one
// that contains ONLY the expected number of tiles (x2 or x4).
function getGroupContainer(outerTile) {
  if (!outerTile) return null;
  let el = outerTile;
  for (let i = 0; i < 8; i++) {
    el = el.parentElement;
    if (!el || el === document.body) return null;
    if (el.closest('[data-tile-id]')) continue; // skip if we're inside a tile

    // CRITICAL: count OUTER tiles only (not nested inside [data-tile-id]).
    // Completed tiles have outer+inner both with data-tile-id.
    // Using total count would find the slot-wrapper (1 completed tile = 2 data-tile-id)
    // which incorrectly satisfies >=2. We need >= 2 OUTER tiles.
    const outerCount = getOuterTilesWithin(el).length;

    if (outerCount >= 2) {
      const parentEl = el.parentElement;
      if (!parentEl) return el;
      const parentOuterCount = getOuterTilesWithin(parentEl).length;
      // Group container: parent has MORE outer tiles than us (parent = grid level)
      if (parentOuterCount > outerCount) return el;
    }
  }
  return null;
}

// Get all current generation group containers on the page
function getAllGroupContainers() {
  const outerTiles = getOuterTiles();
  if (!outerTiles.length) return [];
  const groups = new Set();
  for (const tile of outerTiles) {
    const g = getGroupContainer(tile);
    if (g) groups.add(g);
  }
  return Array.from(groups);
}
// ────────────────────────────────────────────────────────────────────────────

// Helper to handle legacy (string) and new (object) selector formats and safely validate CSS syntax
function resolveSelector(key) {
  if (!state.settings.selectors) return null;
  const val = state.settings.selectors[key];
  if (!val) return null;
  
  let selectorString = null;
  if (typeof val === 'string') selectorString = val;
  else if (typeof val === 'object' && val.selector) selectorString = val.selector;
  
  if (!selectorString || selectorString.trim() === '') return null;
  
  // Validate that the custom selector does not crash the DOM parser!
  try {
    document.createDocumentFragment().querySelectorAll(selectorString);
    return selectorString;
  } catch (err) {
    addLog('warning', `Custom selector is invalid CSS syntax: [${key}] = "${selectorString}". Falling back to native UI scan.`);
    return null;
  }
}

function findNewCardByPrompt(promptText, ignoreExistingCards = false, reverseOrder = false, allClaimedIds = null) {
  const fullPromptClean = promptText.replace(/\s+/g, ' ').toLowerCase();
  const cleanPromptSnippet = promptText.substring(0, 150).replace(/\s+/g, ' ').toLowerCase();

  function getCardText(card) {
    let t = (card.innerText || card.textContent || '').replace(/\s+/g, ' ').toLowerCase();
    // Thêm các thuộc tính ẩn có thể chứa full prompt
    const els = card.querySelectorAll('[alt], [title], [aria-label]');
    for (const el of els) {
        t += ' ' + (el.getAttribute('alt') || '');
        t += ' ' + (el.getAttribute('title') || '');
        t += ' ' + (el.getAttribute('aria-label') || '');
    }
    return t.replace(/\s+/g, ' ').toLowerCase();
  }

  function isCardClaimed(card) {
      if (!allClaimedIds) return false;
      const tile = card.closest('[data-tile-id]');
      if (!tile) return false;
      return allClaimedIds.has(tile.getAttribute('data-tile-id'));
  }

  function findInList(nodeList) {
    let list = Array.from(nodeList);
    if (reverseOrder) list.reverse(); // Tìm từ dưới lên trên (cũ nhất trước)

    // Pass 1: Tìm khớp chính xác TOÀN BỘ prompt (Full match)
    for (const card of list) {
      if (!ignoreExistingCards && state._existingCards && state._existingCards.has(card)) continue;
      if (!card.offsetParent) continue;
      if (isCardClaimed(card)) continue;
      const text = getCardText(card);
      if (text.includes(fullPromptClean)) return card;
    }

    // Pass 2: Fallback tìm theo 150 ký tự đầu (Prefix match)
    for (const card of list) {
      if (!ignoreExistingCards && state._existingCards && state._existingCards.has(card)) continue;
      if (!card.offsetParent) continue;
      if (isCardClaimed(card)) continue;
      const text = getCardText(card);
      if (text.includes(cleanPromptSnippet)) return card;
    }
    return null;
  }

  // Strategy 1: Find <a> cards that contain the prompt text
  let found = findInList(document.querySelectorAll('a[href]'));
  if (found) return found;

  // Strategy 2: Old role="article"
  found = findInList(document.querySelectorAll('[role="article"]'));
  if (found) return found;

  // Strategy 3: Any visible block containing prompt text + video/progress indicators
  const allDivs = Array.from(document.querySelectorAll('div[class]'));
  if (reverseOrder) allDivs.reverse();

  for (const div of allDivs) {
    if (!ignoreExistingCards && state._existingCards && state._existingCards.has(div)) continue;
    if (div.isContentEditable || div.getAttribute('data-slate-editor')) continue;
    
    const text = getCardText(div);
    if (!text.includes(cleanPromptSnippet)) continue;
    
    const hasMedia = div.querySelector('video, img');
    // ── 2. Check for Generating State (Percentage) ──
    let percentValues = [];

    // NEW UI Priority: Directly check .loading-percentage elements (Angular Flow 2025)
    const loadingPercentEls = div.querySelectorAll('.loading-percentage');
    for (const el of loadingPercentEls) {
      const t = el.textContent.trim();
      const m = t.match(/(\d{1,3})\s*%/);
      if (m) {
        const val = parseInt(m[1]);
        if (val >= 0 && val <= 100) percentValues.push(val);
      }
    }

    // Also check for flow-pending-tile presence (still generating even if no % shown yet)
    const hasPendingTile = div.querySelector('flow-pending-tile') !== null;

    // OLD UI / Fallback: Scan all leaf text nodes for percentage patterns
    if (percentValues.length === 0 && !hasPendingTile) {
      const allTextEls = div.querySelectorAll('*');
      for (const el of allTextEls) {
        if (el.children.length > 0) continue;
        const t = el.textContent.trim();
        const m = t.match(/(\d{1,3})\s*%/);
        if (m) percentValues.push(parseInt(m[1]));
      }
    }

    const hasPercent = percentValues.length > 0;
    if (hasMedia || hasPercent || hasPendingTile) {
      const rect = div.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 100) return div;
    }
  }

  return null;
}

// Helper to paste text into a Slate.js contenteditable editor.
// Method: Synthetic ClipboardEvent (Ctrl+V paste simulation) - the only way
// that properly updates Slate's internal React state.
async function setNativeValue(element, value) {
  const tag = element.tagName.toLowerCase();
  const isNativeInput = (tag === 'textarea' || tag === 'input');
  const isContentEditable = element.isContentEditable;

  if (isNativeInput) {
    try {
      const proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(element, value);
      } else {
        element.value = value;
      }
    } catch (e) {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;

  } else if (isContentEditable) {
    // ==================== SLATE.JS: Main World Injection approach ====================
    // PROBLEM: execCommand from a content script (isolated world) fires beforeinput
    // events with isTrusted=false. Slate checks isTrusted and ignores them.
    //
    // SOLUTION: Route through background.js which uses chrome.scripting.executeScript
    // with world:'MAIN'. Code running in MAIN world fires TRUSTED events that Slate accepts.

    addLog('info', '[Slate] Injecting paste via MAIN world (background.js)...');

    element.scrollIntoView({ block: 'center' });
    await wait(200);

    // Send to background which calls chrome.scripting.executeScript({world:'MAIN'})
    const result = await chrome.runtime.sendMessage({
      action: 'INJECT_PASTE',
      data: { text: value, tabId: null } // background uses sender.tab.id automatically
    });

    await wait(600);

    if (!result || !result.ok) {
      addLog('error', `[Slate] INJECT_PASTE failed: ${result?.error || 'unknown'}`);
      return false;
    }

    addLog('info', `[Slate] Paste result: ok=${result.ok}, hasZeroWidth=${result.hasZeroWidth}`);

    if (result.hasZeroWidth) {
      addLog('warning', '[Slate] zero-width still present — Slate may not have updated state, but continuing...');
    } else {
      addLog('info', '[Slate] ✅ Slate accepted text (zero-width gone)');
    }

    return !result.hasZeroWidth; // true = success

  } else {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
}

// ── Helper: read expected video count from Flow UI 'Video x2/x4' button ──
// This caps card discovery so we don't claim cards from adjacent prompts.
function getExpectedVideoCount() {
  // Mặc định: chế độ video sinh 1 cái, chế độ image sinh 4 cái
  const defaultCount = state.settings.runMode === 'video' ? 1 : 4;
  
  // The button text looks like: "Video ▶ crop_16_9 x2" or "x4"
  const allBtns = document.querySelectorAll('button');
  for (const btn of allBtns) {
    if (btn.closest('[role="article"]')) continue;
    const txt = btn.textContent || '';
    const match = txt.match(/x(\d+)/);
    if (match && btn.querySelector('i')?.textContent?.includes('crop')) {
      return parseInt(match[1]) || defaultCount;
    }
  }
  return defaultCount;
}


// ==================== API STATUS CHECK (v1.5.3) ====================
// Gọi batchexecute RPC `jwpduf` (same-origin) để kiểm tra trạng thái workflow
// khi thẻ bị Virtual Scroll ẩn khỏi DOM.
// Pattern giống rename API (mYWVGd) — cùng endpoint, cùng cách gọi.
// Response: data[1] === null → CREATING, data[1] !== null → COMPLETED
async function checkWorkflowStatusViaAPI(_workflowId) {
  // Local-safe fork: completion is detected from the rendered Flow DOM only.
  return null;
}

function getCardStatus(card) {
  if (card.hasAttribute('data-veo-ignored')) {
      return { status: 'COMPLETED', progress: 100, videos: [], error: null };
  }

  // ── 1. Check for Completed State (Videos or Images) ──
  const videoEls = card.querySelectorAll('video');
  const downloadBtns = findDownloadButtonsInCard(card);
  let completedCount = videoEls.length > 0 ? videoEls.length : downloadBtns.length;

  // Image check: Flow 2025 Image tiles become clickable links without video tags.
  if (completedCount === 0) {
    const isLink = card.tagName.toLowerCase() === 'a' || card.querySelector('a') !== null;
    const imgEls = card.querySelectorAll('img');
    if (isLink && imgEls.length > 0) {
       completedCount = 1;
    }
  }

  // NEW UI Image check: Angular tiles may have <img> without being links.
  // Instead of relying on hasPendingTile (which might remain hidden in DOM and cause 96% stuck),
  // we strictly check if the img tag has a real generated image URL from Google Flow.
  if (completedCount === 0) {
    const imgEls = Array.from(card.querySelectorAll('img')).filter(img => {
        const src = img.getAttribute('src') || img.src || '';
        return src.includes('flow-content.google/image') || src.includes('googleusercontent.com');
    });
    if (imgEls.length > 0) {
       completedCount = 1;
    }
  }

  if (completedCount > 0) {
    return { 
      status: 'COMPLETED', 
      progress: 100, 
      videos: Array(completedCount).fill({ id: 0, status: 'COMPLETED', progress: 100 }),
      error: null 
    };
  }
  
  // ── 1b. DOM-based Error Check (Language-Independent) ──
  // flow-error-tile is ALWAYS present on failed cards, regardless of browser language
  if (card.querySelector('flow-error-tile') || card.tagName.toLowerCase() === 'flow-error-tile') {
    return { status: 'ERROR', error: 'Generation Failed (flow-error-tile)', progress: 0, videos: [] };
  }
  // Also check for .error-tile class (backup)
  if (card.querySelector('.error-tile')) {
    return { status: 'ERROR', error: 'Generation Failed (error-tile)', progress: 0, videos: [] };
  }
  // FIX BUG 1: Detect mat-icon warning — Google Flow shows this icon on failed generations
  const warningIcon = card.querySelector('mat-icon.error-icon');
  if (warningIcon && (warningIcon.textContent || '').trim().toLowerCase() === 'warning') {
    return { status: 'ERROR', error: 'Generation Failed (warning icon)', progress: 0, videos: [], isFailed: true };
  }

  // ── 2. Check for Generating State (Percentage) ──
  let percentValues = [];

  // STRATEGY (New UI & Ultimate Fallback):
  // Since the prompt text is safely OUTSIDE the card (in the grid header), 
  // ANY percentage text found inside the card's textContent MUST be the progress indicator.
  // This safely pierces normal elements even if they have children (like SVG icons next to the text).
  const cardText = card.textContent || '';
  const percentMatches = cardText.match(/(\d{1,3})\s*%/g);
  if (percentMatches) {
    for (const m of percentMatches) {
      const val = parseInt(m);
      if (val >= 0 && val <= 100) percentValues.push(val);
    }
  }

  // Backup Strategy just in case they use shadow DOM that is closed, 
  // though typically Flow's percent text is slotted or light DOM.
  if (percentValues.length === 0) {
    const loadingPercentEls = card.querySelectorAll('.loading-percentage, [data-progress]');
    for (const lpEl of loadingPercentEls) {
      const t = lpEl.textContent.trim() || lpEl.getAttribute('data-progress') || '';
      const m = t.match(/(\d{1,3})\s*%/);
      if (m) {
        const val = parseInt(m[1]);
        if (val >= 0 && val <= 100) percentValues.push(val);
      }
    }
  }
  
  percentValues = [...new Set(percentValues)];

  if (percentValues.length > 0) {
    const avg = percentValues.reduce((a, b) => a + b, 0) / percentValues.length;
    const isUpscaling = cardText.toLowerCase().includes('upscaling');
    if (isUpscaling) {
      return { status: 'UPSCALING', progress: 99, videos: [{ id: 0, status: 'UPSCALING', progress: 99 }], error: null };
    }
    return { 
      status: 'CREATING', 
      progress: avg, 
      videos: percentValues.map((p, i) => ({ id: i, status: 'CREATING', progress: p })),
      error: null 
    };
  }

  // ── 3. Check for Queued State ──
  const isQueued = [card, ...Array.from(card.querySelectorAll('*'))]
    .some(d => {
      if (d.children.length > 0) return false;
      if (d.offsetParent === null && d !== card) return false;
      const style = window.getComputedStyle(d);
      if (style.opacity === '0' || style.visibility === 'hidden') return false;
      const t = d.textContent.trim().toLowerCase();
      return t.includes('hàng đợi') || t.includes('queued') || t.includes('đang chuẩn bị') || t.includes('preparing');
    });

  if (isQueued) {
    return { status: 'QUEUED', progress: 0, videos: [{ id: 0, status: 'QUEUED', progress: 0 }], error: null };
  }

  // ── 4. Check for Strict Error State (Only if no Progress and no Queued) ──
  // Use exact match to avoid false positives if prompt contains "thử lại" etc.
  const isError = [card, ...Array.from(card.querySelectorAll('*'))].some(d => {
      if (d.children.length > 0) return false;
      const style = window.getComputedStyle(d);
      if (style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none') return false;
      const t = d.textContent.trim().toLowerCase();
      return t.includes('không thành công') || 
             t.includes('tạo thất bại') || 
             t.includes('generation failed') || 
             t.includes("couldn't generate") || 
             t.includes("can't generate") || 
             t.includes('có lỗi xảy ra') || 
             t.includes('an error occurred');
  });

  if (isError) {
      return { status: 'ERROR', error: 'Không thành công (Policy/Error)', progress: 0, videos: [] };
  }

  // NEW UI: flow-pending-tile is present → card is generating, just hasn't shown % yet
  if (card.tagName.toLowerCase() === 'flow-pending-tile' || card.querySelector('flow-pending-tile')) {
    return { status: 'CREATING', progress: 2, videos: [{ id: 0, status: 'CREATING', progress: 2 }], error: null };
  }

  // Case A: No percentage AND no video AND no error AND no queue → still initializing / waiting
  return { status: 'CREATING', progress: 2, videos: [], error: null };
}

  // 1. Find all video slots in the card

function findPromptTextarea() {
  // ==================== HARDCODED FLOW UI SELECTOR (2025) ====================
  // Priority 0: New Google Flow UI (August 2024+) uses ProseMirror instead of Slate
  const prosemirrorEditors = document.querySelectorAll('.ProseMirror[contenteditable="true"]');
  for (const el of prosemirrorEditors) {
    if (el.offsetParent !== null && !el.closest('[role="article"]')) {
      addLog('info', '[ProseMirror] Found new prompt editor');
      return el;
    }
  }

  // KEY INSIGHT: The page has TWO Slate editors:
  //   1. Search box (top) - does NOT have aria-multiline="true"
  //   2. Prompt editor (bottom) - HAS aria-multiline="true" AND zindex="-1"
  // We MUST check for aria-multiline="true" to get the correct one.

  // Priority 1: Most specific - aria-multiline=true (ONLY on prompt editor, not search)
  const multilineEditors = document.querySelectorAll(
    'div[data-slate-editor="true"][role="textbox"][contenteditable="true"][aria-multiline="true"]'
  );
  for (const el of multilineEditors) {
    if (el.offsetParent !== null && !el.closest('[role="article"]')) {
      addLog('info', '[Slate] Found via aria-multiline=true (prompt editor)');
      return el;
    }
  }

  // Priority 2: zindex="-1" is also unique to the prompt editor
  const zIndexEditors = document.querySelectorAll(
    'div[data-slate-editor="true"][contenteditable="true"][zindex="-1"]'
  );
  for (const el of zIndexEditors) {
    if (el.offsetParent !== null && !el.closest('[role="article"]')) {
      addLog('info', '[Slate] Found via zindex=-1 (prompt editor)');
      return el;
    }
  }

  // Priority 3: Placeholder text match - "Bạn muốn tạo gì?" is only on prompt editor
  const placeholders = document.querySelectorAll('[data-slate-placeholder="true"]');
  for (const p of placeholders) {
    const txt = p.textContent || '';
    if (txt.includes('tạo gì') || txt.includes('Bạn muốn') || txt.includes('What would') || txt.includes('create') || txt.includes('Create')) {
      const editor = p.closest('[data-slate-editor="true"]') || p.closest('[contenteditable="true"]');
      if (editor && editor.offsetParent !== null && !editor.closest('[role="article"]')) {
        addLog('info', '[Slate] Found via placeholder text match');
        return editor;
      }
    }
  }

  // Priority 4: Fall back to LAST Slate editor in DOM (search is usually first, prompt is last)
  const allEditors = document.querySelectorAll(
    'div[data-slate-editor="true"][role="textbox"][contenteditable="true"]'
  );
  const editorArr = Array.from(allEditors).filter(
    el => el.offsetParent !== null && !el.closest('[role="article"]')
  );
  if (editorArr.length > 0) {
    // Pick the LAST one - search is first in DOM, prompt editor is last
    const el = editorArr[editorArr.length - 1];
    addLog('info', `[Slate] Found via last-in-DOM fallback (${editorArr.length} candidates)`);
    return el;
  }



  return null;
}

function findCreateButton() {
  // ==================== HARDCODED FLOW UI SELECTOR (2025) ====================
  // Priority 0: New Google Flow UI (August 2024+)
  const newBtn = document.querySelector('button.generate-icon-button');
  if (newBtn && newBtn.offsetParent !== null && !newBtn.closest('[role="article"]')) {
    addLog('info', '[Create] Found new generate button');
    return newBtn;
  }

  // NOTE: There are TWO buttons with span "Tạo":
  //   1. add_2 icon + aria-haspopup="dialog" → "Add media/input" button (WRONG)
  //   2. arrow_forward icon, no aria-haspopup="dialog" → REAL Create video button (CORRECT)
  // Must check icon to distinguish them!

  // Strategy: Find the Slate editor's parent container, then find arrow_forward button inside
  // Must skip editors inside result cards (role="article") — after image generation,
  // those cards may contain their own Slate editors and querySelector() picks them first!
  let editorEl = null;
  const allEds = document.querySelectorAll(
    'div[data-slate-editor="true"][aria-multiline="true"], div[data-slate-editor="true"][zindex="-1"]'
  );
  for (const ed of allEds) {
    if (!ed.closest('[role="article"]') && ed.offsetParent !== null) {
      editorEl = ed;
      break;
    }
  }

  if (editorEl) {
    // Walk up to find the top-level prompt bar container (contains editor + create button)
    let container = editorEl.parentElement;
    for (let i = 0; i < 15; i++) {
      if (!container) break;
      // Find an arrow_forward button inside this container
      const icons = container.querySelectorAll('i.google-symbols, i[class*="google-symbols"], mat-icon, i.material-icons');
      for (const icon of icons) {
        if (icon.textContent.trim() === 'arrow_forward') {
          const btn = icon.closest('button');
          if (btn && btn.offsetParent !== null) {
            addLog('info', '[Create] Found via editor container → arrow_forward icon');
            return btn;
          }
        }
      }
      container = container.parentElement;
    }
  }

  // Priority 2: Global search for arrow_forward button NOT inside a card
  const icons = document.querySelectorAll('i.google-symbols, i[class*="google-symbols"]');
  for (const icon of icons) {
    if (icon.textContent.trim() === 'arrow_forward') {
      const btn = icon.closest('button');
      if (btn && btn.offsetParent !== null && !btn.closest('[role="article"]')) {
        addLog('info', '[Create] Found via arrow_forward icon (global)');
        return btn;
      }
    }
  }

  // Priority 3: "Tạo" span + must have arrow_forward icon (NOT add_2)
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    if (!btn.offsetParent || btn.closest('[role="article"]')) continue;
    // Must have arrow_forward icon — filters out add_2 button
    const icon = btn.querySelector('i.google-symbols, i[class*="google-symbols"]');
    if (!icon || icon.textContent.trim() !== 'arrow_forward') continue;
    const spans = btn.querySelectorAll('span');
    for (const span of spans) {
      const style = span.getAttribute('style') || '';
      const txt = span.textContent.trim();
      if ((txt === 'Tạo' || txt === 'Create') && style.includes('overflow')) {
        addLog('info', `[Create] Found via hidden span + arrow_forward: "${txt}"`);
        return btn;
      }
    }
  }

  return null;
}

// Removed duplicate findDownloadButtonsInCard

// switchToGridView is defined at top of file (with dag9 settings_2 support)

// ==================== SWITCH TO VIDEO MODE ====================
async function switchToVideoMode() {
  // ==================== HARDCODED FLOW UI SELECTOR (2025) ====================
  // From live DOM: buttons inside settings dropdown have aria-controls ending in "-VIDEO"
  // This is called ONCE at startup (not per-prompt), because the mode persists.
  // NOTE: The settings dropdown must be OPEN first - but at startup it's closed.
  // Since the settings menu is a DROPDOWN (not always visible), we rely on applyFlowSettings()
  // to handle the Video mode selection per-prompt instead.
  // This function only tries to find Video tab on the main UI (if it's visible).
  try {
    // Look for Video tab button in the main visible UI (not in dropdown)
    // In some Flow UI versions, mode tabs are always visible on page
    const videoTabBtns = document.querySelectorAll('[role="tab"][aria-controls$="-VIDEO"], [role="tab"][aria-controls*="-VIDEO"]');
    for (const btn of videoTabBtns) {
      // Must not be inside a Radix dropdown (which is hidden at startup)
      const isInDropdown = btn.closest('[data-radix-menu-content], [role="menu"], [data-radix-popper-content-wrapper]');
      if (!isInDropdown && btn.offsetParent) {
        const isActive = btn.getAttribute('aria-selected') === 'true' || btn.getAttribute('data-state') === 'active';
        if (!isActive) {
          btn.click();
          await wait(500);
          addLog('info', '🎬 Switched to Video mode (main UI tab)');
        } else {
          addLog('info', '🎬 Already in Video mode');
        }
        return;
      }
    }
    addLog('info', '🎬 Video mode will be applied per-prompt via settings dropdown');
  } catch (e) {
    addLog('warning', `switchToVideoMode error: ${e.message}`);
  }
}

// ==================== APPLY FLOW SETTINGS (PER PROMPT) ====================
// Opens the settings dropdown and selects the correct options:
// - Video mode (not Image)
// - Aspect ratio (Landscape/Portrait)
// - Output count (x1/x2/x3/x4)
// Uses Radix UI dropdown with aria-controls attribute matching.
async function applyFlowSettings() {
  try {
    // Step 1: Find the settings button (Video□x2) and click with FULL mouse events
    // Radix UI requires a convincing pointer sequence to open dropdown
    const settingsBtn = findSettingsDropdownButton();
    if (!settingsBtn) {
      addLog('warning', '[Settings] Settings button not found, skipping');
      return;
    }

    // Full mouse event sequence (not just .click()) - needed for Radix UI
    const btnRect = settingsBtn.getBoundingClientRect();
    const bx = btnRect.left + btnRect.width / 2;
    const by = btnRect.top + btnRect.height / 2;
    const bOpts = { bubbles: true, cancelable: true, clientX: bx, clientY: by };

    settingsBtn.dispatchEvent(new PointerEvent('pointerover', { ...bOpts, pointerType: 'mouse' }));
    settingsBtn.dispatchEvent(new MouseEvent('mouseover', bOpts));
    settingsBtn.dispatchEvent(new PointerEvent('pointerdown', { ...bOpts, pointerType: 'mouse' }));
    settingsBtn.dispatchEvent(new MouseEvent('mousedown', bOpts));
    await wait(50);
    settingsBtn.dispatchEvent(new PointerEvent('pointerup', { ...bOpts, pointerType: 'mouse' }));
    settingsBtn.dispatchEvent(new MouseEvent('mouseup', bOpts));
    settingsBtn.dispatchEvent(new MouseEvent('click', bOpts));
    settingsBtn.click(); // Also call native click as fallback

    addLog('info', '[Settings] Clicked settings button');
    await wait(800);

    // Step 2: Wait up to 5 seconds for dropdown to appear
    let dropdown = null;
    let isNewUI = false;
    for (let i = 0; i < 10; i++) {
      // Old UI
      dropdown = document.querySelector('[data-radix-menu-content][data-state="open"]');
      if (!dropdown) dropdown = document.querySelector('[data-radix-menu-content]');
      // New UI
      if (!dropdown) {
        dropdown = document.querySelector('flow-prompt-box-settings');
        if (dropdown) isNewUI = true;
      }
      if (dropdown) break;
      await wait(500);
    }

    if (!dropdown) {
      addLog('warning', '[Settings] Dropdown did not open');
      return;
    }

    addLog('info', `[Settings] Dropdown is open (${isNewUI ? 'New UI' : 'Old UI'}), applying settings...`);

    const aspectRatio = state.settings.aspectRatio || '16:9';
    const outputCount = String(state.settings.outputCount || 2);

    if (isNewUI) {
      // === NEW UI LOGIC (August 2024+) ===
      const findToggleBtn = (text) => {
        const spans = Array.from(dropdown.querySelectorAll('span.toggle-text'));
        const span = spans.find(el => el.textContent.trim().toLowerCase() === text.toLowerCase());
        return span ? span.closest('mat-button-toggle') : null;
      };

      const clickToggleBtn = async (btn, name) => {
        if (btn && !btn.classList.contains('mat-button-toggle-checked')) {
          const btnEl = btn.querySelector('button');
          if (btnEl) {
            btnEl.click();
            addLog('info', `[Settings] Selected ${name}`);
            await wait(300);
          }
        } else if (btn) {
          addLog('info', `[Settings] Already selected ${name}`);
        }
      };

      // 1. Select Video mode
      await clickToggleBtn(findToggleBtn('video'), 'Video mode');
      // 2. Select Aspect Ratio
      await clickToggleBtn(findToggleBtn(aspectRatio), `Aspect Ratio: ${aspectRatio}`);
      // 3. Select Output Count
      await clickToggleBtn(findToggleBtn(`x${outputCount}`), `Output Count: x${outputCount}`);

    } else {
      // === OLD UI LOGIC ===
      // Step 3: Select VIDEO mode
      // Buttons have: role="tab" aria-controls="radix-:rXX:-content-VIDEO"
      
      // Video mode button
      const videoTabBtn = dropdown.querySelector('[role="tab"][aria-controls$="-content-VIDEO"]');
      if (videoTabBtn) {
        const isVideoActive = videoTabBtn.getAttribute('aria-selected') === 'true' || videoTabBtn.getAttribute('data-state') === 'active';
        if (!isVideoActive) {
          const checkSuccess = async () => videoTabBtn.getAttribute('aria-selected') === 'true' || videoTabBtn.getAttribute('data-state') === 'active';
          await clickWithRetry(videoTabBtn, checkSuccess, 3, 1000);
          addLog('info', '[Settings] Selected Video mode');
        } else {
          addLog('info', '[Settings] Already in Video mode');
        }
      }

      // Step 4: Select Aspect Ratio
      // Landscape = aria-controls$="-LANDSCAPE", Portrait = "-PORTRAIT"
      const wantPortrait = (aspectRatio === '9:16');
      const aspectTarget = wantPortrait ? '-content-PORTRAIT' : '-content-LANDSCAPE';
      const aspectBtn = dropdown.querySelector(`[role="tab"][aria-controls$="${aspectTarget}"]`);
      if (aspectBtn) {
        const isActive = aspectBtn.getAttribute('aria-selected') === 'true' || aspectBtn.getAttribute('data-state') === 'active';
        if (!isActive) {
          const checkSuccess = async () => aspectBtn.getAttribute('aria-selected') === 'true' || aspectBtn.getAttribute('data-state') === 'active';
          await clickWithRetry(aspectBtn, checkSuccess, 3, 1000);
          addLog('info', `[Settings] Selected aspect ratio: ${aspectRatio}`);
        }
      }

      // Step 5: Select Output Count (x1/x2/x3/x4)
      // Buttons have: role="tab" aria-controls ending in "-content-1", "-content-2", etc.
      const countBtn = dropdown.querySelector(`[role="tab"][aria-controls$="-content-${outputCount}"]`);
      if (countBtn) {
        const isActive = countBtn.getAttribute('aria-selected') === 'true' || countBtn.getAttribute('data-state') === 'active';
        if (!isActive) {
          const checkSuccess = async () => countBtn.getAttribute('aria-selected') === 'true' || countBtn.getAttribute('data-state') === 'active';
          await clickWithRetry(countBtn, checkSuccess, 3, 1000);
          addLog('info', `[Settings] Selected output count: x${outputCount}`);
        }
      }
    }

    // Step 6: Close the dropdown by pressing Escape or clicking outside
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(400);
    addLog('info', '[Settings] Settings applied ✅');

  } catch (e) {
    addLog('warning', `[Settings] applyFlowSettings error: ${e.message}`);
  }
}

// Find the settings/options button that opens the Flow dropdown
// Confirmed from DOM: The "Video □ x2" button has aria-haspopup="menu"
// and contains div[data-type="button-overlay"] - this is UNIQUE to this button!
function findSettingsDropdownButton() {
  // Priority 1: New Google Flow UI (August 2024+)
  const newBtn = document.querySelector('button.settings-trigger-button');
  if (newBtn && newBtn.offsetParent !== null && !newBtn.closest('[role="article"]')) {
    return newBtn;
  }

  const candidates = document.querySelectorAll('button[aria-haspopup="menu"]');

  for (const btn of candidates) {
    if (!btn.offsetParent || btn.closest('[role="article"]')) continue;
    const txt = btn.textContent.toLowerCase();
    
    // Mode button always has 'video', 'banana', 'imagen' and 'x'
    if (txt.includes('video') || txt.includes('banana') || txt.includes('imagen')) {
       // Check if it has a multiplier like 1x, 2x, 4x, etc.
       if (txt.match(/\d+x/)) {
           return btn;
       }
    }
  }

  // Priority 2: Just look for '1x', '2x', '3x', '4x' in any menu button
  for (const btn of candidates) {
    if (!btn.offsetParent || btn.closest('[role="article"]')) continue;
    const txt = btn.textContent.toLowerCase();
    if (txt.match(/\d+x/)) return btn;
  }

  return null;
}

// Helper: Find the ⋮ (3-dot more_vert) menu button within a specific card
function findDownloadButtonsInCard(card) {
  if (!card) return [];
  const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  // ── Strategy 1: Direct Angular Material Menu Trigger or User-defined selector ──
  const userSelector = resolveSelector('downloadBtn');
  if (userSelector) {
    const userBtns = card.querySelectorAll(userSelector);
    if (userBtns.length > 0) return Array.from(userBtns);
  }

  const menuTriggers = Array.from(card.querySelectorAll('button.mat-mdc-menu-trigger, button[aria-haspopup="menu"]'));
  if (menuTriggers.length > 0) return menuTriggers;

  const results = [];

  // ── Strategy 2: Buttons inside card with more_vert / more_horiz ──
  for (const btn of card.querySelectorAll('button')) {
    const text = btn.textContent.trim().toLowerCase();
    const label = (btn.getAttribute('aria-label') || btn.title || '').toLowerCase();
    // Material icon text content (includes check because text can be 'more_vert Khác')
    if (text.includes('more_vert') || text.includes('more_horiz') || text === '⋮' || text === '⋯') {
      results.push(btn); continue;
    }
    // aria-label (supports both 'tuỳ' and 'tùy')
    if (label.includes('more') || label.includes('tuỳ') || label.includes('tùy') || label.includes('option') || label.includes('khác')) {
      results.push(btn); continue;
    }
    // aria-haspopup
    if (btn.getAttribute('aria-haspopup')) {
      results.push(btn); continue;
    }
    // Span/icon/mat-icon children with more_vert
    const spans = btn.querySelectorAll('span, i, svg, mat-icon');
    for (const s of spans) {
      const st = s.textContent.trim();
      if (st === 'more_vert' || st === 'more_horiz' || st === '⋮') {
        results.push(btn); break;
      }
    }
  }

  if (results.length > 0) {
    // addLog('info', `Found ${results.length} menu (3-dots) buttons in card`); // Ẩn log để tránh spam
    return results;
  }

  // ── Strategy 3: Position-based — button in top-right area of card ──
  // Nút ⋮ thường nằm ở góc trên phải của card (trong 40% trên, 30% phải)
  const cardRect = card.getBoundingClientRect();
  if (cardRect.width > 0 && cardRect.height > 0) {
    const topZone  = cardRect.top + cardRect.height * 0.45;
    const rightZone = cardRect.left + cardRect.width * 0.65;
    for (const btn of card.querySelectorAll('button')) {
      if (!isVis(btn)) continue;
      const r = btn.getBoundingClientRect();
      if (r.top < topZone && r.left > rightZone) {
        // addLog('info', `Found 3-dot button via position (top=${Math.round(r.top)}, left=${Math.round(r.left)})`); // Ẩn log tránh spam
        return [btn];
      }
    }
  }

  // addLog('info', `Found 0 download buttons in card (Strategy 4)`); // Đã ẩn log này để tránh gây hiểu nhầm
  return [];
}

// ==================== DOWNLOAD LOGIC (SIMPLIFIED) ====================
// Flow UI uses Radix UI for its drop-downs. Radix relies on Pointer events to manage menu states.
// BUT Google's proprietary React actions (like the actual download sequence) rely on native onClick.

// Opens DropdownMenu trigger (supports both legacy Radix UI and Angular Material MDC)
function radixOpenMenu(element) {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const opts = { view: window, bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  
  element.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', button: 0, buttons: 1 }));
  element.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
  element.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', button: 0, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0, buttons: 0 }));
  
  // CRITICAL FIX: Angular Material MDC requires a real 'click' event.
  // We MUST call stopPropagation() so the click doesn't bubble up to the video card container,
  // which would otherwise open the video detail modal (large overlay).
  const clickEvent = new MouseEvent('click', { ...opts });
  clickEvent.stopPropagation();
  element.dispatchEvent(clickEvent);
}

// Submenu expansion (supports keyboard a11y, mouseenter, and click for Angular Material)
function radixKeyboardExpandSubmenu(element) {
  if (!element) return;
  
  if (typeof element.focus === 'function') {
    element.focus();
  }

  const kbOpts = { view: window, bubbles: true, cancelable: true };
  
  // ArrowRight and Enter are standard Radix Submenu Expansion bindings
  element.dispatchEvent(new KeyboardEvent('keydown', { ...kbOpts, key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }));
  element.dispatchEvent(new KeyboardEvent('keyup', { ...kbOpts, key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }));

  element.dispatchEvent(new KeyboardEvent('keydown', { ...kbOpts, key: 'Enter', code: 'Enter', keyCode: 13 }));
  element.dispatchEvent(new KeyboardEvent('keyup', { ...kbOpts, key: 'Enter', code: 'Enter', keyCode: 13 }));
}

// ==================== ROBUST CLICK ====================
// Tránh lỗi click hụt do lag UI, click xong đợi 2s, nếu checkSuccessFn false thì click lại
async function clickWithRetry(element, checkSuccessFn, maxRetries = 3, retryDelay = 2000) {
    if (!element) return false;
    for (let i = 0; i < maxRetries; i++) {
        try {
            radixOpenMenu(element);
            element.click();
        } catch (e) {}
        
        await wait(retryDelay);
        if (await checkSuccessFn()) {
            return true;
        } else {
            addLog('warning', `⚠️ Click không phản hồi, đang thử lại (Lần ${i + 1}/${maxRetries})...`);
        }
    }
    return false;
}

// Each video downloads its own files sequentially - no global queue

async function startDownloadForVideo(video) {
  if (!video || !state.settings.autoDownload) return;
  if (video._isDownloading) {
    addLog('info', `[${video.promptIndex}] Already downloading, skip`);
    return;
  }
  if (video.downloaded) {
    return;
  }

  video._isDownloading = true;
  const promptIndex = video.promptIndex;

  addLog('info', `[${promptIndex}] 🎬 Starting sequential download...`);

  try {
    let tiles = video.cardElements || [];
    
    // Recovery Phase: If tiles are empty (or dead JSON objects from saveProject), reconstruct them from trackedTileIds string array
    if (tiles.length === 0 || !(tiles[0] instanceof Element || tiles[0] instanceof Node)) {
        if (video.trackedTileIds && video.trackedTileIds.length > 0) {
            tiles = new Array(video.trackedTileIds.length).fill(null);
            addLog('info', `[${promptIndex}] Hydrating ${tiles.length} tile slots from tracking memory.`);
        }
    }

    if (!tiles || tiles.length === 0) throw new Error('No generated tiles found for this prompt');

    const startFrom = video.downloadedCount || 0;
    const totalToDownload = tiles.length;
    video.totalVideos = totalToDownload; // Sync total videos if not set

    if (startFrom >= totalToDownload) {
      addLog('info', `[${promptIndex}] All videos already downloaded (${startFrom}/${totalToDownload})`);
      video.downloaded = true;
      video._isDownloading = false;
      return;
    }

    addLog('info', `[${promptIndex}] Will download ${totalToDownload - startFrom} videos (from ${startFrom + 1} to ${totalToDownload})`);

    // Download each video tile ONE BY ONE
    for (let i = startFrom; i < totalToDownload; i++) {
      const videoNum = i + 1;
      addLog('info', `[${promptIndex}] 📥 Downloading ${videoNum}/${totalToDownload}...`);

      try {
        let tile = tiles[i];

        // If the tile element is missing, invalid (e.g. from JSON), or detached from DOM
        if (!tile || !(tile instanceof Node) || !document.body.contains(tile)) {
          const tileId = video.trackedTileIds && video.trackedTileIds[i];
          if (tileId) tile = getTileById(tileId);
        }

        // Check if the tile is a failed generation (no media) to skip it gracefully!
        // ONLY call querySelector if it's actually a valid DOM Node
        const hasMedia = tile && (tile instanceof Node) && (typeof tile.querySelector === 'function') && tile.querySelector('video, img, a[href^="/edit/"]');
        if (tile && (tile instanceof Node) && !hasMedia) {
             addLog('warning', `[${promptIndex}] Video ${videoNum}/${totalToDownload} bị lỗi từ Google (Không thể tạo video). Đã skip.`);
             video.downloadedCount = (video.downloadedCount || 0) + 1; // Đánh dấu là đã xử lý
             continue; // Bỏ qua mượt mà, tải video còn lại!
        }

        // If STILL missing, physically scroll up to force React to remount it!
        if (!tile || !(tile instanceof Node) || !document.body.contains(tile)) {
          addLog('warning', `[${promptIndex}] Tile detached (Virtualized DOM). Scrolling up to recover...`);
          let recovered = false;
          
          for (let s = 0; s < 30; s++) { // Try up to 30 scrolls
            const tileId = video.trackedTileIds && video.trackedTileIds[i];
            if (tileId) tile = getTileById(tileId);
            
            if (tile && (tile instanceof Node) && document.body.contains(tile)) {
              recovered = true;
              break;
            }
            
            // Scroll up by 800px per tick on all probable scroll containers
            window.scrollBy({ top: -1000, behavior: 'auto' });
            const scrollContainers = [
                document.querySelector('c-wiz[data-is-scrollable="true"]'),
                document.documentElement,
                document.body,
                document.querySelector('[role="main"]')
            ];
            for (const sc of scrollContainers) {
                if (sc && typeof sc.scrollBy === 'function') {
                    sc.scrollBy({ top: -1000, behavior: 'auto' });
                } else if (sc) {
                    sc.scrollTop -= 1000;
                }
            }
            await wait(600);
          }
          
          if (!recovered) {
             throw new Error('Tile DOM element lost (Scroll recovery failed)');
          }
          
          // Update the tiles array reference so subsequent logic uses the correct native node
          tiles[i] = tile;
          video.cardElements = tiles; // Save it back to state too just in case
        }

        tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await wait(1000);


        // ── MỞ MENU TẢI XUỐNG BẰNG RIGHT CLICK (THEO YÊU CẦU USER) ──
        // Lệnh hover cũ không còn mở được nút 3 chấm do Google Flow đã đổi UI.
        // Ta sẽ giả lập hover vào thẻ, sau đó gọi trực tiếp Right Click (contextmenu) để mở menu tải xuống.
        const rect = tile.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            throw new Error('Tile has no size (hidden or detached).');
        }
        const bx = rect.left + rect.width / 2;
        const by = rect.top + rect.height / 2;
        const bOpts = { view: window, bubbles: true, cancelable: true, clientX: bx, clientY: by };

        // 1. Giả lập Hover
        tile.dispatchEvent(new PointerEvent('pointerover', { ...bOpts, pointerType: 'mouse' }));
        tile.dispatchEvent(new MouseEvent('mouseover', bOpts));
        tile.dispatchEvent(new MouseEvent('mouseenter', bOpts));
        await wait(500);

        // 2. Mở Context Menu (Right Click)
        const ctxEvent = new MouseEvent('contextmenu', { 
            ...bOpts,
            button: 2, 
            buttons: 2 // CRITICAL: Angular Material check 'buttons === 2' to detect right-click correctly
        });
        
        // TUYỆT ĐỐI KHÔNG dùng ctxEvent.stopPropagation() vì Flow bắt sự kiện right-click ở cấp cao hơn.
        // Nếu stopPropagation() thì Flow sẽ hiểu nhầm là Left Click và mở tung thẻ ảnh lên!
        tile.dispatchEvent(ctxEvent);
        await wait(1500); // Chờ menu xổ ra

        // [VEO] LUÔN GÁN TÊN CỤC BỘ KHI TẢI XUỐNG (không phụ thuộc vào renamedOnCloud)
        const suffix = videoNum.toString();
        const targetFilenameBase = generateFileName(video, suffix, totalToDownload);

        // --- PHASE 1: CHROME NATIVE RENAME (Bypass UI) ---
        // Thay vì dùng UI Rename của React dễ gây đơ, ta chuyển thẳng file name cho Background xử lý tự động ngầm!
        if (targetFilenameBase) {
            try { 
                chrome.runtime.sendMessage({ action: 'SET_NEXT_FILENAME', filename: targetFilenameBase }); 
                addLog('info', `[${promptIndex}] Đã đính kèm tên file ngầm: ${targetFilenameBase}`);
            } catch(e) {
                addLog('error', `[${promptIndex}] Lỗi gửi tên: ${e.message}`);
            }
        }

        // --- PHASE 2: SELECT DOWNLOAD OPTION ---
        // Context menu is already opened from the 3-dots button above.

        // Find the "Tải xuống" (Download) item inside the opened menu
        const mainMenuItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]'));
        const downloadItem = mainMenuItems.find(el => {
          const icon = el.querySelector('i.google-symbols, .google-symbols, .material-icons, mat-icon, i');
          const iconText = icon ? icon.textContent.trim().toLowerCase() : '';
          if (iconText === 'download' || iconText === 'file_download') return true;
          
          const textContent = el.textContent.toLowerCase();
          return textContent.includes('download') || textContent.includes('tải') || textContent.includes('lưu');
        });

        if (!downloadItem) {
          addLog('error', `[${promptIndex}] Download option not found in menu. UI changed or menu didn't open.`);
          throw new Error('Download option missing in menu');
        }

        await wait(500); // Give React time to breathe

        // Radix UI responds perfectly to Keyboard A11y bindings! (Theo chuẩn 1.5.0, KHÔNG gọi downloadItem.click() để tránh click xuyên xuống card dưới)
        radixKeyboardExpandSubmenu(downloadItem);
        await wait(2000); // Wait 2 seconds for the quality sub-menu to slide out

          // Select quality (Flow UI might show a sub-menu or just download)
          const subMenuItems = Array.from(document.querySelectorAll('[role="menuitem"]'));
          
          if (subMenuItems.length > 0) {
              let isVideoFormat = false;
              let isImageFormat = false;

              for (const item of subMenuItems) {
                  const text = item.textContent.toLowerCase();
                  if (text.includes('1080') || text.includes('720') || text.includes('270') || (text.includes('4k') && !text.includes('4px'))) isVideoFormat = true;
                  if (text.includes('gốc') || text.includes('original') || text.includes('nguyên bản') || text.includes('tăng ') || text.match(/\b[24]x\b/) || text.match(/\b[24]px\b/)) isImageFormat = true;
              }

              if (state.settings.runMode === 'video' && isImageFormat && !isVideoFormat) {
                  addLog('warning', `[${promptIndex}] ⚠️ Bỏ qua thẻ này do định dạng là Ảnh (Đang chạy chế độ Video).`);
                  tile.setAttribute('data-veo-ignored', 'true');
                  video.totalVideos = Math.max(0, video.totalVideos - 1);
                  saveProject();
                  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                  await wait(1000);
                  continue;
              }
              if (state.settings.runMode === 'image' && isVideoFormat && !isImageFormat) {
                  addLog('warning', `[${promptIndex}] ⚠️ Bỏ qua thẻ này do định dạng là Video (Đang chạy chế độ Ảnh).`);
                  tile.setAttribute('data-veo-ignored', 'true');
                  video.totalVideos = Math.max(0, video.totalVideos - 1);
                  saveProject();
                  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                  await wait(1000);
                  continue;
              }
          }

          const targetQualityRaw = state.settings.downloadQuality || '1080p';
          let clicked = false;
          
          const qualityMap = {
              '1080p': '1080p',
              '720p': '720p',
              '4k': '4k',
              '270p': '270p',
              'img_4k': '4k',
              'img_2k': '2k',
              'img_1k': '1k'
          };
          const tq = (qualityMap[targetQualityRaw] || targetQualityRaw).toLowerCase();

          if (subMenuItems.length > 0) {
            for (const item of subMenuItems) {
              const text = item.textContent.toLowerCase();
              if (text.includes(tq) || 
                  (targetQualityRaw === 'img_1k' && (text.includes('1k') || text.includes('gốc') || text.includes('original'))) || 
                  (targetQualityRaw === 'img_4k' && text.includes('4k')) || 
                  (targetQualityRaw === 'img_2k' && text.includes('2k'))) {
                item.click(); 
                clicked = true;
                addLog('info', `[${promptIndex}] Đã chọn độ phân giải: ${targetQualityRaw}`);
                break;
              }
            }

            if (!clicked && targetQualityRaw === '1080p') {
              for (const item of subMenuItems) {
                if (item.textContent.includes('720p')) {
                  item.click();
                  clicked = true;
                  addLog('warning', `[${promptIndex}] Fallback to 720p`);
                  break;
                }
              }
            }
          } else {
            // If there's no quality submenu, the main downloadItem click above might have already initiated the download!
            clicked = true;
            addLog('info', `[${promptIndex}] Clicked download (No sub-quality menu found)`);
          }

          if (!clicked) throw new Error('Failed to select quality');

          // ================= UI INTERACTION COMPLETE ==================

          // --- ĐỒNG BỘ: CHỜ TRÌNH DUYỆT BẮT ĐẦU TẢI XUỐNG THỰC SỰ ---
          // Google Flow dùng Ajax kéo Video ngầm từ Server trước khi gọi Native Download của Chrome.
          // Phải chờ sự kiện này tải xong, nếu không vòng lặp chạy tiếp sẽ phá hỏng thứ tự Đặt Tên File!
          if (targetFilenameBase) {
              addLog('info', `[${promptIndex}] Đang chờ máy chủ xuất file (khoảng 3-15s)...`);
              await new Promise((resolve) => {
                  let timeout;
                  const listener = (msg) => {
                      if (msg.action === 'DOWNLOAD_STARTED') {
                          if (msg.filename === targetFilenameBase) {
                              chrome.runtime.onMessage.removeListener(listener);
                              clearTimeout(timeout);
                              resolve();
                          }
                      }
                  };
                  chrome.runtime.onMessage.addListener(listener);
                  // Timeout 120s phòng hờ Google Flow Server load nặng khi xuất 1080p
                  timeout = setTimeout(() => {
                      chrome.runtime.onMessage.removeListener(listener);
                      addLog('warning', `[${promptIndex}] Đợi hệ thống xuất video quá lâu (120s) - bỏ qua chờ...`);
                      resolve();
                  }, 120000);
              });
              addLog('success', `[${promptIndex}] Bắt đầu tải tệp: ${targetFilenameBase}`);
          } else {
             addLog('success', `[${promptIndex}] Đã xác nhận lệnh tải (Không đổi tên).`);
             await wait(3000); // Chờ dự phòng
          }

          video.downloadedCount = (video.downloadedCount || 0) + 1;
          updateUI();
          saveProject();

          // Just wait briefly before proceeding to next video in this prompt
          if (i < totalToDownload - 1) await wait(2000);

        } catch (error) {
          addLog('error', `[${promptIndex}] Video ${videoNum} failed: ${error.message}`);
          throw error;
        }
    }

    if (video.downloadedCount >= video.totalVideos) {
      video.downloaded = true;
      addLog('success', `[${promptIndex}] 🎉 All complete!`);
      saveProject(); // Bắt buộc phải lưu LẠI cờ downloaded=true vào bộ nhớ!
    }

  } catch (error) {
    addLog('error', `[${promptIndex}] Download failed: ${error.message}`);
    throw error; // Rethrow to mainLoop to actually trigger retries and prevent infinite loop!
  } finally {
    video._isDownloading = false;
    updateUI();
  }
}

function getPromptIndexNumber(promptIndex) {
    const s = state.settings || {};
    const mode = s.renameMode || 'default';
    if (mode === 'custom_list') {
        return promptIndex; // For custom_list, just fallback to sequential 1,2,3 for prefixing the prompt text in Flow UI
    }
    const startIndex = parseInt(s.renameStartIndex) || 1;
    return startIndex + promptIndex - 1;
}

function generateFileName(video, suffix, totalItems) {
    const s = state.settings || {};
    const mode = s.renameMode || 'default';
    const startIndex = parseInt(s.renameStartIndex) || 1;
    const promptIndex = video.promptIndex; 

    // Custom List Mode
    if (mode === 'custom_list' && s.renameCustomList) {
        const lines = s.renameCustomList.split('\n').map(l => l.trim()).filter(l => l);
        const customName = lines[promptIndex - 1];
        if (customName) {
            // Keep only letters, numbers, underscores, and hyphens. Everything else becomes '_'
            const safeCustomName = customName.replace(/[^\p{L}\p{N}_-]/gu, '_').replace(/_+/g, '_').replace(/_+$/, '').trim();
            if (totalItems === 1) return safeCustomName;
            return `${safeCustomName}_${suffix}`;
        }
    }

    // Default Mode
    let basePrefix = promptIndex.toString();
    const matchPrefix = video.promptText.match(/^(\d+)[\)\.]\s*/);
    if (matchPrefix) {
        basePrefix = matchPrefix[1];
    } else {
        basePrefix = (startIndex + promptIndex - 1).toString();
    }
    
    const prefix = basePrefix.padStart(2, '0');
    // Keep only letters, numbers, underscores, and hyphens
    const safePrompt = video.promptText.replace(/^(\d+)[\)\.]\s*/, '').replace(/[^\p{L}\p{N}_-]/gu, '_').replace(/_+/g, '_').substring(0, 30).replace(/_+$/, '').trim();
    
    return totalItems === 1 ? `${prefix}_${safePrompt}` : `${prefix}_${safePrompt}_${suffix}`;
}

// Local fork: original internal-API Cloud rename implementation removed.
// A UI-only rename implementation is declared near the end of this file.

async function downloadProjectAsZip() {
    addLog('info', '🔍 Đang tìm nút ⋮ Menu Dự Án trong header...');

    // ── TÌM TRỰC TIẾP NÚT ⋮ (more_vert) TRONG HEADER ──
    // Thay vì duyệt tất cả menu buttons từ trái sang phải (chậm, click nhầm),
    // ta filter chính xác: icon more_vert + không trong card + ở vùng header (top < 150px)
    //
    // Dựa trên UI Flow: header chứa [filter] [+] [film] [settings] [?] [⋮]
    // Chỉ nút ⋮ (more_vert) mới có "Tải dự án xuống" trong menu của nó.

    const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(b => b.offsetParent !== null) // Chỉ visible buttons
        .filter(b => !b.closest('[data-tile-id]') && !b.closest('[role="article"]')); // Không trong card

    // Helper: kiểm tra button có icon more_vert hoặc aria-label phù hợp
    const hasMoreVert = (btn) => {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('lựa chọn khác') || label.includes('more options') || label.includes('tùy chọn') || label.includes('tuỳ chọn')) return true;
        const icons = btn.querySelectorAll('i, span, svg, mat-icon');
        for (const ic of icons) {
            if (ic.textContent.trim() === 'more_vert') return true;
        }
        return btn.textContent.trim() === 'more_vert';
    };

    let globalMenuBtn = null;

    // Ưu tiên 1: Tìm nút more_vert trong header zone (top < 150px của viewport)
    // → Đây chính xác là nút ⋮ góc phải trên cùng
    const headerBtns = allBtns
        .filter(b => hasMoreVert(b))
        .map(b => ({ btn: b, rect: b.getBoundingClientRect() }))
        .filter(({ rect }) => rect.top >= 0 && rect.top < 150 && rect.width > 0);

    if (headerBtns.length > 0) {
        // Nếu có nhiều more_vert trong header, lấy cái RIGHTMOST (nút ⋮ trên cùng bên phải cạnh Settings/Avatar)
        headerBtns.sort((a, b) => b.rect.right - a.rect.right);
        globalMenuBtn = headerBtns[0].btn;
        addLog('info', `🎯 Tìm thấy nút ⋮ trong header (top=${Math.round(headerBtns[0].rect.top)}px, right=${Math.round(headerBtns[0].rect.right)}px)`);
    }

    // Fallback: Nếu header zone không có → lấy nút more_vert RIGHTMOST trên trang
    // (không trong card) — thường vẫn đúng vì nút ⋮ dự án ở góc phải nhất
    if (!globalMenuBtn) {
        const allMoreVert = allBtns
            .filter(b => hasMoreVert(b))
            .map(b => ({ btn: b, rect: b.getBoundingClientRect() }))
            .filter(({ rect }) => rect.width > 0)
            .sort((a, b) => b.rect.right - a.rect.right);

        if (allMoreVert.length > 0) {
            globalMenuBtn = allMoreVert[0].btn;
            addLog('warning', `⚠️ Không tìm thấy trong header zone — dùng rightmost more_vert làm fallback`);
        }
    }

    if (!globalMenuBtn) {
        throw new Error("Không tìm thấy nút ⋮ (more_vert) ngoài header của trang Flow");
    }

    // ── MỞ MENU ──
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(300);

    radixOpenMenu(globalMenuBtn);
    globalMenuBtn.click(); // Fallback native click cho Angular Material
    await wait(1500);

    // ── TÌM OPTION "TẢI DỰ ÁN XUỐNG" (NÚT ĐẦU TIÊN TRONG MENU) ──
    const menuItems = Array.from(document.querySelectorAll('.mat-mdc-menu-panel [role="menuitem"], [role="menu"] [role="menuitem"], [role="menuitem"], [role="menuitemradio"]'));
    let foundDownloadItem = null;

    for (const item of menuItems) {
        const text = item.textContent.toLowerCase();
        const icon = item.querySelector('i.google-symbols, .google-symbols, i, svg, mat-icon');

        if (text.includes('tải dự án') || text.includes('download project') ||
            text.includes('tải xuống') || text.includes('zip') ||
            text.includes('tải tất cả') || text.includes('download all')) {
            foundDownloadItem = item;
            break;
        }
        if (icon && (icon.textContent.trim() === 'download' || icon.textContent.trim() === 'file_download')) {
            foundDownloadItem = item;
            break;
        }
    }

    // Theo đúng cấu trúc menu: Option đầu tiên luôn là "Tải dự án xuống"
    if (!foundDownloadItem && menuItems.length > 0) {
        foundDownloadItem = menuItems[0];
        addLog('info', `🎯 Đã chọn option đầu tiên trong menu dự án: "${foundDownloadItem.textContent.trim()}"`);
    }

    if (!foundDownloadItem) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        throw new Error("Mở được menu ⋮ nhưng không thấy option 'Tải dự án xuống' — UI Flow có thể đã thay đổi");
    }

    addLog('success', `✅ Tìm thấy "Tải dự án xuống", đang click...`);
    const checkSuccess = async () => {
        return !document.body.contains(foundDownloadItem) || foundDownloadItem.getAttribute('data-state') === 'closed';
    };
    const success = await clickWithRetry(foundDownloadItem, checkSuccess, 3, 2000);
    if (!success) {
        throw new Error("Không thể click vào nút tải xuống (hụt 3 lần).");
    }
}

// Removed legacy triggerDownloadIfNeeded logic

// ==================== PROJECT SAVE/LOAD ====================
async function saveProject() {
  if (!state.projectName) {
    if (state.prompts.length > 0) {
      // Auto-generate name if not set
      const date = new Date().toISOString().slice(0, 10);
      state.projectName = `AutoSave_${date}_${Date.now()}`;
    } else {
      return;
    }
  }

  // Create clean copy without DOM elements and ephemeral runtime states
  const cleanVideos = state.videos.map(v => {
    const { cardElement, _existingCards, _isDownloading, _downloadQueued, _preClickTopIds, ...rest } = v;
    return rest;
  });

  const projectData = {
    name: state.projectName,
    timestamp: Date.now(),
    prompts: state.prompts,
    videos: cleanVideos,
    settings: state.settings,
    _hasReloadedBeforeDownload: state._hasReloadedBeforeDownload || false,
    _hasReloadedAfterRename: state._hasReloadedAfterRename || false,
    _hasReloadedAtEnd: state._hasReloadedAtEnd || false,
    startTime: state.startTime // Save start time for elapsed calculation
  };

  try {
    // Save to storage (shared)
    let { veoProjects = {} } = await chrome.storage.local.get('veoProjects');
    
    // Tự động dọn dẹp nếu người dùng là bản FREE và bộ nhớ sắp đầy (>4.5MB)
    if (state.userPlan === 'FREE' && state.userRole !== 'ADMIN') {
        const bytesInUse = await new Promise(resolve => {
            if (chrome.storage && chrome.storage.local && chrome.storage.local.getBytesInUse) {
                chrome.storage.local.getBytesInUse(null, resolve);
            } else {
                resolve(0);
            }
        });
        
        if (bytesInUse > 4500000) {
            const newVeoProjects = {};
            if (veoProjects[state.projectName]) {
                newVeoProjects[state.projectName] = veoProjects[state.projectName];
            }
            veoProjects = newVeoProjects;
            addLog('info', '🗑️ Đã tự động dọn dẹp bộ nhớ dự án cũ do đầy dung lượng (Gói FREE).');
        }
    }

    veoProjects[state.projectName] = projectData;
    await chrome.storage.local.set({ veoProjects });
    if (state.isRunning && state.projectName) {
      chrome.storage.local.set({ activeRunningProject: state.projectName });
    }

    // Notify Side Panel to update dropdown
    chrome.runtime.sendMessage({
      action: 'SAVE_PROJECT',
      data: projectData
    }).catch(() => { });
    
    return true;
  } catch (error) {
    if (error.message && error.message.toLowerCase().includes('quota')) {
      if (state.isRunning) {
        addLog('error', '⛔ BỘ NHỚ LƯU TRỮ ĐÃ ĐẦY! Vui lòng bấm vào Quản lý dự án để xóa bớt các dự án cũ.');
        state.isRunning = false;
        chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED', summary: '⛔ Dừng do đầy bộ nhớ' }).catch(() => { });
      }
    } else {
      console.error("Lỗi khi lưu project:", error);
    }
    return false;
  }
}

async function loadProject(projectName, isAutoResuming = false) {
  const { veoProjects = {} } = await chrome.storage.local.get('veoProjects');
  const project = veoProjects[projectName];
  if (!project) return;

  state.projectName = project.name;
  state.prompts = project.prompts;
  state.videos = project.videos.map(v => {
      // 🛠️ AUTO-HEAL: Vá lỗi desync state cũ khi bị hụt mất cờ downloaded
      const healedDownloaded = v.downloaded || (v.totalVideos > 0 && (v.downloadedCount || 0) >= v.totalVideos);
      return { 
          ...v, 
          downloaded: healedDownloaded,
          promptId: v.promptId || `pid_${Date.now()}_${v.promptIndex}`, // Auto-heal for old saves
          cardElement: null, 
          _isDownloading: false,
          _downloadQueued: false, 
          _preClickTopIds: null 
      };
  });
  state.settings = { ...state.settings, ...project.settings };
  state._hasReloadedBeforeDownload = project._hasReloadedBeforeDownload || false;
  state._hasReloadedAfterRename = project._hasReloadedAfterRename || false;
  state._hasReloadedAtEnd = project._hasReloadedAtEnd || false;
  state.startTime = project.startTime || 0; // Restore start time

  // Determine if project has pending tasks
  const isFinished = state.videos.every(v => {
      if (v.status !== 'COMPLETED') return false;
      if (state.settings.autoDownload) {
          if (!v.downloaded && !v._downloadFinalFailed) {
              return false;
          }
      }
      return true;
  });

  chrome.runtime.sendMessage({
    action: 'PROJECT_LOADED',
    data: {
      prompts: state.prompts,
      settings: state.settings,
      projectName: state.projectName,
      startTime: state.startTime,
      isFinished: isFinished,
      isRunning: isAutoResuming || state.isRunning
    }
  }).catch(() => { });

  updateUI();
  addLog('success', `📂 Loaded project: ${projectName}`);
}

async function deleteProject(projectName) {
  const { veoProjects = {} } = await chrome.storage.local.get('veoProjects');
  delete veoProjects[projectName];
  await chrome.storage.local.set({ veoProjects });

  // Notify side panel to refresh dropdown
  chrome.runtime.sendMessage({
    action: 'PROJECT_DELETED',
    data: { projectName }
  }).catch(() => { });

  addLog('success', `Deleted project: ${projectName}`);
}

// ==================== INIT ====================
function init() {
  if (window !== window.top || window.location.search.includes('veo_extra_window=true')) {
    return; // Không chạy automation polling hay auto-resume trong iframe hoặc popup Extra Tools
  }
  setInterval(monitorCards, CHECK_INTERVAL);
  setInterval(simulateScroll, SCROLL_INTERVAL);
  // Watchdog removed for smarter native processing constraints

  // Load settings and check for Auto-Resume flag
  chrome.storage.local.get(['veoSettings', 'autoResumeProject', 'activeRunningProject']).then(({ veoSettings, autoResumeProject, activeRunningProject }) => {
    if (veoSettings) {
      state.settings = { ...state.settings, ...veoSettings };
    }

    const projectToResume = autoResumeProject || activeRunningProject;
    if (projectToResume) {
        // Xoá cờ tự động chạy ngay để tránh vòng lặp F5 nếu có lỗi
        chrome.storage.local.remove(['autoResumeProject']);
        
        state.isRunning = true;
        // Báo Sidepanel cập nhật UI "Đang chạy" ngay lập tức để không bị giật sang nút Tiếp tục
        chrome.runtime.sendMessage({ action: 'AUTOMATION_RESUMED' }).catch(() => {});
        
        // Đợi 3 giây cho React xây dựng xong DOM của Flow trước khi Resume
        setTimeout(() => {
            loadProject(projectToResume, true).then(() => {
                if (state.projectName) {
                    addLog('info', `🔄 Tự động khôi phục quá trình Tải cho dự án: ${state.projectName}`);
                    state.isRunning = true;
                    chrome.storage.local.set({ activeRunningProject: state.projectName });
                    // Báo Sidepanel cập nhật UI "Đang chạy"
                    chrome.runtime.sendMessage({ action: 'AUTOMATION_RESUMED' }).catch(() => {});
                    chrome.runtime.sendMessage({
                        action: 'UPDATE_PROGRESS',
                        data: {
                            projectName: state.projectName,
                            summary: 'Đang Tải Xuống (Auto-Resume)...',
                            isRunning: true
                        }
                    }).catch(() => {});
                    mainLoop(); // Kích hoạt chạy tiếp
                }
            });
        }, 3000);
    }
  });
}


function veoScrollBy(amount) {
    window.scrollBy({ top: amount, behavior: 'smooth' });
    const scrollContainers = [
        document.querySelector('c-wiz[data-is-scrollable="true"]'),
        document.querySelector('div[role="main"]'),
        document.querySelector('.Oa106d'),
        document.querySelector('c-wiz[role="main"]')
    ];
    for (const sc of scrollContainers) {
        if (sc && typeof sc.scrollBy === 'function') {
            sc.scrollBy({ top: amount, behavior: 'smooth' });
        }
    }
}

function simulateScroll() {
  if (!state.isRunning) return;
  if (!state.settings.randomScroll) return; // Chỉ chạy khi bật tính năng này
  
  if (Math.random() < 0.3) {
    const scrollAmount = (Math.random() * 300 - 50); // Cuộn lên hoặc xuống một chút
    
    // Thử cuộn trên window trước
    veoScrollBy(scrollAmount);
  }
}

init();


// ============================================================================
// EXTRA TOOLS IN-PAGE OVERLAY (SAME-ORIGIN)
// ============================================================================
let extraToolsOverlay = null;
let extraToolsTabBar = null;
let extraToolsIframeContainer = null;
let extraToolsOpenTabs = [];

function createExtraToolsOverlay() {
    if (extraToolsOverlay) return;

    try {
        document.body.style.zoom = '1';
        document.documentElement.style.zoom = '1';
    } catch(e) {}

    extraToolsOverlay = document.createElement('div');
    extraToolsOverlay.id = 'veo-extra-tools-overlay';
    extraToolsOverlay.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
        margin: 0 !important;
        padding: 0 !important;
        box-sizing: border-box !important;
        background-color: #0f172a !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif !important;
    `;

    // Tab Bar
    extraToolsTabBar = document.createElement('div');
    extraToolsTabBar.style.cssText = `
        display: flex; background: #0f172a; padding: 8px 10px 0 10px;
        overflow-x: auto; border-bottom: 1px solid #334155; flex-shrink: 0;
    `;

    // Iframe Container
    extraToolsIframeContainer = document.createElement('div');
    extraToolsIframeContainer.style.cssText = `
        flex: 1 !important;
        position: relative !important;
        background: #0f172a !important;
        width: 100% !important;
        height: 100% !important;
        min-height: 0 !important;
        overflow: hidden !important;
    `;

        
    // Warning Header
    const warningHeader = document.createElement('div');
    warningHeader.style.cssText = `
        background: #1e293b; color: #fbbf24;
        padding: 6px 15px; font-size: 13px; font-weight: bold;
        border-bottom: 1px solid #334155; display: flex; align-items: center; flex-shrink: 0;
    `;
    const marquee = document.createElement('marquee');
    marquee.scrollAmount = 5;
    marquee.textContent = '⚠️ LƯU Ý: Tùy thuộc vào loại tài khoản Google (Free, Pro, Ultra) bạn đang dùng mà tốc độ và lượt gọi Agent (AI) sẽ bị giới hạn theo quy định của Google Flow. (NOTE: Depending on your Google account type, Agent/AI calls may be limited by Google Flow policies.)';
    warningHeader.appendChild(marquee);
    extraToolsOverlay.appendChild(warningHeader);

    extraToolsOverlay.appendChild(extraToolsTabBar);
    extraToolsOverlay.appendChild(extraToolsIframeContainer);

    (document.documentElement || document.body).appendChild(extraToolsOverlay);
}

function openExtraToolTab(url, title) {
    if (!extraToolsOverlay) createExtraToolsOverlay();
    extraToolsOverlay.style.display = 'flex';

    // Check if tab exists
    const existingIndex = extraToolsOpenTabs.findIndex(t => t.url === url);
    if (existingIndex !== -1) {
        switchExtraToolTab(url);
        return;
    }

    // Create Tab
    const tabEl = document.createElement('div');
    tabEl.style.cssText = `
        background: #1e293b; color: #94a3b8;
        padding: 8px 16px; border-radius: 8px 8px 0 0;
        margin-right: 6px; cursor: pointer; display: flex; align-items: center;
        gap: 10px; font-size: 14px; border: 1px solid #334155; border-bottom: none;
        white-space: nowrap; user-select: none;
    `;
    tabEl.innerHTML = `<span>${title}</span><span class="tab-close" style="color:#ef4444;font-weight:bold;margin-left:8px;">✕</span>`;

    // Create Iframe
    const iframeEl = document.createElement('iframe');
    iframeEl.src = url;
    iframeEl.style.cssText = `
        width: 100% !important; height: 100% !important; border: none !important; position: absolute !important; top: 0 !important; left: 0 !important; display: none; background: #0f172a !important;
    `;
    iframeEl.allow = "camera; microphone; clipboard-read; clipboard-write; display-capture; fullscreen; geolocation";

    tabEl.onclick = (e) => {
        if (e.target.classList.contains('tab-close')) closeExtraToolTab(url);
        else switchExtraToolTab(url);
    };

    extraToolsTabBar.appendChild(tabEl);
    extraToolsIframeContainer.appendChild(iframeEl);

    extraToolsOpenTabs.push({ url, title, tabEl, iframeEl });
    switchExtraToolTab(url);
}

function switchExtraToolTab(url) {
    extraToolsOpenTabs.forEach(t => {
        if (t.url === url) {
            t.tabEl.style.background = '#06b6d4';
            t.tabEl.style.color = '#ffffff';
            t.tabEl.style.borderTop = '3px solid #0891b2';
            t.iframeEl.style.display = 'block';
            document.title = 'EXTRA TOOLS (FREE FLOW AUTOMATION - VEO AUTOMATION)';
        } else {
            t.tabEl.style.background = '#1e293b';
            t.tabEl.style.color = '#94a3b8';
            t.tabEl.style.borderTop = '1px solid #334155';
            t.iframeEl.style.display = 'none';
        }
    });
}

function closeExtraToolTab(url) {
    const index = extraToolsOpenTabs.findIndex(t => t.url === url);
    if (index !== -1) {
        const t = extraToolsOpenTabs[index];
        t.tabEl.remove();
        t.iframeEl.remove();
        extraToolsOpenTabs.splice(index, 1);

        if (extraToolsOpenTabs.length > 0) {
            switchExtraToolTab(extraToolsOpenTabs[extraToolsOpenTabs.length - 1].url);
        } else {
            if (window === window.top && window.location.search.includes('veo_extra_window=true')) {
                chrome.runtime.sendMessage({ action: 'CLOSE_CURRENT_TAB' });
            } else {
                extraToolsOverlay.style.display = 'none';
                document.title = 'EXTRA TOOLS (FREE FLOW AUTOMATION - VEO AUTOMATION)';
            }
        }
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'OPEN_EXTRA_TOOL_OVERLAY') {
        if (window !== window.top) return;

        openExtraToolTab(message.url, message.title);
        sendResponse({ ok: true });
    }
});

// Auto-load if opened in dedicated popup
if (window === window.top && window.location.search.includes('veo_extra_window=true')) {
    const urlParams = new URLSearchParams(window.location.search);
    const initUrl = urlParams.get('tool_url');
    const initTitle = urlParams.get('tool_title') || 'Tiện ích';
    
    if (initUrl) {
        document.title = 'EXTRA TOOLS (FREE FLOW AUTOMATION - VEO AUTOMATION)';
        setTimeout(() => {
            openExtraToolTab(initUrl, initTitle);
        }, 500);
    }
}

// Persistent Title Fixer
var desiredTitle = '';
setInterval(() => {
    if (window === window.top && window.location.search.includes('veo_extra_window=true') && document.title !== 'EXTRA TOOLS (FREE FLOW AUTOMATION - VEO AUTOMATION)') {
        document.title = 'EXTRA TOOLS (FREE FLOW AUTOMATION - VEO AUTOMATION)';
    }
}, 500);

// Local fork: internal rename API self-test removed.

// Tự động kích hoạt Thu phóng 80% và Lưới ô khi trang Flow sẵn sàng
setTimeout(() => {
    try {
        if (window.location.search.includes('veo_extra_window=true') || window !== window.top) {
            return;
        }
        applyPageZoom('0.8');
        switchToGridView();
    } catch(e) {}
}, 1500);

// ============================================================================
// LOCAL-FORK SECURITY OVERRIDES
// These declarations intentionally replace the original internal-API helpers.
// This fork never intercepts Flow Authorization headers and never calls private
// workflow status/rename endpoints. Rename is attempted through the visible UI.
// ============================================================================
async function localHydrateTilesForRename(video) {
  let tiles = Array.isArray(video.cardElements)
    ? video.cardElements.filter(t => t instanceof Node && document.body.contains(t))
    : [];

  if ((!tiles || tiles.length === 0) && Array.isArray(video.trackedTileIds)) {
    tiles = video.trackedTileIds.map(id => getTileById(id)).filter(Boolean);
  }

  // Last-resort recovery: use Flow search to isolate the prompt and grab visible tiles.
  if (!tiles || tiles.length === 0) {
    const searchBox = findFlowSearchBox();
    if (searchBox) {
      const displayIndex = getPromptIndexNumber(video.promptIndex);
      const rawPrompt = (state.settings.addIndex ? `${displayIndex}. ${video.promptText}` : video.promptText) || '';
      const filterText = rawPrompt.replace(/\s+/g, ' ').trim();
      try {
        await setNativeValue(searchBox, filterText);
        searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        searchBox.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        await wait(1800);
        tiles = getOuterTiles().filter(t => t.offsetParent !== null || t.offsetWidth > 0);
      } finally {
        await setNativeValue(searchBox, '');
        await wait(500);
      }
    }
  }
  return tiles || [];
}

async function localOpenRenameMenu(tile) {
  if (!tile) return false;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  tile.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await wait(500);

  const rect = tile.getBoundingClientRect();
  const cx = rect.left + Math.max(8, rect.width / 2);
  const cy = rect.top + Math.max(8, rect.height / 2);
  const opts = { view: window, bubbles: true, cancelable: true, clientX: cx, clientY: cy };

  // Strategy 1: context menu (current Flow UI commonly exposes Rename here).
  try {
    tile.dispatchEvent(new PointerEvent('pointerover', { ...opts, pointerType: 'mouse' }));
    tile.dispatchEvent(new MouseEvent('mouseover', opts));
    tile.dispatchEvent(new MouseEvent('contextmenu', { ...opts, button: 2, buttons: 2 }));
  } catch (_) {}
  await wait(900);

  let items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]'));
  let renameItem = items.find(el => {
    const text = (el.textContent || '').trim().toLowerCase();
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    return text.includes('rename') || text.includes('đổi tên') || label.includes('rename') || label.includes('đổi tên');
  });

  // Strategy 2: tile 3-dot menu.
  if (!renameItem) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(250);
    const menuBtn = findDownloadButtonsInCard(tile)[0];
    if (menuBtn) {
      try { radixOpenMenu(menuBtn); menuBtn.click(); } catch (_) {}
      await wait(900);
      items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]'));
      renameItem = items.find(el => {
        const text = (el.textContent || '').trim().toLowerCase();
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        return text.includes('rename') || text.includes('đổi tên') || label.includes('rename') || label.includes('đổi tên');
      });
    }
  }

  if (!renameItem) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  }

  try { renameItem.click(); } catch (_) { radixOpenMenu(renameItem); }
  await wait(700);
  return true;
}

async function renameMediaOnCloud(video) {
  addLog('info', `[${video.promptIndex}] ✏️ Đổi tên qua giao diện Flow (Local Safe Mode)...`);
  let tiles = await localHydrateTilesForRename(video);
  if (!tiles.length) {
    video._renameError = true;
    video._renameSkipped = true;
    video._renameErrorReason = 'Không tìm thấy tile trên DOM';
    addLog('warning', `[${video.promptIndex}] Không tìm thấy tile để đổi tên. File tải xuống vẫn được đổi tên cục bộ.`);
    return false;
  }

  video.totalVideos = video.totalVideos || tiles.length;
  let successCount = 0;

  for (let i = 0; i < tiles.length; i++) {
    let tile = tiles[i];
    if ((!tile || !document.body.contains(tile)) && video.trackedTileIds?.[i]) {
      tile = getTileById(video.trackedTileIds[i]);
    }
    if (!tile) continue;

    const newName = generateFileName(video, String(i + 1), tiles.length);
    const opened = await localOpenRenameMenu(tile);
    if (!opened) {
      addLog('warning', `[${video.promptIndex}] Không thấy mục Rename cho tile ${i + 1}; bỏ qua Cloud rename.`);
      continue;
    }

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'INJECT_RENAME_INPUT',
        data: { newName }
      });
      if (result && result.ok) {
        successCount++;
        addLog('success', `[${video.promptIndex}] ✅ Đổi tên UI: ${newName}`);
      } else {
        addLog('warning', `[${video.promptIndex}] Rename UI chưa xác nhận (${result?.error || 'unknown'}).`);
      }
    } catch (e) {
      addLog('warning', `[${video.promptIndex}] Rename UI lỗi: ${e.message}`);
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(500);
  }

  if (successCount === tiles.length) {
    video.renamedOnCloud = true;
    video._renameError = false;
    video._renameSkipped = false;
    addLog('success', `[${video.promptIndex}] ✅ Đã đổi tên ${successCount}/${tiles.length} tile qua UI.`);
    saveProject();
    return true;
  }

  // Do not loop forever. Local download filename enforcement remains active.
  video.renamedOnCloud = false;
  video._renameError = true;
  video._renameSkipped = true;
  video._renameErrorReason = `UI rename ${successCount}/${tiles.length}`;
  addLog('warning', `[${video.promptIndex}] Cloud rename ${successCount}/${tiles.length}. Khi tải, Chrome vẫn ép tên file theo Prompt.`);
  saveProject();
  return false;
}
