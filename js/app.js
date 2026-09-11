// UI state, pointer interaction and wiring.

import { PAGE_PRESETS, computeLayout, fitPlacement, placedAspect, placementRect } from './layout.js';
import { loadSource } from './source.js';
import { drawPreview, computeView, viewToPoster, handlePoints, blankTiles, refreshTheme } from './renderer.js';

const HANDLE_REACH = 12;
import { buildPosterPdf } from './exporter.js';

const $ = (id) => document.getElementById(id);

const el = {
  drop: $('drop'), file: $('file'), filemeta: $('filemeta'), filename: $('filename'),
  filenote: $('filenote'), pagerow: $('pagerow'), pdfpage: $('pdfpage'), clear: $('clear'),
  cols: $('cols'), rows: $('rows'), preset: $('preset'), customsize: $('customsize'),
  customW: $('customW'), customH: $('customH'), orientation: $('orientation'),
  units: $('units'), customWLabel: $('customWLabel'), customHLabel: $('customHLabel'),
  artWLabel: $('artWLabel'), artHLabel: $('artHLabel'),
  margin: $('margin'), marginNum: $('marginNum'), marginUnit: $('marginUnit'),
  overlap: $('overlap'), overlapNum: $('overlapNum'), overlapUnit: $('overlapUnit'),
  posterReadout: $('posterReadout'),
  fit: $('fit'), fill: $('fill'), center: $('center'), rotL: $('rotL'), rotR: $('rotR'),
  scale: $('scale'), scaleNum: $('scaleNum'), artW: $('artW'), artH: $('artH'), artReadout: $('artReadout'),
  lockAspect: $('lockAspect'),
  dpi: $('dpi'), format: $('format'), quality: $('quality'), qualityVal: $('qualityVal'),
  qualityField: $('qualityField'), transparentField: $('transparentField'), transparent: $('transparent'),
  marks: $('marks'), labels: $('labels'), assembly: $('assembly'),
  outputReadout: $('outputReadout'), exportBtn: $('export'),
  progress: $('progress'), bar: $('bar'), progressText: $('progressText'),
  showGrid: $('showGrid'), stagehint: $('stagehint'),
  canvas: $('preview'), canvaswrap: $('canvaswrap'), toast: $('toast'),
  toastText: $('toastText'), toastClose: $('toastClose'), emptystate: $('emptystate'),
};

const state = {
  source: null,
  placement: null,
  showGrid: true,
  busy: false,
  units: 'mm',
  lockAspect: true,
  cfg: {
    preset: 'a4', orientation: 'portrait',
    cols: 2, rows: 3,
    margin: 10, overlap: 0,
    customW: 210, customH: 297,
  },
};

let layout = computeLayout(state.cfg);

/**
 * Undo history for the placement. Direct manipulation without an undo is a trap:
 * one stray drag destroys a careful composition and the only way back is by eye.
 * Entries are pushed at the end of a gesture, never during one, so a drag is a
 * single step rather than a hundred.
 */
const history = { past: [], future: [], limit: 50 };

function commit() {
  if (!state.placement) return;
  const last = history.past[history.past.length - 1];
  const now = JSON.stringify(state.placement);
  if (last === now) return;
  history.past.push(now);
  if (history.past.length > history.limit) history.past.shift();
  history.future.length = 0;
}

function resetHistory() {
  history.past.length = 0;
  history.future.length = 0;
  commit();
}

function step(from, to) {
  if (from.length < 2) return false;
  to.push(from.pop());
  state.placement = JSON.parse(from[from.length - 1]);
  render();
  return true;
}

const undo = () => step(history.past, history.future);

function redo() {
  if (!history.future.length) return false;
  const entry = history.future.pop();
  history.past.push(entry);
  state.placement = JSON.parse(entry);
  render();
  return true;
}

/* ------------------------------------------------------------------ setup */

