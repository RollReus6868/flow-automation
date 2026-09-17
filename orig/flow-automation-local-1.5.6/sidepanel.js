const DEFAULT_SETTINGS = {
  runMode: 'video',
  mode: 'text-to-video',
  model: 'veo-3.1-fast',
  aspectRatio: '16:9',
  duration: '8',
  outputCount: 2,
  pasteDelayMin: 20,
  pasteDelayMax: 30,
  maxRetries: 5,
  addIndex: true,
  autoRename: true,
  renameMode: 'default',
  renameStartIndex: '1',
  renameCustomList: '',
  dlMode: 'single',
  autoDownload: true,
  downloadZip: false,
  downloadQuality: '1080p',
  randomScroll: false,
  charSync: false,
  keyframeSync: false,
  voiceSync: false,
  voiceSelect: 'Achernar',
  autoShutdown: false,
  zoomLevel: '0.8',
  language: 'vi',
  selectors: {}
};

const ui = id => document.getElementById(id);
const app = {
  prompts: [], settings: { ...DEFAULT_SETTINGS }, isRunning: false, paused: false,
  loadedProject: false, startTime: 0, elapsedTimer: null, logs: []
};

function isFlowUrl(url='') {
  return /^https:\/\/(?:[^/]+\.)?flow\.google\.com\//.test(url) || /^https:\/\/labs\.google(?:\.com)?\/fx\//.test(url);
}

function log(type, message) {
  const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  app.logs.push({ type, message: String(message), time });
  if (app.logs.length > 800) app.logs.splice(0, app.logs.length - 800);
  const box = ui('logs');
  if (box) {
    const el = document.createElement('div');
    el.className = `log ${type || 'info'}`;
    el.textContent = `[${time}] ${message}`;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }
}

function setRunning(running, paused=false) {
  app.isRunning = running;
  app.paused = paused;
  const b = ui('startBtn');
  if (!b) return;
  if (running) {
    b.textContent = '⏸ Tạm dừng';
    b.classList.add('paused');
  } else if (paused || app.loadedProject) {
    b.textContent = '▶ Tiếp tục';
    b.classList.remove('paused');
  } else {
    b.textContent = '▶ Bắt đầu';
    b.classList.remove('paused');
  }
}

function startElapsed() {
  if (!app.startTime) app.startTime = Date.now();
  clearInterval(app.elapsedTimer);
  const tick = () => {
    const ms = Math.max(0, Date.now() - app.startTime);
    const s = Math.floor(ms/1000); const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const ss=s%60;
    ui('elapsed').textContent = [h,m,ss].map(v=>String(v).padStart(2,'0')).join(':');
  };
  tick(); app.elapsedTimer = setInterval(tick, 1000);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function flowTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(t => isFlowUrl(t.url || ''));
}

async function sendToActiveFlow(action, data={}) {
  let tab = await activeTab();
  if (!tab || !isFlowUrl(tab.url || '')) {
    const tabs = await flowTabs();
    tab = tabs.find(t => t.active) || tabs[0];
  }
  if (!tab?.id) throw new Error('Không tìm thấy tab Google Flow.');
  await chrome.tabs.sendMessage(tab.id, { action, data });
  return tab;
}

async function broadcastFlow(action, data={}) {
  const tabs = await flowTabs();
  await Promise.allSettled(tabs.filter(t=>t.id).map(t => chrome.tabs.sendMessage(t.id, { action, data })));
}

async function checkConnection() {
  const tab = await activeTab();
  const dot = ui('connDot'), text = ui('connText'), detail = ui('connDetail');
  if (tab && isFlowUrl(tab.url || '')) {
    dot.className = 'dot ok'; text.textContent = 'Đã kết nối Google Flow'; detail.textContent = tab.title || tab.url;
    try { await chrome.tabs.sendMessage(tab.id, { action:'UPDATE_SETTINGS', data: app.settings }); } catch (_) {
      dot.className = 'dot bad'; text.textContent = 'Flow đã mở nhưng content script chưa sẵn sàng'; detail.textContent = 'Hãy refresh tab Flow một lần.';
    }
  } else {
    const tabs = await flowTabs();
    if (tabs.length) {
      dot.className = 'dot'; text.textContent = `Có ${tabs.length} tab Flow ở nền`; detail.textContent = 'Chuyển sang tab Flow trước khi bắt đầu để giảm lỗi UI.';
    } else {
      dot.className = 'dot bad'; text.textContent = 'Chưa mở Google Flow'; detail.textContent = 'Nhấn “Mở Flow” hoặc mở project Flow của bạn.';
    }
  }
}

