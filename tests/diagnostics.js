/* ============================================================================
   KIỂM THỬ LỚP TỰ CHẨN ĐOÁN + SELECTOR THỦ CÔNG (1.8.0)
   ----------------------------------------------------------------------------
   Tiện ích phải "đọc" giao diện web của Flow (không có API chính thức), nên khi
   Google đổi UI là các phép dò DOM trượt. Bộ test này canh 4 việc:
     1. Selector do NGƯỜI DÙNG chọn phải được ưu tiên hơn cách dò mặc định.
     2. Selector rác/sai cú pháp KHÔNG được làm sập automation.
     3. Dò trượt nhiều lần -> báo rõ "vỡ ở bước nào", nhưng KHÔNG báo động sai
        khi phần tử đó đúng ra chưa tồn tại (lưới trống chẳng hạn).
     4. Selector sinh ra phải bền: không dùng id/class do framework sinh động.
   ========================================================================== */
const fs = require('fs');
const H = require('./harness.js');
const { ok, eq, section, loadPage } = H;

/* Giao diện Flow giả lập: đủ các phần tử then chốt. */
const FLOW_HTML = `<!doctype html><html><body>
  <input type="search" placeholder="Search" id="searchbox">
  <div class="ProseMirror" contenteditable="true" aria-multiline="true"></div>
  <button class="generate-icon-button" aria-label="Tạo">arrow_forward</button>
  <button class="settings-trigger-button" aria-haspopup="menu">veo 3.1 1x</button>
  <div id="grid">
    <flow-tile-container data-tile-id="t1">
      <video src="blob:v1"></video>
      <button class="mat-mdc-menu-trigger" aria-haspopup="menu">more_vert</button>
    </flow-tile-container>
    <flow-tile-container data-tile-id="t2">
      <video src="blob:v2"></video>
      <button class="mat-mdc-menu-trigger" aria-haspopup="menu">more_vert</button>
    </flow-tile-container>
  </div>
  <div id="fake-new-ui">
    <button class="x1f6kntn9" id="mat-menu-trigger-1274" aria-label="Tùy chọn khác">⋯</button>
  </div>
</body></html>`;

function newPage() {
  const p = loadPage({ html: FLOW_HTML, url: 'https://flow.google.com/project/abc', scripts: ['content-v2.js'] });
  // jsdom trả về rect rỗng cho mọi thứ -> mọi phần tử bị coi là ẩn. Giả lập
  // "đang hiện" cho hợp thực tế (trên Chromium thật thì rect là thật).
  p.eval(`
    Element.prototype.getBoundingClientRect = function () {
      return { width: 100, height: 40, top: 300, left: 10, right: 110, bottom: 340, x: 10, y: 300 };
    };
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { get() { return document.body; }, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth',  { get() { return 100; }, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { get() { return 40; }, configurable: true });
  `);
  return p;
}

/* ══════════════════════════════════════════════════════════════
   1. Sinh selector BỀN (bản cũ trả #id / .class đầu tiên là hỏng)
   ══════════════════════════════════════════════════════════════ */
section('Sinh selector bền khi Flow đổi giao diện');

const p1 = newPage();
const gen = p1.eval('generateSelector');
const isVolatileId = p1.eval('isVolatileId');
const isVolatileClass = p1.eval('isVolatileClass');

ok('id Angular Material động -> KHÔNG dùng', isVolatileId('mat-menu-panel-12'));
ok('id Radix động -> KHÔNG dùng', isVolatileId('radix-:r7:'));
ok('id có nhiều số -> KHÔNG dùng', isVolatileId('button-284713'));
ok('id người viết tay -> dùng được', !isVolatileId('promptBar'));
ok('class hash build -> KHÔNG dùng', isVolatileClass('x1f6kntn9'));
ok('class trạng thái (hover/active) -> KHÔNG dùng', isVolatileClass('hover-state'));
ok('class Angular tns -> KHÔNG dùng', isVolatileClass('ng-tns-c123-4'));
ok('class có nghĩa -> dùng được', !isVolatileClass('mat-mdc-menu-trigger'));