/**
 * Display units. Geometry is always stored in millimeters; these only convert
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
 * Step size for the margin and overlap sliders, in millimeters: half a
 * millimeter, or a sixteenth of an inch so imperial users land on 1/4" and 1/2"
 * exactly. The sliders carry step="any" and are quantized here instead, because
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
  clearProgress();
  const before = layout;
  const aspect = state.placement ? activeAspect() : 1;
  const fraction = state.placement && {
    fx: state.placement.cx / before.posterW,
    fy: state.placement.cy / before.posterH,
    fw: state.placement.w / fitPlacement(before, state.source, state.placement.rot, 'contain', aspect).w,
  };

  readConfig();
  layout = computeLayout(state.cfg);

  if (state.placement && fraction) {
    const fit = fitPlacement(layout, state.source, state.placement.rot, 'contain', aspect);
    const w = fit.w * fraction.fw;
    setPlacement({
      ...state.placement,
      cx: fraction.fx * layout.posterW,
      cy: fraction.fy * layout.posterH,
      w,
      h: w / aspect,
    });
  }
  render();
}

const MIN_SIZE = 5;
const MAX_SIZE = 40000;

function setPlacement(next) {
  const rot = ((next.rot % 360) + 360) % 360;
  const w = clamp(next.w, MIN_SIZE, MAX_SIZE);
  // With the ratio locked, the height always follows the artwork's own ratio.
  // With the ratio free, the caller owns both dimensions.
  const h = state.lockAspect
    ? w / placedAspect(state.source, rot)
    : clamp(next.h, MIN_SIZE, MAX_SIZE);
  state.placement = { cx: next.cx, cy: next.cy, w, h, rot };
}

/**
 * The ratio that a fit or a scale must keep. With the lock on this is the ratio
 * of the artwork. With the lock off the box keeps the shape it has now, thus a
 * fit or a layout change does not undo a deliberate stretch.
 */
function activeAspect(rot = state.placement?.rot ?? 0) {
  if (state.lockAspect || !state.placement) return placedAspect(state.source, rot);
  return state.placement.w / state.placement.h;
}

/** How far the box is from the artwork's own ratio. 1 means no stretch. */
function stretchFactor() {
  const p = state.placement;
  return p.w / p.h / placedAspect(state.source, p.rot);
}

/* ----------------------------------------------------------------- render */

/** Clear export feedback: a bar left at 100% stops being feedback. */
let progressTimer;
function clearProgress() {
  clearTimeout(progressTimer);
  el.progress.hidden = true;
  el.bar.style.width = '0%';
  el.progressText.textContent = '';
}

function render() {
  drawPreview(el.canvas, {
    source: state.source,
    placement: state.placement,
    layout,
    showGrid: state.showGrid,
    // Blank-sheet hatching is a sheet-level annotation, so it follows the same
    // toggle. Unchecking the grid gives a clean look at the artwork.
    markBlank: state.showGrid,
    freeAspect: !state.lockAspect,
  });
  syncReadouts();
}

