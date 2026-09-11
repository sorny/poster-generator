// UI state, pointer interaction and wiring.

import { PAGE_PRESETS, computeLayout, fitPlacement, placedAspect, placementRect } from './layout.js';
import { loadSource } from './source.js';
import { drawPreview, computeView, viewToPoster, corners, blankTiles, HANDLE_SIZE } from './renderer.js';
import { buildPosterPdf } from './exporter.js';

const $ = (id) => document.getElementById(id);

const el = {
  drop: $('drop'), file: $('file'), filemeta: $('filemeta'), filename: $('filename'),
  filenote: $('filenote'), pagerow: $('pagerow'), pdfpage: $('pdfpage'), clear: $('clear'),
  cols: $('cols'), rows: $('rows'), preset: $('preset'), customsize: $('customsize'),
  customW: $('customW'), customH: $('customH'), orientation: $('orientation'),
  units: $('units'), customWLabel: $('customWLabel'), customHLabel: $('customHLabel'),
  artWLabel: $('artWLabel'), artHLabel: $('artHLabel'),
  margin: $('margin'), marginVal: $('marginVal'), overlap: $('overlap'), overlapVal: $('overlapVal'),
  posterReadout: $('posterReadout'),
  fit: $('fit'), fill: $('fill'), center: $('center'), rotL: $('rotL'), rotR: $('rotR'),
  scale: $('scale'), scaleVal: $('scaleVal'), artW: $('artW'), artH: $('artH'), artReadout: $('artReadout'),
  dpi: $('dpi'), format: $('format'), quality: $('quality'), qualityVal: $('qualityVal'),
  qualityField: $('qualityField'), transparentField: $('transparentField'), transparent: $('transparent'),
  marks: $('marks'), labels: $('labels'), assembly: $('assembly'),
  outputReadout: $('outputReadout'), exportBtn: $('export'),
  progress: $('progress'), bar: $('bar'), progressText: $('progressText'),
  showGrid: $('showGrid'), stagehint: $('stagehint'),
  canvas: $('preview'), canvaswrap: $('canvaswrap'), toast: $('toast'),
};

const state = {
  source: null,
  placement: null,
  showGrid: true,
  busy: false,
  units: 'mm',
  cfg: {
    preset: 'a4', orientation: 'portrait',
    cols: 2, rows: 3,
    margin: 10, overlap: 0,
    customW: 210, customH: 297,
  },
};

let layout = computeLayout(state.cfg);

/* ------------------------------------------------------------------ setup */

/**
 * Display units. Geometry is always stored in millimetres; these only convert
 * what the user reads and types. `len` is a sheet/margin dimension, `big` is a
 * finished poster or artwork dimension — metric shows those in cm, which has no
 * imperial equivalent, so inches serve both roles.
 */
const UNITS = {
  mm: {
    len: 'mm', big: 'cm',
    toLen: (mm) => mm, fromLen: (v) => v,
    toBig: (mm) => mm / 10, fromBig: (v) => v * 10,
    lenPlaces: 1, bigPlaces: 1,
    pageStep: 1, pageMin: 20, pageMax: 2000,
    bigStep: 0.1, bigMin: 0.1,
  },
  in: {
    len: 'in', big: 'in',
    toLen: (mm) => mm / 25.4, fromLen: (v) => v * 25.4,
    toBig: (mm) => mm / 25.4, fromBig: (v) => v * 25.4,
    lenPlaces: 2, bigPlaces: 2,
    pageStep: 0.125, pageMin: 0.8, pageMax: 78,
    bigStep: 0.125, bigMin: 0.04,
  },
};

const unit = () => UNITS[state.units];

/** Sheet-size menu, grouped and annotated with each preset's real dimensions. */
function buildPresetOptions() {
  const selected = el.preset.value || 'a4';
  const u = unit();
  el.preset.textContent = '';
  const groups = new Map();
  for (const [id, preset] of Object.entries(PAGE_PRESETS)) {
    if (!groups.has(preset.group)) {
      const group = document.createElement('optgroup');
      group.label = preset.group;
      groups.set(preset.group, group);
      el.preset.append(group);
    }
    const dims = id === 'custom'
      ? ''
      : ` — ${num(u.toLen(preset.size[0]), u.lenPlaces)} × ${num(u.toLen(preset.size[1]), u.lenPlaces)} ${u.len}`;
    groups.get(preset.group).append(new Option(preset.label + dims, id));
  }
  el.preset.value = selected;
}

