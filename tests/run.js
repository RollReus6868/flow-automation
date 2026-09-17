const H = require('./harness.js');
const { ok, eq, section, loadPage } = H;

/* ══════════════════════════════════════════════════════════════════
   1. SIDE PANEL — tách prompt, range, không giới hạn ký tự
   ══════════════════════════════════════════════════════════════════ */
section('SIDE PANEL: tách prompt / phạm vi chạy');

const panelHtml = require('fs').readFileSync(H.EXT + '/sidepanel.html', 'utf8');
const panel = loadPage({
  html: panelHtml,
  url: 'chrome-extension://testextension/sidepanel.html',
  scripts: ['sidepanel.js']
});
panel.document.dispatchEvent(new panel.Event('DOMContentLoaded'));

const doc = panel.document;
const parsePrompts = panel.eval('parsePrompts');
const joinPrompts = panel.eval('joinPrompts');
const parseIndexList = panel.eval('parseIndexList');

eq('mode line: mỗi dòng 1 prompt',
   parsePrompts('a\nb\n\nc\n', 'line'), ['a', 'b', 'c']);

eq('mode blank: prompt nhiều dòng',
   parsePrompts('dòng 1\ndòng 2\n\nprompt hai\nvẫn prompt hai', 'blank'),
   ['dòng 1\ndòng 2', 'prompt hai\nvẫn prompt hai']);

eq('mode dash: ngắt bằng ---',
   parsePrompts('p1 dòng a\np1 dòng b\n---\np2', 'dash'),
   ['p1 dòng a\np1 dòng b', 'p2']);

eq('mode eq: ngắt bằng ===',
   parsePrompts('x\n===\ny\n\nvẫn y', 'eq'), ['x', 'y\n\nvẫn y']);

eq('CRLF được chuẩn hoá', parsePrompts('a\r\nb\r\n', 'line'), ['a', 'b']);
eq('text rỗng -> []', parsePrompts('   \n  \n', 'line'), []);

// KHÔNG GIỚI HẠN KÝ TỰ
const huge = 'X'.repeat(50000);
const parsedHuge = parsePrompts(huge + '\nshort', 'line');
ok('prompt 50.000 ký tự không bị cắt', parsedHuge[0].length === 50000, `len=${parsedHuge[0].length}`);

// round-trip cho từng mode
for (const m of ['line', 'blank', 'dash', 'eq']) {
  const list = m === 'line' ? ['a', 'b', 'c'] : ['a\nline2', 'b', 'c'];
  eq(`round-trip join→parse (${m})`, parsePrompts(joinPrompts(list, m), m), list);
}

eq('range list "1,3,7"', parseIndexList('1,3,7', 10), [1, 3, 7]);
eq('range list có dải "2-5"', parseIndexList('2-5, 9', 10), [2, 3, 4, 5, 9]);
eq('range list dải nghịch "7-5"', parseIndexList('7-5', 10), [5, 6, 7]);
eq('range list loại số ngoài phạm vi', parseIndexList('0, 3, 99', 10), [3]);
eq('range list trùng lặp bị gộp', parseIndexList('3,3,3', 10), [3]);

/* thống kê ký tự */
section('SIDE PANEL: thống kê & xem trước');
doc.getElementById('promptsInput').value = 'abc\n' + 'Y'.repeat(1234);
panel.eval('refreshPromptStats()');
ok('đếm đúng 2 prompt', doc.getElementById('promptCount').textContent.startsWith('2 prompt'),
   doc.getElementById('promptCount').textContent);
ok('hiển thị prompt dài nhất 1.234', /1\.234/.test(doc.getElementById('promptChars').textContent),
   doc.getElementById('promptChars').textContent);

/* ══════════════════════════════════════════════════════════════════
   1b. ẢNH → VIDEO (mới 1.6.1)
   ══════════════════════════════════════════════════════════════════ */
section('ẢNH → VIDEO: sinh mã ảnh & dòng prompt');

const setI2v = (o) => {
  for (const [k, v] of Object.entries(o)) {
    const el = doc.getElementById(k);
    if (!el) throw new Error('không có #' + k);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
  }
};
const i2vNames = panel.eval('i2vImageNames');
const i2vInvalid = panel.eval('i2vInvalidNames');
const i2vLine = panel.eval('i2vLineFor');

setI2v({ i2vFrom: 1, i2vTo: 5, i2vPad: 2, i2vNamePrefix: '', i2vNameSuffix: '' });
eq('1..5 pad2', i2vNames(), ['01', '02', '03', '04', '05']);

setI2v({ i2vFrom: 8, i2vTo: 12, i2vPad: 3 });
eq('8..12 pad3', i2vNames(), ['008', '009', '010', '011', '012']);

setI2v({ i2vFrom: 1, i2vTo: 3, i2vPad: 1 });
eq('pad1 không thêm 0', i2vNames(), ['1', '2', '3']);

setI2v({ i2vFrom: 1, i2vTo: 3, i2vPad: 2, i2vNamePrefix: 'anh', i2vNameSuffix: '_v2' });
eq('tiền tố + hậu tố', i2vNames(), ['anh01_v2', 'anh02_v2', 'anh03_v2']);

setI2v({ i2vFrom: 5, i2vTo: 2, i2vPad: 2, i2vNamePrefix: '', i2vNameSuffix: '' });
eq('đến < từ -> rỗng (chặn nhập sai)', i2vNames(), []);

setI2v({ i2vFrom: 1, i2vTo: 5000, i2vPad: 2 });
eq('khoảng quá lớn -> rỗng (chặn nhập sai)', i2vNames(), []);

setI2v({ i2vFrom: 1, i2vTo: 1, i2vPad: 2 });
eq('một ảnh duy nhất', i2vNames(), ['01']);

// mã ảnh phải khớp regex @tag của Character Sync
eq('mã hợp lệ', i2vInvalid(['01', 'anh_02', 'Cảnh3']), []);
eq('mã có gạch ngang là KHÔNG hợp lệ (regex @tag không nhận)', i2vInvalid(['anh-01']), ['anh-01']);
eq('mã có khoảng trắng là KHÔNG hợp lệ', i2vInvalid(['anh 01']), ['anh 01']);
eq('mã có dấu chấm là KHÔNG hợp lệ', i2vInvalid(['01.png']), ['01.png']);

section('ẢNH → VIDEO: ghép prompt');
setI2v({ i2vPrompt: 'camera zoom cham', i2vUsePromptList: false });
eq('prompt chung + mã ảnh ở cuối', i2vLine('01', 0), 'camera zoom cham @01');

doc.getElementById('promptsInput').value = 'dong mot\ndong hai';
panel.eval('refreshPromptStats()');
setI2v({ i2vUsePromptList: true });
eq('dùng dòng prompt riêng cho ảnh 1', i2vLine('01', 0), 'dong mot @01');
eq('dùng dòng prompt riêng cho ảnh 2', i2vLine('02', 1), 'dong hai @02');
eq('thiếu dòng -> bù bằng prompt chung', i2vLine('03', 2), 'camera zoom cham @03');
setI2v({ i2vUsePromptList: false });