function promptsFromText() {
  app.prompts = ui('promptsInput').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  ui('promptCount').textContent = String(app.prompts.length);
  ui('endIndex').max = Math.max(1, app.prompts.length);
  if (Number(ui('endIndex').value) > app.prompts.length || ui('endIndex').value === '1') ui('endIndex').value = Math.max(1, app.prompts.length);
  updateRangeInfo();
}

function selectedJobs() {
  const total = app.prompts.length;
  if (!total) return [];
  if (ui('useCustomRange').checked) {
    const values = ui('customIndices').value.split(',').map(s=>Number.parseInt(s.trim(),10)).filter(n=>Number.isInteger(n)&&n>=1&&n<=total);
    return [...new Set(values)].map(index => ({ index, text: app.prompts[index-1] }));
  }
  let start = Math.max(1, Number.parseInt(ui('startIndex').value,10)||1);
  let end = Math.min(total, Number.parseInt(ui('endIndex').value,10)||total);
  if (end < start) end = start;
  const out=[]; for(let i=start;i<=end;i++) out.push({index:i,text:app.prompts[i-1]});
  return out;
}

function updateRangeInfo() {
  const jobs = selectedJobs();
  ui('rangeInfo').textContent = `${app.prompts.length} prompt tổng · ${jobs.length} prompt được chọn`;
}

function gatherSettings() {
  const dlMode = ui('downloadMode').value;
  const runMode = document.querySelector('input[name="runMode"]:checked')?.value || 'video';
  let min = Math.max(runMode === 'image' ? 10 : 20, Number.parseInt(ui('delayMin').value,10)||20);
  let max = Math.max(min, Number.parseInt(ui('delayMax').value,10)||min);
  app.settings = {
    ...app.settings,
    runMode,
    aspectRatio: ui('aspectRatio').value,
    outputCount: Number.parseInt(ui('outputCount').value,10)||2,
    pasteDelayMin: min, pasteDelayMax: max,
    maxRetries: Math.max(0, Number.parseInt(ui('maxRetries').value,10)||0),
    randomScroll: ui('randomScroll').checked,
    addIndex: ui('addIndex').checked,
    charSync: ui('charSync').checked,
    keyframeSync: runMode === 'video' && ui('keyframeSync').checked,
    voiceSync: runMode === 'video' && ui('voiceSync').checked,
    voiceSelect: ui('voiceSelect').value,
    autoRename: ui('autoRename').checked,
    renameMode: ui('renameMode').value,
    renameStartIndex: ui('renameStartIndex').value || '1',
    renameCustomList: ui('renameCustomList').value,
    dlMode,
    autoDownload: dlMode !== 'none',
    downloadZip: dlMode === 'zip',
    downloadQuality: ui('downloadQuality').value,
    autoShutdown: ui('autoShutdown').checked,
    zoomLevel: ui('zoomLevel').value,
    language: 'vi'
  };
  ui('delayMin').value = String(min); ui('delayMax').value = String(max);
  return app.settings;
}

async function saveSettings() {
  gatherSettings();
  await chrome.storage.local.set({ veoSettings: app.settings });
  broadcastFlow('UPDATE_SETTINGS', app.settings).catch(()=>{});
  broadcastFlow('ENFORCE_GROUP_MODE', { zoomLevel: app.settings.zoomLevel }).catch(()=>{});
}