/** Push the current unit into every label, input range and typed value. */
function applyUnits() {
  const u = unit();
  buildPresetOptions();

  el.customWLabel.textContent = `Width (${u.len})`;
  el.customHLabel.textContent = `Height (${u.len})`;
  for (const [input, mm] of [[el.customW, state.cfg.customW], [el.customH, state.cfg.customH]]) {
    input.step = u.pageStep;
    input.min = u.pageMin;
    input.max = u.pageMax;
    input.value = num(u.toLen(mm), 3);
  }

  el.artWLabel.textContent = `Width (${u.big})`;
  el.artHLabel.textContent = `Height (${u.big})`;
  for (const input of [el.artW, el.artH]) {
    input.step = u.bigStep;
    input.min = u.bigMin;
  }

}

/**
 * Step size for the margin and overlap sliders, in millimetres: half a
 * millimetre, or a sixteenth of an inch so imperial users land on 1/4" and 1/2"
 * exactly. The sliders carry step="any" and are quantised here instead, because
 * changing a range input's step attribute makes the browser re-sanitise its
 * value — which would silently resize the poster on a display-only unit switch.
 */
const sliderGrid = () => (state.units === 'in' ? 25.4 / 16 : 0.5);

function readConfig() {
  state.cfg = {
    preset: el.preset.value,
    orientation: el.orientation.querySelector('.on').dataset.value,
    cols: clamp(+el.cols.value || 1, 1, 20),
    rows: clamp(+el.rows.value || 1, 1, 20),
    margin: +el.margin.value,
    overlap: +el.overlap.value,
    customW: clamp(unit().fromLen(+el.customW.value) || 210, 20, 2000),
    customH: clamp(unit().fromLen(+el.customH.value) || 297, 20, 2000),
  };
  el.customsize.hidden = state.cfg.preset !== 'custom';
}

/** Re-fit the artwork into a resized poster, keeping the composition. */
function relayout() {
  const before = layout;
  const fraction = state.placement && {
    fx: state.placement.cx / before.posterW,
    fy: state.placement.cy / before.posterH,
    fw: state.placement.w / fitPlacement(before, state.source, state.placement.rot, 'contain').w,
  };

  readConfig();
  layout = computeLayout(state.cfg);

  if (state.placement && fraction) {
    const fit = fitPlacement(layout, state.source, state.placement.rot, 'contain');
    setPlacement({
      ...state.placement,
      cx: fraction.fx * layout.posterW,
      cy: fraction.fy * layout.posterH,
      w: fit.w * fraction.fw,
      h: (fit.w * fraction.fw) / placedAspect(state.source, state.placement.rot),
    });
  }
  render();
}

function setPlacement(next) {
  const aspect = placedAspect(state.source, next.rot);
  const w = clamp(next.w, 5, 40000);
  state.placement = { cx: next.cx, cy: next.cy, w, h: w / aspect, rot: ((next.rot % 360) + 360) % 360 };
}

/* ----------------------------------------------------------------- render */

function render() {
  drawPreview(el.canvas, {
    source: state.source,
    placement: state.placement,
    layout,
    showGrid: state.showGrid,
  });
  syncReadouts();
}

