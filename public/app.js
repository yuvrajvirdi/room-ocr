import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs';

const PDF_URL = 'drawing.pdf';

let pdfDoc = null;
let pageNum = 1;
let mode = 'capture'; // capture (green) or ignore (red)
let annotations = { pages: {} }; // keyed by page number, rects use normalized 0-1 coordinates
let selectedId = null;
let renderTask = null;
let currentViewport = null;

const canvas = document.getElementById('pdfCanvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const pageWrap = document.getElementById('pageWrap');
const viewerContainer = document.getElementById('viewerContainer');
const saveStatus = document.getElementById('saveStatus');

let saveTimer = null;
function scheduleSave() {
  saveStatus.textContent = 'Saving...';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch('/api/annotations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(annotations),
      });
      saveStatus.textContent = 'Saved';
    } catch {
      saveStatus.textContent = 'Save failed, retrying';
      scheduleSave();
    }
  }, 400);
}

async function loadAnnotations() {
  try {
    const res = await fetch('/api/annotations');
    const data = await res.json();
    if (data && typeof data === 'object' && data.pages) annotations = data;
  } catch {
    // no saved file yet, start fresh
  }
}

function pageAnns() {
  const key = String(pageNum);
  if (!annotations.pages[key]) annotations.pages[key] = [];
  return annotations.pages[key];
}

let renderSeq = 0;

async function renderPage(num) {
  const seq = ++renderSeq;
  const page = await pdfDoc.getPage(num);
  if (seq !== renderSeq) return; // a newer render started, drop this one
  const base = page.getViewport({ scale: 1 });
  const available = viewerContainer.clientWidth - 32;
  const cssScale = Math.max(0.05, available / base.width);
  const dpr = window.devicePixelRatio || 1;

  currentViewport = page.getViewport({ scale: cssScale });
  canvas.width = Math.floor(base.width * cssScale * dpr);
  canvas.height = Math.floor(base.height * cssScale * dpr);
  canvas.style.width = `${Math.floor(base.width * cssScale)}px`;
  canvas.style.height = `${Math.floor(base.height * cssScale)}px`;

  if (renderTask) {
    try {
      renderTask.cancel();
    } catch {}
  }
  renderTask = page.render({
    canvasContext: ctx,
    viewport: page.getViewport({ scale: cssScale * dpr }),
  });
  try {
    await renderTask.promise;
  } catch (e) {
    if (e?.name === 'RenderingCancelledException') return;
    throw e;
  }
  if (seq !== renderSeq) return;
  renderTask = null;

  document.getElementById('pageIndicator').textContent = `${num} / ${pdfDoc.numPages}`;
  document.getElementById('prevPage').disabled = num <= 1;
  document.getElementById('nextPage').disabled = num >= pdfDoc.numPages;

  drawRects();
  renderSidebar();
}

function drawRects() {
  overlay.querySelectorAll('.rect:not(.preview)').forEach((el) => el.remove());
  const W = overlay.clientWidth;
  const H = overlay.clientHeight;
  for (const ann of pageAnns()) {
    const el = document.createElement('div');
    el.className = `rect ${ann.type}${ann.id === selectedId ? ' selected' : ''}`;
    el.dataset.id = ann.id;
    el.style.left = `${ann.x * W}px`;
    el.style.top = `${ann.y * H}px`;
    el.style.width = `${ann.w * W}px`;
    el.style.height = `${ann.h * H}px`;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = ann.type === 'capture' ? 'capture' : 'ignore';
    el.appendChild(badge);
    overlay.appendChild(el);
  }
}