{
  const doc = p1.document;
  const tile = doc.querySelector('flow-tile-container');
  eq('custom element của Flow -> lấy đúng tên thẻ', gen(tile), 'flow-tile-container');

  const create = doc.querySelector('.generate-icon-button');
  const s = gen(create);
  ok('nút Tạo -> selector khớp lại đúng nó',
     [...doc.querySelectorAll(s)].includes(create), s);
  ok('  không dùng class hash', !/x1f6kntn/.test(s), s);

  // Phần tử chỉ có id động + class hash: selector vẫn phải khớp đúng nó,
  // và KHÔNG được bám vào id/class dễ đổi.
  const nasty = doc.querySelector('#fake-new-ui button');
  const sn = gen(nasty);
  ok('phần tử toàn id/class động -> vẫn sinh được selector khớp',
     [...doc.querySelectorAll(sn)].includes(nasty), sn);
  ok('  không bám id động mat-menu-trigger-1274', !sn.includes('1274'), sn);
  ok('  không bám class hash x1f6kntn9', !sn.includes('x1f6kntn9'), sn);
  ok('  dùng aria-label (bền hơn)', sn.includes('aria-label'), sn);

  // Nút ⋮ nằm TRONG thẻ: selector phải chạy được bằng card.querySelectorAll()
  // (bản cũ sinh đường dẫn từ <body> nên không khớp khi quét trong thẻ).
  const card = doc.querySelectorAll('flow-tile-container')[1];
  const menuBtn = card.querySelector('button');
  const sc = gen(menuBtn, card);
  ok('nút ⋮ -> selector chạy được TRONG phạm vi thẻ',
     [...card.querySelectorAll(sc)].includes(menuBtn), sc);
  ok('  selector không chứa đường dẫn từ body', !/^html|^body/.test(sc), sc);
}

/* ══════════════════════════════════════════════════════════════
   2. Selector người dùng chọn được ƯU TIÊN
   ══════════════════════════════════════════════════════════════ */
section('Selector người dùng chọn thắng cách dò mặc định');

{
  const p = newPage();
  const doc = p.document;

  // Mặc định: tìm được ô ProseMirror.
  const def = p.eval('findPromptTextarea()');
  ok('mặc định tìm đúng ô nhập prompt', def === doc.querySelector('.ProseMirror'));

  // Giả lập Google đổi UI: người dùng tự chỉ sang một ô khác.
  doc.body.insertAdjacentHTML('beforeend', '<div id="newEditor" contenteditable="true"></div>');
  p.eval(`state.settings.selectors = { promptEditor: '#newEditor' }`);
  const over = p.eval('findPromptTextarea()');
  ok('có override -> dùng ĐÚNG phần tử người dùng chọn', over === doc.querySelector('#newEditor'));

  // Selector sai cú pháp: tuyệt đối không được ném lỗi làm chết automation.
  p.eval(`state.settings.selectors = { promptEditor: 'div[[[bad' }`);
  let threw = false, fallback = null;
  try { fallback = p.eval('findPromptTextarea()'); } catch (e) { threw = true; }
  ok('selector sai cú pháp -> KHÔNG ném lỗi', !threw);
  ok('  tự quay về cách dò mặc định', fallback === doc.querySelector('.ProseMirror'));

  // Selector hợp lệ nhưng không khớp gì -> cũng phải quay về mặc định.
  p.eval(`state.settings.selectors = { promptEditor: '#khong-ton-tai' }`);
  ok('selector không khớp gì -> quay về mặc định',
     p.eval('findPromptTextarea()') === doc.querySelector('.ProseMirror'));

  // Nút ⋮ trong thẻ: override phải được áp trong phạm vi thẻ.
  p.eval(`state.settings.selectors = { downloadBtn: 'button[aria-haspopup="menu"]' }`);
  const card = doc.querySelector('flow-tile-container');
  const btns = p.eval('findDownloadButtonsInCard')(card);
  eq('override cho nút ⋮ chỉ lấy nút TRONG thẻ đó', btns.length, 1);
  ok('  đúng nút của thẻ đó', btns[0] === card.querySelector('button'));
}

/* ══════════════════════════════════════════════════════════════
   3. Phát hiện vỡ UI — và KHÔNG báo động sai
   ══════════════════════════════════════════════════════════════ */
section('Phát hiện Flow đổi giao diện');
let breakPage = null;

