const API = '';
let photos = [];
let selectedPhotoId = null;
let detailDirty = false;
let detailSnapshot = null;
let selectedIds = new Set();
let selectionAnchorId = null;

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
  initEscHandler();
  initStopButton();
  initConfirmDialog();
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

function initEscHandler() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (confirmState) {
        e.preventDefault();
        closeConfirm(false);
        return;
      }
      const overlay = document.getElementById('detailOverlay');
      const modalOpen = overlay && overlay.classList.contains('open');
      if (modalOpen) {
        e.preventDefault();
        closeDetail();
      } else if (selectedIds.size > 0) {
        e.preventDefault();
        clearSelection();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      if (isTypingTarget(e.target)) return;
      const overlay = document.getElementById('detailOverlay');
      if (overlay && overlay.classList.contains('open')) return;
      if (!photos.length) return;
      e.preventDefault();
      selectAllPhotos();
    }
  });
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function selectAllPhotos() {
  selectedIds = new Set(photos.map(p => p.id));
  selectionAnchorId = photos[0] ? photos[0].id : null;
  renderGrid();
}

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

  const setAllCb = document.getElementById('setAllEditorial');
  if (setAllCb) setAllCb.addEventListener('change', setAllEditorial);
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

function syncSetAllEditorialCheckbox() {
  const cb = document.getElementById('setAllEditorial');
  if (!cb || !photos.length) return;
  const allEditorial = photos.every(p => p.metadata.editorial);
  const noneEditorial = photos.every(p => !p.metadata.editorial);
  cb.checked = allEditorial;
  cb.indeterminate = !allEditorial && !noneEditorial;
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
  startAction(`Uploading ${fileList.length} file(s)`);
  try {
    const res = await api('/api/photos/upload', { method: 'POST', body: fd, signal: actionSignal() });
    if (res.aborted) return;
    if (res.success) {
      toast(res.message, 'success');
      loadPhotos();
    } else {
      toast(res.message || 'Upload failed', 'error');
    }
  } finally {
    endAction();
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
    const isSelected = selectedIds.has(p.id);
    return `
    <div class="${classes.join(' ')}"
         data-id="${p.id}" onclick="onCardClick(event, '${p.id}')">
      <img src="${p.thumbnail_url}" alt="${p.original_filename}" loading="lazy">
      <span class="status-badge status-${p.status}">${p.status}</span>
      <button class="card-remove" data-tip="Remove this photo"
              onclick="event.stopPropagation(); removePhoto('${p.id}')">&times;</button>
      <label class="card-select" data-tip="Select this photo (Shift-click to range-select)"
             onclick="onSelectCheckboxClick(event, '${p.id}')">
        <input type="checkbox" ${isSelected ? 'checked' : ''}
               onclick="onSelectCheckboxClick(event, '${p.id}')">
      </label>
      <div class="info">
        <div class="name" title="${p.original_filename}">${p.original_filename}</div>
        ${p.metadata.title ? `<div class="name" style="color:var(--text);margin-top:2px">${p.metadata.title}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  updateSelectionUI();
  syncSetAllEditorialCheckbox();
}

function onSelectCheckboxClick(event, id) {
  event.stopPropagation();
  event.preventDefault();
  if (event.shiftKey && selectedIds.size > 0) {
    extendSelectionTo(id);
  } else {
    toggleSelection(id);
  }
}

function onCardClick(event, id) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    toggleSelection(id);
    return;
  }
  if (event.shiftKey) {
    event.preventDefault();
    if (selectedIds.size > 0) extendSelectionTo(id);
    else toggleSelection(id);
    return;
  }
  openDetail(id);
}

function toggleSelection(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    if (selectionAnchorId === id) selectionAnchorId = null;
  } else {
    selectedIds.add(id);
    selectionAnchorId = id;
  }
  renderGrid();
}

function extendSelectionTo(id) {
  const ids = photos.map(p => p.id);
  const targetIdx = ids.indexOf(id);
  if (targetIdx < 0) return;
  let anchorIdx = selectionAnchorId ? ids.indexOf(selectionAnchorId) : -1;
  if (anchorIdx < 0) {
    for (let i = ids.length - 1; i >= 0; i--) {
      if (selectedIds.has(ids[i])) { anchorIdx = i; break; }
    }
  }
  if (anchorIdx < 0) anchorIdx = targetIdx;
  const [from, to] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
  for (let i = from; i <= to; i++) selectedIds.add(ids[i]);
  if (!selectionAnchorId) selectionAnchorId = ids[anchorIdx];
  renderGrid();
}

