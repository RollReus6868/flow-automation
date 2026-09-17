/* ══════════════════════════════════════════════════════════════════════
   INTEGRATION TEST — luồng TẢI XUỐNG + ĐẶT TÊN FILE thật
   Nối content script ↔ background service worker qua một cầu message giả,
   dựng DOM Google Flow mô phỏng (menu chuột phải + submenu chất lượng),
   rồi chạy chính hàm startDownloadForVideo() của extension.
   ══════════════════════════════════════════════════════════════════════ */
const H = require('/home/claude/tests/harness.js');
const { ok, eq, section, loadPage } = H;

const FLOW_HTML = `<!doctype html><html><body>
  <div class="ProseMirror" contenteditable="true"></div>
  <input type="text" placeholder="Tìm kiếm" id="searchBox">
  <div id="grid"></div>
  <div id="menuHost"></div>
</body></html>`;

function layout(root, w = 200, h = 120) {
  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    el.getBoundingClientRect = () => ({ width: w, height: h, top: 40, left: 40, right: 40 + w, bottom: 40 + h, x: 40, y: 40 });
    Object.defineProperty(el, 'offsetWidth', { get: () => w, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { get: () => h, configurable: true });
    Object.defineProperty(el, 'offsetParent', { get: () => root.parentElement || root, configurable: true });
  }
}