function syncReadouts() {
  const u = unit();
  const len = (mm) => `${num(u.toLen(mm), u.lenPlaces)} ${u.len}`;
  const big = (mm) => num(u.toBig(mm), u.bigPlaces);

  el.marginVal.textContent = len(layout.margin);
  el.overlapVal.textContent = len(layout.overlap);

  const sheets = layout.cols * layout.rows;
  el.posterReadout.innerHTML =
    `Finished poster <b>${big(layout.posterW)} × ${big(layout.posterH)} ${u.big}</b> ` +
    `on <b>${sheets}</b> sheet${sheets === 1 ? '' : 's'}.<br>` +
    `Printable area per sheet ${len(layout.printW)} × ${len(layout.printH)}.`;

  if (state.placement) {
    const p = state.placement;
    el.scale.value = clamp(scalePercent(), 5, 400);
    el.scaleVal.textContent = `${Math.round(scalePercent())}%`;
    if (document.activeElement !== el.artW) el.artW.value = big(p.w);
    if (document.activeElement !== el.artH) el.artH.value = big(p.h);

    const across = p.rot % 180 === 0 ? state.source.width : state.source.height;
    const dpi = across / (p.w / 25.4);
    const quality = state.source.kind === 'pdf'
      ? 'vector artwork — sharp at any size'
      : `${Math.round(dpi)} dpi effective${dpi < 150 ? ' <span class="warn">(soft in print)</span>' : ''}`;
    el.artReadout.innerHTML =
      `Artwork <b>${big(p.w)} × ${big(p.h)} ${u.big}</b>${p.rot ? `, rotated ${p.rot}°` : ''}.<br>${quality}`;
    el.stagehint.textContent =
      `${state.source.name} · ${big(p.w)} × ${big(p.h)} ${u.big} on a ${big(layout.posterW)} × ${big(layout.posterH)} ${u.big} poster`;
  } else {
    el.stagehint.textContent = 'No artwork loaded';
    el.artReadout.textContent = 'Drag on the canvas to move · corner handles resize · scroll to zoom · arrow keys nudge.';
  }

  const dpi = +el.dpi.value;
  const tw = Math.round((layout.pageW / 25.4) * dpi);
  const th = Math.round((layout.pageH / 25.4) * dpi);
  const mp = (tw * th) / 1e6;
  const blank = state.placement ? blankTiles(layout, state.placement) : [];
  el.outputReadout.innerHTML =
    `Each sheet rasterises to <b>${tw} × ${th} px</b> (${mp.toFixed(1)} MP).` +
    (mp > 80 ? ' <span class="warn">Large — lower the dpi if your browser runs out of memory.</span>' : '') +
    (blank.length ? `<br><span class="warn">${blank.length} sheet${blank.length === 1 ? '' : 's'} print blank: ${blank.join(', ')}.</span>` : '');

  el.exportBtn.disabled = !state.source || state.busy;
}

function scalePercent() {
  const fit = fitPlacement(layout, state.source, state.placement.rot, 'contain');
  return (state.placement.w / fit.w) * 100;
}

/* ------------------------------------------------------------ file loading */

async function handleFile(file) {
  if (!file) return;
  try {
    el.drop.classList.remove('over');
    hideToast();
    state.source?.dispose?.();
    state.source = null;
    state.placement = null;
    el.stagehint.textContent = 'Loading…';

    const source = await loadSource(file, (msg) => { el.stagehint.textContent = msg; });
    state.source = source;
    setPlacement(fitPlacement(layout, source, 0, 'contain'));

    el.filemeta.hidden = false;
    el.filename.textContent = source.name;
    el.filenote.textContent = `${source.kind === 'pdf' ? 'PDF' : 'Image'} · ${source.resolutionNote}`;
    el.pagerow.hidden = source.pageCount < 2;
    if (source.pageCount > 1) {
      el.pdfpage.innerHTML = '';
      for (let i = 1; i <= source.pageCount; i++) {
        el.pdfpage.append(new Option(`${i} of ${source.pageCount}`, i, false, i === 1));
      }
    }
    render();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Could not read that file.');
    el.stagehint.textContent = 'No artwork loaded';
  }
}

function clearSource() {
  state.source?.dispose?.();
  state.source = null;
  state.placement = null;
  el.filemeta.hidden = true;
  el.file.value = '';
  render();
}

/* ------------------------------------------------------ pointer interaction */

function currentView() {
  return computeView(el.canvas.clientWidth, el.canvas.clientHeight, layout);
}

function destRect(view) {
  const r = placementRect(state.placement);
  return { x: view.ox + r.x * view.scale, y: view.oy + r.y * view.scale, w: r.w * view.scale, h: r.h * view.scale };
}

function hitTest(view, px, py) {
  if (!state.placement) return null;
  const dest = destRect(view);
  const reach = HANDLE_SIZE;
  const cs = corners(dest);
  for (let i = 0; i < cs.length; i++) {
    if (Math.abs(px - cs[i][0]) <= reach && Math.abs(py - cs[i][1]) <= reach) {
      return { mode: 'resize', corner: i, anchor: cs[(i + 2) % 4] };
    }
  }
  if (px >= dest.x && px <= dest.x + dest.w && py >= dest.y && py <= dest.y + dest.h) return { mode: 'move' };
  return null;
}

let drag = null;

el.canvas.addEventListener('pointermove', (ev) => {
  if (drag || !state.placement) return;
  const { x, y } = localPoint(ev);
  const hit = hitTest(currentView(), x, y);
  el.canvas.style.cursor = !hit ? 'default'
    : hit.mode === 'move' ? 'grab'
    : hit.corner % 2 === 0 ? 'nwse-resize' : 'nesw-resize';
});

