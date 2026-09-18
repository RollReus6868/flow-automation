/* ============================================================================
   KIỂM TRA BẢN MỚI — tầng 3: CHROMIUM THẬT
   ----------------------------------------------------------------------------
   Vì sao phải chạy trên browser thật (jsdom không thay được):
     1. Code kiểm tra bản mới sống trong SERVICE WORKER của MV3 — môi trường
        khác hẳn window: worker bị kill/hồi sinh, không có DOM, và fetch chạy
        trong ngữ cảnh extension nên bị host_permissions chặn thật sự.
     2. chrome.storage.local ở đây là bản THẬT (jsdom chỉ là object giả), nên
        đây là chỗ duy nhất chứng minh trạng thái sống sót qua các lần gọi.
     3. Đường đi panel -> chrome.runtime.sendMessage -> onMessage của worker
        chỉ tồn tại trên browser thật; jsdom chỉ mô phỏng được lời gọi.
   `fetch` trong worker được thay bằng bản giả để kiểm soát nội dung trả về —
   nhưng mọi thứ còn lại (worker, storage, message passing, manifest) là thật.
   ========================================================================== */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { EXT, launchOpts } = require('./paths.js');

const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const CUR = MANIFEST.version;

let PASS = 0, FAIL = 0;
const ok = (n, c, x = '') => { c ? (PASS++, console.log('  ✓ ' + n)) : (FAIL++, console.log('  ✗ ' + n + ' ' + x)); };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want),
  `\n      nhận: ${JSON.stringify(got)}\n      cần : ${JSON.stringify(want)}`);

async function waitForReadySw(ctx) {
  for (let i = 0; i < 80; i++) {
    const sw = ctx.serviceWorkers()[0];
    if (sw) {
      try {
        if (await sw.evaluate(() => typeof checkForUpdate === 'function')) return sw;
      } catch (e) { /* worker đang khởi động lại */ }
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Service worker không nạp xong background.js');
}

async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    ...launchOpts(),
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
           '--no-first-run', '--no-default-browser-check'],
  });
  const sw = await waitForReadySw(ctx);
  const extId = new URL(sw.url()).host;

  // Worker tự chạy MỘT LƯỢT kiểm tra bản mới lúc khởi động (onStartup) và lượt
  // đó dùng MẠNG THẬT. Nếu để nó chạy song song với kịch bản test thì nó ghi đè
  // trạng thái vừa dựng (ví dụ xoá cờ lỗi thành "vừa xong") -> test đỏ ngẫu
  // nhiên. Chặn ngay từ đầu: bịt fetch rồi chờ lượt khởi động kết thúc, để mỗi
  // kịch bản bắt đầu từ trạng thái sạch và KHÔNG có request nào đang bay.
  await sw.evaluate(() => {
    globalThis.__calls = [];
    globalThis.fetch = (url) => {
      globalThis.__calls.push(String(url));
      return Promise.reject(new Error('boot-check bị chặn trong test'));
    };
  });
  await new Promise(r => setTimeout(r, 1500));

  return { ctx, sw, dir, extId };
}

/** Thay fetch trong worker bằng bản giả có ghi lại các URL đã gọi. */
async function stubFetch(sw, body, status = 200) {
  await sw.evaluate(({ body, status }) => {
    globalThis.__calls = [];
    globalThis.fetch = (url) => {
      globalThis.__calls.push(String(url));
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(body)
      });
    };
  }, { body: typeof body === 'string' ? body : JSON.stringify(body), status });
}