function applySettings(s) {
  app.settings = { ...DEFAULT_SETTINGS, ...(s||{}) };
  const set=(id,v)=>{ if(ui(id)) ui(id).value=v ?? ''; }, check=(id,v)=>{ if(ui(id)) ui(id).checked=!!v; };
  const r = document.querySelector(`input[name="runMode"][value="${app.settings.runMode}"]`); if(r) r.checked=true;
  set('outputCount', app.settings.outputCount); set('aspectRatio', app.settings.aspectRatio); set('delayMin', app.settings.pasteDelayMin); set('delayMax', app.settings.pasteDelayMax); set('maxRetries', app.settings.maxRetries);
  check('randomScroll', app.settings.randomScroll); set('zoomLevel', app.settings.zoomLevel || '0.8'); check('addIndex', app.settings.addIndex !== false); check('charSync', app.settings.charSync); check('keyframeSync', app.settings.keyframeSync); check('voiceSync', app.settings.voiceSync); set('voiceSelect', app.settings.voiceSelect);
  check('autoRename', app.settings.autoRename !== false); set('renameMode', app.settings.renameMode); set('renameStartIndex', app.settings.renameStartIndex); set('renameCustomList', app.settings.renameCustomList); set('downloadMode', app.settings.dlMode || (app.settings.downloadZip?'zip':(app.settings.autoDownload===false?'none':'single'))); set('downloadQuality', app.settings.downloadQuality); check('autoShutdown', app.settings.autoShutdown);
  updateConditionalUI();
}

function updateConditionalUI() {
  ui('customIndices').classList.toggle('hidden', !ui('useCustomRange').checked);
  const customRename = ui('renameMode').value === 'custom_list';
  ui('renameCustomList').classList.toggle('hidden', !customRename); ui('renameDefaultBox').classList.toggle('hidden', customRename);
  ui('qualityBox').classList.toggle('hidden', ui('downloadMode').value !== 'single');
  const image = document.querySelector('input[name="runMode"]:checked')?.value === 'image';
  ui('keyframeSync').disabled = image; ui('voiceSync').disabled = image;
}

