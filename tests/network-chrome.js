/* ============================================================================
   CHỐT CHẶN MẠNG trên CHROMIUM THẬT (1.10.0)
   ----------------------------------------------------------------------------
   Vì sao cần tầng này dù logic đã có test jsdom:
   Bản sửa đặt cược vào ba giả định của TRÌNH DUYỆT THẬT mà jsdom không chứng
   minh được (jsdom chỉ chạy `fetch` giả):
     1. `navigator.onLine` THẬT SỰ có thể là `false` trong khi request vẫn đi
        được — đúng cảnh người dùng gặp. Ở đây tái hiện bằng CDP
        `Network.emulateNetworkConditions` (context.setOffline) cộng với một
        route được Playwright trả lời hộ.
     2. `fetch` CÙNG ORIGIN từ trang Flow chạy được với `cache:'no-store'` +
        `credentials:'omit'` + `AbortSignal` — tức phép dò không cần thêm
        host_permissions và không bị CORS chặn.
     3. Mất mạng thật thì `fetch` ném đúng `TypeError: Failed to fetch`, chuỗi
        mà `describeNetError()` dựa vào để ghi log tiếng Việt.
   Ngoài ra kiểm luôn: content-v2.js nạp được trong Chrome thật, không lỗi cú
   pháp, không ném lỗi lúc khởi tạo (jsdom có biến đổi const/let nên có thể che
   mất lỗi thật).

   Trang https://flow.google.com được Playwright trả lời hộ (route) nên test
   KHÔNG cần mạng ra ngoài và không đụng vào tài khoản Google nào.

   Chạy:  node tests/network-chrome.js
   ========================================================================== */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { EXT, launchOpts } = require('./paths.js');

let PASS = 0, FAIL = 0;
const fails = [];
const ok = (n, c, x = '') => {
  if (c) { PASS++; console.log('  ✓ ' + n); }
  else { FAIL++; fails.push(n); console.log('  ✗ ' + n + ' ' + x); }
};
const section = (t) => console.log(`\n── ${t} ──`);