{
  const p = newPage();
  const doc = p.document;
  const sent = p.chrome._sent;

  // Xoá hết phần tử -> mọi phép dò đều trượt.
  doc.querySelector('.ProseMirror').remove();
  doc.querySelector('.generate-icon-button').remove();

  p.eval('state.isRunning = true');
  for (let i = 0; i < 3; i++) p.eval('findPromptTextarea()');

  const logs = sent.filter(m => m.action === 'LOG').map(m => m.message);
  const breakLog = logs.find(m => /KHÔNG TÌM THẤY/.test(m));
  ok('dò trượt 3 lần -> báo lỗi rõ ràng', !!breakLog, JSON.stringify(logs.slice(-3)));
  ok('  nêu đúng TÊN BƯỚC bị vỡ (tiếng Việt)', /Ô nhập prompt/.test(breakLog || ''), breakLog);
  ok('  nói rõ nghi Google đổi giao diện', /đổi giao diện/.test(breakLog || ''), breakLog);
  ok('  chỉ đúng nơi cần bấm để tự vá', /Chọn trên trang|Chẩn đoán/.test(breakLog || ''), breakLog);
  ok('gửi UI_BREAK cho Side Panel', sent.some(m => m.action === 'UI_BREAK'),
     JSON.stringify(sent.map(m => m.action)));

  const brk = sent.find(m => m.action === 'UI_BREAK');
  eq('  kèm key của phần tử', brk?.data?.key, 'promptEditor');

  // Không spam: 20 lần dò trượt tiếp cũng chỉ báo 1 lần trong 5 phút.
  const before = sent.filter(m => m.action === 'UI_BREAK').length;
  for (let i = 0; i < 20; i++) p.eval('findPromptTextarea()');
  eq('không spam log/báo động (cooldown 5 phút)',
     sent.filter(m => m.action === 'UI_BREAK').length, before);

  // Ghi storage là async -> kiểm tra ở phần async bên dưới.
  breakPage = p;
}

section('KHÔNG báo động sai khi phần tử đúng ra chưa tồn tại');

{
  const p = newPage();
  const doc = p.document;
  const sent = p.chrome._sent;

  // Lưới trống là chuyện bình thường (dự án mới, chưa tạo gì).
  doc.getElementById('grid').remove();
  p.eval('state.isRunning = false');
  for (let i = 0; i < 6; i++) p.eval('getOuterTiles()');
  ok('lưới trống + bot không chạy -> KHÔNG báo vỡ UI',
     !sent.some(m => m.action === 'UI_BREAK'),
     JSON.stringify(sent.filter(m => m.action === 'LOG').map(m => m.message).slice(-2)));

  // Nhưng nếu đang chạy và ĐÃ có video đáng lẽ phải thấy -> phải báo.
  p.eval(`
    state.isRunning = true;
    state.videos = [{ promptIndex: 1, status: STATUS.COMPLETED }];
  `);
  for (let i = 0; i < 3; i++) p.eval('getOuterTiles()');
  ok('đang chạy mà không thấy thẻ nào -> BÁO vỡ UI',
     sent.some(m => m.action === 'UI_BREAK' && m.data?.key === 'tile'));
}

/* ══════════════════════════════════════════════════════════════
   4. Tự kiểm tra toàn bộ giao diện (nút "Kiểm tra")
   ══════════════════════════════════════════════════════════════ */
section('Nút Kiểm tra giao diện: báo cáo từng bước');