function safeRenderProgress(html) {
  const body = ui('progressBody'); body.textContent='';
  if (!html || !html.trim()) { const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.className='empty';td.textContent='Chưa có tác vụ';tr.appendChild(td);body.appendChild(tr);return; }
  const doc = new DOMParser().parseFromString(`<table><tbody>${html}</tbody></table>`, 'text/html');
  const rows = [...doc.querySelectorAll('tbody tr')];
  for (const src of rows) {
    const tr=document.createElement('tr'); const cells=[...src.querySelectorAll(':scope > td')];
    cells.slice(0,5).forEach((c,idx)=>{
      const td=document.createElement('td');
      if(idx===2){
        const raw=c.textContent.replace(/\s+/g,' ').trim(); td.textContent=raw||'—';
        const fill=c.querySelector('.veo-progress-fill'); if(fill){const bar=document.createElement('div');bar.className='statusbar';const i=document.createElement('i');i.style.width=(fill.getAttribute('style')?.match(/width:\s*([\d.]+)%/)?.[1]||0)+'%';bar.appendChild(i);td.appendChild(bar);}
      } else td.textContent=c.textContent.replace(/\s+/g,' ').trim();
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
}

async function renderProjects() {
  const { veoProjects = {} } = await chrome.storage.local.get('veoProjects');
  const box=ui('projectList'); box.textContent='';
  const items=Object.values(veoProjects).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
  if(!items.length){const d=document.createElement('div');d.className='muted';d.textContent='Chưa có project đã lưu.';box.appendChild(d);} 
  for(const p of items){
    const d=document.createElement('div');d.className='project';
    const title=document.createElement('div');title.className='title';title.textContent=p.name||'Project';
    const meta=document.createElement('div');meta.className='meta';meta.textContent=`${p.prompts?.length||0} prompt · ${new Date(p.timestamp||Date.now()).toLocaleString('vi-VN')}`;
    const bs=document.createElement('div');bs.className='buttons';
    const load=document.createElement('button');load.className='ghost';load.textContent='Tải lại';load.onclick=async()=>{await sendToActiveFlow('LOAD_PROJECT',{projectName:p.name});log('info',`Đã yêu cầu tải project ${p.name}`);};
    const del=document.createElement('button');del.className='danger ghostdanger';del.textContent='Xóa';del.onclick=async()=>{if(!confirm(`Xóa project “${p.name}”?`))return;delete veoProjects[p.name];await chrome.storage.local.set({veoProjects});await broadcastFlow('DELETE_PROJECT',{projectName:p.name});renderProjects();};
    bs.append(load,del);d.append(title,meta,bs);box.appendChild(d);
  }
  if(chrome.storage.local.getBytesInUse){const bytes=await chrome.storage.local.getBytesInUse(null);ui('storageInfo').textContent=`Chrome storage đang dùng ${(bytes/1024/1024).toFixed(2)} MB.`;}
}

async function doStart() {
  try {
    await saveSettings();
    if (app.isRunning) {
      await broadcastFlow('PAUSE_AUTOMATION', {}); setRunning(false,true); log('warning','Đã gửi lệnh tạm dừng.'); return;
    }
    if (app.loadedProject) {
      await sendToActiveFlow('RESUME_LOADED_PROJECT',{settings:app.settings}); app.loadedProject=false; setRunning(true); startElapsed(); log('success','Tiếp tục project đã lưu.'); return;
    }
    if (app.paused) {
      await sendToActiveFlow('RESUME_AUTOMATION',{}); setRunning(true); startElapsed(); log('success','Tiếp tục automation.'); return;
    }
    promptsFromText(); const jobs=selectedJobs();
    if(!jobs.length){alert('Hãy nhập và chọn ít nhất một prompt.');return;}
    app.startTime=Date.now(); app.paused=false; app.loadedProject=false; ui('summary').classList.add('hidden');
    await sendToActiveFlow('START_AUTOMATION',{prompts:app.prompts,videosToCreate:jobs,settings:app.settings});
    setRunning(true);startElapsed();log('success',`Bắt đầu ${jobs.length} prompt.`);
  } catch(e){log('error',e.message);alert(e.message);setRunning(false,false);}
}

chrome.runtime.onMessage.addListener((message) => {
  if(message.action==='LOG') log(message.type||'info',message.message||'');
  else if(message.action==='UPDATE_STATS'){ui('statCreating').textContent=message.data?.creating??0;ui('statCompleted').textContent=message.data?.completed??0;ui('statError').textContent=message.data?.error??0;}
  else if(message.action==='UPDATE_TABLE') safeRenderProgress(message.data||'');
  else if(message.action==='UPDATE_PROGRESS'){if(message.data?.isRunning){setRunning(true);if(!app.startTime)app.startTime=Date.now();startElapsed();}}
  else if(message.action==='AUTOMATION_RESUMED'){setRunning(true);if(!app.startTime)app.startTime=Date.now();startElapsed();}
  else if(message.action==='AUTOMATION_STOPPED'){
    setRunning(false,false);app.paused=false;app.loadedProject=false;
    if(message.summary){const s=ui('summary');s.textContent='';const doc=new DOMParser().parseFromString(`<div>${message.summary}</div>`,'text/html');s.textContent=doc.body.textContent.trim();s.classList.remove('hidden');}
    renderProjects();
  }
  else if(message.action==='PROJECT_LOADED'){
    const d=message.data||{};app.prompts=d.prompts||[];ui('promptsInput').value=app.prompts.join('\n');promptsFromText();applySettings(d.settings||{});app.startTime=d.startTime||0;app.loadedProject=!d.isFinished&&!d.isRunning;setRunning(!!d.isRunning,false);if(app.startTime)startElapsed();log('success',`Đã nạp project ${d.projectName||''}`);
  }
  else if(message.action==='SAVE_PROJECT'||message.action==='PROJECT_DELETED') renderProjects();
  else if(message.action==='PICK_RESULT'){
    const {targetType,selector}=message.data||{}; if(targetType==='downloadBtn'&&selector){app.settings.selectors={...(app.settings.selectors||{}),downloadBtn:selector};ui('pickedSelector').textContent=selector;chrome.storage.local.set({veoSettings:app.settings});broadcastFlow('UPDATE_SETTINGS',app.settings);log('success','Đã lưu selector nút menu tile.');}
  }
  else if(message.action==='SHUTDOWN_TRIGGERED'){ui('cancelShutdownBtn').classList.remove('hidden');ui('nativeStatus').textContent='Shutdown đã được lên lịch. Bạn có thể hủy.';}
  else if(message.action==='SHUTDOWN_CANCELLED'){ui('cancelShutdownBtn').classList.add('hidden');ui('nativeStatus').textContent='Đã hủy shutdown.';}
});

document.addEventListener('DOMContentLoaded', async () => {
  const { veoSettings } = await chrome.storage.local.get('veoSettings'); applySettings(veoSettings); if(app.settings.selectors?.downloadBtn)ui('pickedSelector').textContent=app.settings.selectors.downloadBtn;
  promptsFromText(); await checkConnection(); await renderProjects();

  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.tabpane').forEach(p=>p.classList.remove('active'));ui(`tab-${b.dataset.tab}`).classList.add('active');if(b.dataset.tab==='projects')renderProjects();});
  ui('openFlowBtn').onclick=()=>chrome.tabs.create({url:'https://flow.google.com/'}); ui('refreshConnBtn').onclick=checkConnection;
  ui('promptsInput').addEventListener('input',promptsFromText); ['startIndex','endIndex','customIndices'].forEach(id=>ui(id).addEventListener('input',updateRangeInfo));ui('useCustomRange').onchange=()=>{updateConditionalUI();updateRangeInfo();};
  ui('startBtn').onclick=doStart; ui('resetBtn').onclick=async()=>{if(!confirm('Đặt lại automation hiện tại?'))return;await broadcastFlow('RESET_AUTOMATION',{});app.startTime=0;app.paused=false;app.loadedProject=false;setRunning(false,false);safeRenderProgress('');};
  const settingIds=['outputCount','aspectRatio','delayMin','delayMax','maxRetries','randomScroll','zoomLevel','addIndex','charSync','keyframeSync','voiceSync','voiceSelect','autoRename','renameMode','renameStartIndex','renameCustomList','downloadMode','downloadQuality','autoShutdown'];
  settingIds.forEach(id=>ui(id)?.addEventListener('change',()=>{updateConditionalUI();saveSettings();}));document.querySelectorAll('input[name="runMode"]').forEach(x=>x.addEventListener('change',()=>{updateConditionalUI();saveSettings();}));
  ui('pickDownloadBtn').onclick=async()=>{try{await sendToActiveFlow('START_PICKING',{targetType:'downloadBtn'});log('info','Hãy click nút 3 chấm/menu của một tile trên Flow.');}catch(e){alert(e.message);}};
  ui('testNativeBtn').onclick=async()=>{ui('nativeStatus').textContent='Đang kiểm tra…';try{const r=await chrome.runtime.sendMessage({action:'TEST_NATIVE_HOST'});ui('nativeStatus').textContent=r?.success?'✅ Native Host hoạt động.':`⚠️ ${r?.error||'Không kết nối được.'}`;}catch(e){ui('nativeStatus').textContent='⚠️ '+e.message;}};
  ui('cancelShutdownBtn').onclick=async()=>{await chrome.runtime.sendMessage({action:'CANCEL_SHUTDOWN'});ui('cancelShutdownBtn').classList.add('hidden');};
  ui('deleteAllProjectsBtn').onclick=async()=>{if(!confirm('Xóa tất cả project đã lưu?'))return;await chrome.storage.local.remove(['veoProjects']);renderProjects();};
  ui('clearLogsBtn').onclick=()=>{app.logs=[];ui('logs').textContent='';};
  ui('renameMode').addEventListener('change',updateConditionalUI);ui('downloadMode').addEventListener('change',updateConditionalUI);
  chrome.tabs.onActivated.addListener(checkConnection);chrome.tabs.onUpdated.addListener((_id,change)=>{if(change.status==='complete')checkConnection();});
  setInterval(checkConnection,5000);
  log('success','Local Mode sẵn sàng. Không sử dụng Firebase/GAS/OAuth của bản mẫu.');
});
