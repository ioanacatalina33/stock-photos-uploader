const API = '';
let photos = [];
let selectedPhotoId = null;

const ADOBE_CATS = {
  1:'Animals',2:'Buildings and Architecture',3:'Business',4:'Drinks',
  5:'The Environment',6:'States of Mind',7:'Food',8:'Graphic Resources',
  9:'Hobbies and Leisure',10:'Industry',11:'Landscape',12:'Lifestyle',
  13:'People',14:'Plants and Flowers',15:'Culture and Religion',16:'Science',
  17:'Social Issues',18:'Sports',19:'Technology',20:'Transport',21:'Travel'
};

const SS_CATS = [
  '','Abstract','Animals/Wildlife','The Arts','Backgrounds/Textures',
  'Beauty/Fashion','Buildings/Landmarks','Business/Finance','Celebrities',
  'Education','Food and Drink','Healthcare/Medical','Holidays','Industrial',
  'Interiors','Miscellaneous','Nature','Objects','Parks/Outdoor','People',
  'Religion','Science','Signs/Symbols','Sports/Recreation','Technology',
  'Transportation','Vintage'
];

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initDropZone();
  initBatchActions();
  initBatchSettings();
  initDetail();
  populateCategorySelects();
  loadPhotos();
  loadSettings();
});

// ─── Batch Context ───
function initBatchSettings() {
  const otherCb = document.getElementById('styleOther');
  const otherInput = document.getElementById('styleOtherInput');
  const defaultChecks = document.querySelectorAll('.style-check:not(#styleOther)');

  otherCb.addEventListener('change', () => {
    if (otherCb.checked) {
      defaultChecks.forEach(cb => { cb.checked = false; });
      otherInput.style.display = 'block';
    } else {
      otherInput.style.display = 'none';
    }
  });
  defaultChecks.forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        otherCb.checked = false;
        otherInput.style.display = 'none';
      }
    });
  });
}

function getBatchContext() {
  const location = document.getElementById('batchLocation').value.trim();
  const kwRaw = document.getElementById('batchKeywords').value.trim();
  const common_keywords = kwRaw ? kwRaw.split(',').map(k => k.trim()).filter(Boolean) : [];

  const checkedStyles = Array.from(document.querySelectorAll('.style-check:checked')).map(cb => cb.value);
  const photo_styles = checkedStyles.filter(v => v !== 'Other');

  if (checkedStyles.includes('Other')) {
    const otherVal = document.getElementById('styleOtherInput').value.trim();
    if (otherVal) {
      otherVal.split(',').map(s => s.trim()).filter(Boolean).forEach(s => photo_styles.push(s));
    }
  }

  return { location, common_keywords, photo_styles };
}

// ─── Tabs ───
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab + 'Panel').classList.add('active');
    });
  });
}

// ─── Drop Zone ───
function initDropZone() {
  const dz = document.getElementById('dropZone');
  const fi = document.getElementById('fileInput');

  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dragover');
    uploadFiles(e.dataTransfer.files);
  });
  fi.addEventListener('change', () => { uploadFiles(fi.files); fi.value = ''; });
}

async function uploadFiles(fileList) {
  if (!fileList.length) return;
  const fd = new FormData();
  for (const f of fileList) fd.append('files', f);

  toast('Uploading ' + fileList.length + ' file(s)...', 'info');
  const res = await api('/api/photos/upload', { method: 'POST', body: fd });
  if (res.success) {
    toast(res.message, 'success');
    loadPhotos();
  } else {
    toast(res.message || 'Upload failed', 'error');
  }
}

// ─── Photo Grid ───
async function loadPhotos() {
  const res = await api('/api/photos/');
  if (res.success) {
    photos = res.data || [];
    renderGrid();
  }
}

