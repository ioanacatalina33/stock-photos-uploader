const API = '';
let photos = [];
let selectedPhotoId = null;
let detailDirty = false;
let detailSnapshot = null;
let selectedIds = new Set();

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
  initTooltips();
  populateCategorySelects();
  loadPhotos();
  loadSettings();
});

// ─── Tooltips (fixed-position, never clipped by overflow containers) ───
function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'js-tooltip';
  document.body.appendChild(tip);

  let currentTarget = null;

  function show(target) {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    tip.textContent = text;
    tip.style.top = '-9999px';
    tip.style.left = '-9999px';
    tip.classList.add('visible');
    requestAnimationFrame(() => position(target));
  }

  function position(target) {
    const r = target.getBoundingClientRect();
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    const margin = 8;

    let top = r.top - tipH - margin;
    if (top < margin) top = r.bottom + margin;

    let left = r.left + r.width / 2 - tipW / 2;
    const maxLeft = Math.max(margin, window.innerWidth - tipW - margin);
    left = Math.max(margin, Math.min(left, maxLeft));

    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
  }

  function hide() {
    tip.classList.remove('visible');
    currentTarget = null;
  }

  document.addEventListener('mouseover', e => {
    const target = e.target.closest('[data-tip]');
    if (!target || target === currentTarget) return;
    currentTarget = target;
    show(target);
  });

  document.addEventListener('mouseout', e => {
    if (!currentTarget) return;
    if (e.target.closest('[data-tip]') === currentTarget && !currentTarget.contains(e.relatedTarget)) {
      hide();
    }
  });

  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}

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

  document.getElementById('setAllEditorial').addEventListener('change', setAllEditorial);
}

