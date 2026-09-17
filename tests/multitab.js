/* ============================================================================
   KIỂM THỬ CHẾ ĐỘ ĐA TAB (1.7.0)
   ----------------------------------------------------------------------------
   Ba thứ dùng chung toàn trình duyệt sẽ đánh nhau nếu chạy 2+ tab, và đây là
   các test canh đúng ba thứ đó:
     1. Hàng đợi tên file + khoá tải xuống (chrome.downloads KHÔNG mang tabId).
     2. Cờ trạng thái chạy (trước đây là biến đơn -> tab nọ khôi phục dự án tab kia).
     3. Cổng giãn nhịp "Tạo" và cổng chặn tắt máy sớm.
   ========================================================================== */
const H = require('./harness.js');
const { ok, eq, section, loadPage } = H;

/* ══════════════════════════════════════════════════════════════
   1. SIDE PANEL — chia danh sách prompt cho N tab
   ══════════════════════════════════════════════════════════════ */
section('PANEL: chia danh sách prompt cho nhiều tab');

const panel = loadPage({
  html: require('fs').readFileSync(H.EXT + '/sidepanel.html', 'utf8'),
  url: 'chrome-extension://testextension/sidepanel.html',
  scripts: ['sidepanel.js']
});

const splitJobs = panel.eval('splitJobs');
const jobs = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ index: from + i, text: 'p' + (from + i) }));

{
  const parts = splitJobs(jobs(10), 2);
  eq('10 prompt / 2 tab -> 5 + 5', parts.map(p => p.length), [5, 5]);
  eq('tab 1 giữ đúng index gốc 1..5', parts[0].map(j => j.index), [1, 2, 3, 4, 5]);
  eq('tab 2 giữ đúng index gốc 6..10', parts[1].map(j => j.index), [6, 7, 8, 9, 10]);
}
{
  // Chia LIÊN TIẾP (không xen kẽ) để file của mỗi tab nằm gọn một dải số.
  const parts = splitJobs(jobs(10), 3);
  eq('10 prompt / 3 tab -> 4 + 3 + 3 (dư chia cho tab đầu)', parts.map(p => p.length), [4, 3, 3]);
  eq('các dải liền mạch, không chồng nhau',
     parts.map(p => `${p[0].index}-${p[p.length - 1].index}`), ['1-4', '5-7', '8-10']);
}
{
  const all = splitJobs(jobs(7), 3).flat().map(j => j.index);
  eq('không mất và không nhân đôi prompt nào', all, [1, 2, 3, 4, 5, 6, 7]);
}
{
  const parts = splitJobs(jobs(2), 5);
  ok('số tab nhiều hơn số prompt -> không sinh khối rỗng',
     parts.length === 2 && parts.every(p => p.length === 1), JSON.stringify(parts.map(p => p.length)));
}
{
  // Chạy dải tuỳ chọn (ví dụ prompt 20..25) vẫn phải giữ index gốc, vì tên file
  // đánh theo số thứ tự dựa vào index — đánh lại từ 1 sẽ tạo file trùng tên.
  const parts = splitJobs(jobs(6, 20), 2);
  eq('dải 20..25 giữ nguyên số thứ tự gốc',
     [parts[0].map(j => j.index), parts[1].map(j => j.index)], [[20, 21, 22], [23, 24, 25]]);
}

/* ══════════════════════════════════════════════════════════════
   2. BACKGROUND — khoá tải xuống & hàng đợi tên file theo tab
   ══════════════════════════════════════════════════════════════ */
section('BACKGROUND: khoá tải xuống tuần tự giữa các tab');

function loadBg() {
  return loadPage({
    html: '<!doctype html><html><body></body></html>',
    url: 'chrome-extension://testextension/_generated_background_page.html',
    scripts: ['background.js']
  });
}

const bg = loadBg();
const router = () => bg.chrome._listeners[0];

/** Gửi một message vào router của background, kèm sender.tab giả lập. */
function call(msg, tabId = null) {
  return new Promise((resolve) => {
    const sender = tabId ? { tab: { id: tabId, windowId: 1, url: 'https://flow.google.com/x', title: 't' } } : {};
    const kept = router()(msg, sender, resolve);
    if (!kept) resolve(undefined);
  });
}