section('ẢNH → VIDEO: nút Sinh danh sách');
doc.getElementById('promptsInput').value = '';
panel.eval('refreshPromptStats()');
setI2v({ i2vFrom: 1, i2vTo: 4, i2vPad: 2, i2vNamePrefix: '', i2vNameSuffix: '',
         i2vPrompt: 'giu nguyen nhan vat, zoom rat cham', i2vStripTag: true, i2vUsePromptList: false });
doc.getElementById('promptSeparator').value = 'blank';   // sẽ bị buộc về 'line'
doc.getElementById('charSync').checked = false;
panel.eval('i2vGenerate()');

eq('ghi 4 dòng vào tab Chạy', panel.eval('app.prompts.length'), 4);
eq('dòng đầu đúng định dạng', panel.eval('app.prompts[0]'), 'giu nguyen nhan vat, zoom rat cham @01');
eq('dòng cuối đúng định dạng', panel.eval('app.prompts[3]'), 'giu nguyen nhan vat, zoom rat cham @04');
eq('buộc kiểu tách về "mỗi dòng 1 prompt"', doc.getElementById('promptSeparator').value, 'line');
ok('tự bật Character Sync', doc.getElementById('charSync').checked === true);
ok('tự tắt Keyframe Sync', doc.getElementById('keyframeSync').checked === false);
ok('tự chuyển về chế độ Video', doc.querySelector('input[name="runMode"][value="video"]').checked === true);
ok('bật charSyncStripTag theo tuỳ chọn', panel.eval('app.settings.charSyncStripTag') === true);
eq('phạm vi chạy tự bao hết 4 prompt', doc.getElementById('endIndex').value, '4');
eq('chuyển sang tab Chạy', doc.querySelector('.tab.active').dataset.tab, 'run');

section('ẢNH → VIDEO: thứ tự tệp theo số tự nhiên');
const natural = panel.eval('naturalCompare');
const shuffled = ['10.png', '2.png', '1.png', '21.png', '3.png'];
eq('sắp xếp 1,2,3,10,21 (không phải 1,10,2,21,3)',
   shuffled.slice().sort(natural), ['1.png', '2.png', '3.png', '10.png', '21.png']);

/* ══════════════════════════════════════════════════════════════════
   1c. XEM TRƯỚC TÊN FILE + THƯ MỤC LƯU
   ══════════════════════════════════════════════════════════════════ */
section('SIDE PANEL: xem trước tên file');

const setRn = (o) => {
  for (const [k, v] of Object.entries(o)) {
    const el = doc.getElementById(k);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
  }
};
const previewText = () => { panel.eval('updateRenamePreview()'); return doc.getElementById('renamePreview').textContent; };

doc.getElementById('promptsInput').value = 'Con mèo bay trên mây';
panel.eval('refreshPromptStats()');

setRn({ renameMode: 'index_only', renameStartIndex: 1, renameIndexPad: 3, renamePrefix: 'Canh', renameSuffix: '', downloadSubfolder: '' });
eq('xem trước chế độ số thứ tự', previewText(), 'Canh_001.mp4');

setRn({ renameMode: 'default', renameStartIndex: 1, renameMaxLen: 30, downloadSubfolder: '' });
ok('xem trước chế độ prompt ĐÃ BỎ DẤU (đúng như trên đĩa)',
   previewText() === '01_Con_meo_bay_tren_may.mp4', previewText());

setRn({ downloadSubfolder: 'FlowVideos/Tập 01' });
eq('xem trước kèm thư mục con (bỏ dấu từng đoạn)', previewText(), 'FlowVideos/Tap 01/01_Con_meo_bay_tren_may.mp4');

setRn({ downloadSubfolder: 'D:\\Media\\Flow' });
eq('đường dẫn tuyệt đối bị cắt (Chrome không cho)', previewText(), 'Media/Flow/01_Con_meo_bay_tren_may.mp4');

setRn({ downloadSubfolder: '' });
setRn({ renameMode: 'custom_list', renameCustomList: 'Tên tự đặt số một' });
eq('xem trước chế độ danh sách riêng', previewText(), 'Ten_tu_dat_so_mot.mp4');
setRn({ renameMode: 'default', renameCustomList: '' });

/* ══════════════════════════════════════════════════════════════════
   2. BẢNG TIẾN TRÌNH — render từ JSON, prompt đầy đủ
   ══════════════════════════════════════════════════════════════════ */
section('SIDE PANEL: bảng tiến trình hiển thị prompt đầy đủ');

const longPrompt = 'Một prompt rất dài '.repeat(40); // ~760 ký tự
panel.eval(`
  app.tableRows = [
    { index:1, prompt:${JSON.stringify(longPrompt)}, status:'CREATING', progress:42, error:null,
      missingTiles:false, stuck:false, retries:0, downloadedCount:0, totalVideos:2,
      downloaded:false, downloadError:false, renamed:false, renameSkipped:false,
      subVideos:[{status:'CREATING',progress:42},{status:'COMPLETED',progress:100}] },
    { index:2, prompt:'ngắn', status:'ERROR', progress:0, error:'Timeout (> 5m)',
      missingTiles:false, stuck:false, retries:3, downloadedCount:0, totalVideos:0,
      downloaded:false, downloadError:true, renamed:false, renameSkipped:true, subVideos:[] },
    { index:3, prompt:'xong roi', status:'COMPLETED', progress:100, error:null,
      missingTiles:false, stuck:false, retries:0, downloadedCount:2, totalVideos:2,
      downloaded:true, downloadError:false, renamed:true, renameSkipped:false,
      subVideos:[{status:'COMPLETED',progress:100},{status:'COMPLETED',progress:100}] }
  ];
  app.tableMeta = { autoDownload:true, autoRename:true };
  renderTable(); renderOverall();
`);

const cells = [...doc.querySelectorAll('#progressBody tr')];
eq('render 3 dòng', cells.length, 3);
const firstText = cells[0].querySelector('.ptext').textContent;
eq('prompt KHÔNG bị cắt trong DOM', firstText.length, longPrompt.length);
ok('không còn hậu tố "..." như bản cũ', !firstText.endsWith('...'), firstText.slice(-10));
ok('có badge % đang tạo', /42%/.test(cells[0].textContent), cells[0].textContent.slice(0, 120));
eq('cột tải của dòng 3', cells[2].querySelector('.c-dl').textContent, '2/2');
ok('dòng lỗi có class row-err', cells[1].className.includes('row-err'));
ok('hiện chi tiết lỗi', /Timeout/.test(cells[1].textContent));
ok('hiện badge lỗi tải', /lỗi tải/.test(cells[1].textContent));
ok('tiến độ tổng = 67%', doc.getElementById('overallFill').style.width === '67%',
   doc.getElementById('overallFill').style.width);

// bộ lọc trạng thái
panel.eval("app.statusFilter='ERROR'; renderTable();");
eq('lọc theo ERROR còn 1 dòng', doc.querySelectorAll('#progressBody tr').length, 1);
panel.eval("app.statusFilter='all'; renderTable();");