el.canvas.addEventListener('pointerdown', (ev) => {
  if (!state.placement) return;
  const view = currentView();
  const { x, y } = localPoint(ev);
  const hit = hitTest(view, x, y);
  if (!hit) return;
  ev.preventDefault();
  el.canvas.setPointerCapture(ev.pointerId);
  el.canvas.classList.add('grabbing');
  drag = { ...hit, view, start: viewToPoster(view, x, y), origin: { ...state.placement } };
});

el.canvas.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const { x, y } = localPoint(ev);
  const now = viewToPoster(drag.view, x, y);

  if (drag.mode === 'move') {
    setPlacement({
      ...drag.origin,
      cx: drag.origin.cx + (now.x - drag.start.x),
      cy: drag.origin.cy + (now.y - drag.start.y),
    });
  } else {
    // Resize from the opposite corner, locked to the artwork's aspect ratio.
    const anchor = viewToPoster(drag.view, drag.anchor[0], drag.anchor[1]);
    const aspect = placedAspect(state.source, drag.origin.rot);
    const w = Math.max(Math.abs(now.x - anchor.x), Math.abs(now.y - anchor.y) * aspect);
    const h = w / aspect;
    const signX = drag.corner === 1 || drag.corner === 2 ? 1 : -1;
    const signY = drag.corner === 2 || drag.corner === 3 ? 1 : -1;
    setPlacement({ ...drag.origin, w, h, cx: anchor.x + (signX * w) / 2, cy: anchor.y + (signY * h) / 2 });
  }
  render();
});

for (const type of ['pointerup', 'pointercancel']) {
  el.canvas.addEventListener(type, (ev) => {
    if (!drag) return;
    drag = null;
    el.canvas.classList.remove('grabbing');
    el.canvas.releasePointerCapture?.(ev.pointerId);
    render();
  });
}

el.canvas.addEventListener('wheel', (ev) => {
  if (!state.placement) return;
  ev.preventDefault();
  const view = currentView();
  const { x, y } = localPoint(ev);
  const cursor = viewToPoster(view, x, y);
  const factor = Math.exp(-ev.deltaY * 0.0015);
  const p = state.placement;
  const w = clamp(p.w * factor, 5, 40000);
  const k = w / p.w;
  // Keep the poster point under the cursor pinned while zooming.
  setPlacement({ ...p, w, cx: cursor.x + (p.cx - cursor.x) * k, cy: cursor.y + (p.cy - cursor.y) * k });
  render();
}, { passive: false });

window.addEventListener('keydown', (ev) => {
  if (!state.placement) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
  const step = ev.shiftKey ? 10 : 1;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const move = moves[ev.key];
  if (!move) return;
  ev.preventDefault();
  setPlacement({ ...state.placement, cx: state.placement.cx + move[0], cy: state.placement.cy + move[1] });
  render();
});

/* ----------------------------------------------------------------- export */

async function exportPdf() {
  if (!state.source || state.busy) return;
  state.busy = true;
  hideToast();
  el.progress.hidden = false;
  el.exportBtn.disabled = true;

  const onProgress = (value, text) => {
    el.bar.style.width = `${Math.round(value * 100)}%`;
    el.progressText.textContent = text;
  };

  try {
    const format = el.format.value;
    const bytes = await buildPosterPdf({
      source: state.source,
      placement: state.placement,
      layout,
      dpi: +el.dpi.value,
      format,
      quality: +el.quality.value / 100,
      marks: el.marks.checked,
      labels: el.labels.checked,
      assemblyMap: el.assembly.checked,
      transparent: format === 'image/png' && el.transparent.checked,
    }, onProgress);

    const base = state.source.name.replace(/\.[^.]+$/, '') || 'poster';
    download(new Blob([bytes], { type: 'application/pdf' }),
             `${base}-poster-${layout.cols}x${layout.rows}.pdf`);
    onProgress(1, `Done — ${layout.tiles.length} sheets saved.`);
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Export failed.');
    el.progress.hidden = true;
  } finally {
    state.busy = false;
    el.exportBtn.disabled = false;
  }
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ---------------------------------------------------------------- wiring */

el.drop.addEventListener('click', () => el.file.click());
el.drop.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.file.click(); }
});
el.file.addEventListener('change', () => handleFile(el.file.files[0]));
el.clear.addEventListener('click', clearSource);

