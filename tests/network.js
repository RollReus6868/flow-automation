/* ============================================================================
   CHỐT CHẶN MẠNG (1.10.0)
   ----------------------------------------------------------------------------
   Nạp content-v2.js thật vào jsdom, ép `navigator.onLine = false` và thay
   `fetch` bằng bản giả để kiểm soát từng kịch bản. Gọi thẳng `networkGateOk()`
   của extension — KHÔNG viết lại logic.

   Chạy:  node tests/network.js
   Đổi bản:  FLOW_VER=1.9.0 node tests/network.js   (bản cũ sẽ fail — đúng ý)
   ========================================================================== */
const fs = require('fs');
const H = require('./harness.js');
const { ok, eq, section, loadPage } = H;

const FLOW_HTML = `<!doctype html><html><body>
  <div class="ProseMirror" contenteditable="true"></div>
</body></html>`;

/** Dựng một trang Flow mới, mỗi test một trang sạch để trạng thái không rò rỉ. */
function newPage() {
  const page = loadPage({ html: FLOW_HTML, scripts: ['content-v2.js'] });
  return page;
}

/** Ép navigator.onLine — jsdom mặc định luôn true. */
function setOnLine(page, value) {
  Object.defineProperty(page.navigator, 'onLine', { get: () => value, configurable: true });
}

/**
 * Thay fetch bằng bản giả.
 *   mode 'ok'      -> trả về Response giả (có mạng)
 *   mode '404'     -> vẫn là CÓ MẠNG: tới được máy chủ mới nhận được mã lỗi
 *   mode 'fail'    -> ném TypeError('Failed to fetch') như Chrome khi mất mạng
 *   mode 'hang'    -> không bao giờ trả lời -> phải bị AbortController cắt
 * Trả về mảng ghi lại các URL đã gọi.
 */
function stubFetch(page, mode) {
  const calls = [];
  page.fetch = (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (mode === 'ok') return Promise.resolve({ ok: true, status: 200 });
    if (mode === '404') return Promise.resolve({ ok: false, status: 404 });
    if (mode === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
    if (mode === 'hang') {
      return new Promise((_res, rej) => {
        const sig = opts.signal;
        if (sig) sig.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          rej(e);
        });
      });
    }
    return Promise.reject(new Error('mode lạ: ' + mode));
  };
  return calls;
}

/** Log mà content script đã gửi về panel qua chrome.runtime.sendMessage. */
function logsOf(page) {
  return page.chrome._sent.filter(m => m && m.action === 'LOG').map(m => m.message);
}
function clearLogs(page) {
  const s = page.chrome._sent;
  s.length = 0;
}

