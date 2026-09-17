/* Render sidepanel.html trong Chromium thật để kiểm tra CSS (color-mix, :has…)
   và xuất ảnh xem trước giao diện. */
const { chromium } = require('playwright');
const fs = require('fs');
const EXT = '/home/claude/ext/flow-automation-local-1.8.0';
const OUT = '/home/claude/shots';

const CHROME_STUB = `
window.chrome = {
  runtime: {
    id: 'x', lastError: null,
    onMessage: { addListener(){}, removeListener(){} },
    sendMessage: (msg) => {
      // 1.7.0: panel hỏi background danh sách tab Flow để vẽ khối "Chạy nhiều tab".
      if (msg && msg.action === 'LIST_FLOW_TABS') {
        return Promise.resolve({ ok: true, tabs: [
          { tabId: 11, windowId: 1, active: true,  title: 'Flow — Bible Ghibli', url: 'https://labs.google/fx/tools/flow',
            ready: true, slot: 1, projectName: 'Project_2026-09-16_T1', running: true,
            total: 24, done: 9, creating: 2, error: 0, hidden: false, throttled: false, holdsDownloadLock: true },
          { tabId: 22, windowId: 2, active: false, title: 'Flow — Tập 12', url: 'https://labs.google/fx/tools/flow',
            ready: true, slot: 2, projectName: 'Project_2026-09-16_T2', running: true,
            total: 24, done: 6, creating: 2, error: 1, hidden: true, throttled: true, holdsDownloadLock: false },
          { tabId: 33, windowId: 3, active: false, title: 'Flow (chưa nạp script)', url: 'https://flow.google.com/x',
            ready: false, slot: null, projectName: '', running: false,
            total: 0, done: 0, creating: 0, error: 0, hidden: false, throttled: false, holdsDownloadLock: false }
        ] });
      }
      return Promise.resolve({ success: true });
    }
  },
  storage: { local: {
    get: (k) => Promise.resolve({}),
    set: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    getBytesInUse: () => Promise.resolve(1234567)
  } },
  tabs: {
    query: () => Promise.resolve([]),
    sendMessage: () => Promise.resolve(),
    create(){}, onActivated: { addListener(){} }, onUpdated: { addListener(){} }
  }
};
`;

