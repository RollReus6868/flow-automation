/* Kiểm chứng trên Chromium THẬT: thư mục lưu lấy từ cài đặt (veoSettings.downloadSubfolder)
   có tạo đúng thư mục con trên ổ đĩa hay không. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const EXT = '/home/claude/ext/flow-automation-local-1.8.0';

let PASS = 0, FAIL = 0;
const ok = (n, c, x='') => { c ? (PASS++, console.log('  ✓ '+n)) : (FAIL++, console.log('  ✗ '+n+' '+x)); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-'));
  const dl = path.join(dir, 'Downloads');
  fs.mkdirSync(dl, { recursive: true });
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({
    download: { prompt_for_download: false, default_directory: dl }, savefile: { default_directory: dl } }));

  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run'],
  });
  const pg = ctx.pages()[0] || await ctx.newPage();
  await (await ctx.newCDPSession(pg)).send('Browser.setDownloadBehavior', { behavior: 'default' });

  let sw;
  for (let i = 0; i < 60; i++) {
    sw = ctx.serviceWorkers()[0];
    if (sw) { try { if (await sw.evaluate(() => typeof sanitizeSubfolder === 'function')) break; } catch (e) {} }
    await new Promise(r => setTimeout(r, 250));
  }

  // Chờ handler onInstalled của extension ghi xong veoSettings, nếu không bản
  // ghi của test bị ghi đè (đây chính là cách phát hiện lỗi read-modify-write).
  await sw.evaluate(() => new Promise(r => setTimeout(r, 1200)));

  const out = await sw.evaluate(async () => {
    const res = {};
    const dlWith = async (settings, queuedName) => {
      await chrome.storage.local.set({ veoSettings: settings });
      await chrome.storage.session.set({ veoPendingFilenames: [queuedName] });
      const id = await new Promise(r => chrome.downloads.download({ url: 'data:text/plain,hello' }, r));
      let it = null;
      for (let i = 0; i < 80; i++) {
        [it] = await new Promise(r => chrome.downloads.search({ id }, r));
        if (it && (it.state === 'complete' || it.state === 'interrupted')) break;
        await new Promise(r => setTimeout(r, 25));
      }
      return { filename: it?.filename, state: it?.state, error: it?.error || null };
    };

    res.plain      = await dlWith({ downloadSubfolder: 'FlowVideos' }, '01_canh_mot');
    res.nested     = await dlWith({ downloadSubfolder: 'FlowVideos/Tap 01' }, '02_canh_hai');
    res.diacritics = await dlWith({ downloadSubfolder: 'Dự án/Tập 02' }, '03_cảnh_ba');
    res.project    = await dlWith({ downloadSubfolder: 'Flow/{project}', activeProjectName: 'Bible Ghibli 12' }, '04_bon');
    res.absolute   = await dlWith({ downloadSubfolder: 'D:\\Media\\Flow' }, '05_nam');
    res.escape     = await dlWith({ downloadSubfolder: '../../..' }, '06_sau');
    res.none       = await dlWith({ downloadSubfolder: '' }, '07_bay');
    res.noQueue    = await (async () => {
      await chrome.storage.local.set({ veoSettings: { downloadSubfolder: 'FlowVideos' } });
      await chrome.storage.session.set({ veoPendingFilenames: [] });
      const id = await new Promise(r => chrome.downloads.download({ url: 'data:text/plain,z', filename: 'khong_co_ten.txt' }, r));
      let it = null;
      for (let i = 0; i < 80; i++) {
        [it] = await new Promise(r => chrome.downloads.search({ id }, r));
        if (it && it.state === 'complete') break;
        await new Promise(r => setTimeout(r, 25));
      }
      return { filename: it?.filename };
    })();
    return res;
  });

  const rel = (p) => String(p || '').replace(dl + '/', '');
  console.log('');
  for (const [k, v] of Object.entries(out)) console.log(`   ${k.padEnd(11)} -> ${rel(v.filename)}`);
  console.log('');

  ok('thư mục con đơn giản', rel(out.plain.filename) === 'FlowVideos/01_canh_mot.txt', rel(out.plain.filename));
  ok('thư mục con lồng nhau', rel(out.nested.filename) === 'FlowVideos/Tap 01/02_canh_hai.txt', rel(out.nested.filename));
  ok('thư mục + tên có dấu đều được bỏ dấu',
     rel(out.diacritics.filename) === 'Du an/Tap 02/03_canh_ba.txt', rel(out.diacritics.filename));
  ok('biến {project} thay đúng tên dự án',
     rel(out.project.filename) === 'Flow/Bible Ghibli 12/04_bon.txt', rel(out.project.filename));
  ok('đường dẫn tuyệt đối bị hạ thành thư mục con',
     rel(out.absolute.filename) === 'Media/Flow/05_nam.txt', rel(out.absolute.filename));
  ok('".." không thoát được khỏi thư mục Tải xuống',
     rel(out.escape.filename) === '06_sau.txt', rel(out.escape.filename));
  ok('không đặt thư mục -> tải thẳng vào Tải xuống',
     rel(out.none.filename) === '07_bay.txt', rel(out.none.filename));
  // Lưu ý: trong onDeterminingFilename, item.filename là tên Chrome tự suy ra từ
  // URL, KHÔNG phải tên truyền cho downloads.download() — nên chỉ kiểm tra thư mục.
  ok('file không có tên trong hàng đợi vẫn vào đúng thư mục',
     rel(out.noQueue.filename).startsWith('FlowVideos/'), rel(out.noQueue.filename));

  console.log('\n--- CÂY THƯ MỤC THẬT TRÊN Ổ ĐĨA ---');
  const walk = (d, p = '') => { for (const e of fs.readdirSync(d, { withFileTypes: true }))
    e.isDirectory() ? walk(path.join(d, e.name), p + e.name + '/') : console.log('   ' + p + e.name); };
  walk(dl);
  ok('thư mục con thực sự được tạo trên ổ đĩa', fs.existsSync(path.join(dl, 'FlowVideos', 'Tap 01')));

  await ctx.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n════════════════════════════════════════`);
  console.log(`  THƯ MỤC LƯU (Chromium thật) — PASS: ${PASS}   FAIL: ${FAIL}`);
  console.log(`════════════════════════════════════════`);
  process.exit(FAIL ? 1 : 0);
})();