async function setAllEditorial(event) {
  const cb = event.target;
  cb.indeterminate = false;
  const checked = cb.checked;

  const targets = photos.filter(p => p.metadata.editorial !== checked);
  if (!targets.length) {
    renderGrid();
    return;
  }

  cb.disabled = true;

  const results = await Promise.all(targets.map(p =>
    api(`/api/metadata/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editorial: checked })
    }).then(res => ({ p, res }))
  ));

  for (const { p, res } of results) {
    if (res && res.success && res.data) {
      const idx = photos.findIndex(x => x.id === p.id);
      if (idx >= 0) photos[idx] = res.data;
    }
  }

  cb.disabled = false;
  renderGrid();
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

  pruneSelection();

  bar.style.display = photos.length ? 'flex' : 'none';
  batchSettings.style.display = photos.length ? 'block' : 'none';
  count.textContent = photos.length + ' photo(s)';

  const readyCount = photos.filter(p => p.status === 'ready').length;
  document.getElementById('statusText').textContent =
    photos.length ? `${readyCount}/${photos.length} ready` : '';

  grid.innerHTML = photos.map(p => {
    const classes = ['photo-card'];
    if (selectedPhotoId === p.id) classes.push('selected');
    if (selectedIds.has(p.id)) classes.push('multi-selected');
    return `
    <div class="${classes.join(' ')}"
         data-id="${p.id}" onclick="onCardClick(event, '${p.id}')">
      <img src="${p.thumbnail_url}" alt="${p.original_filename}" loading="lazy">
      <span class="status-badge status-${p.status}">${p.status}</span>
      <span class="card-select-mark">&#10003;</span>
      <button class="card-remove" data-tip="Remove this photo"
              onclick="event.stopPropagation(); removePhoto('${p.id}')">&times;</button>
      <label class="card-editorial" data-tip="Mark this photo as editorial"
             onclick="event.stopPropagation()">
        <input type="checkbox" ${p.metadata.editorial ? 'checked' : ''}
               onchange="toggleCardEditorial('${p.id}', this.checked)">
        Editorial
      </label>
      <div class="info">
        <div class="name" title="${p.original_filename}">${p.original_filename}</div>
        ${p.metadata.title ? `<div class="name" style="color:var(--text);margin-top:2px">${p.metadata.title}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  syncSetAllEditorialCheckbox();
  updateSelectionUI();
}

function onCardClick(event, id) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    toggleSelection(id);
    return;
  }
  if (event.shiftKey && selectedIds.size > 0) {
    event.preventDefault();
    extendSelectionTo(id);
    return;
  }
  openDetail(id);
}

function toggleSelection(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  renderGrid();
}

function extendSelectionTo(id) {
  const ids = photos.map(p => p.id);
  const targetIdx = ids.indexOf(id);
  if (targetIdx < 0) return;
  let lastIdx = -1;
  for (let i = ids.length - 1; i >= 0; i--) {
    if (selectedIds.has(ids[i])) { lastIdx = i; break; }
  }
  if (lastIdx < 0) lastIdx = targetIdx;
  const [from, to] = lastIdx <= targetIdx ? [lastIdx, targetIdx] : [targetIdx, lastIdx];
  for (let i = from; i <= to; i++) selectedIds.add(ids[i]);
  renderGrid();
}

function pruneSelection() {
  const valid = new Set(photos.map(p => p.id));
  for (const id of Array.from(selectedIds)) {
    if (!valid.has(id)) selectedIds.delete(id);
  }
}

function clearSelection() {
  if (!selectedIds.size) return;
  selectedIds.clear();
  renderGrid();
}

function getSelectedPhotos(filterFn) {
  const sel = photos.filter(p => selectedIds.has(p.id));
  return filterFn ? sel.filter(filterFn) : sel;
}

function getActionTargets(filterFn) {
  if (selectedIds.size > 0) return getSelectedPhotos(filterFn);
  return filterFn ? photos.filter(filterFn) : photos.slice();
}

function updateSelectionUI() {
  const n = selectedIds.size;
  const info = document.getElementById('selectionInfo');
  const hint = document.getElementById('selectionHint');
  const cnt = document.getElementById('selectionCount');
  if (info) info.style.display = n > 0 ? 'inline' : 'none';
  if (hint) hint.style.display = n > 0 ? 'none' : 'inline';
  if (cnt) cnt.textContent = String(n);

  const set = (id, label) => {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  };

  if (n > 0) {
    set('btnAnalyzeAll', `Analyze ${n} selected with AI`);
    set('btnEmbedAll', `Embed ${n} selected`);
    set('btnCsvAdobe', `CSV Adobe (${n})`);
    set('btnCsvShutter', `CSV Shutterstock (${n})`);
    set('btnUploadAdobe', `Upload ${n} to Adobe`);
    set('btnUploadShutter', `Upload ${n} to Shutterstock`);
    set('btnUploadBoth', `Upload ${n} to Both`);
    set('btnClearAll', `Remove ${n} selected`);
  } else {
    set('btnAnalyzeAll', 'Analyze All with AI');
    set('btnEmbedAll', 'Embed Metadata');
    set('btnCsvAdobe', 'CSV Adobe');
    set('btnCsvShutter', 'CSV Shutterstock');
    set('btnUploadAdobe', 'Upload Adobe');
    set('btnUploadShutter', 'Upload Shutterstock');
    set('btnUploadBoth', 'Upload Both');
    set('btnClearAll', 'Remove All');
  }
}

async function toggleCardEditorial(id, checked) {
  const res = await api(`/api/metadata/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ editorial: checked })
  });
  if (res.success && res.data) {
    const idx = photos.findIndex(x => x.id === id);
    if (idx >= 0) photos[idx] = res.data;
    syncSetAllEditorialCheckbox();
  } else {
    toast(res.message || 'Failed to update', 'error');
  }
}

function syncSetAllEditorialCheckbox() {
  const cb = document.getElementById('setAllEditorial');
  if (!cb || !photos.length) return;
  const allEditorial = photos.every(p => p.metadata.editorial);
  const noneEditorial = photos.every(p => !p.metadata.editorial);
  cb.checked = allEditorial;
  cb.indeterminate = !allEditorial && !noneEditorial;
}