const SEED = `
document.getElementById('promptsInput').value = [
  'Một con mèo tam thể đội mũ phi hành gia đang trôi giữa dải Ngân Hà, ánh sáng xanh tím phản chiếu trên mũ kính, chuyển động chậm, ống kính 35mm',
  'Cận cảnh hạt mưa đọng trên lá sen lúc sớm mai, nắng xuyên qua tạo cầu vồng nhỏ',
  'Thành phố Hà Nội năm 2150 nhìn từ trên cao, xe bay, đèn neon, trời mưa',
  'Người thợ rèn già gõ búa trong xưởng tối, tia lửa bay',
  'Cánh đồng lúa chín bát ngát, máy bay không người lái bay ngang'
].join('\\n');
refreshPromptStats();
document.getElementById('statCreating').textContent = '2';
document.getElementById('statCompleted').textContent = '3';
document.getElementById('statError').textContent = '1';
app.tableMeta = { autoDownload: true, autoRename: true };
app.tableRows = [
  { index:1, prompt:'Một con mèo tam thể đội mũ phi hành gia đang trôi giữa dải Ngân Hà, ánh sáng xanh tím phản chiếu trên mũ kính, chuyển động chậm, ống kính 35mm',
    status:'COMPLETED', progress:100, error:null, missingTiles:false, stuck:false, retries:0,
    downloadedCount:2, totalVideos:2, downloaded:true, downloadError:false, renamed:true, renameSkipped:false,
    subVideos:[{status:'COMPLETED',progress:100},{status:'COMPLETED',progress:100}] },
  { index:2, prompt:'Cận cảnh hạt mưa đọng trên lá sen lúc sớm mai, nắng xuyên qua tạo cầu vồng nhỏ',
    status:'CREATING', progress:64, error:null, missingTiles:false, stuck:false, retries:1,
    downloadedCount:0, totalVideos:2, downloaded:false, downloadError:false, renamed:false, renameSkipped:false,
    subVideos:[{status:'CREATING',progress:64},{status:'COMPLETED',progress:100}] },
  { index:3, prompt:'Thành phố Hà Nội năm 2150 nhìn từ trên cao, xe bay, đèn neon, trời mưa',
    status:'CREATING', progress:0, error:null, missingTiles:true, stuck:false, retries:0,
    downloadedCount:0, totalVideos:0, downloaded:false, downloadError:false, renamed:false, renameSkipped:false,
    subVideos:[] },
  { index:4, prompt:'Người thợ rèn già gõ búa trong xưởng tối, tia lửa bay',
    status:'ERROR', progress:0, error:'Timeout: quá 5 phút chưa hoàn thành. Sẽ thử lại tự động.',
    missingTiles:false, stuck:true, retries:3, downloadedCount:0, totalVideos:0,
    downloaded:false, downloadError:true, renamed:false, renameSkipped:true, subVideos:[] },
  { index:5, prompt:'Cánh đồng lúa chín bát ngát, máy bay không người lái bay ngang',
    status:'WAITING', progress:0, error:null, missingTiles:false, stuck:false, retries:0,
    downloadedCount:0, totalVideos:0, downloaded:false, downloadError:false, renamed:false, renameSkipped:false,
    subVideos:[] }
];
renderTable(); renderOverall();
document.getElementById('i2vPrompt').value = 'camera zoom vào rất chậm, giữ nguyên nhân vật và bối cảnh, ánh sáng điện ảnh';
document.getElementById('i2vFrom').value = '1';
document.getElementById('i2vTo').value = '48';
document.getElementById('i2vPad').value = '2';
document.getElementById('renameMode').value = 'index_only';
document.getElementById('renamePrefix').value = 'Canh';
document.getElementById('renameIndexPad').value = '3';
document.getElementById('downloadSubfolder').value = 'FlowVideos/{date}';
document.getElementById('downloadImmediately').value = 'auto';
// Đa tab (1.7.0)
document.getElementById('multiTab').checked = true;
document.getElementById('multiTabMode').value = 'split';
document.getElementById('multiTabStagger').value = '15';
app.settings.multiTab = true;
app.settings.multiTabMode = 'split';
updateConditionalUI();
// Chẩn đoán giao diện (1.8.0)
app.diag = {
  at: Date.now(), version: '1.8.0', url: 'https://labs.google/fx/vi/tools/flow/project/abc',
  title: 'Flow', tileCount: 12,
  rows: [
    { key:'promptEditor', label:'Ô nhập prompt', hint:'Ô gõ prompt ở dưới cùng trang Flow.',
      critical:true, ok:true, skipped:false, count:1, via:'builtin', override:null,
      element:{tag:'div',id:'',cls:'ProseMirror',aria:'',text:'',selector:'div.ProseMirror'}, candidates:[] },
    { key:'createBtn', label:'Nút Tạo (mũi tên gửi)', hint:'Nút bấm để bắt đầu tạo video/ảnh, cạnh ô nhập prompt.',
      critical:true, ok:false, skipped:false, count:0, via:null, override:null, element:null,
      candidates:[
        {tag:'button', id:'', cls:'x1f6kntn9 send', role:'', aria:'Tạo video', text:'arrow_forward',
         selector:'button[aria-label="Tạo video"]', html:'<button class="x1f6kntn9 send" aria-label="Tạo video">…'},
        {tag:'button', id:'', cls:'add-media', role:'', aria:'Thêm nội dung', text:'add_2',
         selector:'button[aria-label="Thêm nội dung"]', html:'<button class="add-media" aria-label="Thêm nội dung">…'}
      ] },
    { key:'searchBox', label:'Ô tìm kiếm', hint:'Ô tìm kiếm trên thanh công cụ, dùng để lọc thẻ trước khi tải.',
      critical:false, ok:true, skipped:false, count:1, via:'override', override:'input[placeholder="Tìm kiếm"]',
      element:{tag:'input',id:'',cls:'',aria:'',text:'',selector:'input[placeholder="Tìm kiếm"]'}, candidates:[] },
    { key:'tile', label:'Thẻ video / ảnh', hint:'Khung chứa mỗi video hoặc ảnh đã tạo trong lưới kết quả.',
      critical:true, ok:true, skipped:false, count:12, via:'builtin', override:null,
      element:{tag:'flow-tile-container',id:'',cls:'',aria:'',text:'',selector:'flow-tile-container'}, candidates:[] },
    { key:'downloadBtn', label:'Nút ⋮ trên thẻ', hint:'Nút ba chấm trên mỗi thẻ, mở menu Tải xuống / Đổi tên.',
      critical:true, ok:true, skipped:false, count:1, via:'builtin', override:null,
      element:{tag:'button',id:'',cls:'mat-mdc-menu-trigger',aria:'',text:'more_vert',selector:'button.mat-mdc-menu-trigger'}, candidates:[] },
    { key:'settingsBtn', label:'Nút cài đặt mô hình (1x/2x)', hint:'Nút chọn model và số lượng đầu ra, cạnh ô nhập prompt.',
      critical:false, ok:false, skipped:true, count:0, via:null, override:null, element:null, candidates:[] }
  ],
  menu: { ok:true, items:[{text:'Tải xuống',aria:''},{text:'Đổi tên',aria:''},{text:'Tăng lên 4K',aria:''},{text:'Xoá',aria:''}] }
};
renderDiagnostics();
showUiBreakBanner('Nút Tạo (mũi tên gửi)', 3);
document.getElementById('folderInfo').textContent = '48 ảnh · 62.4 MB · thứ tự: 01.png → 48.png';
document.getElementById('elapsed').textContent = '00:12:47';
document.getElementById('connDot').className = 'dot ok';
document.getElementById('connText').textContent = 'Đã kết nối Google Flow';
document.getElementById('connDetail').textContent = 'Dự án: Bible Ghibli — Episode 12';
['Sẵn sàng (Local Mode 1.6.0)','Bắt đầu 5 prompt','[2] Đang tạo 64%','[4] Timeout: quá 5 phút','[1] Đã vào Chrome Downloads: 01_Mot_con_meo_tam_the_1.mp4']
  .forEach((m,i) => log(['success','success','info','error','success'][i], m));
`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];

  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 1000 }, deviceScaleFactor: 2 });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errors.push(`[${theme}] pageerror: ${e.message}`));
    pg.on('console', m => { if (m.type() === 'error') errors.push(`[${theme}] console: ${m.text()}`); });

    await pg.addInitScript(CHROME_STUB);
    await pg.goto('file://' + EXT + '/sidepanel.html');
    await pg.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
    await pg.waitForTimeout(400);
    await pg.evaluate(SEED);
    await pg.waitForTimeout(300);

    await pg.screenshot({ path: `${OUT}/run-${theme}.png`, fullPage: true });

    // khối "Chạy nhiều tab" (1.7.0) — ảnh riêng để soi giao diện đa tab
    await pg.locator('#multiTabCard').screenshot({ path: `${OUT}/multitab-${theme}.png` });

    // tab Cài đặt
    await pg.click('.tab[data-tab="settings"]');
    await pg.evaluate(`document.querySelectorAll('details.acc').forEach(d => d.open = true)`);
    await pg.waitForTimeout(250);
    await pg.screenshot({ path: `${OUT}/settings-${theme}.png`, fullPage: true });

    // khối "Chẩn đoán giao diện Flow" (1.8.0)
    await pg.locator('#diagAcc').screenshot({ path: `${OUT}/diag-${theme}.png` });

    // Các nút điều khiển chẩn đoán phải THẤY được và bấm được (đây là đường
    // duy nhất để người dùng tự vá khi Flow đổi UI).
    for (const sel of ['#runDiagBtn', '#exportDiagBtn', '#clearSelectorBtn']) {
      if (!(await pg.locator(sel).isVisible())) errors.push(`[${theme}] ${sel} KHÔNG hiển thị`);
    }
    // input của switch bị display:none theo thiết kế -> kiểm tra cái công tắc vẽ ra.
    if (!(await pg.locator('#diagDeep + .sw').isVisible())) {
      errors.push(`[${theme}] công tắc "kiểm tra sâu" KHÔNG hiển thị`);
    }
    const nPick = await pg.locator('#diagList .drow-btns button').count();
    if (nPick < 12) errors.push(`[${theme}] thiếu nút chọn/nhập tay ở các dòng chẩn đoán (chỉ ${nPick})`);
    const overflowDiag = await pg.evaluate(() => {
      const el = document.getElementById('diagList');
      return el.scrollWidth > el.clientWidth + 1;
    });
    if (overflowDiag) errors.push(`[${theme}] danh sách chẩn đoán bị tràn ngang`);

    // tab Ảnh → Video
    await pg.click('.tab[data-tab="i2v"]');
    await pg.evaluate(`document.querySelectorAll('details.mini-details').forEach(d => d.open = true)`);
    await pg.waitForTimeout(250);
    await pg.screenshot({ path: `${OUT}/i2v-${theme}.png`, fullPage: true });

    // tab Log
    await pg.click('.tab[data-tab="logs"]');
    await pg.waitForTimeout(250);
    await pg.screenshot({ path: `${OUT}/logs-${theme}.png`, fullPage: true });

    // kiểm tra tràn ngang ở bề rộng nhỏ nhất
    await pg.setViewportSize({ width: 320, height: 900 });
    await pg.click('.tab[data-tab="run"]');
    await pg.waitForTimeout(250);
    const overflow = await pg.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      winW: window.innerWidth
    }));
    if (overflow.docW > overflow.winW + 1) errors.push(`[${theme}] TRÀN NGANG ở 320px: ${overflow.docW} > ${overflow.winW}`);
    await pg.screenshot({ path: `${OUT}/narrow-${theme}.png`, fullPage: true });

    await ctx.close();
  }

  await browser.close();

  if (errors.length) {
    console.log('❌ LỖI KHI RENDER:');
    errors.forEach(e => console.log('   ' + e));
    process.exit(1);
  }
  console.log('✅ Render sạch trong Chromium: không lỗi JS, không tràn ngang ở 320px.');
  console.log('   Ảnh: ' + fs.readdirSync(OUT).join(', '));
})();
