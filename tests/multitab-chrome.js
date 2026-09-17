/* ============================================================================
   ĐA TAB trên CHROMIUM THẬT — kiểm chứng khoá tải xuống
   ----------------------------------------------------------------------------
   Vì sao phải test trên browser thật: chrome.downloads.DownloadItem KHÔNG mang
   tabId, nên không có cách nào biết file vừa tải thuộc tab nào. Đây là gốc rễ
   của lỗi "hai tab tải cùng lúc thì tên file bị đổi chéo". Test này:
     1. TÁI HIỆN lỗi khi KHÔNG có khoá (để chứng minh phép thử có ý nghĩa).
     2. Chứng minh khi CÓ khoá thì hai tab tải song song vẫn đúng tên.
   Tên file được đọc từ chính chrome.downloads, không phải từ mô phỏng.
   ========================================================================== */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const EXT = '/home/claude/ext/flow-automation-local-1.8.0';

let PASS = 0, FAIL = 0;
const ok = (n, c, x = '') => { c ? (PASS++, console.log('  ✓ ' + n)) : (FAIL++, console.log('  ✗ ' + n + ' ' + x)); };

async function waitForReadySw(ctx) {
  for (let i = 0; i < 80; i++) {
    const sw = ctx.serviceWorkers()[0];
    if (sw) {
      try {
        if (await sw.evaluate(() => typeof acquireDownloadLock === 'function')) return sw;
      } catch (e) { /* worker đang khởi động lại */ }
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Service worker không nạp xong background.js');
}

async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multitab-'));
  const dl = path.join(dir, 'dl');
  fs.mkdirSync(dl, { recursive: true });
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({
    download: { prompt_for_download: false, default_directory: dl }, savefile: { default_directory: dl }
  }));
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
           '--no-first-run', '--no-default-browser-check'],
  });
  const pg = ctx.pages()[0] || await ctx.newPage();
  await (await ctx.newCDPSession(pg)).send('Browser.setDownloadBehavior', { behavior: 'default' });
  const sw = await waitForReadySw(ctx);
  return { ctx, sw, dir, dl };
}