/* ══════════════════════════════════════════════════════════════════
   3. CONTENT SCRIPT — tên file, search filter, trạng thái thẻ
   ══════════════════════════════════════════════════════════════════ */
section('CONTENT: đặt tên file (generateFileName)');

const flowHtml = `<!doctype html><html><body>
  <div class="ProseMirror" contenteditable="true"></div>
</body></html>`;
const page = loadPage({ html: flowHtml, scripts: ['content-v2.js'] });

// Reset các khoá liên quan đặt tên trước mỗi case để cấu hình không rò rỉ giữa các test.
const RENAME_DEFAULTS = {
  renameMode: 'default', renameStartIndex: '1', renameMaxLen: 30,
  renameIndexPad: 2, renamePrefix: '', renameSuffix: '',
  renameCustomList: '', asciiMode: 'file'
};
const gen = (settings, video, suffix, total) => {
  page.eval(`state.settings = Object.assign({}, state.settings, ${JSON.stringify(RENAME_DEFAULTS)}, ${JSON.stringify(settings)});`);
  return page.eval(`generateFileName(${JSON.stringify(video)}, ${JSON.stringify(suffix)}, ${total})`);
};

eq('mặc định: STT_nội-dung, 1 file',
   gen({ renameMode: 'default', renameStartIndex: '1', renameMaxLen: 30 },
       { promptIndex: 5, promptText: 'Con mèo bay trên mây' }, '1', 1),
   '05_Con_mèo_bay_trên_mây');

eq('nhiều file thì thêm hậu tố',
   gen({ renameMode: 'default', renameStartIndex: '1', renameMaxLen: 30 },
       { promptIndex: 5, promptText: 'Con mèo bay' }, '2', 4),
   '05_Con_mèo_bay_2');

eq('renameStartIndex dịch số thứ tự',
   gen({ renameMode: 'default', renameStartIndex: '100', renameMaxLen: 30 },
       { promptIndex: 3, promptText: 'abc' }, '1', 1),
   '102_abc');

eq('prompt tự mang tiền tố "12." thì lấy 12',
   gen({ renameMode: 'default', renameStartIndex: '1', renameMaxLen: 30 },
       { promptIndex: 1, promptText: '12. mot hai ba' }, '1', 1),
   '12_mot_hai_ba');

const long = gen({ renameMode: 'default', renameStartIndex: '1', renameMaxLen: 30 },
                 { promptIndex: 1, promptText: 'a'.repeat(300) }, '1', 1);
eq('maxLen=30 cắt đúng 30 ký tự phần prompt', long, '01_' + 'a'.repeat(30));

const unl = gen({ renameMode: 'default', renameStartIndex: '1', renameMaxLen: 0 },
                { promptIndex: 1, promptText: 'b'.repeat(300) }, '1', 1);
eq('maxLen=0 -> không giới hạn (chặn trần 150)', unl, '01_' + 'b'.repeat(150));

eq('prompt chỉ có dấu câu vẫn ra tên hợp lệ (không còn "01_")',
   gen({ renameMode: 'default', renameStartIndex: '1', renameMaxLen: 30 },
       { promptIndex: 7, promptText: '!!! ??? ...' }, '1', 1),
   '07_prompt_7');

eq('ký tự nguy hiểm cho hệ thống tệp bị thay',
   gen({ renameMode: 'default', renameStartIndex: '1', renameMaxLen: 60 },
       { promptIndex: 1, promptText: 'a/b\\c:d*e?f"g<h>i|j' }, '1', 1),
   '01_a_b_c_d_e_f_g_h_i_j');

eq('custom_list dùng đúng dòng tương ứng',
   gen({ renameMode: 'custom_list', renameCustomList: 'Alpha\nBeta\nGamma', renameMaxLen: 30 },
       { promptIndex: 2, promptText: 'bất kỳ' }, '1', 1),
   'Beta');

eq('custom_list KHÔNG bị cắt bởi renameMaxLen',
   gen({ renameMode: 'custom_list', renameCustomList: 'C'.repeat(90), renameMaxLen: 5 },
       { promptIndex: 1, promptText: 'x' }, '1', 1),
   'C'.repeat(90));

eq('custom_list thiếu dòng -> fallback về mặc định',
   gen({ renameMode: 'custom_list', renameCustomList: 'Alpha', renameMaxLen: 30 },
       { promptIndex: 3, promptText: 'du phong' }, '1', 1),
   '03_du_phong');

section('CONTENT: đặt tên theo SỐ THỨ TỰ (mới 1.6.1)');

eq('chỉ số thứ tự, pad 2',
   gen({ renameMode: 'index_only', renameStartIndex: '1', renameIndexPad: 2, renamePrefix: '', renameSuffix: '' },
       { promptIndex: 7, promptText: 'noi dung khong dung den' }, '1', 1),
   '07');

eq('pad 4',
   gen({ renameMode: 'index_only', renameStartIndex: '1', renameIndexPad: 4 },
       { promptIndex: 7, promptText: 'x' }, '1', 1),
   '0007');

eq('pad 1 (không thêm số 0)',
   gen({ renameMode: 'index_only', renameStartIndex: '1', renameIndexPad: 1 },
       { promptIndex: 7, promptText: 'x' }, '1', 1),
   '7');

eq('tiền tố',
   gen({ renameMode: 'index_only', renameStartIndex: '1', renameIndexPad: 3, renamePrefix: 'Canh', renameSuffix: '' },
       { promptIndex: 2, promptText: 'x' }, '1', 1),
   'Canh_002');

eq('tiền tố + hậu tố',
   gen({ renameMode: 'index_only', renameStartIndex: '1', renameIndexPad: 2, renamePrefix: 'EP01', renameSuffix: 'final' },
       { promptIndex: 3, promptText: 'x' }, '1', 1),
   'EP01_03_final');

eq('số bắt đầu dịch cả dãy',
   gen({ renameMode: 'index_only', renameStartIndex: '100', renameIndexPad: 3 },
       { promptIndex: 5, promptText: 'x' }, '1', 1),
   '104');

eq('nhiều media -> thêm số media ở cuối',
   gen({ renameMode: 'index_only', renameStartIndex: '1', renameIndexPad: 2, renamePrefix: 'Canh' },
       { promptIndex: 4, promptText: 'x' }, '3', 4),
   'Canh_04_3');

eq('prompt tự mang số "12." thì ưu tiên số đó (khớp với thẻ trên Flow)',
   gen({ renameMode: 'index_only', renameStartIndex: '1', renameIndexPad: 3 },
       { promptIndex: 1, promptText: '12. mot hai ba' }, '1', 1),
   '012');

eq('tiền tố có dấu được làm sạch',
   gen({ renameMode: 'index_only', renameStartIndex: '1', renameIndexPad: 2, renamePrefix: 'Cảnh quay' },
       { promptIndex: 1, promptText: 'x' }, '1', 1),
   'Cảnh_quay_01');