(async () => {
  // Tab nào cũng phải "tồn tại" để khoá không bị thu hồi.
  bg.chrome.tabs.get = (id) => Promise.resolve({ id, active: true, windowId: 1, url: 'https://flow.google.com/x' });

  let r = await call({ action: 'ACQUIRE_DOWNLOAD_LOCK' }, 11);
  ok('tab 11 lấy được khoá', r?.ok === true, JSON.stringify(r));

  r = await call({ action: 'ACQUIRE_DOWNLOAD_LOCK' }, 22);
  ok('tab 22 BỊ TỪ CHỐI khi tab 11 đang giữ', r?.ok === false, JSON.stringify(r));
  ok('  có nói ai đang giữ khoá', r?.ownerTabId === 11, JSON.stringify(r));
  ok('  có gợi ý thời gian chờ lại', typeof r?.waitMs === 'number' && r.waitMs > 0, JSON.stringify(r));

  r = await call({ action: 'ACQUIRE_DOWNLOAD_LOCK' }, 11);
  ok('chủ khoá gọi lại vẫn được (không tự chặn mình)', r?.ok === true, JSON.stringify(r));

  r = await call({ action: 'RELEASE_DOWNLOAD_LOCK' }, 22);
  ok('tab KHÔNG phải chủ thì không nhả được khoá của người khác', r?.ok === false, JSON.stringify(r));

  await call({ action: 'RELEASE_DOWNLOAD_LOCK' }, 11);
  r = await call({ action: 'ACQUIRE_DOWNLOAD_LOCK' }, 22);
  ok('sau khi tab 11 nhả, tab 22 vào được', r?.ok === true, JSON.stringify(r));

  // Tab giữ khoá bị đóng/chết: khoá phải thu hồi được, nếu không mọi tab treo.
  section('BACKGROUND: khoá bị treo do tab chết phải thu hồi được');
  const stale = loadBg();
  const staleRouter = (msg, tabId) => new Promise((resolve) => {
    const sender = tabId ? { tab: { id: tabId, windowId: 1, url: 'https://flow.google.com/x' } } : {};
    const kept = stale.chrome._listeners[0](msg, sender, resolve);
    if (!kept) resolve(undefined);
  });
  // tab 33 giữ khoá từ 10 phút trước và tab đó không còn tồn tại
  await stale.chrome.storage.session.set({
    veoDownloadLock: { tabId: 33, at: Date.now() - 600000, renewedAt: Date.now() - 600000 }
  });
  stale.chrome.tabs.get = (id) => id === 33 ? Promise.reject(new Error('No tab')) : Promise.resolve({ id });
  r = await staleRouter({ action: 'ACQUIRE_DOWNLOAD_LOCK' }, 44);
  ok('thu hồi khoá của tab đã chết -> tab 44 chạy tiếp được', r?.ok === true, JSON.stringify(r));

  /* ── hàng đợi tên file tách theo tab ── */
  section('BACKGROUND: hàng đợi tên file không lẫn giữa các tab');
  const q = loadBg();
  const qCall = (msg, tabId) => new Promise((resolve) => {
    const sender = tabId ? { tab: { id: tabId, windowId: 1, url: 'https://flow.google.com/x' } } : {};
    const kept = q.chrome._listeners[0](msg, sender, resolve);
    if (!kept) resolve(undefined);
  });
  const queue = async () => (await q.chrome.storage.session.get('veoPendingFilenames')).veoPendingFilenames || [];

  await qCall({ action: 'SET_NEXT_FILENAME', filename: 'T1_01' }, 11);
  await qCall({ action: 'SET_NEXT_FILENAME', filename: 'T2_01' }, 22);
  eq('mỗi tên file mang theo tabId chủ của nó',
     (await queue()).map(e => [e.tabId, e.filename]), [[11, 'T1_01'], [22, 'T2_01']]);

  // BUG CŨ (1.6.1): startAutomation gọi CLEAR_FILENAME_QUEUE xoá SẠCH hàng đợi
  // -> tab thứ hai bắt đầu chạy là cuốn luôn tên đang chờ của tab thứ nhất.
  await qCall({ action: 'CLEAR_FILENAME_QUEUE' }, 22);
  eq('tab 22 bắt đầu chạy KHÔNG xoá tên đang chờ của tab 11',
     (await queue()).map(e => e.filename), ['T1_01']);

  await qCall({ action: 'SET_NEXT_FILENAME', filename: 'chung' }, 22);
  await qCall({ action: 'SET_NEXT_FILENAME', filename: 'chung' }, 11);
  await qCall({ action: 'UNSET_NEXT_FILENAME', filename: 'chung' }, 22);
  eq('UNSET chỉ rút tên CỦA CHÍNH TAB ĐÓ (hai tab trùng tên vẫn đúng)',
     (await queue()).map(e => [e.tabId, e.filename]), [[11, 'T1_01'], [11, 'chung']]);

  // Tab đóng giữa lúc còn tên treo -> phải dọn, nếu không file của tab khác bị
  // đặt lệch một nhịp.
  q.chrome.tabs.get = (id) => Promise.resolve({ id });
  await q.chrome._onRemoved(11);
  await new Promise(r => setTimeout(r, 30));
  eq('tab đóng -> tên file treo của nó bị dọn sạch', await queue(), []);

  /* ── onDeterminingFilename ưu tiên tên của tab đang giữ khoá ── */
  section('BACKGROUND: đặt tên đúng tab đang giữ khoá tải');
  const d = loadBg();
  const dCall = (msg, tabId) => new Promise((resolve) => {
    const sender = tabId ? { tab: { id: tabId, windowId: 1, url: 'https://flow.google.com/x' } } : {};
    const kept = d.chrome._listeners[0](msg, sender, resolve);
    if (!kept) resolve(undefined);
  });
  d.chrome.tabs.get = (id) => Promise.resolve({ id });
  const sentTo = [];
  d.chrome.tabs.sendMessage = (tabId, payload) => { sentTo.push({ tabId, payload }); return Promise.resolve(); };

  await dCall({ action: 'SET_NEXT_FILENAME', filename: 'cua_tab_11' }, 11);
  await dCall({ action: 'SET_NEXT_FILENAME', filename: 'cua_tab_22' }, 22);
  await dCall({ action: 'ACQUIRE_DOWNLOAD_LOCK' }, 22);   // tab 22 mới là tab đang tải

  const suggested = await new Promise((resolve) => {
    d.chrome._determining({ filename: 'download.mp4', url: 'https://x/y' }, (s) => resolve(s));
  });
  eq('lấy tên của tab ĐANG GIỮ KHOÁ, không lấy mục đầu hàng đợi',
     suggested.filename, 'cua_tab_22.mp4');
  const stillQueued = (await d.chrome.storage.session.get('veoPendingFilenames')).veoPendingFilenames || [];
  eq('tên của tab 11 vẫn còn nguyên trong hàng đợi',
     stillQueued.map(e => e.filename), ['cua_tab_11']);
  ok('chỉ báo DOWNLOAD_STARTED cho đúng tab 22',
     sentTo.some(s => s.tabId === 22 && s.payload.action === 'DOWNLOAD_STARTED') &&
     !sentTo.some(s => s.tabId === 11 && s.payload.action === 'DOWNLOAD_STARTED'),
     JSON.stringify(sentTo.map(s => [s.tabId, s.payload.action])));

  /* ── tương thích ngược: hàng đợi kiểu chuỗi của bản ≤1.6.1 ── */
  const legacy = loadBg();
  legacy.chrome.tabs.sendMessage = () => Promise.resolve();
  await legacy.chrome.storage.session.set({ veoPendingFilenames: ['ten_cu_dang_chuoi'] });
  const legacySuggested = await new Promise((resolve) => {
    legacy.chrome._determining({ filename: 'a.mp4', url: 'u' }, (s) => resolve(s));
  });
  eq('nâng cấp từ 1.6.1: tên đang chờ kiểu chuỗi vẫn dùng được',
     legacySuggested.filename, 'ten_cu_dang_chuoi.mp4');

  /* ══════════════════════════════════════════════════════════════
     3. BACKGROUND — giãn nhịp "Tạo" và cổng tắt máy
     ══════════════════════════════════════════════════════════════ */
  section('BACKGROUND: giãn nhịp thao tác Tạo giữa các tab');
  const p = loadBg();
  const pCall = (msg, tabId) => new Promise((resolve) => {
    const sender = tabId ? { tab: { id: tabId, windowId: 1 } } : {};
    const kept = p.chrome._listeners[0](msg, sender, resolve);
    if (!kept) resolve(undefined);
  });

  const slots = await Promise.all([
    pCall({ action: 'ACQUIRE_CREATE_SLOT', gapMs: 10000 }, 11),
    pCall({ action: 'ACQUIRE_CREATE_SLOT', gapMs: 10000 }, 22),
    pCall({ action: 'ACQUIRE_CREATE_SLOT', gapMs: 10000 }, 33)
  ]);
  const w = slots.map(s => Math.round((s?.waitMs || 0) / 1000));
  ok('3 tab hỏi cùng lúc -> nhận 3 mốc cách nhau (0s, 10s, 20s)',
     w[0] === 0 && w[1] === 10 && w[2] === 20, JSON.stringify(w));

  const off = await pCall({ action: 'ACQUIRE_CREATE_SLOT', gapMs: 0 }, 11);
  eq('giãn nhịp = 0 -> không chờ gì (giữ tốc độ như 1 tab)', off?.waitMs, 0);

  section('BACKGROUND: không tắt máy khi tab khác còn chạy');
  const s = loadBg();
  const sCall = (msg, tabId) => new Promise((resolve) => {
    const sender = tabId ? { tab: { id: tabId, windowId: 1, url: 'https://flow.google.com/x' } } : {};
    const kept = s.chrome._listeners[0](msg, sender, resolve);
    if (!kept) resolve(undefined);
  });
  s.chrome.tabs.get = (id) => Promise.resolve({ id });

  await sCall({ action: 'REGISTER_TAB' }, 11);
  await sCall({ action: 'REGISTER_TAB' }, 22);
  await sCall({ action: 'TAB_STATUS', data: { running: true, total: 10, done: 3 } }, 11);
  await sCall({ action: 'TAB_STATUS', data: { running: false, total: 10, done: 10 } }, 22);

  let can = await sCall({ action: 'CAN_SHUTDOWN' }, 22);
  ok('tab 22 xong trước -> CHƯA được tắt máy', can?.ok === false, JSON.stringify(can));
  ok('  có nói rõ đang chờ tab nào',
     can?.waiting?.length === 1 && can.waiting[0].tabId === 11, JSON.stringify(can?.waiting));

  await sCall({ action: 'TAB_STATUS', data: { running: false, total: 10, done: 10 } }, 11);
  can = await sCall({ action: 'CAN_SHUTDOWN' }, 22);
  ok('mọi tab đã xong -> được tắt máy', can?.ok === true, JSON.stringify(can));

  // Tab đang chạy bị đóng mà registry không dọn thì sẽ chặn tắt máy vĩnh viễn.
  await sCall({ action: 'TAB_STATUS', data: { running: true } }, 11);
  s.chrome.tabs.get = (id) => id === 11 ? Promise.reject(new Error('gone')) : Promise.resolve({ id });
  can = await sCall({ action: 'CAN_SHUTDOWN' }, 22);
  ok('tab đang chạy bị đóng -> tự dọn khỏi registry, không chặn mãi',
     can?.ok === true, JSON.stringify(can));

  section('BACKGROUND: đăng ký tab và số thứ tự tab');
  const g = loadBg();
  const gCall = (msg, tabId) => new Promise((resolve) => {
    const sender = tabId ? { tab: { id: tabId, windowId: 7, url: 'https://flow.google.com/x', title: 'Flow' } } : {};
    const kept = g.chrome._listeners[0](msg, sender, resolve);
    if (!kept) resolve(undefined);
  });
  g.chrome.tabs.get = (id) => Promise.resolve({ id });
  const a1 = await gCall({ action: 'REGISTER_TAB' }, 101);
  const a2 = await gCall({ action: 'REGISTER_TAB' }, 202);
  const again = await gCall({ action: 'REGISTER_TAB' }, 101);
  eq('tab đầu nhận số thứ tự 1', a1?.slot, 1);
  eq('tab thứ hai nhận số thứ tự 2', a2?.slot, 2);
  eq('F5 lại thì vẫn giữ số thứ tự cũ (tên dự án không đổi)', again?.slot, 1);
  ok('không có sender.tab -> trả lỗi rõ ràng, không ném exception',
     (await gCall({ action: 'REGISTER_TAB' }, null))?.ok === false);

  /* ══════════════════════════════════════════════════════════════
     4. CONTENT SCRIPT — cờ chạy theo tab, gate tab ẩn, tiết kiệm bộ nhớ
     ══════════════════════════════════════════════════════════════ */
  section('CONTENT: cờ trạng thái chạy tách riêng theo từng tab');
  const c = loadPage({
    html: '<!doctype html><html><body><div id="x"></div></body></html>',
    url: 'https://flow.google.com/project/abc',
    scripts: ['content-v2.js']
  });

  const setRunState = c.eval('setRunState');
  const getRunState = c.eval('getRunState');
  const clearRunState = c.eval('clearRunState');

  c.eval('veoTabId = 11');
  await setRunState({ active: 'Project_T1' });
  c.eval('veoTabId = 22');
  await setRunState({ active: 'Project_T2', autoResume: 'Project_T2' });

  c.eval('veoTabId = 11');
  eq('tab 11 đọc đúng dự án của nó', (await getRunState()).active, 'Project_T1');
  c.eval('veoTabId = 22');
  eq('tab 22 đọc đúng dự án của nó', (await getRunState()).active, 'Project_T2');

  // BUG CŨ: khoá dùng chung -> tab này dừng là xoá luôn cờ của tab kia, sau F5
  // tab kia không tự khôi phục (hoặc khôi phục sai dự án).
  await clearRunState();
  c.eval('veoTabId = 11');
  eq('tab 22 dừng KHÔNG xoá cờ của tab 11', (await getRunState()).active, 'Project_T1');

  section('CONTENT: tab bị ẩn vẫn chạy khi bật đa tab');
  const isTabActive = c.eval('isTabActive');
  Object.defineProperty(c.document, 'visibilityState', { get: () => 'hidden', configurable: true });
  c.eval('state.settings.multiTab = false');
  c.chrome.runtime.sendMessage = () => Promise.resolve(false);   // background nói "không active"
  ok('1 tab (mặc định): tab bị ẩn -> ngủ như cũ', (await isTabActive()) === false);
  c.eval('state.settings.multiTab = true');
  ok('đa tab: tab bị ẩn vẫn được chạy', (await isTabActive()) === true);

  section('CONTENT: dò Chrome hãm tab ẩn');
  const checkThrottle = c.eval('checkThrottle');
  const logs = [];
  c.chrome.runtime.sendMessage = (m) => { logs.push(m); return Promise.resolve({ ok: true }); };
  // setTimeout bị hãm: 1s thực tế mất 8s
  const realSetTimeout = c.setTimeout;
  c.eval('window.__origST = window.setTimeout');
  c.setTimeout = (fn, ms) => realSetTimeout(fn, ms > 0 ? 5 : 0);
  const dateNow = Date.now;
  let fake = dateNow();
  global.__t = 0;
  c.Date.now = () => fake;
  const promise = checkThrottle();
  fake += 8000;                       // giả lập trôi 8 giây
  const throttled = await promise;
  c.Date.now = dateNow;
  ok('phát hiện được tab đang bị hãm', throttled === true);
  ok('  cảnh báo rõ cách khắc phục (tách ra cửa sổ riêng)',
     logs.some(m => m.action === 'LOG' && /cửa sổ riêng/i.test(m.message || '')),
     JSON.stringify(logs.filter(m => m.action === 'LOG').map(m => m.message)));
  ok('  báo cờ throttled lên Side Panel',
     logs.some(m => m.action === 'TAB_STATUS' && m.data?.throttled === true));

  section('CONTENT: tiết kiệm bộ nhớ khi N tab cùng ghi dự án');
  const src = require('fs').readFileSync(H.EXT + '/content-v2.js', 'utf8');
  ok('saveProject bỏ lưu trùng promptText khi khớp prompts[]',
     /canonical === rest\.promptText\) delete rest\.promptText/.test(src));
  ok('loadProject dựng lại promptText từ prompts[]',
     /restoredText = v\.promptText \|\| \(project\.prompts \|\| \[\]\)/.test(src));
  ok('dọn dự án cũ theo DUNG LƯỢNG thực, không chỉ đếm 10 dự án',
     /BUDGET\s*=\s*\d+/.test(src) && /used \+ sz > BUDGET/.test(src));
  ok('cảnh báo khi chính dự án đang chạy quá lớn',
     /activeSize > BUDGET/.test(src));

  section('CONTENT: khoá tải xuống được dùng ở mọi đường tải');
  ok('tải lẻ từng prompt có xin khoá', /await acquireDownloadLock\(`prompt \$\{video\.promptIndex\}`\)/.test(src));
  ok('tải ZIP cũng xin khoá', /acquireDownloadLock\('ZIP'\)/.test(src));
  ok('luôn nhả khoá trong finally', (src.match(/releaseDownloadLock\(\)/g) || []).length >= 3);
  ok('dừng automation thì nhả khoá ngay (không để tab khác chờ 45s)',
     /reportTabStatus\(\{ phase: 'stopped' \}\);[\s\S]{0,400}releaseDownloadLock\(\)/.test(src));
  ok('có giãn nhịp trước khi bấm Tạo', /await awaitCreateSlot\(\);/.test(src));
  ok('cổng tắt máy hỏi background trước', /bg\('CAN_SHUTDOWN'\)/.test(src));

  const rep = H.report();
  console.log(`\n════════════════════════════════════════`);
  console.log(`  ĐA TAB — PASS: ${rep.PASS}   FAIL: ${rep.FAIL}`);
  if (rep.FAIL) rep.fails.forEach(f => console.log('   - ' + f));
  console.log(`════════════════════════════════════════`);
  process.exit(rep.FAIL ? 1 : 0);
})();