function renderGrid() {
  const grid = document.getElementById('photoGrid');
  const bar = document.getElementById('batchBar');
  const batchSettings = document.getElementById('batchSettings');
  const count = document.getElementById('photoCount');

  bar.style.display = photos.length ? 'flex' : 'none';
  batchSettings.style.display = photos.length ? 'block' : 'none';
  count.textContent = photos.length + ' photo(s)';

  const readyCount = photos.filter(p => p.status === 'ready').length;
  document.getElementById('statusText').textContent =
    photos.length ? `${readyCount}/${photos.length} ready` : '';

  grid.innerHTML = photos.map(p => `
    <div class="photo-card ${selectedPhotoId === p.id ? 'selected' : ''}"
         data-id="${p.id}" onclick="openDetail('${p.id}')">
      <img src="${p.thumbnail_url}" alt="${p.original_filename}" loading="lazy">
      <span class="status-badge status-${p.status}">${p.status}</span>
      <div class="info">
        <div class="name" title="${p.original_filename}">${p.original_filename}</div>
        ${p.metadata.title ? `<div class="name" style="color:var(--text);margin-top:2px">${p.metadata.title}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// ─── Batch Actions ───
function initBatchActions() {
  document.getElementById('btnAnalyzeAll').addEventListener('click', analyzeAll);
  document.getElementById('btnEmbedAll').addEventListener('click', embedAll);
  document.getElementById('btnCsvAdobe').addEventListener('click', () => downloadCSV('adobe'));
  document.getElementById('btnCsvShutter').addEventListener('click', () => downloadCSV('shutterstock'));
  document.getElementById('btnUploadAdobe').addEventListener('click', () => uploadPlatform('adobe'));
  document.getElementById('btnUploadShutter').addEventListener('click', () => uploadPlatform('shutterstock'));
  document.getElementById('btnUploadBoth').addEventListener('click', () => uploadPlatform('both'));
  document.getElementById('btnClearAll').addEventListener('click', clearAll);
}

async function analyzeAll() {
  const pending = photos.filter(p => p.status === 'pending' || p.status === 'error');
  if (!pending.length) { toast('No photos to analyze', 'info'); return; }

  showProgress('Analyzing with AI...', 0, pending.length);
  const btn = document.getElementById('btnAnalyzeAll');
  btn.disabled = true;

  const context = getBatchContext();
  let done = 0;
  for (const p of pending) {
    const res = await api(`/api/metadata/analyze/${p.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context)
    });
    done++;
    updateProgress(done, pending.length);
    if (res.success && res.data) {
      const idx = photos.findIndex(x => x.id === p.id);
      if (idx >= 0) photos[idx] = res.data;
    }
    renderGrid();
  }

  hideProgress();
  btn.disabled = false;
  toast('Analysis complete', 'success');
  loadPhotos();
}

async function embedAll() {
  const btn = document.getElementById('btnEmbedAll');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Embedding...';
  const res = await api('/api/metadata/embed-batch', { method: 'POST' });
  btn.disabled = false;
  btn.textContent = origText;
  toast(res.message || 'Done', res.success ? 'success' : 'error');
}

function downloadCSV(platform) {
  const url = platform === 'adobe' ? '/api/upload/csv/adobe' : '/api/upload/csv/shutterstock';
  window.open(url);
}

async function uploadPlatform(platform) {
  const ready = photos.filter(p => p.status === 'ready');
  if (!ready.length) { toast('No ready photos to upload', 'info'); return; }

  const ids = ready.map(p => p.id);
  const platformLabel = platform === 'both' ? 'both platforms' : platform === 'adobe' ? 'Adobe Stock' : 'Shutterstock';

  const btns = ['btnUploadAdobe', 'btnUploadShutter', 'btnUploadBoth'];
  btns.forEach(id => { document.getElementById(id).disabled = true; });

  showProgress(`Uploading ${ready.length} photo(s) to ${platformLabel}...`, 0, 1);

  let endpoint = '/api/upload/';
  if (platform === 'adobe') endpoint += 'adobe';
  else if (platform === 'shutterstock') endpoint += 'shutterstock';
  else endpoint += 'both';

  const res = await api(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_ids: ids, platform: platform === 'both' ? 'both' : platform === 'adobe' ? 'adobe_stock' : 'shutterstock' })
  });

  updateProgress(1, 1);
  hideProgress();
  btns.forEach(id => { document.getElementById(id).disabled = false; });
  toast(res.message || 'Upload complete', res.success ? 'success' : 'error');
  loadPhotos();
}

async function clearAll() {
  if (!confirm('Delete all photos?')) return;
  await api('/api/photos/', { method: 'DELETE' });
  photos = [];
  renderGrid();
  toast('All photos cleared', 'info');
}

// ─── Detail Panel ───
function initDetail() {
  document.getElementById('detailBackdrop').addEventListener('click', closeDetail);
  document.getElementById('detailClose').addEventListener('click', closeDetail);
  document.getElementById('btnDetailSave').addEventListener('click', saveDetail);
  document.getElementById('btnDetailAnalyze').addEventListener('click', reanalyzeDetail);
  document.getElementById('btnDetailEmbed').addEventListener('click', embedDetail);

  document.getElementById('detailKwInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      e.preventDefault();
      addKeyword(e.target.value.trim());
      e.target.value = '';
    }
  });
}

function populateCategorySelects() {
  const adobeSel = document.getElementById('detailAdobeCat');
  adobeSel.innerHTML = '<option value="">-- Select --</option>' +
    Object.entries(ADOBE_CATS).map(([k,v]) => `<option value="${k}">${k}. ${v}</option>`).join('');

  ['detailSSCat1','detailSSCat2'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = SS_CATS.map(c => `<option value="${c}">${c || '-- None --'}</option>`).join('');
  });
}

function openDetail(id) {
  selectedPhotoId = id;
  const p = photos.find(x => x.id === id);
  if (!p) return;

  document.getElementById('detailImg').src = p.thumbnail_url;
  document.getElementById('detailFilename').textContent = p.original_filename + ` (${p.width}x${p.height})`;
  document.getElementById('detailStatus').textContent = p.status;
  document.getElementById('detailStatus').className = 'status-badge status-' + p.status;

  document.getElementById('detailTitle').value = p.metadata.title || '';
  document.getElementById('detailDesc').value = p.metadata.description || '';
  document.getElementById('detailAdobeCat').value = p.metadata.adobe_category || '';
  document.getElementById('detailSSCat1').value = p.metadata.shutterstock_category_1 || '';
  document.getElementById('detailSSCat2').value = p.metadata.shutterstock_category_2 || '';
  document.getElementById('detailEditorial').checked = p.metadata.editorial;
  document.getElementById('detailMature').checked = p.metadata.mature_content;

  renderKeywords(p.metadata.keywords || []);
  document.getElementById('detailOverlay').classList.add('open');
  renderGrid();
}

function closeDetail() {
  document.getElementById('detailOverlay').classList.remove('open');
  selectedPhotoId = null;
  renderGrid();
}

function renderKeywords(kws) {
  const container = document.getElementById('detailKeywords');
  container.innerHTML = kws.map((kw, i) =>
    `<span class="kw-tag">${kw}<span class="remove" onclick="removeKeyword(${i})">&times;</span></span>`
  ).join('');
}

function getDetailKeywords() {
  return Array.from(document.querySelectorAll('#detailKeywords .kw-tag'))
    .map(el => el.childNodes[0].textContent);
}

function addKeyword(kw) {
  const current = getDetailKeywords();
  if (current.length >= 50) { toast('Max 50 keywords', 'error'); return; }
  if (current.includes(kw)) return;
  current.push(kw);
  renderKeywords(current);
}

function removeKeyword(i) {
  const current = getDetailKeywords();
  current.splice(i, 1);
  renderKeywords(current);
}

async function saveDetail() {
  if (!selectedPhotoId) return;
  const body = {
    title: document.getElementById('detailTitle').value,
    description: document.getElementById('detailDesc').value,
    keywords: getDetailKeywords(),
    adobe_category: parseInt(document.getElementById('detailAdobeCat').value) || null,
    shutterstock_category_1: document.getElementById('detailSSCat1').value,
    shutterstock_category_2: document.getElementById('detailSSCat2').value,
    editorial: document.getElementById('detailEditorial').checked,
    mature_content: document.getElementById('detailMature').checked
  };

  const res = await api(`/api/metadata/${selectedPhotoId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.success && res.data) {
    const idx = photos.findIndex(x => x.id === selectedPhotoId);
    if (idx >= 0) photos[idx] = res.data;
    renderGrid();
    toast('Metadata saved', 'success');
  } else {
    toast(res.message || 'Failed to save', 'error');
  }
}

async function reanalyzeDetail() {
  if (!selectedPhotoId) return;
  toast('Analyzing...', 'info');
  const context = getBatchContext();
  const res = await api(`/api/metadata/analyze/${selectedPhotoId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(context)
  });
  if (res.success && res.data) {
    const idx = photos.findIndex(x => x.id === selectedPhotoId);
    if (idx >= 0) photos[idx] = res.data;
    openDetail(selectedPhotoId);
    toast('Analysis complete', 'success');
  } else {
    toast(res.message || 'Analysis failed', 'error');
  }
}

async function embedDetail() {
  if (!selectedPhotoId) return;
  const res = await api(`/api/metadata/embed/${selectedPhotoId}`, { method: 'POST' });
  toast(res.message || 'Done', res.success ? 'success' : 'error');
}

// ─── Settings ───
async function loadSettings() {
  const res = await api('/api/settings/');
  if (!res.success) return;
  const d = res.data;
  if (d.openai_api_key) document.getElementById('settOpenaiKey').placeholder = d.openai_api_key;
  if (d.adobe_stock) {
    document.getElementById('settAdobeHost').value = d.adobe_stock.host || '';
    document.getElementById('settAdobeUser').value = d.adobe_stock.username || '';
    if (d.adobe_stock.password) document.getElementById('settAdobePass').placeholder = d.adobe_stock.password;
  }
  if (d.shutterstock) {
    document.getElementById('settShutterHost').value = d.shutterstock.host || '';
    document.getElementById('settShutterUser').value = d.shutterstock.username || '';
    if (d.shutterstock.password) document.getElementById('settShutterPass').placeholder = d.shutterstock.password;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
  document.getElementById('btnTestAdobe').addEventListener('click', () => testConn('adobe_stock'));
  document.getElementById('btnTestShutter').addEventListener('click', () => testConn('shutterstock'));
});

async function saveSettings() {
  const params = new URLSearchParams();
  const key = document.getElementById('settOpenaiKey').value;
  if (key) params.set('openai_api_key', key);

  const ah = document.getElementById('settAdobeHost').value;
  const au = document.getElementById('settAdobeUser').value;
  const ap = document.getElementById('settAdobePass').value;
  if (ah) params.set('adobe_host', ah);
  if (au) params.set('adobe_username', au);
  if (ap) params.set('adobe_password', ap);

  const sh = document.getElementById('settShutterHost').value;
  const su = document.getElementById('settShutterUser').value;
  const sp = document.getElementById('settShutterPass').value;
  if (sh) params.set('shutterstock_host', sh);
  if (su) params.set('shutterstock_username', su);
  if (sp) params.set('shutterstock_password', sp);

  const res = await api(`/api/settings/?${params.toString()}`, { method: 'PUT' });
  toast(res.message || 'Settings saved', res.success ? 'success' : 'error');
  loadSettings();
}

async function testConn(platform) {
  toast('Testing connection...', 'info');
  const res = await api(`/api/upload/test/${platform}`, { method: 'POST' });
  toast(res.message, res.success ? 'success' : 'error');
}

// ─── Progress ───
function showProgress(label, current, total) {
  document.getElementById('progressArea').style.display = 'block';
  document.getElementById('progressLabel').textContent = label;
  updateProgress(current, total);
}

function updateProgress(current, total) {
  document.getElementById('progressCount').textContent = `${current}/${total}`;
  document.getElementById('progressFill').style.width = total ? `${(current/total)*100}%` : '0';
}

function hideProgress() {
  document.getElementById('progressArea').style.display = 'none';
}

// ─── Toast ───
function toast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => { el.remove(); }, 4000);
}

// ─── API Helper ───
async function api(url, opts = {}) {
  try {
    const resp = await fetch(API + url, opts);
    return await resp.json();
  } catch (e) {
    return { success: false, message: e.message };
  }
}