for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (ev) => { ev.preventDefault(); el.drop.classList.add('over'); });
}
document.addEventListener('dragleave', (ev) => {
  if (ev.relatedTarget === null) el.drop.classList.remove('over');
});
document.addEventListener('drop', (ev) => {
  ev.preventDefault();
  el.drop.classList.remove('over');
  handleFile(ev.dataTransfer?.files?.[0]);
});

el.pdfpage.addEventListener('change', async () => {
  if (!state.source) return;
  await state.source.selectPage(+el.pdfpage.value);
  el.filenote.textContent = `PDF · ${state.source.resolutionNote}`;
  setPlacement(fitPlacement(layout, state.source, state.placement?.rot ?? 0, 'contain'));
  render();
});

// Registered first so the value is on-grid before relayout() reads it.
for (const slider of [el.margin, el.overlap]) {
  slider.addEventListener('input', () => {
    const grid = sliderGrid();
    slider.value = Math.round(+slider.value / grid) * grid;
  });
}

for (const input of [el.cols, el.rows, el.preset, el.customW, el.customH, el.margin, el.overlap]) {
  input.addEventListener('input', relayout);
}

el.units.addEventListener('click', (ev) => {
  const button = ev.target.closest('button');
  if (!button || button.classList.contains('on')) return;
  for (const b of el.units.children) {
    const on = b === button;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  state.units = button.dataset.value;
  applyUnits();   // rewrites the inputs in the new unit before they are re-read
  relayout();
});

el.orientation.addEventListener('click', (ev) => {
  const button = ev.target.closest('button');
  if (!button) return;
  for (const b of el.orientation.children) {
    const on = b === button;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  relayout();
});

el.fit.addEventListener('click', () => withSource(() => setPlacement(fitPlacement(layout, state.source, state.placement.rot, 'contain'))));
el.fill.addEventListener('click', () => withSource(() => setPlacement(fitPlacement(layout, state.source, state.placement.rot, 'cover'))));
el.center.addEventListener('click', () => withSource(() => setPlacement({ ...state.placement, cx: layout.posterW / 2, cy: layout.posterH / 2 })));
el.rotL.addEventListener('click', () => withSource(() => rotate(-90)));
el.rotR.addEventListener('click', () => withSource(() => rotate(90)));

function rotate(delta) {
  const p = state.placement;
  const rot = p.rot + delta;
  // Keep the visual footprint: the bounding box swaps width and height.
  setPlacement({ cx: p.cx, cy: p.cy, w: p.h, h: p.w, rot });
}

el.scale.addEventListener('input', () => withSource(() => {
  const fit = fitPlacement(layout, state.source, state.placement.rot, 'contain');
  setPlacement({ ...state.placement, w: (fit.w * +el.scale.value) / 100 });
}));

el.artW.addEventListener('input', () => withSource(() => {
  const w = unit().fromBig(+el.artW.value);
  if (w > 0) setPlacement({ ...state.placement, w });
}));
el.artH.addEventListener('input', () => withSource(() => {
  const h = unit().fromBig(+el.artH.value);
  if (h > 0) setPlacement({ ...state.placement, w: h * placedAspect(state.source, state.placement.rot) });
}));

function withSource(fn) {
  if (!state.source || !state.placement) return;
  fn();
  render();
}

el.showGrid.addEventListener('change', () => { state.showGrid = el.showGrid.checked; render(); });
el.dpi.addEventListener('change', syncReadouts);
el.quality.addEventListener('input', () => { el.qualityVal.textContent = `${el.quality.value}%`; });
el.format.addEventListener('change', () => {
  const png = el.format.value === 'image/png';
  el.qualityField.hidden = png;
  el.transparentField.hidden = !png;
});
el.exportBtn.addEventListener('click', exportPdf);

new ResizeObserver(render).observe(el.canvaswrap);

/* ---------------------------------------------------------------- helpers */

function localPoint(ev) {
  const rect = el.canvas.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Round to at most `places` decimals and drop trailing zeros: 8.50 -> "8.5". */
const num = (v, places = 1) => String(Math.round(v * 10 ** places) / 10 ** places);

let toastTimer;
function showToast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 8000);
}
function hideToast() { el.toast.hidden = true; }

applyUnits();
readConfig();
layout = computeLayout(state.cfg);
render();