function syncReadouts() {
  const u = unit();
  const len = (mm) => `${num(u.toLen(mm), u.lenPlaces)} ${u.len}`;
  const big = (mm) => num(u.toBig(mm), u.bigPlaces);

  el.marginUnit.textContent = u.len;
  el.overlapUnit.textContent = u.len;
  setNum(el.marginNum, u.toLen(layout.margin), u.lenPlaces);
  setNum(el.overlapNum, u.toLen(layout.overlap), u.lenPlaces);

  const sheets = layout.cols * layout.rows;
  el.posterReadout.innerHTML =
    `Finished poster <b>${big(layout.posterW)} × ${big(layout.posterH)} ${u.big}</b> ` +
    `on <b>${sheets}</b> sheet${sheets === 1 ? '' : 's'}.<br>` +
    `Printable area per sheet ${len(layout.printW)} × ${len(layout.printH)}.`;

  if (state.placement) {
    const p = state.placement;
    el.scale.value = clamp(scalePercent(), 5, 400);
    setNum(el.scaleNum, scalePercent(), 0);
    if (document.activeElement !== el.artW) el.artW.value = big(p.w);
    if (document.activeElement !== el.artH) el.artH.value = big(p.h);

    const swapped = p.rot % 180 !== 0;
    const across = swapped ? state.source.height : state.source.width;
    const down = swapped ? state.source.width : state.source.height;
    // A stretched box has a different resolution on each axis. Report the weaker one.
    const dpi = Math.min(across / (p.w / 25.4), down / (p.h / 25.4));
    const quality = state.source.kind === 'pdf'
      ? 'vector artwork — sharp at any size'
      : `${Math.round(dpi)} dpi effective${dpi < 150 ? ' <span class="warn">(soft in print)</span>' : ''}`;
    const stretch = stretchFactor();
    const stretched = Math.abs(stretch - 1) > 0.002
      ? ` <span class="warn">Stretched ${stretch > 1 ? '+' : '−'}${(Math.abs(stretch - 1) * 100).toFixed(1)}% from the original ratio.</span>`
      : '';
    el.artReadout.innerHTML =
      `Artwork <b>${big(p.w)} × ${big(p.h)} ${u.big}</b>${p.rot ? `, rotated ${p.rot}°` : ''}.<br>${quality}${stretched}`;
    el.stagehint.textContent =
      `${state.source.name} · ${big(p.w)} × ${big(p.h)} ${u.big} on a ${big(layout.posterW)} × ${big(layout.posterH)} ${u.big} poster`;
  } else {
    el.stagehint.textContent = 'No artwork loaded';
    el.artReadout.textContent = 'Drag on the canvas to move · handles resize · arrow keys nudge.';
  }

  const dpi = +el.dpi.value;
  const tw = Math.round((layout.pageW / 25.4) * dpi);
  const th = Math.round((layout.pageH / 25.4) * dpi);
  const mp = (tw * th) / 1e6;
  const blank = state.placement ? blankTiles(layout, state.placement) : [];
  el.outputReadout.innerHTML =
    `Each sheet rasterizes to <b>${tw} × ${th} px</b> (${mp.toFixed(1)} MP).` +
    (mp > 80 ? ' <span class="warn">Large — lower the dpi if your browser runs out of memory.</span>' : '') +
    (blank.length ? `<br><span class="warn">${blank.length} sheet${blank.length === 1 ? '' : 's'} print blank: ${blank.join(', ')}.</span>` : '');

  const ready = !!state.source;
  el.exportBtn.disabled = !ready || state.busy;
  el.exportBtn.textContent = ready
    ? `Generate poster PDF · ${sheets} sheet${sheets === 1 ? '' : 's'}`
    : 'Add artwork to export';
  el.emptystate.hidden = ready;
  el.canvas.setAttribute('aria-label', ready
    ? `Poster preview. ${state.source.name}, ${big(state.placement.w)} by ${big(state.placement.h)} ${u.big}, `
      + `on a ${big(layout.posterW)} by ${big(layout.posterH)} ${u.big} poster of ${sheets} sheets.`
    : 'Poster preview. No artwork loaded.');
}

function scalePercent() {
  const fit = fitPlacement(layout, state.source, state.placement.rot, 'contain', activeAspect());
  return (state.placement.w / fit.w) * 100;
}

/* ------------------------------------------------------------ file loading */

