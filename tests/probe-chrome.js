/* Kiểm chứng phép thử "Hỏi vị trí lưu mỗi tệp" trên Chromium THẬT.
   Headless không hiện được hộp thoại, nên ta kiểm tra hai điều quan trọng:
     1. Khi tải xuống bình thường  -> phải kết luận 'off' (không báo động sai).
     2. Khi tải xuống bị CHẶN      -> phải là 'unknown', TUYỆT ĐỐI không 'on'
        (state='interrupted' + tên rỗng trông rất giống dấu hiệu hộp thoại mở). */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { EXT } = require('./paths.js');

let PASS = 0, FAIL = 0;
const ok = (n, c, x = '') => { c ? (PASS++, console.log('  ✓ ' + n)) : (FAIL++, console.log('  ✗ ' + n + ' ' + x)); };


/** Service worker của MV3 có thể ngủ/khởi động lại; chờ tới khi script đã nạp xong. */
async function waitForReadySw(ctx) {
  for (let i = 0; i < 60; i++) {
    let sw = ctx.serviceWorkers()[0];
    if (!sw) { await new Promise(r => setTimeout(r, 250)); continue; }
    try {
      const ready = await sw.evaluate(() => typeof probeSaveAsPrompt === 'function');
      if (ready) return sw;
    } catch (e) { /* worker đang khởi động lại */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Service worker không nạp xong background.js');
}

async function probe({ allowDownloads }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  const dl = path.join(dir, 'dl');
  fs.mkdirSync(dl, { recursive: true });
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({
    download: { prompt_for_download: false, default_directory: dl }, savefile: { default_directory: dl }
  }));

  const ctx = await chromium.launchPersistentContext(dir, {
    ...require('./paths.js').launchOpts(),
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
           '--no-first-run', '--no-default-browser-check'],
  });
  const pg = ctx.pages()[0] || await ctx.newPage();
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Browser.setDownloadBehavior', { behavior: allowDownloads ? 'default' : 'deny' });

  const sw = await waitForReadySw(ctx);
  const t0 = Date.now();
  const res = await sw.evaluate(() => probeSaveAsPrompt());
  const ms = Date.now() - t0;

  // hàng đợi tên file phải KHÔNG bị phép thử ăn mất
  const queueAfter = await sw.evaluate(async () => {
    const d = await chrome.storage.session.get('veoPendingFilenames');
    return d.veoPendingFilenames || [];
  });

  // lịch sử tải phải được dọn sạch
  const history = await sw.evaluate(() => new Promise(r =>
    chrome.downloads.search({ query: ['flow_automation_check'] }, items => r(items.length))));

  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
  return { res, ms, queueAfter, history };
}

(async () => {
  console.log('\n── PHÉP THỬ trên Chromium thật: tải xuống BÌNH THƯỜNG ──');
  let r = await probe({ allowDownloads: true });
  console.log('   ', JSON.stringify(r.res), `(${r.ms}ms)`);
  ok("kết luận 'off' khi Chrome tải thẳng về máy", r.res.status === 'off', JSON.stringify(r.res));
  ok('chạy nhanh (< 1s), không bắt người dùng chờ', r.ms < 1000, r.ms + 'ms');
  ok('đã dọn sạch khỏi lịch sử tải xuống', r.history === 0, 'còn ' + r.history);

  console.log('\n── PHÉP THỬ trên Chromium thật: tải xuống BỊ CHẶN ──');
  r = await probe({ allowDownloads: false });
  console.log('   ', JSON.stringify(r.res), `(${r.ms}ms)`);
  ok("KHÔNG báo động sai thành 'on' khi download bị chặn", r.res.status !== 'on', JSON.stringify(r.res));
  ok("báo 'unknown' kèm lý do để người dùng tự kiểm tra",
     r.res.status === 'unknown' && !!r.res.reason, JSON.stringify(r.res));
  ok('không bao giờ treo quá 3s', r.ms < 3500, r.ms + 'ms');

  console.log('\n── Hàng đợi tên file không bị phép thử làm lệch ──');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe2-'));
  const dl = path.join(dir, 'dl'); fs.mkdirSync(dl, { recursive: true });
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({
    download: { prompt_for_download: false, default_directory: dl }, savefile: { default_directory: dl } }));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...require('./paths.js').launchOpts(),
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run'],
  });
  const pg = ctx.pages()[0] || await ctx.newPage();
  await (await ctx.newCDPSession(pg)).send('Browser.setDownloadBehavior', { behavior: 'default' });
  const sw = await waitForReadySw(ctx);

  const out = await sw.evaluate(async () => {
    // xếp sẵn tên cho video tiếp theo
    await chrome.storage.session.set({ veoPendingFilenames: ['01_video_quan_trong'] });
    await probeSaveAsPrompt();                    // chạy phép thử ở giữa
    const after = (await chrome.storage.session.get('veoPendingFilenames')).veoPendingFilenames || [];
    // rồi tải "video" thật -> phải nhận đúng tên đã xếp
    const id = await new Promise(r => chrome.downloads.download({ url: 'data:text/plain,v' }, r));
    let it = null;
    for (let i = 0; i < 60; i++) {
      [it] = await new Promise(r => chrome.downloads.search({ id }, r));
      if (it && it.state === 'complete') break;
      await new Promise(r => setTimeout(r, 25));
    }
    return { queueAfterProbe: after, realFile: (it?.filename || '').split(/[\\/]/).pop() };
  });
  console.log('   ', JSON.stringify(out));
  ok('phép thử KHÔNG ăn mất tên trong hàng đợi',
     out.queueAfterProbe.length === 1 && out.queueAfterProbe[0] === '01_video_quan_trong',
     JSON.stringify(out.queueAfterProbe));
  ok('video tải sau đó vẫn nhận ĐÚNG tên đã xếp',
     out.realFile === '01_video_quan_trong.txt', out.realFile);

  await ctx.close(); fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n════════════════════════════════════════`);
  console.log(`  CHROMIUM THẬT — PASS: ${PASS}   FAIL: ${FAIL}`);
  console.log(`════════════════════════════════════════`);
  process.exit(FAIL ? 1 : 0);
})();