function renderSidebar() {
  const anns = pageAnns();
  const captures = anns.filter((a) => a.type === 'capture');
  const ignores = anns.filter((a) => a.type === 'ignore');

  document.getElementById('captureCount').textContent = `(${captures.length})`;
  document.getElementById('ignoreCount').textContent = `(${ignores.length})`;

  const capList = document.getElementById('captureList');
  capList.innerHTML = '';
  captures.forEach((ann, i) => {
    const item = document.createElement('div');
    item.className = `capture-item${ann.id === selectedId ? ' selected' : ''}`;
    item.dataset.id = ann.id;
    const text = ann.ocrPending
      ? '<div class="ocr-text pending">Running OCR...</div>'
      : `<div class="ocr-text">${escapeHtml(ann.text || '(no text found)')}</div>`;
    item.innerHTML = `
      <div class="item-head">
        <span class="label">Capture ${i + 1}</span>
        <button class="del" title="Delete">✕</button>
      </div>
      ${text}`;
    capList.appendChild(item);
  });

  const igList = document.getElementById('ignoreList');
  igList.innerHTML = '';
  ignores.forEach((ann, i) => {
    const item = document.createElement('div');
    item.className = `ignore-item${ann.id === selectedId ? ' selected' : ''}`;
    item.dataset.id = ann.id;
    item.innerHTML = `
      <div class="item-head">
        <span class="label">Ignore ${i + 1}</span>
        <button class="del" title="Delete">✕</button>
      </div>`;
    igList.appendChild(item);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function selectAnn(id) {
  selectedId = id;
  drawRects();
  renderSidebar();
}

function deleteAnn(id) {
  const key = String(pageNum);
  annotations.pages[key] = pageAnns().filter((a) => a.id !== id);
  if (selectedId === id) selectedId = null;
  drawRects();
  renderSidebar();
  scheduleSave();
}

let drag = null;

overlay.addEventListener('pointerdown', (e) => {
  const rectEl = e.target.closest('.rect');
  if (rectEl) {
    selectAnn(rectEl.dataset.id);
    return;
  }
  const bounds = overlay.getBoundingClientRect();
  drag = {
    startX: (e.clientX - bounds.left) / bounds.width,
    startY: (e.clientY - bounds.top) / bounds.height,
    previewEl: null,
  };
  try {
    overlay.setPointerCapture(e.pointerId);
  } catch {
    // ignore, some environments don't support pointer capture
  }
});

overlay.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const bounds = overlay.getBoundingClientRect();
  const cx = Math.min(Math.max((e.clientX - bounds.left) / bounds.width, 0), 1);
  const cy = Math.min(Math.max((e.clientY - bounds.top) / bounds.height, 0), 1);
  const x = Math.min(drag.startX, cx);
  const y = Math.min(drag.startY, cy);
  const w = Math.abs(cx - drag.startX);
  const h = Math.abs(cy - drag.startY);

  if (!drag.previewEl) {
    drag.previewEl = document.createElement('div');
    drag.previewEl.className = `rect preview ${mode}`;
    overlay.appendChild(drag.previewEl);
  }
  Object.assign(drag.previewEl.style, {
    left: `${x * bounds.width}px`,
    top: `${y * bounds.height}px`,
    width: `${w * bounds.width}px`,
    height: `${h * bounds.height}px`,
  });
  drag.current = { x, y, w, h };
});

overlay.addEventListener('pointerup', () => {
  if (!drag) return;
  const r = drag.current;
  drag.previewEl?.remove();
  drag = null;
  // ignore tiny accidental drags
  if (!r || r.w * overlay.clientWidth < 6 || r.h * overlay.clientHeight < 6) {
    selectAnn(null);
    return;
  }
  const ann = { id: crypto.randomUUID(), type: mode, ...r };
  if (mode === 'capture') ann.ocrPending = true;
  pageAnns().push(ann);
  selectedId = ann.id;
  drawRects();
  renderSidebar();
  scheduleSave();
  if (ann.type === 'capture') runOCR(ann, pageNum);
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape' && drag) {
    drag.previewEl?.remove();
    drag = null;
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
    deleteAnn(selectedId);
  } else if (e.key === 'ArrowLeft') {
    goToPage(pageNum - 1);
  } else if (e.key === 'ArrowRight') {
    goToPage(pageNum + 1);
  } else if (e.key.toLowerCase() === 'c') {
    setMode('capture');
  } else if (e.key.toLowerCase() === 'i') {
    setMode('ignore');
  }
});

document.querySelector('.sidebar').addEventListener('click', (e) => {
  const item = e.target.closest('.capture-item, .ignore-item');
  if (!item) return;
  if (e.target.closest('.del')) deleteAnn(item.dataset.id);
  else selectAnn(item.dataset.id);
});

let ocrWorkerPromise = null;
function getOcrWorker() {
  if (!ocrWorkerPromise) ocrWorkerPromise = Tesseract.createWorker('eng');
  return ocrWorkerPromise;
}

async function runOCR(ann, forPage) {
  try {
    const worker = await getOcrWorker();
    // re-render just the cropped region at high scale, gives OCR much better accuracy
    const page = await pdfDoc.getPage(forPage);
    const base = page.getViewport({ scale: 1 });
    const OCR_SCALE = 4;
    const vp = page.getViewport({ scale: OCR_SCALE });
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.floor(ann.w * base.width * OCR_SCALE));
    crop.height = Math.max(1, Math.floor(ann.h * base.height * OCR_SCALE));
    const cctx = crop.getContext('2d');
    cctx.translate(-ann.x * base.width * OCR_SCALE, -ann.y * base.height * OCR_SCALE);
    await page.render({ canvasContext: cctx, viewport: vp }).promise;

    const { data } = await worker.recognize(crop);
    ann.text = (data.text || '').trim();
  } catch (err) {
    console.error('OCR failed', err);
    ann.text = '';
    ann.ocrError = true;
  } finally {
    delete ann.ocrPending;
    scheduleSave();
    if (forPage === pageNum) renderSidebar();
  }
}

function goToPage(num) {
  if (!pdfDoc || num < 1 || num > pdfDoc.numPages) return;
  pageNum = num;
  selectedId = null;
  renderPage(pageNum);
}

function setMode(m) {
  mode = m;
  document.getElementById('modeCapture').classList.toggle('active', m === 'capture');
  document.getElementById('modeIgnore').classList.toggle('active', m === 'ignore');
}

document.getElementById('prevPage').addEventListener('click', () => goToPage(pageNum - 1));
document.getElementById('nextPage').addEventListener('click', () => goToPage(pageNum + 1));
document.getElementById('modeCapture').addEventListener('click', () => setMode('capture'));
document.getElementById('modeIgnore').addEventListener('click', () => setMode('ignore'));

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderPage(pageNum), 200);
});

(async function init() {
  await loadAnnotations();
  pdfDoc = await pdfjsLib.getDocument(PDF_URL).promise;
  await renderPage(pageNum);
  saveStatus.textContent = 'Loaded';
})();