async function handleFile(file) {
  if (!file) return;
  try {
    setDragging(false);
    hideToast();
    state.source?.dispose?.();
    state.source = null;
    state.placement = null;
    el.stagehint.textContent = 'Loading…';

    const source = await loadSource(file, (msg) => { el.stagehint.textContent = msg; });
    state.source = source;
    setPlacement(fitPlacement(layout, source, 0, 'contain'));
    resetHistory();
    clearProgress();

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
  resetHistory();
  clearProgress();
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
  for (const handle of handlePoints(dest, !state.lockAspect)) {
    // Tolerance, not the drawn size: a 9px handle with a 12px reach is a 24px
    // target, which is the WCAG 2.5.8 minimum, without looking heavy.
    if (Math.abs(px - handle.x) <= HANDLE_REACH && Math.abs(py - handle.y) <= HANDLE_REACH) {
      return { mode: 'resize', handle };
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
  el.canvas.style.cursor = !hit ? 'default' : hit.mode === 'move' ? 'grab' : hit.handle.cursor;
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
    // Resize away from the anchor, which is the opposite corner or edge.
    const { handle } = drag;
    const anchor = viewToPoster(drag.view, handle.anchor[0], handle.anchor[1]);
    const reachX = Math.abs(now.x - anchor.x);
    const reachY = Math.abs(now.y - anchor.y);
    let w;
    let h;

    if (state.lockAspect) {
      // Both axes move together, so the corner follows whichever axis reaches further.
      const aspect = placedAspect(state.source, drag.origin.rot);
      w = Math.max(reachX, reachY * aspect);
      h = w / aspect;
    } else {
      // An edge handle leaves its other axis exactly as it was.
      w = handle.ax ? reachX : drag.origin.w;
      h = handle.ay ? reachY : drag.origin.h;
    }

    setPlacement({
      ...drag.origin,
      w,
      h,
      cx: handle.ax ? anchor.x + (handle.sx * w) / 2 : drag.origin.cx,
      cy: handle.ay ? anchor.y + (handle.sy * h) / 2 : drag.origin.cy,
    });
  }
  render();
});

for (const type of ['pointerup', 'pointercancel']) {
  el.canvas.addEventListener(type, (ev) => {
    if (!drag) return;
    drag = null;
    el.canvas.classList.remove('grabbing');
    el.canvas.releasePointerCapture?.(ev.pointerId);
    commit();
    render();
  });
}

let nudgeTimer;

window.addEventListener('keydown', (ev) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);

  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
    if (typing) return;   // let the field handle its own undo
    ev.preventDefault();
    (ev.shiftKey ? redo : undo)();
    return;
  }

  if (!state.placement || typing) return;
  const distance = ev.shiftKey ? 10 : 1;
  const moves = { ArrowLeft: [-distance, 0], ArrowRight: [distance, 0], ArrowUp: [0, -distance], ArrowDown: [0, distance] };
  const move = moves[ev.key];
  if (!move) return;
  ev.preventDefault();
  setPlacement({ ...state.placement, cx: state.placement.cx + move[0], cy: state.placement.cy + move[1] });
  render();
  // A run of arrow presses is one undo step, the same as one drag.
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(commit, 400);
});

/* ----------------------------------------------------------------- export */