function pruneSelection() {
  const valid = new Set(photos.map(p => p.id));
  for (const id of Array.from(selectedIds)) {
    if (!valid.has(id)) selectedIds.delete(id);
  }
  if (selectionAnchorId && !valid.has(selectionAnchorId)) selectionAnchorId = null;
}

function clearSelection() {
  if (!selectedIds.size) return;
  selectedIds.clear();
  selectionAnchorId = null;
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

// A photo is actionable for CSV / embed / upload as long as its metadata is
// complete. That includes photos already uploaded to one platform — they're
// still valid targets for re-export, embedding, or upload to the other
// platform.
function isActionable(p) {
  return p.status === 'ready' || p.status === 'uploaded';
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
  startAction(`Analyzing ${pending.length} photo(s)`, { button: 'btnAnalyzeAll' });

  const context = getBatchContext();
  let done = 0;
  let stopped = false;
  try {
    for (const p of pending) {
      if (isCancelled()) { stopped = true; break; }
      const res = await api(`/api/metadata/analyze/${p.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
        signal: actionSignal(),
      });
      if (res.aborted) { stopped = true; break; }
      done++;
      updateProgress(done, pending.length);
      if (res.success && res.data) {
        const idx = photos.findIndex(x => x.id === p.id);
        if (idx >= 0) photos[idx] = res.data;
      }
      renderGrid();
    }
  } finally {
    hideProgress();
    endAction();
  }

  if (!stopped) toast('Analysis complete', 'success');
  loadPhotos();
}

async function embedAll() {
  const targets = getActionTargets(isActionable);
  if (!targets.length) {
    toast(selectedIds.size ? 'No selected photos are ready to embed' : 'No ready photos to embed', 'info');
    return;
  }
  startAction(`Embedding ${targets.length} photo(s)`, { button: 'btnEmbedAll' });
  try {
    const body = selectedIds.size > 0 ? { photo_ids: targets.map(p => p.id) } : {};
    const res = await api('/api/metadata/embed-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: actionSignal(),
    });
    if (res.aborted) return;
    toast(res.message || 'Done', res.success ? 'success' : 'error');
  } finally {
    endAction();
  }
}

async function downloadCSV(platform) {
  const targets = getActionTargets(isActionable);
  if (!targets.length) {
    const label = platform === 'adobe' ? 'Adobe' : 'Shutterstock';
    toast(
      selectedIds.size
        ? `No selected photos are ready to export to ${label} CSV`
        : `No ready photos to export to ${label} CSV`,
      'info'
    );
    return;
  }

  let url = platform === 'adobe' ? '/api/upload/csv/adobe' : '/api/upload/csv/shutterstock';
  if (selectedIds.size > 0) {
    const ids = Array.from(selectedIds).join(',');
    url += '?ids=' + encodeURIComponent(ids);
  }

  const csvBtnId = platform === 'adobe' ? 'btnCsvAdobe' : 'btnCsvShutter';
  startAction(`Exporting ${platform === 'adobe' ? 'Adobe' : 'Shutterstock'} CSV`, { button: csvBtnId });
  try {
    const resp = await fetch(API + url, { cache: 'no-store', signal: actionSignal() });
    if (!resp.ok) {
      let msg = `CSV download failed (${resp.status})`;
      try {
        const j = await resp.json();
        if (j && j.message) msg = j.message;
      } catch (_) {}
      toast(msg, 'error');
      return;
    }
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = await resp.json();
      toast(j.message || 'CSV export failed', 'error');
      return;
    }
    const blob = await resp.blob();
    const filename = platform === 'adobe' ? 'adobe_stock.csv' : 'shutterstock.csv';
    const a = document.createElement('a');
    const objUrl = URL.createObjectURL(blob);
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  } catch (e) {
    if (e.name !== 'AbortError') toast('CSV download failed: ' + e.message, 'error');
  } finally {
    endAction();
  }
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

  startAction('Importing CSV', { button: 'btnImportCsv' });

  const fd = new FormData();
  fd.append('file', file);

  try {
    const r = await fetch('/api/metadata/import-csv', { method: 'POST', body: fd, signal: actionSignal() });
    const res = await r.json();
    toast(res.message || 'Done', res.success ? 'success' : 'error');
    if (res.success) await loadPhotos();
  } catch (e) {
    if (e.name !== 'AbortError') toast('Import failed: ' + e.message, 'error');
  } finally {
    input.value = '';
    endAction();
  }
}

async function uploadPlatform(platform) {
  hideProgress();
  const ready = getActionTargets(isActionable);
  if (!ready.length) {
    toast(selectedIds.size ? 'No selected photos are ready to upload' : 'No ready photos to upload', 'info');
    return;
  }

  const ids = ready.map(p => p.id);
  const btnMap = { adobe: 'btnUploadAdobe', shutterstock: 'btnUploadShutter', both: 'btnUploadBoth' };
  const otherBtns = ['btnUploadAdobe', 'btnUploadShutter', 'btnUploadBoth'].filter(id => id !== btnMap[platform]);
  otherBtns.forEach(id => { document.getElementById(id).disabled = true; });

  const platformLabel = platform === 'both' ? 'Adobe + Shutterstock' : platform === 'adobe' ? 'Adobe' : 'Shutterstock';
  startAction(`Uploading ${ids.length} photo(s) to ${platformLabel}`, {
    button: btnMap[platform],
    poll: true,
    pollInterval: 2500,
  });

  let endpoint = '/api/upload/';
  if (platform === 'adobe') endpoint += 'adobe';
  else if (platform === 'shutterstock') endpoint += 'shutterstock';
  else endpoint += 'both';

  try {
    const res = await api(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_ids: ids, platform: platform === 'both' ? 'both' : platform === 'adobe' ? 'adobe_stock' : 'shutterstock' }),
      signal: actionSignal(),
    });
    if (!res.aborted) toast(res.message || 'Upload complete', res.success ? 'success' : 'error');
  } finally {
    otherBtns.forEach(id => { document.getElementById(id).disabled = false; });
    endAction();
  }
  loadPhotos();
}

async function clearAllOrSelected() {
  if (selectedIds.size > 0) {
    const ids = Array.from(selectedIds);
    const ok = await confirmDialog({
      title: 'Remove selected photos',
      message: `This will permanently delete ${ids.length} selected photo(s) and their metadata. This cannot be undone.`,
      confirmLabel: `Remove ${ids.length}`,
    });
    if (!ok) return;
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

  const ok = await confirmDialog({
    title: 'Remove all photos',
    message: `This will permanently delete all ${photos.length} photo(s) and their metadata. This cannot be undone.`,
    confirmLabel: 'Remove all',
  });
  if (!ok) return;
  await api('/api/photos/', { method: 'DELETE' });
  photos = [];
  selectedIds.clear();
  renderGrid();
  toast('All photos removed', 'info');
}

async function removePhoto(id) {
  const p = photos.find(x => x.id === id);
  if (!p) return;
  const ok = await confirmDialog({
    title: 'Remove photo',
    message: `This will permanently delete "${p.original_filename}" and its metadata. This cannot be undone.`,
    confirmLabel: 'Remove',
  });
  if (!ok) return;
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

  populateCategorySelects();

  document.getElementById('detailImg').src = p.thumbnail_url;
  document.getElementById('detailFilename').textContent = p.original_filename + ` (${p.width}x${p.height})`;
  document.getElementById('detailStatus').textContent = p.status;
  document.getElementById('detailStatus').className = 'status-badge status-' + p.status;

  document.getElementById('detailTitle').value = p.metadata.title || '';
  document.getElementById('detailDesc').value = p.metadata.description || '';
  const adobeVal = p.metadata.adobe_category != null ? String(p.metadata.adobe_category) : '';
  document.getElementById('detailAdobeCat').value = adobeVal;
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

async function closeDetail() {
  if (detailDirty) {
    const ok = await confirmDialog({
      title: 'Discard unsaved changes?',
      message: 'You have unsaved edits in this photo. Discard them and close?',
      confirmLabel: 'Discard',
    });
    if (!ok) return;
  }
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

// ─── Confirm dialog (replaces native confirm) ───
let confirmState = null;

function confirmDialog({ title = 'Confirm', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = true } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    if (!overlay) { resolve(window.confirm(message)); return; }

    titleEl.textContent = title;
    msgEl.textContent = message;
    okBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;
    okBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');

    confirmState = { resolve, overlay, okBtn, cancelBtn };
    overlay.classList.add('open');
    setTimeout(() => okBtn.focus(), 80);
  });
}

function closeConfirm(result) {
  if (!confirmState) return;
  const { resolve, overlay } = confirmState;
  overlay.classList.remove('open');
  confirmState = null;
  resolve(result);
}

function initConfirmDialog() {
  const okBtn = document.getElementById('confirmOkBtn');
  const cancelBtn = document.getElementById('confirmCancelBtn');
  const backdrop = document.getElementById('confirmBackdrop');
  if (okBtn) okBtn.addEventListener('click', () => closeConfirm(true));
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeConfirm(false));
  if (backdrop) backdrop.addEventListener('click', () => closeConfirm(false));
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
    const resp = await fetch(API + url, { cache: 'no-store', ...opts });
    return await resp.json();
  } catch (e) {
    if (e.name === 'AbortError') return { success: false, message: 'Stopped', aborted: true };
    return { success: false, message: e.message };
  }
}

// ─── Action lifecycle (Stop button) ───
let currentAction = null;

const MIN_STOP_VISIBLE_MS = 700;

function startAction(label, opts = {}) {
  if (currentAction) stopAction(false);
  currentAction = {
    label,
    controller: new AbortController(),
    cancelled: false,
    startedAt: Date.now(),
    button: null,
    pollTimer: null,
  };
  showStopButton(label);

  if (opts.button) {
    const btn = typeof opts.button === 'string' ? document.getElementById(opts.button) : opts.button;
    if (btn) markButtonRunning(btn);
  }
  if (opts.poll) {
    currentAction.pollTimer = setInterval(() => {
      if (currentAction && !currentAction.cancelled) loadPhotos();
    }, opts.pollInterval || 3000);
  }
  return currentAction;
}

function markButtonRunning(btn) {
  if (!currentAction) return;
  currentAction.button = btn;
  currentAction.buttonOrigHTML = btn.innerHTML;
  currentAction.buttonOrigDisabled = btn.disabled;
  btn.disabled = true;
  btn.classList.add('is-running');
  btn.innerHTML = `<span class="spinner" style="margin-right:0.4rem"></span>${currentAction.buttonOrigHTML}`;

  const stopMark = document.createElement('button');
  stopMark.type = 'button';
  stopMark.className = 'btn-stop-mark';
  stopMark.innerHTML = '<span class="stop-square"></span>';
  stopMark.setAttribute('aria-label', 'Stop');
  stopMark.setAttribute('data-tip', 'Stop this action');
  stopMark.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    stopAction(true);
  });
  btn.parentNode.insertBefore(stopMark, btn.nextSibling);
  currentAction.stopMarkExternal = stopMark;
}

function clearButtonRunning() {
  if (!currentAction || !currentAction.button) return;
  const btn = currentAction.button;
  btn.classList.remove('is-running');
  if (currentAction.buttonOrigHTML !== undefined) btn.innerHTML = currentAction.buttonOrigHTML;
  if (currentAction.buttonOrigDisabled !== undefined) btn.disabled = currentAction.buttonOrigDisabled;
  if (currentAction.stopMarkExternal) {
    currentAction.stopMarkExternal.remove();
    currentAction.stopMarkExternal = null;
  }
}

function stopAction(showToastMsg = true) {
  if (!currentAction) return;
  const label = currentAction.label;
  currentAction.cancelled = true;
  try { currentAction.controller.abort(); } catch (_) {}
  if (currentAction.pollTimer) clearInterval(currentAction.pollTimer);
  clearButtonRunning();
  hideStopButton();
  if (showToastMsg) toast(`Stopped: ${label}`, 'info');
  currentAction = null;
}

function endAction() {
  if (!currentAction) return;
  if (currentAction.pollTimer) clearInterval(currentAction.pollTimer);
  clearButtonRunning();
  const elapsed = Date.now() - currentAction.startedAt;
  const remaining = Math.max(0, MIN_STOP_VISIBLE_MS - elapsed);
  const finishingAction = currentAction;
  if (remaining === 0) {
    hideStopButton();
    currentAction = null;
  } else {
    setTimeout(() => {
      if (currentAction === finishingAction) {
        hideStopButton();
        currentAction = null;
      }
    }, remaining);
  }
}

function isCancelled() {
  return currentAction ? currentAction.cancelled : false;
}

function actionSignal() {
  return currentAction ? currentAction.controller.signal : undefined;
}

function showStopButton(label) {
  const btn = document.getElementById('stopActionBtn');
  if (!btn) return;
  btn.querySelector('.stop-label').textContent = label;
  btn.style.display = 'inline-flex';
}

function hideStopButton() {
  const btn = document.getElementById('stopActionBtn');
  if (btn) btn.style.display = 'none';
}

function initStopButton() {
  const btn = document.getElementById('stopActionBtn');
  if (btn) btn.addEventListener('click', () => stopAction(true));
}