// ─── Batch Actions ───
function initBatchActions() {
  document.getElementById('btnAnalyzeAll').addEventListener('click', analyzeAll);
  document.getElementById('btnEmbedAll').addEventListener('click', embedAll);
  document.getElementById('btnImportCsv').addEventListener('click', () => document.getElementById('importCsvInput').click());
  document.getElementById('importCsvInput').addEventListener('change', importCsv);
  document.getElementById('btnCsvAdobe').addEventListener('click', () => downloadCSV('adobe'));
  document.getElementById('btnCsvShutter').addEventListener('click', () => downloadCSV('shutterstock'));
  document.getElementById('btnUploadAdobe').addEventListener('click', () => uploadPlatform('adobe'));
  document.getElementById('btnUploadShutter').addEventListener('click', () => uploadPlatform('shutterstock'));
  document.getElementById('btnUploadBoth').addEventListener('click', () => uploadPlatform('both'));
  document.getElementById('btnClearAll').addEventListener('click', clearAllOrSelected);
  document.getElementById('btnClearSelection').addEventListener('click', clearSelection);
}

async function analyzeAll() {
  const pending = getActionTargets(p => p.status === 'pending' || p.status === 'error');
  if (!pending.length) {
    toast(selectedIds.size ? 'No selected photos need analysis' : 'No photos to analyze', 'info');
    return;
  }

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
  const targets = getActionTargets(p => p.status === 'ready');
  if (!targets.length) {
    toast(selectedIds.size ? 'No selected photos are ready to embed' : 'No ready photos to embed', 'info');
    return;
  }
  const btn = document.getElementById('btnEmbedAll');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Embedding...';
  const body = selectedIds.size > 0 ? { photo_ids: targets.map(p => p.id) } : {};
  const res = await api('/api/metadata/embed-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  btn.disabled = false;
  btn.textContent = origText;
  toast(res.message || 'Done', res.success ? 'success' : 'error');
}

function downloadCSV(platform) {
  let url = platform === 'adobe' ? '/api/upload/csv/adobe' : '/api/upload/csv/shutterstock';
  if (selectedIds.size > 0) {
    const ids = Array.from(selectedIds).join(',');
    url += '?ids=' + encodeURIComponent(ids);
  }
  window.open(url);
}

async function importCsv(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;
  if (!photos.length) {
    toast('Upload photos first, then import a CSV to populate metadata', 'info');
    input.value = '';
    return;
  }

  const btn = document.getElementById('btnImportCsv');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Importing...';

  const fd = new FormData();
  fd.append('file', file);

  try {
    const r = await fetch('/api/metadata/import-csv', { method: 'POST', body: fd });
    const res = await r.json();
    toast(res.message || 'Done', res.success ? 'success' : 'error');
    if (res.success) await loadPhotos();
  } catch (e) {
    toast('Import failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
    input.value = '';
  }
}

async function uploadPlatform(platform) {
  hideProgress();
  const ready = getActionTargets(p => p.status === 'ready');
  if (!ready.length) {
    toast(selectedIds.size ? 'No selected photos are ready to upload' : 'No ready photos to upload', 'info');
    return;
  }

  const ids = ready.map(p => p.id);
  const btnMap = { adobe: 'btnUploadAdobe', shutterstock: 'btnUploadShutter', both: 'btnUploadBoth' };
  const allBtns = ['btnUploadAdobe', 'btnUploadShutter', 'btnUploadBoth'];
  const activeBtn = document.getElementById(btnMap[platform]);
  const origText = activeBtn.textContent;

  allBtns.forEach(id => { document.getElementById(id).disabled = true; });
  activeBtn.innerHTML = '<span class="spinner"></span> Uploading...';

  let endpoint = '/api/upload/';
  if (platform === 'adobe') endpoint += 'adobe';
  else if (platform === 'shutterstock') endpoint += 'shutterstock';
  else endpoint += 'both';

  const res = await api(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_ids: ids, platform: platform === 'both' ? 'both' : platform === 'adobe' ? 'adobe_stock' : 'shutterstock' })
  });

  allBtns.forEach(id => { document.getElementById(id).disabled = false; });
  activeBtn.textContent = origText;
  toast(res.message || 'Upload complete', res.success ? 'success' : 'error');
  loadPhotos();
}