async function exportPdf() {
  if (!state.source || state.busy) return;
  state.busy = true;
  hideToast();
  el.progress.hidden = false;
  el.exportBtn.disabled = true;

  clearTimeout(progressTimer);
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
    const filename = `${base}-poster-${layout.cols}x${layout.rows}.pdf`;
    download(new Blob([bytes], { type: 'application/pdf' }), filename);
    const count = layout.tiles.length;
    onProgress(1, `Saved ${filename} · ${count} sheet${count === 1 ? '' : 's'}`);
    progressTimer = setTimeout(clearProgress, 6000);
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

// A drop anywhere on the page works, so the stage lights up too. Highlighting
// only the sidebar put the feedback hundreds of pixels from the cursor.
const setDragging = (on) => {
  el.drop.classList.toggle('over', on);
  el.canvaswrap.classList.toggle('over', on);
};

for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (ev) => { ev.preventDefault(); setDragging(true); });
}
document.addEventListener('dragleave', (ev) => {
  if (ev.relatedTarget === null) setDragging(false);
});
document.addEventListener('drop', (ev) => {
  ev.preventDefault();
  setDragging(false);
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

// Typing a number moves the slider. These are print measurements with exact
// intended values, so dragging for "12 mm" was never good enough.
for (const [numInput, slider] of [[el.marginNum, el.margin], [el.overlapNum, el.overlap]]) {
  numInput.addEventListener('input', () => {
    const mm = unit().fromLen(+numInput.value);
    if (!Number.isFinite(mm)) return;
    slider.value = clamp(mm, +slider.min, +slider.max);
    relayout();
  });
}

el.scaleNum.addEventListener('input', () => withSource(() => {
  const percent = clamp(+el.scaleNum.value, 5, 400);
  if (!Number.isFinite(percent)) return;
  el.scale.value = percent;
  const aspect = activeAspect();
  const fit = fitPlacement(layout, state.source, state.placement.rot, 'contain', aspect);
  const w = (fit.w * percent) / 100;
  setPlacement({ ...state.placement, w, h: w / aspect });
  commit();
}));

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

el.fit.addEventListener('click', () => withSource(() =>
  setPlacement(fitPlacement(layout, state.source, state.placement.rot, 'contain', activeAspect()))));
el.fill.addEventListener('click', () => withSource(() =>
  setPlacement(fitPlacement(layout, state.source, state.placement.rot, 'cover', activeAspect()))));
el.center.addEventListener('click', () => withSource(() => setPlacement({ ...state.placement, cx: layout.posterW / 2, cy: layout.posterH / 2 })));
el.rotL.addEventListener('click', () => withSource(() => rotate(-90)));
el.rotR.addEventListener('click', () => withSource(() => rotate(90)));

function rotate(delta) {
  const p = state.placement;
  const rot = p.rot + delta;
  // Keep the visual footprint: the bounding box swaps width and height.
  setPlacement({ cx: p.cx, cy: p.cy, w: p.h, h: p.w, rot });
}

el.scale.addEventListener('change', commit);
el.scale.addEventListener('input', () => withSource(() => {
  const aspect = activeAspect();
  const fit = fitPlacement(layout, state.source, state.placement.rot, 'contain', aspect);
  const w = (fit.w * +el.scale.value) / 100;
  setPlacement({ ...state.placement, w, h: w / aspect });
}));

el.artW.addEventListener('change', commit);
el.artH.addEventListener('change', commit);
el.artW.addEventListener('input', () => withSource(() => {
  const w = unit().fromBig(+el.artW.value);
  if (w > 0) setPlacement({ ...state.placement, w });
}));
el.artH.addEventListener('input', () => withSource(() => {
  const h = unit().fromBig(+el.artH.value);
  if (h <= 0) return;
  // Locked, the height drives the width. Free, it stands on its own.
  setPlacement(state.lockAspect
    ? { ...state.placement, w: h * placedAspect(state.source, state.placement.rot) }
    : { ...state.placement, h });
}, { record: false }));

el.lockAspect.addEventListener('change', () => {
  state.lockAspect = el.lockAspect.checked;
  // Locking again restores the artwork's own ratio and removes any stretch.
  if (state.lockAspect && state.placement) setPlacement({ ...state.placement });
  render();
});

function withSource(fn, { record = true } = {}) {
  if (!state.source || !state.placement) return;
  fn();
  if (record) commit();
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

// The canvas palette is read from CSS custom properties and cached, so it has to
// be re-read when the OS flips between light and dark.
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  refreshTheme();
  render();
});

/* ---------------------------------------------------------------- helpers */

function localPoint(ev) {
  const rect = el.canvas.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Write a value into a number input, unless the user is editing that field. */
function setNum(input, value, places) {
  if (document.activeElement === input) return;
  input.value = num(value, places);
}
/** Round to at most `places` decimals and drop trailing zeros: 8.50 -> "8.5". */
const num = (v, places = 1) => String(Math.round(v * 10 ** places) / 10 ** places);

let toastTimer;
function showToast(message) {
  el.toastText.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 8000);
}
function hideToast() {
  clearTimeout(toastTimer);
  el.toast.hidden = true;
}
el.toastClose.addEventListener('click', hideToast);

applyUnits();
readConfig();
layout = computeLayout(state.cfg);
render();