eq('pad quá lớn bị chặn ở 8',
   gen({ renameMode: 'index_only', renameStartIndex: '1', renameIndexPad: 50 },
       { promptIndex: 1, promptText: 'x' }, '1', 1),
   '00000001');

eq('pad không hợp lệ -> mặc định 2',
   gen({ renameMode: 'index_only', renameStartIndex: '1', renameIndexPad: 'abc' },
       { promptIndex: 3, promptText: 'x' }, '1', 1),
   '03');

section('CONTENT: chế độ "bỏ dấu cả tên trên Flow" (asciiMode)');
eq('asciiMode=file -> tên trên Flow GIỮ dấu',
   gen({ renameMode: 'default', renameStartIndex: '1', renameMaxLen: 40, asciiMode: 'file' },
       { promptIndex: 1, promptText: 'Cảnh đẹp Việt Nam' }, '1', 1),
   '01_Cảnh_đẹp_Việt_Nam');
eq('asciiMode=both -> bỏ dấu ngay từ content (khớp tên file)',
   gen({ renameMode: 'default', renameStartIndex: '1', renameMaxLen: 40, asciiMode: 'both' },
       { promptIndex: 1, promptText: 'Cảnh đẹp Việt Nam' }, '1', 1),
   '01_Canh_dep_Viet_Nam');
page.eval("state.settings.asciiMode = 'file';");

section('CONTENT: tách thẻ @Tên của Character Sync (Ảnh → Video)');
const tags = page.eval('applyCharSyncTags');

eq('giữ tên (hành vi gốc Character Sync)',
   tags('canh dem @Luffy dung tren thuyen', false),
   { text: 'canh dem Luffy dung tren thuyen', chars: ['Luffy'] });

eq('xoá hẳn mã ảnh khỏi câu lệnh (Ảnh → Video)',
   tags('camera zoom rat cham @01', true),
   { text: 'camera zoom rat cham', chars: ['01'] });

eq('xoá thẻ ở giữa câu không để lại khoảng trắng đôi',
   tags('canh @01 rat dep', true), { text: 'canh rat dep', chars: ['01'] });

eq('nhiều thẻ, bỏ trùng, giữ thứ tự',
   tags('@A gap @B roi gap lai @A', false).chars, ['A', 'B']);

eq('thẻ unicode tiếng Việt',
   tags('canh @Văn đứng đó', false), { text: 'canh Văn đứng đó', chars: ['Văn'] });

eq('không có thẻ -> chars rỗng, text nguyên vẹn',
   tags('khong co the nao', true), { text: 'khong co the nao', chars: [] });

eq('không để lại khoảng trắng trước dấu câu',
   tags('canh dep @01, sau do zoom', true), { text: 'canh dep, sau do zoom', chars: ['01'] });

eq('email trong prompt cũng bị coi là thẻ (đã biết, chỉ ảnh hưởng khi bật Character Sync)',
   tags('lien he a@gmail roi gui', false).chars, ['gmail']);

section('CONTENT: thứ tự các giai đoạn trong mainLoop');
{
  const src = require('fs').readFileSync(H.EXT + '/content-v2.js', 'utf8');
  const iImmediate = src.indexOf('GIAI ĐOẠN 1.6');
  const iPaste = src.indexOf('GIAI ĐOẠN 1: Tạo mới');
  const iRename = src.indexOf('GIAI ĐOẠN 1.5');
  ok('bước "tải ngay" nằm TRƯỚC bước dán prompt mới', iImmediate > 0 && iPaste > 0 && iImmediate < iPaste,
     `immediate=${iImmediate} paste=${iPaste}`);
  ok('bước đổi tên vẫn nằm trước bước tải', iRename > 0 && iRename < iImmediate,
     `rename=${iRename} immediate=${iImmediate}`);
  ok('không F5 giữa lúc chạy khi đang ở chế độ tải ngay',
     /!state\._hasReloadedBeforeDownload && !isImmediateDownload\(\)/.test(src));
  ok('hai khối tải/tải-lại đã được gộp thành một hàm',
     /async function tryDownloadStep/.test(src) && (src.match(/isolateTilesViaSearch/g) || []).length >= 2);
}

section('CONTENT: chế độ tải ngay sau khi tạo (isImmediateDownload)');
const imm = (patch) => {
  page.eval(`state.settings = Object.assign({}, state.settings, ${JSON.stringify(patch)});`);
  return page.eval('isImmediateDownload()');
};
eq('auto + chế độ Ảnh -> BẬT', imm({ downloadImmediately: 'auto', runMode: 'image', autoDownload: true, downloadZip: false }), true);
eq('auto + chế độ Video -> TẮT', imm({ downloadImmediately: 'auto', runMode: 'video', autoDownload: true, downloadZip: false }), false);
eq('bật thủ công cho Video', imm({ downloadImmediately: true, runMode: 'video', autoDownload: true, downloadZip: false }), true);
eq('tắt thủ công cho Ảnh', imm({ downloadImmediately: false, runMode: 'image', autoDownload: true, downloadZip: false }), false);
eq('tải ZIP thì không thể tải ngay', imm({ downloadImmediately: true, downloadZip: true, autoDownload: true }), false);
eq('không tự tải thì không tải ngay', imm({ downloadImmediately: true, autoDownload: false, downloadZip: false }), false);

section('CONTENT: chuỗi lọc tìm kiếm Flow');
page.eval(`state.settings.addIndex = true; state.settings.renameMode='default'; state.settings.renameStartIndex='1';`);
const f1 = page.eval(`buildSearchFilterText({promptIndex:2, promptText:'con mèo'})`);
eq('có STT khi addIndex', f1, '2. con mèo');
const f2 = page.eval(`buildSearchFilterText({promptIndex:1, promptText:${JSON.stringify('z'.repeat(500))}})`);
ok('prompt 500 ký tự bị rút gọn cho ô search', f2.length <= 84, `len=${f2.length}`);
page.eval(`state.settings.addIndex = false;`);
const f3 = page.eval(`buildSearchFilterText({promptIndex:9, promptText:'  nhiều   khoảng   trắng  '})`);
eq('chuẩn hoá khoảng trắng, bỏ STT', f3, 'nhiều khoảng trắng');
page.eval(`state.settings.addIndex = true;`);

/* ══════════════════════════════════════════════════════════════════
   4. CONTENT — getCardStatus với DOM Flow mô phỏng
   ══════════════════════════════════════════════════════════════════ */
section('CONTENT: nhận diện trạng thái thẻ (getCardStatus)');

// jsdom không có layout engine: mọi getBoundingClientRect trả 0x0 và
// offsetParent = null, nên phần tử hiển thị bình thường vẫn bị coi là "ẩn".
// Giả lập kích thước để mô phỏng một trang đã render thật.
function layout(root, w = 180, h = 24) {
  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    el.getBoundingClientRect = () => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0 });
    Object.defineProperty(el, 'offsetWidth', { get: () => w, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { get: () => h, configurable: true });
  }
}