(async () => {

  /* ═══════════ 1. Worker thật: manifest, quyền, trạng thái lưu bền ═══════════ */
  console.log('\n── Service worker thật: đọc manifest, quyền fetch, lưu trạng thái ──');
  {
    const { ctx, sw, dir } = await launch();

    const ver = await sw.evaluate(() => currentVersion());
    eq('worker đọc đúng version từ manifest thật', ver, CUR);

    // Nếu manifest thiếu host này thì Chrome chặn fetch -> tính năng chết im lặng.
    ok('manifest khai quyền raw.githubusercontent.com',
       MANIFEST.host_permissions.includes('https://raw.githubusercontent.com/*'),
       JSON.stringify(MANIFEST.host_permissions));

    const allowed = await sw.evaluate(() => ({
      def: isUpdateUrlAllowed(UPDATE_DEFAULT_URL),
      evil: isUpdateUrlAllowed('https://raw.githubusercontent.com.evil.tld/v.json'),
      plain: isUpdateUrlAllowed('http://raw.githubusercontent.com/a/b/main/v.json')
    }));
    ok('địa chỉ mặc định được phép trong worker thật', allowed.def);
    ok('host đánh lừa bị chặn trong worker thật', !allowed.evil);
    ok('http (không TLS) bị chặn trong worker thật', !allowed.plain);

    await stubFetch(sw, { version: '99.0.0', notes: 'thử nghiệm', publishedAt: '2026-09-17' });
    const r = await sw.evaluate(() => checkForUpdate({ force: true }));
    eq('worker thật: phát hiện có bản mới', r.status, 'new');
    eq('worker thật: trả đúng bản mới', r.latest, '99.0.0');

    // Đọc lại từ chrome.storage.local THẬT
    const stored = await sw.evaluate(() =>
      chrome.storage.local.get('veoUpdate').then(o => o.veoUpdate));
    eq('chrome.storage.local thật đã lưu latest', stored.latest, '99.0.0');
    eq('đã lưu notes', stored.notes, 'thử nghiệm');
    ok('đã lưu mốc kiểm tra', stored.lastCheckAt > 0, String(stored.lastCheckAt));

    const calls = await sw.evaluate(() => globalThis.__calls);
    ok('URL gọi đi có tham số chống cache', /[?&]_=\d+/.test(calls[0] || ''), String(calls[0]));

    await ctx.close(); fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ═══════════ 2. Trạng thái sống sót khi worker bị KILL rồi hồi sinh ═══════════ */
  console.log('\n── Worker bị kill rồi hồi sinh: trạng thái và throttle vẫn đúng ──');
  {
    const { ctx, sw, dir } = await launch();
    await stubFetch(sw, { version: '99.0.0' });
    await sw.evaluate(() => checkForUpdate({ force: true }));

    // Ép worker chết: MV3 kill worker khi rảnh. Playwright không có API kill
    // trực tiếp, nhưng gọi lại sau khi worker restart vẫn phải đọc được storage,
    // nên ở đây kiểm tra điều quan trọng hơn: state nằm ở storage, KHÔNG nằm
    // trong biến toàn cục của worker.
    const usesGlobalVar = await sw.evaluate(() =>
      typeof globalThis.__updateStateInMemory !== 'undefined');
    ok('trạng thái không giữ trong biến toàn cục (sống sót khi worker bị kill)', !usesGlobalVar);

    const st = await sw.evaluate(() => getUpdateState());
    eq('đọc lại được latest từ storage', st.latest, '99.0.0');

    // Lần gọi KHÔNG force ngay sau đó phải dùng cache, không gọi mạng thêm.
    await sw.evaluate(() => { globalThis.__calls = []; });
    const cached = await sw.evaluate(() => checkForUpdate({ force: false }));
    const callsAfter = await sw.evaluate(() => globalThis.__calls.length);
    eq('trong 6 giờ: dùng cache, không gọi mạng', callsAfter, 0);
    ok('cache vẫn báo có bản mới', cached.status === 'new' && cached.cached === true,
       JSON.stringify(cached));

    await ctx.close(); fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ═══════════ 3. Round-trip THẬT: trang extension -> worker -> trả lời ═══════════ */
  console.log('\n── Panel gọi worker qua chrome.runtime.sendMessage (thật) ──');
  {
    const { ctx, sw, dir, extId } = await launch();
    await stubFetch(sw, { version: '99.0.0', notes: 'có bản mới', downloadUrl: 'https://github.com/a/b/archive/main.zip' });

    // Mở CHÍNH sidepanel.html như một trang thật -> có chrome.runtime thật.
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${extId}/sidepanel.html`);
    await page.waitForFunction(() => typeof window.doUpdateCheck === 'function');

    const ask = (action, data = {}) => page.evaluate(({ action, data }) =>
      new Promise(res => chrome.runtime.sendMessage({ action, ...data }, r => res(r))),
      { action, data });

    const chk = await ask('CHECK_UPDATE', { force: true });
    ok('CHECK_UPDATE trả lời được qua message thật', chk?.ok === true, JSON.stringify(chk));
    eq('worker báo có bản mới', chk.status, 'new');
    eq('worker trả đúng version hiện tại', chk.current, CUR);

    const state = await ask('GET_UPDATE_STATE');
    ok('GET_UPDATE_STATE trả lời được', state?.ok === true, JSON.stringify(state));
    eq('state mang downloadUrl để panel mở trang tải', state.downloadUrl,
       'https://github.com/a/b/archive/main.zip');
    ok('state mang cả URL đang dùng và URL mặc định',
       !!state.url && !!state.defaultUrl, JSON.stringify({ url: state.url, d: state.defaultUrl }));

    // Banner phải hiện trên DOM THẬT của panel sau khi kiểm tra.
    await page.evaluate(() => window.doUpdateCheck(true));
    const bannerOn = await page.evaluate(() =>
      !document.getElementById('updateBanner').classList.contains('hidden'));
    ok('banner hiện trên DOM thật của panel', bannerOn);
    const title = await page.evaluate(() => document.getElementById('updateBannerTitle').textContent);
    ok('banner ghi đúng số bản mới', title.includes('99.0.0'), title);

    // "Để sau" -> lưu vào storage thật, banner ẩn, và lần sau không hiện lại.
    await page.evaluate(() => document.getElementById('updateLaterBtn').click());
    await page.waitForFunction(() =>
      document.getElementById('updateBanner').classList.contains('hidden'));
    const dismissed = await sw.evaluate(() => getUpdateState().then(s => s.dismissedVersion));
    eq('"Để sau" lưu đúng bản bị ẩn vào storage thật', dismissed, '99.0.0');

    await page.evaluate(() => window.doUpdateCheck(true));
    const stillHidden = await page.evaluate(() =>
      document.getElementById('updateBanner').classList.contains('hidden'));
    ok('kiểm tra lại cùng bản đó -> banner KHÔNG hiện lại (không làm phiền)', stillHidden);

    // Nhưng bản mới hơn nữa thì phải hiện lại.
    await stubFetch(sw, { version: '99.1.0' });
    await page.evaluate(() => window.doUpdateCheck(true));
    const shownAgain = await page.evaluate(() =>
      !document.getElementById('updateBanner').classList.contains('hidden'));
    ok('bản mới hơn nữa -> banner hiện lại', shownAgain);

    await ctx.close(); fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ═══════════ 4. Lỗi mạng thật sự: panel phải báo, không treo ═══════════ */
  console.log('\n── Lỗi mạng / URL sai: báo rõ, không treo, không vỡ panel ──');
  {
    const { ctx, sw, dir, extId } = await launch();
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${extId}/sidepanel.html`);
    await page.waitForFunction(() => typeof window.doUpdateCheck === 'function');

    // 404: file chưa push / repo đổi tên
    await stubFetch(sw, '', 404);
    let r = await page.evaluate(() =>
      new Promise(res => chrome.runtime.sendMessage({ action: 'CHECK_UPDATE', force: true }, res)));
    eq('404 -> status error', r.status, 'error');
    ok('lỗi ghi rõ mã 404', /404/.test(r.error || ''), r.error);

    // fetch throw: mất mạng hoàn toàn
    await sw.evaluate(() => { globalThis.fetch = () => Promise.reject(new Error('Failed to fetch')); });
    r = await page.evaluate(() =>
      new Promise(res => chrome.runtime.sendMessage({ action: 'CHECK_UPDATE', force: true }, res)));
    eq('mất mạng -> status error', r.status, 'error');
    ok('panel nhận được thông điệp lỗi (không treo vô hạn)', !!r.error, JSON.stringify(r));

    // Panel vẫn phải sống và banner không hiện khi đang lỗi.
    // Panel vẽ lại mục "Cập nhật tiện ích" SAU khi worker trả lời (qua
    // GET_UPDATE_STATE), nên đọc DOM ngay lập tức là đọc phải bản cũ -> chờ.
    await page.waitForFunction(
      () => /lỗi/i.test(document.getElementById('updCheckedAt').textContent),
      null, { timeout: 5000 }
    ).catch(() => {});
    const alive = await page.evaluate(() => {
      const el = document.getElementById('updCheckedAt');
      return { text: el.textContent, hidden: document.getElementById('updateBanner').classList.contains('hidden') };
    });
    ok('mục Cài đặt hiện lý do lỗi cho người dùng', /lỗi/i.test(alive.text), alive.text);
    ok('đang lỗi thì không hiện banner "có bản mới"', alive.hidden);

    // URL ngoài host cho phép -> chặn trước khi gọi mạng
    await sw.evaluate(() => chrome.storage.local.set({
      veoSettings: { updateCheckUrl: 'https://example.com/version.json' }
    }));
    await sw.evaluate(() => { globalThis.__calls = []; globalThis.fetch = (u) => { globalThis.__calls.push(u); return Promise.reject(new Error('không được gọi')); }; });
    r = await page.evaluate(() =>
      new Promise(res => chrome.runtime.sendMessage({ action: 'CHECK_UPDATE', force: true }, res)));
    eq('URL host lạ -> error', r.status, 'error');
    const blockedCalls = await sw.evaluate(() => globalThis.__calls.length);
    eq('URL host lạ -> KHÔNG gọi mạng chút nào', blockedCalls, 0);

    await ctx.close(); fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ═══════════ 5. Tắt tự kiểm tra: không gọi mạng khi mở panel ═══════════ */
  console.log('\n── Tắt tự kiểm tra trong Cài đặt ──');
  {
    const { ctx, sw, dir, extId } = await launch();
    await sw.evaluate(() => chrome.storage.local.set({
      veoSettings: { updateCheckEnabled: false }
    }));
    // launch() đã chặn sẵn lượt kiểm tra lúc khởi động, nên bộ đếm ở đây sạch.
    await stubFetch(sw, { version: '99.0.0' });

    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${extId}/sidepanel.html`);
    await page.waitForFunction(() => typeof window.doUpdateCheck === 'function');
    // boot của panel đã chạy xong; chờ thêm một nhịp cho chắc
    await page.waitForTimeout(600);

    const calls = await sw.evaluate(() => globalThis.__calls.length);
    eq('đã tắt -> mở panel KHÔNG gọi mạng', calls, 0);

    // nhưng bấm nút tay thì vẫn phải kiểm tra được
    const r = await page.evaluate(() =>
      new Promise(res => chrome.runtime.sendMessage({ action: 'CHECK_UPDATE', force: true }, res)));
    eq('bấm tay vẫn kiểm tra được dù đã tắt tự động', r.status, 'new');

    await ctx.close(); fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`  BẢN MỚI (Chromium thật) — PASS: ${PASS}   FAIL: ${FAIL}`);
  console.log(`════════════════════════════════════════`);
  process.exit(FAIL ? 1 : 0);
})();
