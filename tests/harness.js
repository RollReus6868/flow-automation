/* Test harness: loads the extension scripts inside a jsdom page with a fake
   chrome API so the real code paths (not re-implementations) are exercised. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = '/home/claude/ext/flow-automation-local-1.8.0';

let PASS = 0, FAIL = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, `\n      got:  ${g}\n      want: ${w}`);
}
function section(t) { console.log(`\n── ${t} ──`); }

function makeChrome(page) {
  const listeners = [];
  const sent = [];
  const store = {};
  const api = {
    _sent: sent,
    _store: store,
    _listeners: listeners,
    runtime: {
      lastError: null,
      id: 'testextension',
      onMessage: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      sendMessage: (msg) => { sent.push(msg); return Promise.resolve(api._reply ? api._reply(msg) : undefined); },
      connectNative: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {}, disconnect() {} })
    },
    storage: {
      local: {
        get: (keys) => {
          if (keys === null || keys === undefined) return Promise.resolve({ ...store });
          if (typeof keys === 'string') return Promise.resolve({ [keys]: store[keys] });
          if (Array.isArray(keys)) { const o = {}; keys.forEach(k => o[k] = store[k]); return Promise.resolve(o); }
          return Promise.resolve({ ...store });
        },
        set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
        remove: (keys) => { [].concat(keys).forEach(k => delete store[k]); return Promise.resolve(); },
        getBytesInUse: (k, cb) => { const n = JSON.stringify(store).length; if (cb) { cb(n); return; } return Promise.resolve(n); }
      },
      session: {
        get: (k) => Promise.resolve({ [k]: store['__s_' + k] }),
        set: (o) => { for (const k of Object.keys(o)) store['__s_' + k] = o[k]; return Promise.resolve(); }
      }
    },
    tabs: {
      query: () => Promise.resolve([]),
      sendMessage: () => Promise.resolve(),
      get: () => Promise.resolve({ active: true }),
      create() {}, reload: () => Promise.resolve(), remove: () => Promise.resolve(),
      setZoom: () => Promise.resolve(), setZoomSettings: () => Promise.resolve(),
      onActivated: { addListener() {} }, onUpdated: { addListener() {} },
      // 1.7.0: background dọn registry/hàng đợi khi tab đóng.
      onRemoved: { addListener(fn) { api._onRemoved = fn; } }
    },
    windows: { create: () => Promise.resolve({ id: 99 }) },
    downloads: {
      onDeterminingFilename: { addListener(fn) { api._determining = fn; } },
      onChanged: { addListener() {} },
      download() {}, search() {}
    },
    scripting: { executeScript: () => Promise.resolve([{ result: { ok: true } }]) },
    notifications: { create() {} },
    sidePanel: { setPanelBehavior: () => Promise.resolve() }
  };
  return api;
}

function loadPage({ html = '<!doctype html><html><body></body></html>', url = 'https://flow.google.com/project/abc', scripts = [] }) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  win.chrome = makeChrome(win);
  // jsdom lacks these; the extension code guards most but be safe.
  if (!win.document.execCommand) win.document.execCommand = () => false;
  win.scrollTo = () => {}; win.scrollBy = () => {};
  // jsdom thiếu các API này -> polyfill để chạy đúng code path thật.
  if (!win.PointerEvent) win.PointerEvent = win.MouseEvent;
  if (!win.ClipboardEvent) win.ClipboardEvent = win.Event;
  if (!win.DataTransfer) win.DataTransfer = class { constructor() { this._d = {}; } setData(k, v) { this._d[k] = v; } getData(k) { return this._d[k]; } };
  if (!win.Element.prototype.scrollIntoView) win.Element.prototype.scrollIntoView = function () {};
  // jsdom không hiện hộp thoại: mặc định "OK" để đi đúng nhánh chính.
  win.confirm = () => true;
  win.alert = () => {};
  if (!win.crypto) win.crypto = {};
  if (!win.crypto.randomUUID) win.crypto.randomUUID = () => 'uuid-' + Math.random().toString(36).slice(2);
  Object.defineProperty(win.document, 'visibilityState', { get: () => 'visible', configurable: true });
  for (const s of scripts) {
    let code = fs.readFileSync(path.join(EXT, s), 'utf8');
    // Chỉ thị 'use strict' ở đầu file làm indirect eval giữ khai báo trong
    // phạm vi eval -> test không truy cập được hàm. Bỏ đúng dòng chỉ thị đó.
    code = code.replace(/^\s*(['"])use strict\1\s*;?\s*$/m, '');
    // const/let ở cấp cao nhất chỉ tạo binding trong phạm vi eval (theo spec),
    // nên test không đọc được `app`/`state`. Chuyển sang var CHỈ ở cột 0 (top
    // level) để harness truy cập được; không ảnh hưởng file gốc.
    code = code.replace(/^(const|let) /gm, 'var ');
    win.eval(code);
  }
  return win;
}

module.exports = { ok, eq, section, loadPage, EXT, report: () => ({ PASS, FAIL, fails }) };