function cardStatus(innerHTML, tag = 'flow-tile-container') {
  const holder = page.document.createElement('div');
  holder.innerHTML = `<${tag} data-tile-id="t1">${innerHTML}</${tag}>`;
  page.document.body.appendChild(holder);
  const card = holder.firstElementChild;
  layout(card);
  const res = page.eval('getCardStatus')(card);
  holder.remove();
  return res;
}

// BUG CŨ: thẻ pending chỉ có nút ⋮ bị tính là COMPLETED
const pendingWithMenu = cardStatus(
  `<flow-pending-tile><span class="loading-percentage">37%</span></flow-pending-tile>
   <button aria-haspopup="menu"><i class="google-symbols">more_vert</i></button>`
);
eq('thẻ ĐANG TẠO có nút ⋮ -> CREATING (không còn báo xong sớm)', pendingWithMenu.status, 'CREATING');
eq('  và đọc đúng % tiến độ', Math.round(pendingWithMenu.progress), 37);

const videoDone = cardStatus(
  `<a href="/edit/workflow/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"><video src="https://x.googleusercontent.com/v.mp4"></video></a>
   <button aria-haspopup="menu"><i>more_vert</i></button>`
);
eq('video có src -> COMPLETED', videoDone.status, 'COMPLETED');
eq('  đếm 1 media', videoDone.videos.length, 1);
ok('  mỗi sub-video là object riêng (không dùng chung tham chiếu)',
   videoDone.videos.length === 1 || videoDone.videos[0] !== videoDone.videos[1]);

const twoDone = cardStatus(
  `<video src="a.mp4"></video><video src="b.mp4"></video>`
);
eq('2 video -> COMPLETED x2', [twoDone.status, twoDone.videos.length], ['COMPLETED', 2]);
ok('2 sub-video là 2 object khác nhau', twoDone.videos[0] !== twoDone.videos[1]);

const errTile = cardStatus(`<flow-error-tile><mat-icon class="error-icon">warning</mat-icon></flow-error-tile>`);
eq('flow-error-tile -> ERROR', errTile.status, 'ERROR');
ok('  có cờ isFailed để loại khỏi danh sách tải', errTile.isFailed === true);

const imgDone = cardStatus(
  `<a href="/edit/media/1"><img src="https://lh3.googleusercontent.com/abc"></a>`
);
eq('ảnh đã tạo -> COMPLETED', imgDone.status, 'COMPLETED');

const queued = cardStatus(`<div><span>Đang chuẩn bị</span></div>`);
eq('trạng thái hàng đợi -> QUEUED', queued.status, 'QUEUED');

const upsc = cardStatus(`<div><span>Upscaling 88%</span></div>`);
eq('upscale -> UPSCALING', upsc.status, 'UPSCALING');

const mixed = cardStatus(
  `<video src="a.mp4"></video><flow-pending-tile><span>12%</span></flow-pending-tile>`
);
eq('1 xong + 1 đang chạy -> vẫn CREATING', mixed.status, 'CREATING');

/* ══════════════════════════════════════════════════════════════════
   5. CONTENT — menu đang mở (getOpenMenuItems / closeAnyOpenMenu)
   ══════════════════════════════════════════════════════════════════ */
section('CONTENT: chỉ lấy mục của menu ĐANG MỞ');

page.document.body.innerHTML = `
  <div class="mat-mdc-menu-panel" id="openPanel">
    <button role="menuitem" id="dl"><i class="google-symbols">download</i>Tải xuống</button>
    <button role="menuitem" id="rn">Đổi tên</button>
  </div>
  <div class="mat-mdc-menu-panel" id="closedPanel" style="display:none">
    <button role="menuitem" id="ghost">Tải xuống (menu cũ)</button>
  </div>
`;
// jsdom trả 0 cho getBoundingClientRect -> giả lập kích thước thật
const stubRect = (el, w, h) => { el.getBoundingClientRect = () => ({ width: w, height: h, top: 10, left: 10, right: 10 + w, bottom: 10 + h }); };
['openPanel', 'dl', 'rn'].forEach(id => stubRect(page.document.getElementById(id), 200, 30));
['closedPanel', 'ghost'].forEach(id => stubRect(page.document.getElementById(id), 0, 0));

const items = page.eval('getOpenMenuItems')();
eq('chỉ thấy 2 mục của menu đang mở', items.map(e => e.id), ['dl', 'rn']);
ok('KHÔNG lấy mục của menu đã đóng', !items.some(e => e.id === 'ghost'));

let escCount = 0;
page.document.addEventListener('keydown', (e) => { if (e.key === 'Escape') escCount++; });
page.eval('closeAnyOpenMenu')();
ok('closeAnyOpenMenu bắn phím Escape', escCount > 0, `escCount=${escCount}`);

section('CONTENT: tìm mục Đổi tên trong menu đang mở');
const renameItem = page.eval('findRenameMenuItem')();
eq('tìm đúng mục "Đổi tên"', renameItem && renameItem.id, 'rn');

/* ══════════════════════════════════════════════════════════════════
   6. CONTENT — isTabActive KHÔNG ĐƯỢC TREO (bug nặng của 1.5.6)
   ══════════════════════════════════════════════════════════════════ */
section('CONTENT: isTabActive không treo khi background không trả lời');