async function clearAllOrSelected() {
  if (selectedIds.size > 0) {
    const ids = Array.from(selectedIds);
    if (!confirm(`Remove ${ids.length} selected photo(s)?`)) return;
    let removed = 0;
    let failed = 0;
    await Promise.all(ids.map(async id => {
      const res = await api(`/api/photos/${id}`, { method: 'DELETE' });
      if (res.success) removed++;
      else failed++;
    }));
    photos = photos.filter(p => !selectedIds.has(p.id));
    if (selectedIds.has(selectedPhotoId)) closeDetail();
    selectedIds.clear();
    renderGrid();
    toast(failed
      ? `Removed ${removed}, ${failed} failed`
      : `Removed ${removed} photo(s)`, failed ? 'error' : 'success');
    return;
  }

  if (!confirm('Remove all photos?')) return;
  await api('/api/photos/', { method: 'DELETE' });
  photos = [];
  selectedIds.clear();
  renderGrid();
  toast('All photos removed', 'info');
}

async function removePhoto(id) {
  const p = photos.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Remove "${p.original_filename}"?`)) return;
  const res = await api(`/api/photos/${id}`, { method: 'DELETE' });
  if (res.success) {
    photos = photos.filter(x => x.id !== id);
    if (selectedPhotoId === id) closeDetail();
    renderGrid();
    toast('Photo removed', 'success');
  } else {
    toast(res.message || 'Failed to remove photo', 'error');
  }
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

  ['detailTitle', 'detailDesc', 'detailAdobeCat', 'detailSSCat1', 'detailSSCat2', 'detailEditorial']
    .forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', recomputeDirty);
      el.addEventListener('change', recomputeDirty);
    });
}

function getDetailFormState() {
  return {
    title: document.getElementById('detailTitle').value,
    description: document.getElementById('detailDesc').value,
    keywords: getDetailKeywords(),
    adobe_category: document.getElementById('detailAdobeCat').value,
    shutterstock_category_1: document.getElementById('detailSSCat1').value,
    shutterstock_category_2: document.getElementById('detailSSCat2').value,
    editorial: document.getElementById('detailEditorial').checked,
  };
}

function takeDetailSnapshot() {
  detailSnapshot = JSON.stringify(getDetailFormState());
}

function recomputeDirty() {
  if (!selectedPhotoId || detailSnapshot === null) return;
  detailDirty = JSON.stringify(getDetailFormState()) !== detailSnapshot;
  updateSaveButtonState();
}

function updateSaveButtonState() {
  const btn = document.getElementById('btnDetailSave');
  if (!btn) return;
  if (detailDirty) {
    btn.textContent = 'Save Changes *';
    btn.classList.add('dirty');
  } else {
    btn.textContent = 'Save Changes';
    btn.classList.remove('dirty');
  }
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

  renderKeywords(p.metadata.keywords || []);
  takeDetailSnapshot();
  detailDirty = false;
  updateSaveButtonState();
  document.getElementById('detailOverlay').classList.add('open');
  renderGrid();
}

function closeDetail() {
  if (detailDirty && !confirm('You have unsaved changes. Discard them?')) return;
  document.getElementById('detailOverlay').classList.remove('open');
  selectedPhotoId = null;
  detailDirty = false;
  detailSnapshot = null;
  updateSaveButtonState();
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
  recomputeDirty();
}

function removeKeyword(i) {
  const current = getDetailKeywords();
  current.splice(i, 1);
  renderKeywords(current);
  recomputeDirty();
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
    editorial: document.getElementById('detailEditorial').checked
  };

  const res = await api(`/api/metadata/${selectedPhotoId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.success && res.data) {
    const idx = photos.findIndex(x => x.id === selectedPhotoId);
    if (idx >= 0) photos[idx] = res.data;
    takeDetailSnapshot();
    detailDirty = false;
    updateSaveButtonState();
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
