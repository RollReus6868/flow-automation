/* ============================================================================
   KIỂM TRA BẢN MỚI (1.9.0) — tầng 1: jsdom + chrome API giả
   ----------------------------------------------------------------------------
   Nạp chính background.js và sidepanel.js thật, gọi qua các hàm thật. `fetch`
   được thay bằng bản giả để kiểm soát từng tình huống (mạng lỗi, JSON sai,
   timeout, version cũ hơn/mới hơn). Phần fetch THẬT trong service worker được
   kiểm chứng riêng ở tầng 3 (update-chrome.js) vì jsdom không phải môi trường
   service worker.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const H = require('./harness.js');
const { ok, eq, section, loadPage, EXT } = H;

const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const CUR = MANIFEST.version;

/** Nạp background.js với một fetch giả. */
function loadBg(fetchImpl) {
  const win = loadPage({ scripts: ['background.js'] });
  win.fetch = fetchImpl || (() => Promise.reject(new Error('fetch chưa được gán')));
  // AbortController có trong jsdom; AbortError cần mô phỏng khi test timeout.
  return win;
}

/** fetch giả trả về nội dung text với mã trạng thái cho trước. */
function fakeFetch(body, { status = 200, delayMs = 0 } = {}) {
  return (url, opts) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))
    }), delayMs);
    // Tôn trọng AbortSignal để test được nhánh timeout.
    if (opts?.signal) {
      opts.signal.addEventListener('abort', () => {
        clearTimeout(t);
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    }
  });
}