(async () => {
  // Listener của side panel gắn trong DOMContentLoaded (async) -> chờ 1 nhịp.
  await new Promise(r => setTimeout(r, 50));

  /* endIndex = 1 phải đặt được (bug cũ) */
  section('SIDE PANEL: lỗi "Đến dòng = 1" của bản 1.5.6');
  doc.getElementById('promptsInput').value = 'p1\np2\np3\np4\np5';
  panel.eval('refreshPromptStats()');
  eq('mặc định tự chọn hết 5 prompt', doc.getElementById('endIndex').value, '5');

  // người dùng tự nhập 1 (dispatch 'input' như thao tác thật)
  const endEl = doc.getElementById('endIndex');
  endEl.value = '1';
  endEl.dispatchEvent(new panel.Event('input', { bubbles: true }));
  panel.eval('refreshPromptStats()');
  eq('endIndex giữ nguyên = 1 sau khi người dùng tự nhập', endEl.value, '1');
  eq('chọn đúng 1 prompt', panel.eval('selectedJobs()').map(j => j.index), [1]);

  // thêm prompt mới không được ghi đè lựa chọn của người dùng
  doc.getElementById('promptsInput').value = 'p1\np2\np3\np4\np5\np6';
  panel.eval('refreshPromptStats()');
  eq('thêm prompt vẫn giữ endIndex = 1', endEl.value, '1');
  doc.getElementById('promptsInput').value = 'p1\np2\np3\np4\np5';
  panel.eval('refreshPromptStats()');

  doc.getElementById('startIndex').value = '2';
  doc.getElementById('endIndex').value = '4';
  eq('range 2..4', panel.eval('selectedJobs()').map(j => j.index), [2, 3, 4]);

  doc.getElementById('useCustomRange').checked = true;
  doc.getElementById('customIndices').value = '1, 5, 3-4';
  eq('custom indices + dải', panel.eval('selectedJobs()').map(j => j.index), [1, 3, 4, 5]);
  doc.getElementById('useCustomRange').checked = false;

  // Giả lập background "im lặng" như bản cũ: sendMessage trả Promise không bao giờ resolve
  page.chrome.runtime.sendMessage = () => new Promise(() => {});
  Object.defineProperty(page.document, 'visibilityState', { get: () => 'hidden', configurable: true });

  const t0 = Date.now();
  const res = await Promise.race([
    page.eval('isTabActive')(),
    new Promise(r => setTimeout(() => r('__TIMEOUT__'), 6000))
  ]);
  const dt = Date.now() - t0;
  ok('có kết quả trong vòng ~2s dù background im lặng', res !== '__TIMEOUT__' && dt < 5000, `res=${res} dt=${dt}ms`);
  eq('  mặc định coi như active để không chặn automation', res, true);

  Object.defineProperty(page.document, 'visibilityState', { get: () => 'visible', configurable: true });
  const res2 = await page.eval('isTabActive')();
  eq('tab đang hiển thị -> true ngay, không cần hỏi background', res2, true);

  /* ══════════════════════════════════════════════════════════════
     7. BACKGROUND — tên file tải về
     ══════════════════════════════════════════════════════════════ */
  section('BACKGROUND: ép tên file tải về');

  const bg = loadPage({
    html: '<!doctype html><html><body></body></html>',
    url: 'chrome-extension://testextension/_generated_background_page.html',
    scripts: ['background.js']
  });

  const splitExtension = bg.eval('splitExtension');
  const sanitizeForDisk = bg.eval('sanitizeForDisk');

  eq('tách .mp4', splitExtension('video_abc.mp4'), { stem: 'video_abc', ext: 'mp4' });
  eq('tách theo dấu chấm CUỐI', splitExtension('a.b.c.png'), { stem: 'a.b.c', ext: 'png' });
  // BUG CŨ: filename không có dấu chấm -> ext = toàn bộ tên -> "ten.tenfilegoc"
  eq('không có phần mở rộng -> ext rỗng', splitExtension('noextension'), { stem: 'noextension', ext: '' });
  eq('file ẩn .gitignore không bị coi là ext', splitExtension('.gitignore'), { stem: '.gitignore', ext: '' });
  eq('bỏ đường dẫn', splitExtension('C:\\Users\\a\\b.mp4'), { stem: 'b', ext: 'mp4' });

  eq('sanitize ký tự cấm', sanitizeForDisk('a<b>c:d"e|h?i*j'), 'a_b_c_d_e_h_i_j');
  eq('sanitize bỏ dấu chấm đầu', sanitizeForDisk('...hidden'), 'hidden');
  eq('sanitize tên rỗng -> mặc định', sanitizeForDisk('   '), 'flow_media');
  ok('sanitize giới hạn 150 ký tự cho tên file', sanitizeForDisk('z'.repeat(400)).length === 150);

  // ─── ASCII hoá: Chrome ÂM THẦM BỎ tên có ký tự ngoài ASCII (đã kiểm chứng
  //     trên Chromium thật) nên tên phải được chuyển tự trước khi suggest() ───
  const isAscii = (s) => /^[\x20-\x7E]*$/.test(s);
  eq('bỏ dấu tiếng Việt', sanitizeForDisk('01_Con_mèo_bay_trên_mây'), '01_Con_meo_bay_tren_may');
  eq('bỏ dấu đủ bộ nguyên âm', sanitizeForDisk('aàáạảãâầấậẩẫăằắặẳẵ'), 'aaaaaaaaaaaaaaaaaa');
  eq('ký tự đ/Đ', sanitizeForDisk('Đường_đi_đẹp'), 'Duong_di_dep');
  eq('giữ nguyên chữ hoa khi bỏ dấu', sanitizeForDisk('CẢNH_Ở_ĐÂY'), 'CANH_O_DAY');
  ok('kết quả luôn là ASCII thuần (tiếng Việt)', isAscii(sanitizeForDisk('Một cảnh phim rất đẹp ở Việt Nam')));
  ok('kết quả luôn là ASCII thuần (emoji)', isAscii(sanitizeForDisk('video_🎬_01')));
  ok('kết quả luôn là ASCII thuần (CJK)', isAscii(sanitizeForDisk('中文名字_01')));
  ok('kết quả luôn là ASCII thuần (dấu Latin khác)', isAscii(sanitizeForDisk('café_naïve_über')));
  eq('bỏ dấu Latin khác qua NFD', sanitizeForDisk('café_naive'), 'cafe_naive');

  // ─── Thư mục con: bản 1.6.0 thay '/' thành '_' nên không tạo được folder ───
  eq('giữ thư mục con', sanitizeForDisk('FlowVideos/Duan01/video_01'), 'FlowVideos/Duan01/video_01');
  eq('thư mục con có dấu -> bỏ dấu từng đoạn', sanitizeForDisk('Flow/Dự án 01/video'), 'Flow/Du an 01/video');
  eq('backslash cũng là dấu phân cách', sanitizeForDisk('Flow\\Sub\\video'), 'Flow/Sub/video');
  eq('chặn .. thoát khỏi thư mục Downloads', sanitizeForDisk('../../escape'), 'escape');
  eq('chặn .. ở giữa đường dẫn', sanitizeForDisk('Flow/../video'), 'Flow/video');
  eq('bỏ đoạn rỗng do // liên tiếp', sanitizeForDisk('A///B//c'), 'A/B/c');
  ok('giới hạn độ sâu 5 cấp', sanitizeForDisk('a/b/c/d/e/f/g/h').split('/').length <= 5,
     sanitizeForDisk('a/b/c/d/e/f/g/h'));
  eq('Chrome từ chối đoạn có khoảng trắng đầu -> phải trim',
     sanitizeForDisk(' leading/ mid /trailing '), 'leading/mid/trailing');
  eq('tên cấm của Windows được đổi', sanitizeForDisk('CON'), '_CON');
  eq('tên cấm COM1 được đổi', sanitizeForDisk('com1'), '_com1');
  eq('không đổi tên chỉ GIỐNG tên cấm', sanitizeForDisk('console'), 'console');

  // ─── Thư mục lưu do người dùng chọn ───
  const sanitizeSubfolder = bg.eval('sanitizeSubfolder');
  eq('thư mục con thường', sanitizeSubfolder('FlowVideos', {}), 'FlowVideos');
  eq('cắt bỏ đường dẫn tuyệt đối Windows', sanitizeSubfolder('D:\\Media\\Flow', {}), 'Media/Flow');
  eq('cắt bỏ đường dẫn tuyệt đối POSIX', sanitizeSubfolder('/home/me/Flow', {}), 'home/me/Flow');
  eq('rỗng -> không dùng thư mục con', sanitizeSubfolder('', {}), '');
  eq('biến {project}', sanitizeSubfolder('Flow/{project}', { activeProjectName: 'Du an 7' }), 'Flow/Du an 7');
  ok('biến {date} ra ngày hôm nay',
     new RegExp('^Flow/\\d{4}-\\d{2}-\\d{2}$').test(sanitizeSubfolder('Flow/{date}', {})),
     sanitizeSubfolder('Flow/{date}', {}));

  // chạy thật listener onDeterminingFilename
  const determining = bg.chrome._determining;
  ok('đã đăng ký onDeterminingFilename', typeof determining === 'function');

  const suggestOnce = (item) => new Promise((resolve) => {
    determining(item, (res) => resolve(res));
  });

  // Nạp tên vào hàng đợi qua đúng message router
  const router = bg.chrome._listeners[0];
  const call = (msg) => new Promise((resolve) => { router(msg, {}, resolve); });

  await call({ action: 'CLEAR_FILENAME_QUEUE' });
  await call({ action: 'SET_NEXT_FILENAME', filename: '01_con_meo' });
  let r = await suggestOnce({ filename: 'download_1234.mp4' });
  eq('ép tên + giữ .mp4', r.filename, '01_con_meo.mp4');
  eq('  dùng conflictAction uniquify', r.conflictAction, 'uniquify');

  // hàng đợi rỗng -> giữ tên gốc
  r = await suggestOnce({ filename: 'other_file.mp4' });
  eq('hàng đợi rỗng -> không đổi tên', r.filename, 'other_file.mp4');

  // UNSET: mô phỏng thẻ bị bỏ qua
  await call({ action: 'SET_NEXT_FILENAME', filename: 'A' });
  await call({ action: 'SET_NEXT_FILENAME', filename: 'B_bi_skip' });
  await call({ action: 'SET_NEXT_FILENAME', filename: 'C' });
  await call({ action: 'UNSET_NEXT_FILENAME', filename: 'B_bi_skip' });
  const n1 = await suggestOnce({ filename: 'x.mp4' });
  const n2 = await suggestOnce({ filename: 'y.mp4' });
  eq('sau khi rút tên bị skip, file tiếp theo KHÔNG bị lệch tên',
     [n1.filename, n2.filename], ['A.mp4', 'C.mp4']);

  // __SKIP_RENAME__
  await call({ action: 'SET_NEXT_FILENAME', filename: '__SKIP_RENAME__' });
  r = await suggestOnce({ filename: 'keep_me.mp4' });
  eq('cờ __SKIP_RENAME__ giữ nguyên tên gốc', r.filename, 'keep_me.mp4');

  // tên có ký tự cấm
  await call({ action: 'SET_NEXT_FILENAME', filename: 'bad<name>:here' });
  r = await suggestOnce({ filename: 'z.png' });
  eq('tên có ký tự cấm được làm sạch', r.filename, 'bad_name_here.png');

  await call({ action: 'SET_NEXT_FILENAME', filename: '07_Cảnh_đẹp_Việt_Nam' });
  r = await suggestOnce({ filename: 'z.mp4' });
  eq('tên tiếng Việt được bỏ dấu để Chrome KHÔNG bỏ qua', r.filename, '07_Canh_dep_Viet_Nam.mp4');

  await call({ action: 'SET_NEXT_FILENAME', filename: 'Sub/Folder/08_video' });
  r = await suggestOnce({ filename: 'z.mp4' });
  eq('đường dẫn thư mục con đi qua nguyên vẹn', r.filename, 'Sub/Folder/08_video.mp4');

  // file không có ext
  await call({ action: 'SET_NEXT_FILENAME', filename: 'no_ext_case' });
  r = await suggestOnce({ filename: 'sourcewithoutext' });
  eq('nguồn không có ext -> không sinh ra ".sourcewithoutext"', r.filename, 'no_ext_case');

  // hàng đợi bền qua "restart" service worker (storage.session)
  section('BACKGROUND: hàng đợi tên file sống sót khi service worker bị kill');
  await call({ action: 'CLEAR_FILENAME_QUEUE' });
  await call({ action: 'SET_NEXT_FILENAME', filename: 'survivor_01' });
  const persisted = await bg.chrome.storage.session.get('veoPendingFilenames');
  // 1.7.0: mỗi mục mang theo tabId để dọn được hàng đợi của riêng một tab.
  eq('hàng đợi đã ghi vào storage.session (kèm tabId)',
     persisted.veoPendingFilenames, [{ tabId: null, filename: 'survivor_01' }]);

  /* ══════════════════════════════════════════════════════════════
     7b. BACKGROUND — phép thử "Hỏi vị trí lưu mỗi tệp"
     Mỗi nhánh được kiểm tra bằng cách giả lập đúng trạng thái mà Chrome
     trả về (số liệu lấy từ đo thật trên Chromium, xem tests/probe-chrome.js).
     ══════════════════════════════════════════════════════════════ */
  section('BACKGROUND: phát hiện setting "Hỏi vị trí lưu mỗi tệp"');

  const probeFn = bg.eval('probeSaveAsPrompt');

  /** Giả lập chrome.downloads với một hàm trả trạng thái theo thời gian đã trôi. */
  function stubDownloads(stateAt, { failDownload = false } = {}) {
    const t0 = Date.now();
    const calls = { cancel: 0, erase: 0, removeFile: 0 };
    bg.chrome.downloads.download = (opts, cb) => {
      if (failDownload) { bg.chrome.runtime.lastError = { message: 'chặn bởi chính sách' }; cb(undefined); bg.chrome.runtime.lastError = null; return; }
      cb(101);
    };
    bg.chrome.downloads.search = (q, cb) => {
      if (q && Array.isArray(q.query)) return cb([]);       // truy vấn dọn dẹp
      cb([stateAt(Date.now() - t0)]);
    };
    bg.chrome.downloads.cancel = (id, cb) => { calls.cancel++; cb && cb(); };
    bg.chrome.downloads.erase = (q, cb) => { calls.erase++; cb && cb([101]); };
    bg.chrome.downloads.removeFile = (id, cb) => { calls.removeFile++; cb && cb(); };
    return calls;
  }

  // (1) Bình thường: hoàn tất ngay, có tên -> TẮT
  stubDownloads(() => ({ state: 'complete', filename: '/home/u/Downloads/x.txt', error: null, bytesReceived: 5 }));
  let pr = await probeFn();
  eq('hoàn tất ngay + có tên file -> kết luận TẮT', pr.status, 'off');

  // (2) Hộp thoại đang mở: in_progress, tên RỖNG, không lỗi, kéo dài -> BẬT
  let t1 = Date.now();
  stubDownloads(() => ({ state: 'in_progress', filename: '', error: null, bytesReceived: 0 }));
  pr = await probeFn();
  const dur = Date.now() - t1;
  eq('treo ở in_progress + tên rỗng -> kết luận BẬT', pr.status, 'on');
  ok('kết luận trong ~1.5s, không bắt chờ lâu', dur >= 1300 && dur < 3200, dur + 'ms');

  // (3) Download bị chặn: USER_CANCELED NGAY LẬP TỨC -> KHÔNG kết luận
  //     (bản đầu tiên của tôi báo nhầm thành BẬT — đã bị test trên Chromium thật bắt)
  stubDownloads(() => ({ state: 'interrupted', filename: '', error: 'USER_CANCELED', bytesReceived: 0 }));
  pr = await probeFn();
  eq('bị ngắt tức thì -> KHÔNG kết luận (tránh báo động sai)', pr.status, 'unknown');
  ok('có nêu lý do cho người dùng', typeof pr.reason === 'string' && pr.reason.length > 10, pr.reason);

  // (4) Người dùng THẬT bấm Cancel sau 800ms -> BẬT
  stubDownloads((ms) => ms < 800
    ? { state: 'in_progress', filename: '', error: null, bytesReceived: 0 }
    : { state: 'interrupted', filename: '', error: 'USER_CANCELED', bytesReceived: 0 });
  pr = await probeFn();
  eq('người dùng đóng hộp thoại sau 800ms -> kết luận BẬT', pr.status, 'on');
  ok('kèm ghi chú giải thích', typeof pr.note === 'string' && /ms/.test(pr.note), pr.note);

  // (5) Lỗi khác (FILE_ACCESS_DENIED) -> KHÔNG kết luận
  stubDownloads(() => ({ state: 'interrupted', filename: '', error: 'FILE_ACCESS_DENIED', bytesReceived: 0 }));
  pr = await probeFn();
  eq('lỗi truy cập tệp -> KHÔNG kết luận', pr.status, 'unknown');
  ok('nêu đúng mã lỗi', /FILE_ACCESS_DENIED/.test(pr.reason || ''), pr.reason);

  // (6) Không tạo được phép thử -> KHÔNG kết luận
  stubDownloads(() => ({ state: 'complete', filename: 'x', error: null }), { failDownload: true });
  pr = await probeFn();
  eq('không tạo được download -> KHÔNG kết luận', pr.status, 'unknown');

  // (7) Dọn dẹp sau phép thử
  const cleanupCalls = stubDownloads(() => ({ state: 'complete', filename: '/x/flow_automation_check.txt', error: null, bytesReceived: 5 }));
  await probeFn();
  ok('xoá tệp thử khỏi ổ đĩa', cleanupCalls.removeFile >= 1, JSON.stringify(cleanupCalls));
  ok('xoá khỏi lịch sử tải xuống', cleanupCalls.erase >= 1, JSON.stringify(cleanupCalls));

  // (8) Phép thử KHÔNG được ăn tên trong hàng đợi
  await call({ action: 'CLEAR_FILENAME_QUEUE' });
  await call({ action: 'SET_NEXT_FILENAME', filename: '01_video_that' });
  bg.eval('probeUrlInFlight = "data:text/plain;charset=utf-8,flow-automation-check-abc"');
  let rr = await suggestOnce({ filename: 'probe.txt', url: 'data:text/plain;charset=utf-8,flow-automation-check-abc' });
  eq('tệp của phép thử giữ nguyên tên, KHÔNG lấy tên trong hàng đợi', rr.filename, 'probe.txt');
  bg.eval('probeUrlInFlight = null');
  rr = await suggestOnce({ filename: 'real.mp4' });
  eq('video thật sau đó vẫn nhận đúng tên đã xếp', rr.filename, '01_video_that.mp4');

  /* ══════════════════════════════════════════════════════════════
     8. BACKGROUND — router phải TRẢ LỜI CHECK_TAB_ACTIVE
     ══════════════════════════════════════════════════════════════ */
  section('BACKGROUND: handler CHECK_TAB_ACTIVE (bản 1.5.6 thiếu hoàn toàn)');
  let answered = false;
  const keepOpen = router({ action: 'CHECK_TAB_ACTIVE' }, { tab: { id: 7 } }, () => { answered = true; });
  ok('router giữ kênh mở (return true) để trả lời async', keepOpen === true);
  await new Promise(r => setTimeout(r, 50));
  ok('đã gọi sendResponse -> content script không bị treo', answered);

  ok('message không xác định KHÔNG giữ kênh mở (tránh rò rỉ)',
     router({ action: 'UPDATE_STATS' }, {}, () => {}) === false);

  /* ══════════════════════════════════════════════════════════════
     9. Regression: không còn dùng document.body.style.zoom
     ══════════════════════════════════════════════════════════════ */
  section('Regression: zoom không bị nhân đôi');
  const fs = require('fs');
  const contentSrc = fs.readFileSync(H.EXT + '/content-v2.js', 'utf8');
  const zoomAssigns = contentSrc.match(/document\.body\.style\.zoom\s*=\s*[^;]+/g) || [];
  ok('chỉ còn reset zoom về rỗng/1, không đặt 0.8 nữa',
     zoomAssigns.every(z => /=\s*''|=\s*'1'/.test(z)), JSON.stringify(zoomAssigns));

  page.eval('state.settings.zoomLevel = "0.8";');
  page.chrome._sent.length = 0;
  page.chrome.runtime.sendMessage = (m) => { page.chrome._sent.push(m); return Promise.resolve(); };
  page.eval('applyPageZoom()');
  const zoomMsg = page.chrome._sent.find(m => m.action === 'SET_TAB_ZOOM');
  eq('applyPageZoom gửi SET_TAB_ZOOM cho background', zoomMsg && zoomMsg.zoom, 0.8);

  section('Regression: code chết đã bị loại bỏ');
  ok('không còn hàm checkWatchdog', !/function\s+checkWatchdog/.test(contentSrc));
  ok('không còn nhánh state.userPlan === "FREE"', !/state\.userPlan\s*===\s*'FREE'/.test(contentSrc));
  ok('downloadQueue/activeDownloads đã được khai báo',
     /let\s+downloadQueue\s*=/.test(contentSrc) && /let\s+activeDownloads\s*=/.test(contentSrc));
  const bgSrc = fs.readFileSync(H.EXT + '/background.js', 'utf8');
  ok('shutdownSuccess được khai báo trong TRIGGER_SHUTDOWN',
     /let shutdownSuccess = false;/.test(bgSrc));
  ok('background có handler CHECK_TAB_ACTIVE', /CHECK_TAB_ACTIVE/.test(bgSrc));
  ok('content gọi CLEAR_FILENAME_QUEUE khi bắt đầu', /CLEAR_FILENAME_QUEUE/.test(contentSrc));
  ok('content có UNSET_NEXT_FILENAME khi skip/timeout',
     (contentSrc.match(/UNSET_NEXT_FILENAME/g) || []).length >= 2);

  /* ══════════════════════════════════════════════════════════════
     KẾT QUẢ
     ══════════════════════════════════════════════════════════════ */
  const rep = H.report();
  console.log(`\n════════════════════════════════════════`);
  console.log(`  PASS: ${rep.PASS}   FAIL: ${rep.FAIL}`);
  if (rep.FAIL) console.log('  Fail:\n   - ' + rep.fails.join('\n   - '));
  console.log(`════════════════════════════════════════`);
  process.exit(rep.FAIL ? 1 : 0);
})();