(async () => {
  /* ─────────────────────────────────────────────────────────────────────────
     1. TÁI HIỆN LỖI: không có khoá -> hai tab tải xen kẽ bị đổi tên chéo
     ───────────────────────────────────────────────────────────────────────── */
  console.log('\n── Tái hiện lỗi khi KHÔNG có khoá tải (hàng đợi dùng chung) ──');
  {
    const { ctx, sw, dir } = await launch();
    const out = await sw.evaluate(async () => {
      await chrome.storage.session.set({ veoPendingFilenames: [], veoDownloadLock: null });
      const grab = async (wanted) => {
        await loadQueue(); normalizeQueue();
        pendingFilenames.push({ tabId: 999, filename: wanted });
        await saveQueue();
      };
      const dl = async (tag) => {
        const id = await new Promise(r => chrome.downloads.download({ url: 'data:text/plain,' + tag }, r));
        let it = null;
        for (let i = 0; i < 200; i++) {
          [it] = await new Promise(r => chrome.downloads.search({ id }, r));
          if (it && it.state === 'complete') break;
          await new Promise(r => setTimeout(r, 25));
        }
        return (it?.filename || '').split(/[\\/]/).pop();
      };
      // Tab 1 đăng ký tên trước, nhưng tab 2 kịp tải TRƯỚC (đúng cảnh hai tab
      // chạy song song, không ai nhường ai).
      await grab('T1_canh_01');
      await grab('T2_canh_01');
      const tab2File = await dl('tab2');     // tab 2 tải trước -> ăn tên của tab 1
      const tab1File = await dl('tab1');
      return { tab1File, tab2File };
    });
    console.log('   ', JSON.stringify(out));
    ok('KHÔNG có khoá -> tên file bị đổi chéo giữa hai tab (lỗi có thật)',
       out.tab2File.startsWith('T1_canh_01'), JSON.stringify(out));
    await ctx.close(); fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     2. CÓ KHOÁ: hai "tab" chạy song song, mỗi file nhận đúng tên của tab mình
     ───────────────────────────────────────────────────────────────────────── */
  console.log('\n── Có khoá tải: hai tab chạy song song vẫn đúng tên ──');
  {
    const { ctx, sw, dir, dl } = await launch();
    const out = await sw.evaluate(async () => {
      await chrome.storage.session.set({ veoPendingFilenames: [], veoDownloadLock: null });
      // hai tabId này phải "tồn tại" để khoá không bị thu hồi -> dùng chính tab
      // thật của cửa sổ đang mở cho tab A, và một id không tồn tại sẽ bị thu
      // hồi, nên ta ghi đè tabExists bằng cách tạo 2 tab thật.
      const t1 = await chrome.tabs.create({ url: 'about:blank', active: false });
      const t2 = await chrome.tabs.create({ url: 'about:blank', active: false });
      const order = [];

      async function tabWorker(tabId, wanted, startDelay) {
        await new Promise(r => setTimeout(r, startDelay));
        // xếp hàng chờ khoá (đúng như content script làm)
        for (let i = 0; i < 400; i++) {
          const r = await acquireDownloadLock(tabId);
          if (r.ok) break;
          await new Promise(res => setTimeout(res, 25));
        }
        order.push('lock:' + tabId);
        // đăng ký tên rồi tải (giống SET_NEXT_FILENAME + startDownloadForVideo)
        await loadQueue(); normalizeQueue();
        pendingFilenames.push({ tabId, filename: wanted });
        await saveQueue();

        const id = await new Promise(r => chrome.downloads.download({ url: 'data:text/plain,' + wanted }, r));
        let it = null;
        for (let i = 0; i < 300; i++) {
          [it] = await new Promise(r => chrome.downloads.search({ id }, r));
          if (it && it.state === 'complete') break;
          await new Promise(r => setTimeout(r, 25));
        }
        const got = (it?.filename || '').split(/[\\/]/).pop();
        order.push('free:' + tabId);
        await releaseDownloadLock(tabId);
        return { tabId, wanted, got };
      }

      const res = await Promise.all([
        tabWorker(t1.id, 'T1_canh_01', 0),
        tabWorker(t2.id, 'T2_canh_01', 5)   // xuất phát gần như cùng lúc
      ]);
      const queueLeft = (await chrome.storage.session.get('veoPendingFilenames')).veoPendingFilenames || [];
      const lockLeft = (await chrome.storage.session.get('veoDownloadLock')).veoDownloadLock;
      return { res, order, queueLeft, lockLeft };
    });

    console.log('   ', JSON.stringify(out.res));
    console.log('    thứ tự vào/ra khoá:', out.order.join(' → '));

    for (const r of out.res) {
      ok(`tab ${r.tabId} nhận đúng tên của mình (${r.wanted})`,
         r.got === r.wanted + '.txt', `nhận: ${r.got}`);
    }
    ok('hai tab KHÔNG vào pha tải cùng lúc (khoá tuần tự hoá đúng)',
       /^lock:\d+ → free:\d+ → lock:\d+ → free:\d+$/.test(out.order.join(' → ')),
       out.order.join(' → '));
    ok('hàng đợi tên file trống sau khi cả hai xong (không sót gây lệch nhịp)',
       out.queueLeft.length === 0, JSON.stringify(out.queueLeft));
    ok('khoá đã được nhả hẳn', !out.lockLeft, JSON.stringify(out.lockLeft));

    // Đọc lại từ ổ đĩa: hai file phải tồn tại với đúng tên.
    const files = fs.readdirSync(dl).sort();
    console.log('    file trên ổ đĩa:', files.join(', '));
    ok('ổ đĩa có đúng 2 file với đúng hai tên',
       files.includes('T1_canh_01.txt') && files.includes('T2_canh_01.txt'),
       files.join(','));

    await ctx.close(); fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ─────────────────────────────────────────────────────────────────────────
     3. Tab giữ khoá bị ĐÓNG giữa pha tải -> tab còn lại không bị treo
     ───────────────────────────────────────────────────────────────────────── */
  console.log('\n── Tab đang giữ khoá bị đóng: tab còn lại phải chạy tiếp ──');
  {
    const { ctx, sw, dir } = await launch();
    const out = await sw.evaluate(async () => {
      await chrome.storage.session.set({ veoPendingFilenames: [], veoDownloadLock: null });
      const dead = await chrome.tabs.create({ url: 'about:blank', active: false });
      const alive = await chrome.tabs.create({ url: 'about:blank', active: false });

      const got = await acquireDownloadLock(dead.id);
      // tab đó đăng ký tên rồi "chết" (người dùng đóng tab giữa lúc đang tải)
      await loadQueue(); normalizeQueue();
      pendingFilenames.push({ tabId: dead.id, filename: 'TAB_DA_DONG' });
      await saveQueue();
      await chrome.tabs.remove(dead.id);
      await new Promise(r => setTimeout(r, 400));   // để onRemoved dọn xong

      const after = await acquireDownloadLock(alive.id);
      const queueLeft = (await chrome.storage.session.get('veoPendingFilenames')).veoPendingFilenames || [];

      // tab còn sống tải file của mình -> KHÔNG được ăn tên của tab đã đóng
      pendingFilenames.push({ tabId: alive.id, filename: 'TAB_CON_SONG' });
      await saveQueue();
      const id = await new Promise(r => chrome.downloads.download({ url: 'data:text/plain,x' }, r));
      let it = null;
      for (let i = 0; i < 300; i++) {
        [it] = await new Promise(r => chrome.downloads.search({ id }, r));
        if (it && it.state === 'complete') break;
        await new Promise(r => setTimeout(r, 25));
      }
      return {
        firstOk: got.ok, afterOk: after.ok, queueLeft,
        file: (it?.filename || '').split(/[\\/]/).pop()
      };
    });
    console.log('   ', JSON.stringify(out));
    ok('tab đóng -> khoá được nhả, tab còn lại lấy được ngay', out.firstOk && out.afterOk, JSON.stringify(out));
    ok('tên file treo của tab đã đóng bị dọn (không làm lệch tên tab khác)',
       !out.queueLeft.some(e => e.filename === 'TAB_DA_DONG'), JSON.stringify(out.queueLeft));
    ok('file của tab còn sống nhận ĐÚNG tên của nó', out.file === 'TAB_CON_SONG.txt', out.file);
    await ctx.close(); fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`  ĐA TAB (Chromium thật) — PASS: ${PASS}   FAIL: ${FAIL}`);
  console.log(`════════════════════════════════════════`);
  process.exit(FAIL ? 1 : 0);
})();