(async () => {

  /* ───────────────────────── so sánh phiên bản ───────────────────────── */
  section('So sánh phiên bản (parseVersion / compareVersions)');
  {
    const win = loadBg();
    const cmp = win.compareVersions, parse = win.parseVersion;

    eq('1.9.0 vs 1.8.0 -> mới hơn', cmp('1.9.0', '1.8.0'), 1);
    eq('1.8.0 vs 1.9.0 -> cũ hơn', cmp('1.8.0', '1.9.0'), -1);
    eq('1.8.0 vs 1.8.0 -> bằng', cmp('1.8.0', '1.8.0'), 0);
    // Đây là cái bẫy kinh điển của so sánh chuỗi: "1.10.0" < "1.9.0" theo
    // thứ tự chữ, nhưng 1.10.0 MỚI HƠN.
    eq('1.10.0 vs 1.9.0 -> mới hơn (không so chuỗi)', cmp('1.10.0', '1.9.0'), 1);
    eq('1.9.10 vs 1.9.9 -> mới hơn', cmp('1.9.10', '1.9.9'), 1);
    eq('2.0 vs 1.9.9 -> mới hơn (thiếu phần vẫn đúng)', cmp('2.0', '1.9.9'), 1);
    eq('1.9.0.1 vs 1.9.0 -> mới hơn (4 phần)', cmp('1.9.0.1', '1.9.0'), 1);
    eq('1.9.0-beta.2 vs 1.9.0 -> bằng (bỏ đuôi pre-release)', cmp('1.9.0-beta.2', '1.9.0'), 0);
    eq('khoảng trắng hai đầu vẫn parse được', cmp('  1.9.0  ', '1.9.0'), 0);

    eq('version rỗng -> null', cmp('', '1.0.0'), null);
    eq('version chữ -> null', cmp('bản mới nhất', '1.0.0'), null);
    eq('version âm -> null', parse('-1.0.0'), null);
    eq('undefined -> null', parse(undefined), null);
    ok('parse("1.9") trả 4 phần', JSON.stringify(parse('1.9')) === '[1,9,0,0]', JSON.stringify(parse('1.9')));
  }

  /* ─────────────────── chặn URL không được manifest cho ─────────────────── */
  section('Chặn URL ngoài host_permissions');
  {
    const win = loadBg();
    const allow = win.isUpdateUrlAllowed;
    ok('raw.githubusercontent.com -> cho phép',
       allow('https://raw.githubusercontent.com/a/b/main/version.json'));
    ok('gist.githubusercontent.com -> cho phép',
       allow('https://gist.githubusercontent.com/a/b/raw/version.json'));
    ok('http (không TLS) -> chặn',
       !allow('http://raw.githubusercontent.com/a/b/main/version.json'));
    ok('host lạ -> chặn', !allow('https://example.com/version.json'));
    // Đây là bẫy thật: tên miền chứa chuỗi hợp lệ nhưng KHÔNG phải host đó.
    ok('host đánh lừa (raw.githubusercontent.com.evil.tld) -> chặn',
       !allow('https://raw.githubusercontent.com.evil.tld/version.json'));
    ok('URL rác -> chặn', !allow('không phải url'));
    ok('rỗng -> chặn', !allow(''));

    // Địa chỉ mặc định phải nằm trong danh sách cho phép, nếu không thì tính
    // năng chết ngay từ lần cài đầu.
    ok('UPDATE_DEFAULT_URL nằm trong host được phép', allow(win.UPDATE_DEFAULT_URL),
       win.UPDATE_DEFAULT_URL);
    ok('UPDATE_DEFAULT_URL trỏ tới file version.json',
       /\/version\.json$/.test(win.UPDATE_DEFAULT_URL), win.UPDATE_DEFAULT_URL);
  }

  /* ───────────────────────── đọc version.json ───────────────────────── */
  section('Đọc version.json (fetchLatestVersion)');
  {
    const URL_OK = 'https://raw.githubusercontent.com/a/b/main/version.json';
    {
      const win = loadBg(fakeFetch({ version: '2.0.0', notes: 'ghi chú', downloadUrl: 'https://x/y.zip', publishedAt: '2026-01-02' }));
      const r = await win.fetchLatestVersion(URL_OK);
      ok('JSON hợp lệ -> ok', r.ok, JSON.stringify(r));
      eq('đọc đúng version', r.version, '2.0.0');
      eq('đọc đúng notes', r.notes, 'ghi chú');
      eq('đọc đúng downloadUrl', r.downloadUrl, 'https://x/y.zip');
    }
    {
      let seen = '';
      const win = loadBg((u) => { seen = u; return fakeFetch({ version: '2.0.0' })(u, {}); });
      await win.fetchLatestVersion(URL_OK);
      // raw.githubusercontent.com cache 5 phút -> thiếu cache-buster thì vừa
      // push xong vẫn đọc ra bản cũ.
      ok('URL có thêm tham số chống cache', /[?&]_=\d+/.test(seen), seen);
    }
    {
      const win = loadBg(fakeFetch('{ không phải json', {}));
      const r = await win.fetchLatestVersion(URL_OK);
      ok('JSON sai cú pháp -> báo lỗi rõ ràng, không throw',
         !r.ok && /JSON/i.test(r.error), JSON.stringify(r));
    }
    {
      const win = loadBg(fakeFetch({ notes: 'thiếu version' }));
      const r = await win.fetchLatestVersion(URL_OK);
      ok('thiếu trường version -> báo lỗi', !r.ok && /version/i.test(r.error), JSON.stringify(r));
    }
    {
      const win = loadBg(fakeFetch('', { status: 404 }));
      const r = await win.fetchLatestVersion(URL_OK);
      ok('404 (repo đổi tên / file chưa push) -> báo mã lỗi',
         !r.ok && /404/.test(r.error), JSON.stringify(r));
    }
    {
      const win = loadBg(() => Promise.reject(new Error('Failed to fetch')));
      const r = await win.fetchLatestVersion(URL_OK);
      ok('mất mạng -> báo lỗi, không throw ra ngoài', !r.ok && !!r.error, JSON.stringify(r));
    }
    {
      // delay dài hơn UPDATE_TIMEOUT_MS -> phải bị abort và báo hết thời gian chờ
      const win = loadBg(fakeFetch({ version: '9.9.9' }, { delayMs: 60000 }));
      win.UPDATE_TIMEOUT_MS = 30;   // rút ngắn để test không phải chờ 10 giây
      const r = await win.fetchLatestVersion(URL_OK);
      ok('mạng treo -> abort và báo hết thời gian chờ',
         !r.ok && /thời gian chờ|abort/i.test(r.error), JSON.stringify(r));
    }
    {
      const win = loadBg(fakeFetch({ version: '2.0.0' }));
      const r = await win.fetchLatestVersion('https://example.com/version.json');
      ok('URL bị chặn -> KHÔNG gọi mạng, báo lỗi ngay',
         !r.ok && /không được phép/i.test(r.error), JSON.stringify(r));
    }
  }

  /* ──────────────────── checkForUpdate: luồng đầy đủ ──────────────────── */
  section('checkForUpdate — so với manifest thật, lưu trạng thái');
  {
    {
      const win = loadBg(fakeFetch({ version: '99.0.0', notes: 'to lắm', publishedAt: '2026-02-03' }));
      const r = await win.checkForUpdate({ force: true });
      eq('bản xa mới hơn -> status "new"', r.status, 'new');
      eq('trả về đúng version hiện tại (đọc từ manifest)', r.current, CUR);
      eq('trả về đúng version mới', r.latest, '99.0.0');
      const st = (await win.chrome.storage.local.get('veoUpdate')).veoUpdate;
      eq('đã lưu latest vào storage', st.latest, '99.0.0');
      ok('đã lưu mốc thời gian kiểm tra', st.lastCheckAt > 0, String(st.lastCheckAt));
      eq('không còn lỗi cũ treo lại', st.error, '');
    }
    {
      const win = loadBg(fakeFetch({ version: '0.0.1' }));
      const r = await win.checkForUpdate({ force: true });
      eq('bản xa cũ hơn -> status "latest"', r.status, 'latest');
    }
    {
      const win = loadBg(fakeFetch({ version: CUR }));
      const r = await win.checkForUpdate({ force: true });
      eq('bản xa bằng bản đang dùng -> "latest"', r.status, 'latest');
    }
    {
      const win = loadBg(fakeFetch('', { status: 500 }));
      const r = await win.checkForUpdate({ force: true });
      eq('máy chủ lỗi -> status "error"', r.status, 'error');
      const st = (await win.chrome.storage.local.get('veoUpdate')).veoUpdate;
      ok('lỗi được lưu để panel hiện lại được', /500/.test(st.error), st.error);
      ok('vẫn cập nhật lastCheckAt (không thử lại liên tục khi đang lỗi)',
         st.lastCheckAt > 0, String(st.lastCheckAt));
    }
  }

  /* ─────────────────────────── throttle 6 giờ ─────────────────────────── */
  section('Throttle — mở panel nhiều lần không gọi mạng liên tục');
  {
    let calls = 0;
    const win = loadBg((u, o) => { calls++; return fakeFetch({ version: '99.0.0' })(u, o); });

    await win.checkForUpdate({ force: false });
    eq('lần đầu: có gọi mạng', calls, 1);

    const r2 = await win.checkForUpdate({ force: false });
    eq('gọi lại ngay: KHÔNG gọi mạng thêm', calls, 1);
    ok('vẫn trả về kết quả từ cache', r2.cached === true && r2.latest === '99.0.0', JSON.stringify(r2));
    eq('cache vẫn báo đúng là có bản mới', r2.status, 'new');

    const r3 = await win.checkForUpdate({ force: true });
    eq('bấm nút (force): bỏ qua throttle, gọi mạng lại', calls, 2);
    eq('force trả kết quả tươi (không phải cache)', r3.cached, undefined);

    // Giả lập đã quá 6 giờ
    const st = (await win.chrome.storage.local.get('veoUpdate')).veoUpdate;
    await win.chrome.storage.local.set({
      veoUpdate: { ...st, lastCheckAt: Date.now() - (6 * 60 * 60 * 1000 + 1000) }
    });
    await win.checkForUpdate({ force: false });
    eq('quá 6 giờ: tự gọi mạng lại', calls, 3);
  }

  /* ──────────────────────── tắt tự kiểm tra ──────────────────────── */
  section('Tôn trọng lựa chọn tắt tự kiểm tra');
  {
    let calls = 0;
    const win = loadBg((u, o) => { calls++; return fakeFetch({ version: '99.0.0' })(u, o); });
    await win.chrome.storage.local.set({ veoSettings: { updateCheckEnabled: false } });

    const r = await win.checkForUpdate({ force: false });
    eq('đã tắt -> status "skipped"', r.status, 'skipped');
    eq('đã tắt -> không gọi mạng', calls, 0);

    const r2 = await win.checkForUpdate({ force: true });
    eq('nhưng bấm nút tay thì VẪN kiểm tra (tắt là tắt tự động, không phải khoá nút)',
       r2.status, 'new');
    eq('bấm tay có gọi mạng', calls, 1);
  }
  {
    let calls = 0;
    const win = loadBg((u, o) => { calls++; return fakeFetch({ version: '99.0.0' })(u, o); });
    // Người mới cài: CHƯA có veoSettings -> phải mặc định BẬT, nếu không thì
    // người dùng mới không bao giờ được báo bản mới.
    const r = await win.checkForUpdate({ force: false });
    eq('chưa có veoSettings -> vẫn tự kiểm tra (mặc định bật)', r.status, 'new');
    eq('có gọi mạng', calls, 1);
  }

  /* ───────────────────── dùng URL tuỳ chỉnh trong cài đặt ───────────────────── */
  section('URL tuỳ chỉnh trong Cài đặt');
  {
    let seen = '';
    const win = loadBg((u, o) => { seen = u; return fakeFetch({ version: '99.0.0' })(u, o); });
    await win.chrome.storage.local.set({
      veoSettings: { updateCheckUrl: 'https://gist.githubusercontent.com/me/abc/raw/version.json' }
    });
    await win.checkForUpdate({ force: true });
    ok('dùng đúng URL người dùng nhập', seen.startsWith('https://gist.githubusercontent.com/me/abc/raw/version.json'), seen);

    await win.chrome.storage.local.set({ veoSettings: { updateCheckUrl: '   ' } });
    seen = '';
    await win.checkForUpdate({ force: true });
    ok('URL để trống/toàn khoảng trắng -> quay về địa chỉ mặc định',
       seen.startsWith(win.UPDATE_DEFAULT_URL), seen);
  }

  /* ─────────────── thông báo hệ thống chỉ một lần mỗi version ─────────────── */
  section('Thông báo hệ thống — không làm phiền quá một lần mỗi bản');
  {
    const win = loadBg(fakeFetch({ version: '99.0.0' }));
    let notes = 0;
    win.chrome.notifications.create = () => { notes++; };

    const r = await win.checkForUpdate({ force: true });
    eq('lần đầu thấy bản mới -> có thông báo', await win.notifyUpdateOnce(r), true);
    eq('đã hiện 1 thông báo', notes, 1);

    eq('gọi lại cùng version -> KHÔNG thông báo nữa', await win.notifyUpdateOnce(r), false);
    eq('vẫn chỉ 1 thông báo', notes, 1);

    eq('bản mới hơn nữa -> thông báo lại',
       await win.notifyUpdateOnce({ status: 'new', latest: '99.1.0' }), true);
    eq('đã hiện 2 thông báo', notes, 2);

    eq('không có bản mới -> không thông báo',
       await win.notifyUpdateOnce({ status: 'latest', latest: CUR }), false);
    eq('vẫn 2 thông báo', notes, 2);
  }

  /* ─────────────── "Để sau": ẩn đúng bản đó, bản sau vẫn báo ─────────────── */
  section('Nút "Để sau" (DISMISS_UPDATE)');
  {
    const win = loadBg(fakeFetch({ version: '99.0.0' }));
    await win.patchUpdateState({ dismissedVersion: '99.0.0' });
    const st = await win.getUpdateState();
    eq('đã lưu bản bị ẩn', st.dismissedVersion, '99.0.0');
    // patch không được xoá các trường khác
    await win.patchUpdateState({ latest: '99.0.0' });
    const st2 = await win.getUpdateState();
    eq('patch giữ nguyên dismissedVersion', st2.dismissedVersion, '99.0.0');
    eq('patch ghi được latest', st2.latest, '99.0.0');
  }

  /* ─────────────── phía Side Panel: quyết định hiện banner ─────────────── */
  section('Side Panel — logic hiện/ẩn banner');
  {
    const html = fs.readFileSync(path.join(EXT, 'sidepanel.html'), 'utf8');
    const win = loadPage({ html, url: 'chrome-extension://testextension/sidepanel.html', scripts: ['sidepanel.js'] });
    const banner = () => !win.document.getElementById('updateBanner').classList.contains('hidden');

    // compareVersionsUi phải khớp hành vi của background (cùng cái bẫy 1.10 vs 1.9)
    eq('panel: 1.10.0 vs 1.9.0 -> mới hơn', win.compareVersionsUi('1.10.0', '1.9.0'), 1);
    eq('panel: bằng nhau', win.compareVersionsUi(CUR, CUR), 0);
    eq('panel: version rác -> null', win.compareVersionsUi('x', CUR), null);

    ok('có bản mới, chưa ẩn -> HIỆN banner',
       win.applyUpdateResult({ current: '1.9.0', latest: '1.10.0', notes: 'abc', dismissedVersion: '' }) === true
       && banner());
    ok('tiêu đề banner ghi đúng số bản mới',
       win.document.getElementById('updateBannerTitle').textContent.includes('1.10.0'),
       win.document.getElementById('updateBannerTitle').textContent);

    ok('đã bấm "Để sau" đúng bản đó -> KHÔNG hiện',
       win.applyUpdateResult({ current: '1.9.0', latest: '1.10.0', dismissedVersion: '1.10.0' }) === true
       && !banner());
    ok('nhưng bản MỚI HƠN nữa thì vẫn hiện lại',
       win.applyUpdateResult({ current: '1.9.0', latest: '1.11.0', dismissedVersion: '1.10.0' }) === true
       && banner());
    ok('đang là bản mới nhất -> không hiện',
       win.applyUpdateResult({ current: '1.9.0', latest: '1.9.0', dismissedVersion: '' }) === false
       && !banner());
    ok('bản xa cũ hơn -> không hiện',
       win.applyUpdateResult({ current: '1.9.0', latest: '1.8.0', dismissedVersion: '' }) === false
       && !banner());
    ok('chưa kiểm tra lần nào (latest rỗng) -> không hiện',
       !win.applyUpdateResult({ current: '1.9.0', latest: '', dismissedVersion: '' })
       && !banner());

    // Link tải dự phòng suy ra từ URL raw khi version.json không ghi downloadUrl
    eq('suy ra trang repo từ URL raw',
       win.repoPageFromRawUrl('https://raw.githubusercontent.com/RollReus6868/flow-automation/main/version.json'),
       'https://github.com/RollReus6868/flow-automation');
    eq('URL không phải raw -> không suy ra', win.repoPageFromRawUrl('https://example.com/a.json'), '');
    eq('ưu tiên downloadUrl trong version.json',
       win.updateDownloadTarget({ downloadUrl: 'https://x/y.zip', url: 'https://raw.githubusercontent.com/a/b/main/version.json' }),
       'https://x/y.zip');
    eq('thiếu downloadUrl -> dùng trang repo suy ra được',
       win.updateDownloadTarget({ url: 'https://raw.githubusercontent.com/a/b/main/version.json' }),
       'https://github.com/a/b');
  }

  /* ───────── panel <-> background: đúng thông điệp, đúng cờ force ───────── */
  section('Side Panel gọi background đúng cách');
  {
    const html = fs.readFileSync(path.join(EXT, 'sidepanel.html'), 'utf8');
    const win = loadPage({ html, url: 'chrome-extension://testextension/sidepanel.html', scripts: ['sidepanel.js'] });
    const sent = win.chrome._sent;
    win.chrome._reply = (msg) => {
      if (msg.action === 'GET_UPDATE_STATE') {
        return { ok: true, current: '1.9.0', latest: '1.10.0', dismissedVersion: '', lastCheckAt: Date.now(), url: 'https://raw.githubusercontent.com/a/b/main/version.json' };
      }
      if (msg.action === 'CHECK_UPDATE') return { ok: true, status: 'new', current: '1.9.0', latest: '1.10.0' };
      return { ok: true };
    };

    sent.length = 0;
    await win.refreshUpdateUI();
    eq('refreshUpdateUI hỏi GET_UPDATE_STATE', sent.map(m => m.action).join(','), 'GET_UPDATE_STATE');
    ok('điền được version đang dùng vào mục Cài đặt',
       win.document.getElementById('updCurrent').textContent === '1.9.0',
       win.document.getElementById('updCurrent').textContent);
    ok('mục Cài đặt ghi rõ bản mới hơn',
       /1\.10\.0.*mới hơn/.test(win.document.getElementById('updLatest').textContent),
       win.document.getElementById('updLatest').textContent);

    sent.length = 0;
    await win.doUpdateCheck(false);
    const auto = sent.find(m => m.action === 'CHECK_UPDATE');
    eq('mở panel -> gửi CHECK_UPDATE với force=false (để throttle có hiệu lực)', auto.force, false);

    sent.length = 0;
    await win.doUpdateCheck(true);
    const manual = sent.find(m => m.action === 'CHECK_UPDATE');
    eq('bấm nút -> force=true', manual.force, true);
    ok('nút được bật lại sau khi kiểm tra xong',
       win.document.getElementById('updCheckBtn').disabled === false);
    ok('chữ trên nút trở lại bình thường',
       win.document.getElementById('updCheckBtn').textContent.includes('Kiểm tra bản mới'),
       win.document.getElementById('updCheckBtn').textContent);

    // background không trả lời (worker chết) -> panel không được vỡ
    win.chrome._reply = () => undefined;
    sent.length = 0;
    let threw = false;
    try { await win.refreshUpdateUI(); } catch (e) { threw = true; }
    ok('background không phản hồi -> panel không throw', !threw);
  }

  /* ───────────────── cài đặt mới được lưu/nạp đúng ───────────────── */
  section('Cài đặt updateCheckEnabled / updateCheckUrl');
  {
    const html = fs.readFileSync(path.join(EXT, 'sidepanel.html'), 'utf8');
    const win = loadPage({ html, url: 'chrome-extension://testextension/sidepanel.html', scripts: ['sidepanel.js'] });

    eq('mặc định BẬT tự kiểm tra', win.DEFAULT_SETTINGS.updateCheckEnabled, true);
    eq('mặc định URL để trống (dùng địa chỉ trong background)', win.DEFAULT_SETTINGS.updateCheckUrl, '');

    win.applySettings({ updateCheckEnabled: false, updateCheckUrl: 'https://gist.githubusercontent.com/x/y/raw/v.json' });
    eq('applySettings tắt được ô chọn', win.document.getElementById('updateCheckEnabled').checked, false);
    eq('applySettings điền được URL', win.document.getElementById('updateCheckUrl').value,
       'https://gist.githubusercontent.com/x/y/raw/v.json');

    win.document.getElementById('updateCheckEnabled').checked = true;
    win.document.getElementById('updateCheckUrl').value = '  https://raw.githubusercontent.com/a/b/main/version.json  ';
    const g = win.gatherSettings();
    eq('gatherSettings đọc lại ô chọn', g.updateCheckEnabled, true);
    eq('gatherSettings cắt khoảng trắng của URL', g.updateCheckUrl,
       'https://raw.githubusercontent.com/a/b/main/version.json');

    // Dòng "đã kiểm tra ... " phải đọc được với mọi khoảng thời gian.
    eq('chưa kiểm tra -> nói rõ chưa lần nào', win.fmtCheckedAt(0), 'Chưa kiểm tra lần nào.');
    ok('vừa xong', /vừa xong/.test(win.fmtCheckedAt(Date.now() - 5000)), win.fmtCheckedAt(Date.now() - 5000));
    ok('tính theo phút', /7 phút trước/.test(win.fmtCheckedAt(Date.now() - 7 * 60000)),
       win.fmtCheckedAt(Date.now() - 7 * 60000));
    ok('tính theo giờ', /3 giờ trước/.test(win.fmtCheckedAt(Date.now() - 3 * 3600000)),
       win.fmtCheckedAt(Date.now() - 3 * 3600000));
    ok('quá 1 ngày -> hiện ngày giờ cụ thể',
       /\d{4}/.test(win.fmtCheckedAt(Date.now() - 3 * 86400000)),
       win.fmtCheckedAt(Date.now() - 3 * 86400000));
  }

  /* ─── askBackground không được treo vĩnh viễn (bài học từ ảnh chụp) ─── */
  section('askBackground có thời gian chờ — worker im lặng không được làm treo panel');
  {
    const html = fs.readFileSync(path.join(EXT, 'sidepanel.html'), 'utf8');
    const win = loadPage({ html, url: 'chrome-extension://testextension/sidepanel.html', scripts: ['sidepanel.js'] });
    win.BG_TIMEOUT_MS = 60;
    // sendMessage KHÔNG gọi callback -> mô phỏng service worker chết hẳn.
    win.chrome.runtime.sendMessage = () => {};
    const t0 = Date.now();
    const r = await win.askBackground('GET_UPDATE_STATE');
    const waited = Date.now() - t0;
    ok('không treo: trả về sau khi hết thời gian chờ', waited < 5000, waited + 'ms');
    ok('báo rõ là background không phản hồi',
       r.ok === false && /không phản hồi/i.test(r.error), JSON.stringify(r));

    // Và refreshUpdateUI trong tình huống đó vẫn kết thúc, không throw.
    let done = false;
    await win.refreshUpdateUI().then(() => { done = true; });
    ok('refreshUpdateUI vẫn kết thúc bình thường khi worker im lặng', done);
  }

  /* ─────────────── version.json trong repo phải khớp manifest ─────────────── */
  section('version.json trong repo khớp với manifest của bản mới nhất');
  {
    const vjPath = path.join(__dirname, '..', 'version.json');
    ok('repo có file version.json', fs.existsSync(vjPath), vjPath);
    if (fs.existsSync(vjPath)) {
      const vj = JSON.parse(fs.readFileSync(vjPath, 'utf8'));
      eq('version.json khớp version trong manifest đang test', vj.version, CUR);
      ok('có downloadUrl https', /^https:\/\//.test(vj.downloadUrl || ''), String(vj.downloadUrl));
      ok('có notes để hiện trên banner', !!vj.notes, String(vj.notes));
    }
  }

  const { PASS, FAIL } = H.report();
  console.log(`\n════════════════════════════════════════`);
  console.log(`  KIỂM TRA BẢN MỚI — PASS: ${PASS}   FAIL: ${FAIL}`);
  console.log(`════════════════════════════════════════`);
  process.exit(FAIL ? 1 : 0);
})();