const FLOW_HTML = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Flow</title></head>
<body><div class="ProseMirror" contenteditable="true"></div></body></html>`;

/** Điều khiển cách route trả lời phép dò: 'ok' | 'dead' */
let probeMode = 'ok';
const probeHits = [];

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netguard-'));
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    ...launchOpts(),
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
           '--no-first-run', '--no-default-browser-check'],
  });

  await ctx.route('https://flow.google.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/favicon.ico')) {
      probeHits.push(url);
      if (probeMode === 'dead') return route.abort('internetdisconnected');
      return route.fulfill({ status: 200, contentType: 'image/x-icon', body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FLOW_HTML });
  });

  const pg = await ctx.newPage();
  const consoleLines = [];
  const pageErrors = [];
  pg.on('console', (m) => consoleLines.push(m.text()));
  pg.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));

  await pg.goto('https://flow.google.com/project/test', { waitUntil: 'domcontentloaded' });
  // content_scripts chạy ở run_at: document_idle -> chờ một nhịp.
  await pg.waitForTimeout(1500);

  /* ═══════════════════════════════════════════════════════════════
     1. Content script nạp được trong Chrome thật
     ═══════════════════════════════════════════════════════════════ */
  section('Content script nạp trong Chrome thật');
  ok('content-v2.js nạp xong (thấy log khởi động)',
     consoleLines.some(l => /Content V2 Script Loaded|Content script loaded/i.test(l)),
     JSON.stringify(consoleLines.slice(0, 5)));
  ok('không có lỗi cú pháp / lỗi khởi tạo nào',
     pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

  /* ═══════════════════════════════════════════════════════════════
     2. Phép dò cùng origin chạy được ở trạng thái mạng bình thường
     ═══════════════════════════════════════════════════════════════ */
  section('Phép dò cùng origin (mạng bình thường)');
  const probeInPage = async () => pg.evaluate(async () => {
    // ĐÚNG hình dạng request mà probeNetwork() trong content-v2.js dùng.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      const r = await fetch(`${location.origin}/favicon.ico?_=${Date.now()}`, {
        method: 'GET', cache: 'no-store', credentials: 'omit', signal: ctrl.signal
      });
      return { ok: true, status: r.status, onLine: navigator.onLine };
    } catch (e) {
      return { ok: false, name: e.name, message: String(e.message || e), onLine: navigator.onLine };
    } finally { clearTimeout(timer); }
  });

  {
    const before = probeHits.length;
    const r = await probeInPage();
    ok('navigator.onLine = true khi mạng bình thường', r.onLine === true, JSON.stringify(r));
    ok('fetch cùng origin thành công (không vướng CORS, không cần host_permissions)',
       r.ok === true, JSON.stringify(r));
    ok('request thật sự được gửi đi', probeHits.length === before + 1);
  }

  /* ═══════════════════════════════════════════════════════════════
     3. TÁI HIỆN LỖI GỐC: onLine = false nhưng vẫn gọi được Flow
     ═══════════════════════════════════════════════════════════════ */
  section('Tái hiện lỗi gốc: Chrome báo mất mạng sai');
  {
    probeMode = 'ok';
    await ctx.setOffline(true);
    await pg.waitForTimeout(200);

    const r = await probeInPage();
    ok('TÁI HIỆN được: navigator.onLine = false (đúng cảnh người dùng gặp)',
       r.onLine === false, JSON.stringify(r));
    ok('nhưng request tới Flow VẪN THÀNH CÔNG -> 1.9.0 đã dừng bot oan',
       r.ok === true, JSON.stringify(r));
    ok('=> phép dò của 1.10.0 phân biệt được báo động giả', r.onLine === false && r.ok === true);
  }

  /* ═══════════════════════════════════════════════════════════════
     4. Mất mạng thật -> đúng chuỗi lỗi mà describeNetError() trông chờ
     ═══════════════════════════════════════════════════════════════ */
  section('Mất mạng thật');
  {
    probeMode = 'dead';
    const r = await probeInPage();
    ok('mất mạng thật -> fetch ném lỗi', r.ok === false, JSON.stringify(r));
    ok('ném đúng TypeError: Failed to fetch (chuỗi describeNetError() dựa vào)',
       /Failed to fetch/i.test(r.message || ''), JSON.stringify(r));

    // Chạy đúng hàm dịch lỗi của extension trên chuỗi lỗi THẬT vừa bắt được.
    const src = fs.readFileSync(path.join(EXT, 'content-v2.js'), 'utf8');
    const m = src.match(/function describeNetError\(e\)[\s\S]*?\n\}/);
    ok('tìm thấy describeNetError() trong content-v2.js', !!m);
    if (m) {
      const NET_PROBE_TIMEOUT_MS = 8000;
      // eslint-disable-next-line no-eval
      const describeNetError = eval(`(${m[0].replace('function describeNetError', 'function')})`);
      const viet = describeNetError(new TypeError(r.message));
      ok('dịch lỗi thật sang tiếng Việt cụ thể (không chung chung)',
         /không gửi được request tới Flow/.test(viet), viet);
      const ab = new Error('aborted'); ab.name = 'AbortError';
      ok('lỗi treo -> "hết thời gian chờ (quá 8 giây)"',
         describeNetError(ab) === 'hết thời gian chờ (quá 8 giây)', describeNetError(ab));
    }

    await ctx.setOffline(false);
  }

  await ctx.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}

  console.log(`\n════════════════════════════════════════`);
  console.log(`  CHỐT MẠNG (Chromium thật) — PASS: ${PASS}   FAIL: ${FAIL}`);
  if (FAIL) console.log('  Fail:\n   - ' + fails.join('\n   - '));
  console.log(`════════════════════════════════════════`);
  process.exit(FAIL ? 1 : 0);
})();