(async () => {

  /* ══════════════════════════════════════════════════════════════
     1. Có mạng bình thường
     ══════════════════════════════════════════════════════════════ */
  section('CHỐT MẠNG: đường bình thường');
  {
    const page = newPage();
    const gate = page.eval('networkGateOk');
    const calls = stubFetch(page, 'fail');   // nếu bị gọi là sai
    setOnLine(page, true);

    ok('onLine=true -> chạy tiếp', (await gate()) === true);
    eq('onLine=true thì KHÔNG dò mạng (không tốn request)', calls.length, 0);
    eq('onLine=true thì không ghi log nào', logsOf(page).length, 0);
  }

  /* ══════════════════════════════════════════════════════════════
     2. LỖI GỐC: Chrome báo mất mạng sai (máy vẫn vào được Flow)
        Đây chính là ca người dùng gặp: T1/T2/T3 spam mỗi 5 giây.
     ══════════════════════════════════════════════════════════════ */
  section('CHỐT MẠNG: Chrome báo sai (onLine=false nhưng vào được Flow)');
  {
    const page = newPage();
    const gate = page.eval('networkGateOk');
    const calls = stubFetch(page, 'ok');
    setOnLine(page, false);

    ok('onLine=false + gọi được Flow -> VẪN CHẠY TIẾP (không ngủ đông)',
       (await gate()) === true);
    eq('đã dò mạng đúng 1 lần', calls.length, 1);

    const url = calls[0].url;
    ok('dò CÙNG ORIGIN với Flow (không cần host_permissions mới)',
       url.startsWith('https://flow.google.com/'), url);
    ok('dò có cache-buster', /[?&]_=\d+/.test(url), url);
    eq('dò dùng cache: no-store', calls[0].opts.cache, 'no-store');
    ok('dò có AbortSignal để cắt khi treo', !!calls[0].opts.signal);

    const L1 = logsOf(page);
    eq('báo động giả -> ghi log đúng 1 dòng', L1.length, 1);
    ok('log nói rõ là cảnh báo SAI, không phải mất mạng',
       /bỏ qua cảnh báo sai/i.test(L1[0]), L1[0]);
    ok('log chỉ đường tới nơi tắt chốt', /Cài đặt/.test(L1[0]), L1[0]);

    // LỖI GỐC: 1.9.0 ghi một dòng mỗi 5 giây, mỗi tab. Gọi lại 20 lần.
    for (let i = 0; i < 20; i++) ok(`lần gọi lại #${i + 1} vẫn chạy tiếp`, (await gate()) === true);
    eq('gọi lại 20 lần KHÔNG ghi thêm log nào (hết spam)', logsOf(page).length, 1);
    eq('gọi lại 20 lần KHÔNG dò lại (giãn nhịp 60 giây)', calls.length, 1);
  }

  /* ══════════════════════════════════════════════════════════════
     3. Mất mạng THẬT
     ══════════════════════════════════════════════════════════════ */
  section('CHỐT MẠNG: mất mạng thật');
  {
    const page = newPage();
    const gate = page.eval('networkGateOk');
    const calls = stubFetch(page, 'fail');
    setOnLine(page, false);

    ok('mất mạng thật -> báo ngủ đông', (await gate()) === false);
    const L = logsOf(page);
    eq('ghi đúng 1 dòng', L.length, 1);
    ok('log có chữ "Mất mạng thật"', /Mất mạng thật/.test(L[0]), L[0]);
    ok('log nói rõ lý do bằng tiếng Việt cụ thể',
       /không gửi được request tới Flow/.test(L[0]), L[0]);

    for (let i = 0; i < 10; i++) await gate();
    eq('gọi lại 10 lần vẫn chỉ 1 dòng log (gộp, không spam mỗi 5 giây)',
       logsOf(page).length, 1);
    ok('có dò lại nhưng thưa (nhịp 15 giây), không dò mỗi lần gọi',
       calls.length === 1, `calls=${calls.length}`);
  }

  /* ══════════════════════════════════════════════════════════════
     4. Treo -> phải bị AbortController cắt, báo "hết thời gian chờ"
     ══════════════════════════════════════════════════════════════ */
  section('CHỐT MẠNG: request treo');
  {
    const page = newPage();
    const gate = page.eval('networkGateOk');
    stubFetch(page, 'hang');
    setOnLine(page, false);

    // Rút ngắn thời gian chờ để test không phải đợi 8 giây thật.
    page.eval('NET_PROBE_TIMEOUT_MS = 120;');
    const t0 = Date.now();
    const r = await gate();
    const dt = Date.now() - t0;

    ok('request treo -> kết luận mất mạng', r === false);
    ok('bị cắt nhanh, không treo vĩnh viễn', dt < 3000, `mất ${dt}ms`);
    const L = logsOf(page);
    ok('log báo đúng "hết thời gian chờ"', /hết thời gian chờ/.test(L[0] || ''), L[0]);
  }

  /* ══════════════════════════════════════════════════════════════
     5. Máy chủ trả 404 vẫn tính là CÓ MẠNG
     ══════════════════════════════════════════════════════════════ */
  section('CHỐT MẠNG: 404 vẫn là có mạng');
  {
    const page = newPage();
    const gate = page.eval('networkGateOk');
    stubFetch(page, '404');
    setOnLine(page, false);
    ok('404 -> tới được máy chủ -> chạy tiếp', (await gate()) === true);
  }

  /* ══════════════════════════════════════════════════════════════
     6. Tuỳ chọn networkGuard = 'off'
     ══════════════════════════════════════════════════════════════ */
  section('CHỐT MẠNG: tuỳ chọn "Bỏ qua hẳn"');
  {
    const page = newPage();
    const gate = page.eval('networkGateOk');
    const calls = stubFetch(page, 'fail');
    setOnLine(page, false);
    page.eval("state.settings.networkGuard = 'off';");

    ok('networkGuard=off -> luôn chạy tiếp dù mất mạng thật', (await gate()) === true);
    eq('networkGuard=off thì không tốn request dò nào', calls.length, 0);
    eq('networkGuard=off thì không ghi log nào', logsOf(page).length, 0);
  }

  /* ══════════════════════════════════════════════════════════════
     7. Mặc định của cài đặt + đường truyền UPDATE_SETTINGS
     ══════════════════════════════════════════════════════════════ */
  section('CHỐT MẠNG: mặc định & UPDATE_SETTINGS');
  {
    const page = newPage();
    eq("mặc định networkGuard = 'auto'", page.eval('state.settings.networkGuard'), 'auto');

    // Panel gửi cài đặt xuống content script qua onMessage thật.
    const listeners = page.chrome._listeners;
    ok('content script có đăng ký onMessage', listeners.length > 0);
    listeners.forEach(fn => fn({ action: 'UPDATE_SETTINGS', data: { networkGuard: 'off' } }, {}, () => {}));
    eq('UPDATE_SETTINGS truyền được networkGuard xuống content',
       page.eval('state.settings.networkGuard'), 'off');
  }

  /* ══════════════════════════════════════════════════════════════
     8. Có mạng trở lại -> báo một dòng rồi thôi
     ══════════════════════════════════════════════════════════════ */
  section('CHỐT MẠNG: hồi phục');
  {
    const page = newPage();
    const gate = page.eval('networkGateOk');
    stubFetch(page, 'fail');
    setOnLine(page, false);
    await gate();                       // vào trạng thái mất mạng
    clearLogs(page);

    setOnLine(page, true);
    ok('có mạng lại -> chạy tiếp', (await gate()) === true);
    const L = logsOf(page);
    eq('báo hồi phục đúng 1 dòng', L.length, 1);
    ok('log báo "Có mạng trở lại"', /Có mạng trở lại/.test(L[0]), L[0]);

    clearLogs(page);
    for (let i = 0; i < 5; i++) await gate();
    eq('sau khi hồi phục thì im lặng hoàn toàn', logsOf(page).length, 0);
  }

  /* ══════════════════════════════════════════════════════════════
     9. Sự kiện online/offline của trình duyệt
     ══════════════════════════════════════════════════════════════ */
  section('CHỐT MẠNG: sự kiện online của trình duyệt');
  {
    const page = newPage();
    const gate = page.eval('networkGateOk');
    const calls = stubFetch(page, 'fail');
    setOnLine(page, false);

    await gate();
    eq('đã dò 1 lần', calls.length, 1);

    // Chưa tới nhịp 15 giây thì không dò lại...
    await gate();
    eq('chưa tới nhịp -> không dò lại', calls.length, 1);

    // ...nhưng sự kiện 'online' phải cho dò lại NGAY.
    page.dispatchEvent(new page.Event('online'));
    setOnLine(page, false);             // OS báo online nhưng ta vẫn kiểm chứng
    await gate();
    eq("sự kiện 'online' -> dò lại ngay, không đợi hết nhịp", calls.length, 2);

    const L = logsOf(page);
    ok("sự kiện 'online' KHÔNG tự ghi log (tránh báo trùng 2 dòng)",
       L.filter(m => /Có mạng trở lại/.test(m)).length === 0, JSON.stringify(L));
  }

  /* ══════════════════════════════════════════════════════════════
     10. Hồi quy mã nguồn — không được quay lại cách cũ
     ══════════════════════════════════════════════════════════════ */
  section('CHỐT MẠNG: hồi quy mã nguồn');
  {
    const src = fs.readFileSync(H.EXT + '/content-v2.js', 'utf8');
    ok('mainLoop KHÔNG còn tin thẳng navigator.onLine',
       !/if\s*\(!navigator\.onLine\)\s*\{[\s\S]{0,120}addLog/.test(src));
    ok('mainLoop gọi networkGateOk()', /await\s+networkGateOk\(\)/.test(src));
    ok('có listener sự kiện online', /addEventListener\('online'/.test(src));
    ok('không còn chuỗi log cũ "Mất mạng! Bot đang ngủ đông"',
       !/Mất mạng! Bot đang ngủ đông/.test(src));

    const panelSrc = fs.readFileSync(H.EXT + '/sidepanel.js', 'utf8');
    const panelHtml = fs.readFileSync(H.EXT + '/sidepanel.html', 'utf8');
    ok('panel có ô chọn networkGuard', /id="networkGuard"/.test(panelHtml));
    ok('networkGuard nằm trong danh sách tự lưu',
       /'networkGuard'/.test(panelSrc));
    ok('panel có mặc định networkGuard', /networkGuard:\s*'auto'/.test(panelSrc));
  }

  const rep = H.report();
  console.log(`\n════════════════════════════════════════`);
  console.log(`  PASS: ${rep.PASS}   FAIL: ${rep.FAIL}`);
  if (rep.FAIL) console.log('  Fail:\n   - ' + rep.fails.join('\n   - '));
  console.log(`════════════════════════════════════════`);
  process.exit(rep.FAIL ? 1 : 0);
})();