(async () => {
  /* Snapshot chẩn đoán được ghi vào storage (async) — kiểm tra ở đây. */
  await new Promise(r => setTimeout(r, 50));
  {
    const diag = breakPage.chrome._store.veoUiDiagnostics;
    ok('lưu snapshot chẩn đoán vào storage (panel đọc lại được sau F5)', !!diag?.promptEditor);
    ok('  snapshot có danh sách phần tử ứng viên để vá',
       Array.isArray(diag?.promptEditor?.candidates) && diag.promptEditor.candidates.length > 0,
       JSON.stringify(diag?.promptEditor?.candidates?.length));
    ok('  ứng viên có cả selector đề xuất và HTML rút gọn',
       !!diag?.promptEditor?.candidates?.[0]?.selector && !!diag?.promptEditor?.candidates?.[0]?.html);
  }

  const p = newPage();
  const report = await p.eval('runUiSelfTest')(false);

  eq('kiểm tra đủ 6 phần tử then chốt', report.rows.length, 6);
  const byKey = Object.fromEntries(report.rows.map(r => [r.key, r]));
  ok('ô nhập prompt: OK', byKey.promptEditor.ok);
  ok('nút Tạo: OK', byKey.createBtn.ok);
  ok('ô tìm kiếm: OK', byKey.searchBox.ok);
  ok('thẻ video: OK', byKey.tile.ok);
  eq('  đếm đúng 2 thẻ', byKey.tile.count, 2);
  ok('nút ⋮ trên thẻ: OK', byKey.downloadBtn.ok);
  ok('có ghi nguồn dò (mặc định / override)', byKey.tile.via === 'builtin');
  ok('báo cáo có URL + số thẻ để đối chiếu', !!report.url && report.tileCount === 2);

  // Sau khi Flow "đổi UI": phần tử mất -> phải báo đỏ kèm ứng viên.
  p.document.querySelector('.generate-icon-button').remove();
  p.document.querySelector('.ProseMirror').classList.remove('ProseMirror');
  const r2 = await p.eval('runUiSelfTest')(false);
  const b2 = Object.fromEntries(r2.rows.map(r => [r.key, r]));
  ok('mất nút Tạo -> báo KHÔNG tìm thấy', !b2.createBtn.ok);
  ok('  kèm phần tử ứng viên để chọn nhanh', b2.createBtn.candidates.length > 0);
  ok('  đánh dấu là phần tử quan trọng', b2.createBtn.critical === true);

  // Kiểm tra sâu không được chen vào khi bot đang thao tác.
  p.eval('uiLock = true');
  const deep = await p.eval('probeCardMenu')();
  ok('bot đang thao tác -> hoãn mở menu, nêu lý do rõ ràng',
     deep.ok === false && /tạm dừng bot|đang thao tác/i.test(deep.reason), JSON.stringify(deep));

  /* ══════════════════════════════════════════════════════════════
     5. SIDE PANEL — báo cáo .txt và lưu selector thủ công
     ══════════════════════════════════════════════════════════════ */
  section('Side Panel: báo cáo .txt và lưu selector thủ công');

  const panel = loadPage({
    html: fs.readFileSync(H.EXT + '/sidepanel.html', 'utf8'),
    url: 'chrome-extension://testextension/sidepanel.html',
    scripts: ['sidepanel.js']
  });
  // Chờ boot của panel chạy xong: DOMContentLoaded gọi applySettings() và HÀM ĐÓ
  // THAY app.settings, nếu ta ghi trước thì bị nó đè -> test đua giả tạo.
  await new Promise(r => setTimeout(r, 80));

  panel.eval(`
    app.settings.selectors = { downloadBtn: 'button.my-pick' };
    app.logs = [{ type: 'error', message: 'Timeout: không dán được prompt', time: '10:00:00' }];
    app.diag = ${JSON.stringify(r2)};
  `);
  const text = panel.eval('buildDiagReportText()');

  ok('báo cáo nêu phần tử KHÔNG tìm thấy', /KHÔNG TÌM THẤY\] Nút Tạo/.test(text), text.slice(0, 200));
  ok('báo cáo liệt kê ứng viên kèm selector', /selector:/.test(text));
  ok('báo cáo có HTML rút gọn của ứng viên', /html\s*:/.test(text));
  ok('báo cáo có selector người dùng đang đặt', /downloadBtn = button\.my-pick/.test(text));
  ok('báo cáo kèm log gần nhất', /Timeout: không dán được prompt/.test(text));
  ok('báo cáo có URL trang Flow', /flow\.google\.com/.test(text));
  ok('báo cáo có phiên bản tiện ích', /Phiên bản tool/.test(text));

  // Lưu selector nhập tay: phải chặn cú pháp sai trước khi ghi vào settings.
  panel.eval(`app.settings.selectors = {}`);
  await panel.eval('saveManualSelector')('createBtn', 'Nút Tạo', 'button[[[bad');
  eq('selector sai cú pháp -> KHÔNG lưu', panel.eval('app.settings.selectors').createBtn, undefined);
  await panel.eval('saveManualSelector')('createBtn', 'Nút Tạo', 'button.send-btn');
  eq('selector hợp lệ -> lưu vào cài đặt', panel.eval('app.settings.selectors').createBtn, 'button.send-btn');
  ok('  đã ghi xuống storage để content script dùng',
     panel.chrome._store.veoSettings?.selectors?.createBtn === 'button.send-btn');

  /* Regression: bộ chọn cũ chỉ nhận đúng downloadBtn, nay nhận mọi phần tử. */
  section('Regression: picker nhận mọi phần tử, không chỉ nút ⋮');
  const src = fs.readFileSync(H.EXT + '/sidepanel.js', 'utf8');
  ok('PICK_RESULT lưu theo key động', /\[targetType\]: selector/.test(src));
  ok('không còn tham chiếu #pickedSelector đã bị xoá khỏi HTML',
     !/pickedSelector/.test(src));
  const csrc = fs.readFileSync(H.EXT + '/content-v2.js', 'utf8');
  ok('picker có bảng hướng dẫn trên trang', /veo-pick-banner/.test(csrc));
  ok('picker huỷ được bằng Esc', /handlePickEscape/.test(csrc));
  ok('6 phần tử then chốt đều có nhãn tiếng Việt',
     (csrc.match(/label: '[^']+'/g) || []).length >= 6);

  const rep = H.report();
  console.log(`\n════════════════════════════════════════`);
  console.log(`  CHẨN ĐOÁN UI — PASS: ${rep.PASS}   FAIL: ${rep.FAIL}`);
  if (rep.FAIL) rep.fails.forEach(f => console.log('   - ' + f));
  console.log(`════════════════════════════════════════`);
  process.exit(rep.FAIL ? 1 : 0);
})();