(async () => {
  const page = loadPage({ html: FLOW_HTML, scripts: ['content-v2.js'] });
  const bg = loadPage({
    html: '<!doctype html><html><body></body></html>',
    url: 'chrome-extension://testextension/bg.html',
    scripts: ['background.js']
  });

  const bgRouter = bg.chrome._listeners[0];
  const bgDetermining = bg.chrome._determining;

  /* ── cầu nối content -> background ── */
  page.chrome.runtime.sendMessage = (msg) =>
    new Promise((resolve) => {
      const keep = bgRouter(msg, { tab: { id: 1 } }, resolve);
      if (keep !== true) resolve(undefined);
    });

  /* ── cầu nối background -> content (notifyFlowTabs) ── */
  bg.chrome.tabs.query = (_q, cb) => { cb([{ id: 1, url: 'https://flow.google.com/project/x' }]); };
  bg.chrome.tabs.sendMessage = (_id, payload) => {
    for (const fn of page.chrome._listeners.slice()) {
      try { fn(payload, {}, () => {}); } catch (e) {}
    }
    return Promise.resolve();
  };

  /* ── Chrome Downloads giả: khi Flow "tải", gọi onDeterminingFilename ── */
  const savedFiles = [];
  function fakeChromeDownload(sourceFilename) {
    return new Promise((resolve) => {
      bgDetermining({ filename: sourceFilename, url: 'https://x.googleusercontent.com/a', referrer: 'https://flow.google.com/' },
        (res) => { savedFiles.push(res.filename); resolve(res.filename); });
    });
  }

  /* ─────────────────── DOM Flow mô phỏng ─────────────────── */
  /**
   * Tạo 1 thẻ video kèm hành vi menu:
   *  - contextmenu  -> mở menu có mục "Tải xuống"
   *  - ArrowRight/Enter trên "Tải xuống" -> mở submenu chất lượng
   *  - click mục chất lượng -> "tải file" (gọi Chrome Downloads giả)
   */
  function buildTile(id, { quality = 'video', sourceName = 'flow_download.mp4' } = {}) {
    const grid = page.document.getElementById('grid');
    const tile = page.document.createElement('flow-tile-container');
    tile.setAttribute('data-tile-id', id);
    tile.innerHTML = `<a href="/edit/workflow/${id}"><video src="https://x.googleusercontent.com/${id}.mp4"></video></a>
      <button aria-haspopup="menu" class="mat-mdc-menu-trigger"><i class="google-symbols">more_vert</i></button>`;
    grid.appendChild(tile);
    layout(tile);

    const host = page.document.getElementById('menuHost');

    const openMainMenu = () => {
      host.innerHTML = `<div class="mat-mdc-menu-panel" data-menu="main">
          <button role="menuitem" data-k="dl"><i class="google-symbols">download</i>Tải xuống</button>
          <button role="menuitem" data-k="rn">Đổi tên</button>
        </div>`;
      layout(host.firstElementChild, 200, 30);
      const dl = host.querySelector('[data-k="dl"]');
      const openSub = () => {
        const sub = page.document.createElement('div');
        sub.className = 'mat-mdc-menu-panel';
        sub.dataset.menu = 'sub';
        sub.innerHTML = quality === 'video'
          ? `<button role="menuitem" data-q="4k">4K</button>
             <button role="menuitem" data-q="1080p">1080p</button>
             <button role="menuitem" data-q="720p">720p</button>`
          : `<button role="menuitem" data-q="1k">Kích thước gốc (1K)</button>
             <button role="menuitem" data-q="2k">Tăng lên 2K</button>
             <button role="menuitem" data-q="4k">Tăng lên 4K</button>`;
        host.appendChild(sub);
        layout(sub, 160, 28);
        sub.querySelectorAll('[role="menuitem"]').forEach(it => {
          it.addEventListener('click', () => {
            host.innerHTML = '';                       // Flow đóng menu
            fakeChromeDownload(sourceName);            // rồi tải file
          });
        });
      };
      dl.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'Enter') openSub(); });
    };

    tile.addEventListener('contextmenu', openMainMenu);
    tile.querySelector('button').addEventListener('click', openMainMenu);
    return tile;
  }

  const setState = (patch) => page.eval(`Object.assign(state, ${JSON.stringify(patch)});`);
  const setSettings = (patch) => page.eval(`Object.assign(state.settings, ${JSON.stringify(patch)});`);
  const queueLen = async () => (await bg.chrome.storage.session.get('veoPendingFilenames')).veoPendingFilenames?.length ?? 0;

  /* ══════════════ 1. Tải 2 media của một prompt ══════════════ */
  section('INTEGRATION: tải 2 media + ép tên file đúng thứ tự');

  page.document.getElementById('grid').innerHTML = '';
  page.document.getElementById('menuHost').innerHTML = '';
  savedFiles.length = 0;

  const t1 = buildTile('tileA');
  const t2 = buildTile('tileB');

  setState({ isRunning: true, projectName: 'P1', videos: [], prompts: ['Con mèo bay trên mây xanh'] });
  setSettings({
    autoDownload: true, dlMode: 'single', downloadQuality: '1080p', runMode: 'video',
    renameMode: 'default', renameStartIndex: '1', renameMaxLen: 30, addIndex: true, maxRetries: 3
  });

  const video = {
    promptIndex: 1, promptText: 'Con mèo bay trên mây xanh', status: 'COMPLETED',
    trackedTileIds: ['tileA', 'tileB'], totalVideos: 2, downloadedCount: 0,
    downloaded: false, retries: 0
  };
  page.window = page;
  page.__v = video;
  page.eval(`state.videos = [__v]; __v.cardElements = [document.querySelector('[data-tile-id="tileA"]'), document.querySelector('[data-tile-id="tileB"]')];`);

  await page.eval('startDownloadForVideo')(page.__v);

  eq('đã tải 2 file', savedFiles.length, 2);
  eq('tên file bỏ dấu (Chrome chỉ nhận ASCII) và đúng thứ tự',
     savedFiles, ['01_Con_meo_bay_tren_may_xanh_1.mp4', '01_Con_meo_bay_tren_may_xanh_2.mp4']);
  ok('mọi tên file đều là ASCII thuần', savedFiles.every(f => /^[\x20-\x7E]*$/.test(f)), savedFiles.join(' | '));
  eq('đánh dấu tải xong 2/2', page.eval('state.videos[0].downloadedCount'), 2);
  ok('cờ downloaded = true', page.eval('state.videos[0].downloaded') === true);
  eq('hàng đợi tên file đã rỗng (không rò rỉ)', await queueLen(), 0);

  /* ══════════════ 2. Prompt siêu dài -> tên file vẫn hợp lệ ══════════════ */
  section('INTEGRATION: prompt siêu dài (2.000 ký tự) vẫn tải & đặt tên được');

  page.document.getElementById('grid').innerHTML = '';
  page.document.getElementById('menuHost').innerHTML = '';
  savedFiles.length = 0;
  buildTile('tileLong');

  const longText = 'Một cảnh phim điện ảnh cực kỳ chi tiết về thành phố tương lai '.repeat(35); // ~2100 ký tự
  page.__v2 = {
    promptIndex: 7, promptText: longText, status: 'COMPLETED',
    trackedTileIds: ['tileLong'], totalVideos: 1, downloadedCount: 0, downloaded: false, retries: 0
  };
  setSettings({ renameMaxLen: 0 });   // "không giới hạn"
  page.eval(`state.videos = [__v2]; __v2.cardElements = [document.querySelector('[data-tile-id="tileLong"]')];`);
  await page.eval('startDownloadForVideo')(page.__v2);

  eq('tải được 1 file', savedFiles.length, 1);
  const nm = savedFiles[0] || '';
  ok(`tên file bắt đầu bằng 07_ (thực tế: ${nm.slice(0, 24)}…)`, nm.startsWith('07_'));
  ok('tên file bị chặn trần an toàn ≤ 160 ký tự', nm.length <= 160, `len=${nm.length}`);
  ok('không chứa ký tự cấm của hệ thống tệp', !/[<>:"/\\|?*]/.test(nm.replace(/\.mp4$/, '')), nm);
  eq('hàng đợi rỗng sau khi tải', await queueLen(), 0);

  /* ══════════════ 3. Thẻ sai định dạng -> KHÔNG làm lệch tên file sau ══════════════ */
  section('INTEGRATION: bỏ qua thẻ sai định dạng không gây lệch tên (bug 1.5.6)');

  page.document.getElementById('grid').innerHTML = '';
  page.document.getElementById('menuHost').innerHTML = '';
  savedFiles.length = 0;

  buildTile('tileImg', { quality: 'image' });                  // menu chỉ có 1K/2K/4K -> là ẢNH
  buildTile('tileVid', { quality: 'video', sourceName: 'g.mp4' });

  setSettings({ runMode: 'video', downloadQuality: '1080p', renameMaxLen: 30 });
  page.__v3 = {
    promptIndex: 2, promptText: 'canh bien dem', status: 'COMPLETED',
    trackedTileIds: ['tileImg', 'tileVid'], totalVideos: 2, downloadedCount: 0, downloaded: false, retries: 0
  };
  page.eval(`state.videos = [__v3]; __v3.cardElements = [document.querySelector('[data-tile-id="tileImg"]'), document.querySelector('[data-tile-id="tileVid"]')];`);
  await page.eval('startDownloadForVideo')(page.__v3);

  eq('chỉ tải 1 file (thẻ ảnh bị bỏ qua đúng)', savedFiles.length, 1);
  eq('file tải được mang ĐÚNG tên của nó, không bị lệch sang tên thẻ bị bỏ qua',
     savedFiles[0], '02_canh_bien_dem_2.mp4');
  eq('hàng đợi tên file KHÔNG còn tên rác', await queueLen(), 0);

  /* ══════════════ 4. Bảng tiến trình nhận JSON đầy đủ ══════════════ */
  section('INTEGRATION: content gửi UPDATE_TABLE_DATA với prompt nguyên văn');

  const captured = [];
  page.chrome.runtime.sendMessage = (msg) => { captured.push(msg); return Promise.resolve(); };
  page.eval(`
    state.videos = [{
      promptIndex: 1, promptText: ${JSON.stringify(longText)}, status: 'CREATING',
      progress: 55, retries: 1, downloadedCount: 0, totalVideos: 2, subVideos: [{status:'CREATING',progress:55}]
    }];
    sendTableUpdate();
  `);
  const tableMsg = captured.find(m => m.action === 'UPDATE_TABLE_DATA');
  ok('gửi action UPDATE_TABLE_DATA (không còn HTML thô)', !!tableMsg);
  ok('không còn gửi action UPDATE_TABLE cũ', !captured.some(m => m.action === 'UPDATE_TABLE'));
  eq('prompt gửi đi nguyên văn, không cắt', tableMsg.data.rows[0].prompt.length, longText.length);
  eq('kèm sub-status của từng thẻ', tableMsg.data.rows[0].subVideos.length, 1);

  /* ══════════════ 5. Rename qua UI: tìm đúng ô input trong CDK overlay ══════════════ */
  section('INTEGRATION: rename tìm được ô nhập trong overlay Angular Material');

  // Lấy NGUYÊN source hàm mà background inject vào MAIN world, rồi nạp nó vào
  // window của trang Flow (giống chrome.scripting.executeScript world:'MAIN').
  const renameFnSource = bg.eval('mainWorldRenameInput').toString();
  const mainWorldRenameInput = page.eval(`(${renameFnSource})`);
  page.document.getElementById('menuHost').innerHTML = `
    <div class="cdk-overlay-pane" id="pane">
      <input type="text" value="ten_cu" id="renameInput">
      <button id="confirmBtn"><mat-icon>check</mat-icon></button>
    </div>`;
  const pane = page.document.getElementById('pane');
  layout(pane, 220, 40);
  layout(page.document.getElementById('renameInput'), 160, 32);
  layout(page.document.getElementById('confirmBtn'), 32, 32);

  let confirmClicked = false;
  page.document.getElementById('confirmBtn').addEventListener('click', () => { confirmClicked = true; });

  const renameRes = await mainWorldRenameInput('ten_moi_01');
  ok('rename trả về ok', renameRes.ok === true, JSON.stringify(renameRes));
  eq('tìm ô input qua CDK overlay (bản cũ chỉ hỗ trợ Radix)',
     String(renameRes.inputDebug || '').startsWith('overlay:'), true);
  eq('đã ghi giá trị mới vào input', page.document.getElementById('renameInput').value, 'ten_moi_01');
  ok('đã bấm nút xác nhận ✓', confirmClicked, `confirmVia=${renameRes.confirmVia}`);

  /* ══════════════════════════ KẾT QUẢ ══════════════════════════ */
  const rep = H.report();
  console.log(`\n════════════════════════════════════════`);
  console.log(`  INTEGRATION — PASS: ${rep.PASS}   FAIL: ${rep.FAIL}`);
  if (rep.FAIL) console.log('  Fail:\n   - ' + rep.fails.join('\n   - '));
  console.log(`════════════════════════════════════════`);
  process.exit(rep.FAIL ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
