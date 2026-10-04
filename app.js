/* ─────────────────────────────────────────────────────────
   Panel — a private food & macro log
   No server, no account. Data lives in this browser.
   ───────────────────────────────────────────────────────── */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KEY = 'panel.v1';

/* storage with an in-memory fallback so the app still works
   in sandboxes where localStorage is blocked */
const mem = {};
const store = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return mem[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch { delete mem[k]; } }
};

let S = store.get(KEY);
let FOODS = [];
let cursor = todayKey();

/* ── helpers ─────────────────────────────────────────── */
function todayKey(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
}
function shiftKey(k, n) { const d = new Date(k + 'T12:00:00'); d.setDate(d.getDate() + n); return todayKey(d); }
function prettyDate(k) {
  const d = new Date(k + 'T12:00:00');
  if (k === todayKey()) return 'Today';
  if (k === shiftKey(todayKey(), -1)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
const r0 = n => Math.round(n || 0);
const r1 = n => Math.round((n || 0) * 10) / 10;
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2100);
}

/* ── targets ─────────────────────────────────────────── */
function computeTargets(p) {
  const bmr = 10 * p.w + 6.25 * p.h - 5 * p.age + (p.sex === 'm' ? 5 : -161);
  const tdee = bmr * p.act;
  const floor = Math.max(p.sex === 'm' ? 1500 : 1200, Math.round(bmr));
  let kcal = Math.round(tdee + p.goal);
  const floored = kcal < floor;
  if (floored) kcal = floor;

  let pr = Math.round(1.8 * p.w);              // protein, g/kg bodyweight
  let ft = Math.round((kcal * 0.27) / 9);       // fat, ~27% of energy
  let cb = Math.round((kcal - pr * 4 - ft * 9) / 4);
  if (cb < 50) { cb = 50; ft = Math.max(30, Math.round((kcal - pr * 4 - cb * 4) / 9)); }

  return { k: kcal, p: pr, c: cb, f: ft, custom: false, bmr: Math.round(bmr), tdee: Math.round(tdee), floored };
}

function targetsNote() {
  const t = S.targets, p = S.profile;
  if (t.custom) return 'These are your own numbers. “Recalculate” will overwrite them.';
  let s = `At rest you burn about ${t.bmr} kcal; with your activity, roughly ${t.tdee} a day. `;
  s += p.goal === 0 ? 'Your target matches that.' :
       p.goal < 0 ? `Your target sits ${t.tdee - t.k} below it.` :
                    `Your target sits ${t.k - t.tdee} above it.`;
  if (t.floored) s += ' It was raised to your resting rate — eating below that long-term tends to backfire.';
  return s + ' Edit any field to override.';
}

/* ── food maths ──────────────────────────────────────── */
function computeMacros(food, amt, unitIdx) {
  let factor;
  if (food.basis === 'portion') factor = amt;
  else {
    const grams = unitIdx > 0 ? amt * food.u[unitIdx - 1].g : amt;
    factor = grams / 100;
  }
  return { k: food.k * factor, p: food.pr * factor, c: food.cb * factor, f: food.ft * factor };
}
function amountLabel(food, amt, unitIdx) {
  if (food.basis === 'portion') return `${r1(amt)} × portion`;
  if (unitIdx > 0) return `${r1(amt)} × ${food.u[unitIdx - 1].l}`;
  return `${r0(amt)} g`;
}

/* ── day totals ──────────────────────────────────────── */
const dayEntries = k => S.days[k] || [];
function dayTotals(k) {
  return dayEntries(k).reduce((a, e) => ({ k: a.k + e.k, p: a.p + e.p, c: a.c + e.c, f: a.f + e.f }),
    { k: 0, p: 0, c: 0, f: 0 });
}

/* ═══════════════ ONBOARDING ═══════════════ */
function segInit(root) {
  $$('button', root).forEach(b => b.onclick = () => {
    $$('button', root).forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    root.dispatchEvent(new CustomEvent('pick', { detail: b.dataset.v }));
  });
}
const segVal = root => $('button.on', root)?.dataset.v;

function initSetup() {
  ['#s-sex', '#s-activity', '#s-goal'].forEach(s => segInit($(s)));
  $('#s-go').onclick = () => {
    const age = +$('#s-age').value, h = +$('#s-height').value, w = +$('#s-weight').value;
    if (!(age >= 14 && age <= 99)) return toast('Age needs to be between 14 and 99');
    if (!(h >= 120 && h <= 230)) return toast('Height in centimetres, please');
    if (!(w >= 30 && w <= 250)) return toast('Weight in kilograms, please');
    const profile = {
      name: $('#s-name').value.trim(), sex: segVal($('#s-sex')), age, h, w,
      act: +segVal($('#s-activity')), goal: +segVal($('#s-goal'))
    };
    S = {
      profile, targets: computeTargets(profile),
      days: {}, weights: { [todayKey()]: w },
      custom: [], saved: [], recent: [],
      ai: { provider: 'anthropic', model: 'claude-sonnet-5', key: '' }
    };
    save(); $('#setup').classList.add('hidden'); startApp();
  };
}
function save() { store.set(KEY, S); }

/* ═══════════════ VIEWS ═══════════════ */
function showView(v) {
  ['today', 'weight', 'more'].forEach(x => $('#view-' + x).classList.toggle('hidden', x !== v));
  $$('.tabs button[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  window.scrollTo(0, 0);
  if (v === 'weight') renderWeight();
  if (v === 'more') renderSettings();
}

/* ── today ── */
function renderToday() {
  $('#today-date').textContent = prettyDate(cursor);
  $('#today-eyebrow').textContent = S.profile.name ? S.profile.name : 'Log';
  $('#day-next').disabled = cursor >= todayKey();
  $('#day-next').style.opacity = cursor >= todayKey() ? .35 : 1;

  const t = dayTotals(cursor), g = S.targets;
  $('#panel-sub').textContent = new Date(cursor + 'T12:00:00')
    .toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  $('#cal-num').textContent = r0(t.k);
  $('#cal-sub').textContent = `of ${g.k} target`;
  const pct = g.k ? t.k / g.k : 0;
  const cm = $('#cal-meter');
  cm.style.width = Math.min(100, pct * 100) + '%';
  cm.classList.toggle('over', pct > 1.02);

  [['p', 'p'], ['c', 'c'], ['f', 'f']].forEach(([id, key]) => {
    $('#m-' + id).textContent = r0(t[key]) + ' g';
    $('#m-' + id + '-target').textContent = g[key] + ' g';
    $('#m-' + id + '-bar').style.width = Math.min(100, (t[key] / g[key]) * 100) + '%';
  });

  const left = g.k - t.k;
  $('#remain-txt').textContent = t.k === 0
    ? 'Nothing logged yet.'
    : left >= 0
      ? `${r0(left)} kcal and ${Math.max(0, r0(g.p - t.p))} g of protein still to go.`
      : `${r0(-left)} kcal over. One day is one day.`;

  const wrap = $('#meals'); wrap.innerHTML = '';
  ['Breakfast', 'Lunch', 'Dinner', 'Snack'].forEach(meal => {
    const items = dayEntries(cursor).filter(e => e.meal === meal);
    const kc = items.reduce((a, e) => a + e.k, 0);
    const sec = document.createElement('div');
    sec.className = 'meal';
    sec.innerHTML = `<div class="meal-head"><h3>${meal}</h3><span>${kc
      ? r0(kc) + ' kcal <button class="save-meal">save as…</button>' : ''}</span></div>`;
    const sm = $('.save-meal', sec);
    if (sm) sm.onclick = ev => { ev.stopPropagation(); saveMealAs(meal, items); };
    if (!items.length) {
      sec.insertAdjacentHTML('beforeend', `<p class="meal-empty">Nothing here yet</p>`);
    } else {
      items.forEach(e => {
        const b = document.createElement('button');
        b.className = 'entry';
        b.innerHTML =
          `<div class="entry-name">${esc(e.food.n)}</div><div class="entry-k">${r0(e.k)}</div>` +
          `<div class="entry-sub">${esc(e.food.br ? e.food.br + ' · ' : '')}${amountLabel(e.food, e.amt, e.unitIdx)}</div>` +
          `<div class="entry-macros">P ${r0(e.p)} · C ${r0(e.c)} · F ${r0(e.f)}</div>`;
        b.onclick = () => openPortion(e.food, e.meal, e);
        sec.appendChild(b);
      });
    }
    wrap.appendChild(sec);
  });
}

/* ── weight ── */
function renderWeight() {
  const rows = Object.entries(S.weights).sort((a, b) => a[0] < b[0] ? -1 : 1);
  const latest = rows.at(-1);
  $('#wt-latest').textContent = latest ? r1(latest[1]) + ' kg' : '—';

  const last7 = rows.slice(-7);
  const avg = last7.length ? last7.reduce((a, r) => a + r[1], 0) / last7.length : null;
  $('#wt-avg').textContent = avg ? r1(avg) + ' kg' : '—';

  // weekly rate from a least-squares fit over the last 28 days
  const recent = rows.slice(-28);
  let rate = null;
  if (recent.length >= 4) {
    const t0 = new Date(recent[0][0] + 'T12:00:00').getTime();
    const xs = recent.map(r => (new Date(r[0] + 'T12:00:00').getTime() - t0) / 864e5);
    const ys = recent.map(r => r[1]);
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    if (den > 0) rate = (num / den) * 7;
  }
  const rEl = $('#wt-delta');
  rEl.textContent = rate === null ? '—' : (rate >= 0 ? '+' : '') + r1(rate) + ' kg';
  rEl.style.color = rate === null ? '' : Math.abs(rate) < 0.05 ? 'var(--ink2)' : rate < 0 ? 'var(--olive)' : 'var(--ble)';

  drawChart(rows.slice(-90));

  const list = $('#wt-list');
  list.innerHTML = '';
  $('#wt-list-card').classList.toggle('hidden', !rows.length);
  rows.slice().reverse().slice(0, 40).forEach(([d, kg]) => {
    const row = document.createElement('div');
    row.className = 'wt-row';
    row.innerHTML = `<span>${prettyDate(d)}</span><span><strong>${r1(kg)} kg</strong> <button aria-label="Delete">×</button></span>`;
    $('button', row).onclick = () => { delete S.weights[d]; save(); renderWeight(); };
    list.appendChild(row);
  });
  $('#wt-date').value ||= todayKey();
}

function drawChart(rows) {
  const el = $('#wt-chart');
  if (rows.length < 2) { el.innerHTML = `<p class="empty">Two weigh-ins and a line appears.</p>`; return; }
  const W = 320, H = 130, PAD = 8;
  const t0 = new Date(rows[0][0] + 'T12:00:00').getTime();
  const t1 = new Date(rows.at(-1)[0] + 'T12:00:00').getTime();
  const span = Math.max(1, t1 - t0);
  const ys = rows.map(r => r[1]);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1) { const m = (hi + lo) / 2; lo = m - .5; hi = m + .5; }
  const px = d => PAD + ((new Date(d + 'T12:00:00').getTime() - t0) / span) * (W - PAD * 2);
  const py = v => H - PAD - ((v - lo) / (hi - lo)) * (H - PAD * 2);

  // 7-point trailing mean
  const ma = rows.map((_, i) => {
    const w = rows.slice(Math.max(0, i - 6), i + 1);
    return w.reduce((a, r) => a + r[1], 0) / w.length;
  });
  const line = ma.map((v, i) => `${i ? 'L' : 'M'}${px(rows[i][0]).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const dots = rows.map(r => `<circle cx="${px(r[0]).toFixed(1)}" cy="${py(r[1]).toFixed(1)}" r="2.2" fill="var(--ink3)"/>`).join('');

  el.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight trend">
      <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="var(--line)" stroke-width="1"/>
      ${dots}
      <path d="${line}" fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <text x="${PAD}" y="12" font-size="10" fill="var(--ink3)" font-weight="700">${r1(hi)}</text>
      <text x="${PAD}" y="${H - PAD - 4}" font-size="10" fill="var(--ink3)" font-weight="700">${r1(lo)}</text>
    </svg>`;
}

/* ── settings ── */
function renderSettings() {
  const t = S.targets, p = S.profile;
  $('#t-kcal').value = t.k; $('#t-p').value = t.p; $('#t-c').value = t.c; $('#t-f').value = t.f;
  $('#t-explain').textContent = targetsNote();
  $('#p-age').value = p.age; $('#p-height').value = p.h; $('#p-weight').value = p.w;
  $('#p-sex').value = p.sex; $('#p-activity').value = p.act; $('#p-goal').value = p.goal;
  $('#ai-provider').value = S.ai.provider; $('#ai-model').value = S.ai.model;
  $('#ai-key').value = S.ai.key ? '••••••••••••' : '';
  $('#ai-status').textContent = S.ai.key ? 'Key saved in this browser.' : 'No key yet — photo scanning is off.';

  $('#saved-card').classList.toggle('hidden', !S.saved.length);
  const sm = $('#saved-manage'); sm.innerHTML = '';
  S.saved.forEach(m => {
    const t = mealTotals(m);
    const row = document.createElement('button');
    row.className = 'wt-row tappable';
    row.innerHTML = `<span>${esc(m.name)}<br><span class="res-s">P ${r0(t.p)} · C ${r0(t.c)} · F ${r0(t.f)} · ${m.items.length} items</span></span>` +
                    `<span><strong>${r0(t.k)} kcal</strong> <span class="chev">›</span></span>`;
    row.onclick = () => openMealEditor(m);
    sm.appendChild(row);
  });

  renderMyFoods();
}

function renderMyFoods(filter = '') {
  $('#myfoods-card').classList.toggle('hidden', !S.custom.length);
  const box = $('#myfoods-list'); box.innerHTML = '';
  const nq = normalise(filter);
  const list = nq ? S.custom.filter(f => normalise(f.n).includes(nq)) : S.custom;
  if (!list.length) { box.innerHTML = `<p class="empty">Nothing matches.</p>`; return; }
  list.forEach(f => {
    const row = document.createElement('button');
    row.className = 'wt-row tappable';
    row.innerHTML = `<span>${esc(f.n)}<br><span class="res-s">${f.basis === 'portion' ? 'per portion' : 'per 100 g'} · P ${r1(f.pr)} · C ${r1(f.cb)} · F ${r1(f.ft)}</span></span>` +
                    `<span><strong>${r0(f.k)} kcal</strong> <span class="chev">›</span></span>`;
    row.onclick = () => openFoodEditor(f);
    box.appendChild(row);
  });
}

function mealTotals(m) {
  return m.items.reduce((a, it) => {
    const x = computeMacros(it.food, it.amt, it.unitIdx);
    return { k: a.k + x.k, p: a.p + x.p, c: a.c + x.c, f: a.f + x.f };
  }, { k: 0, p: 0, c: 0, f: 0 });
}

/* ═══════════════ ADD SHEET ═══════════════ */
let sheetMeal = 'Breakfast';

function guessMeal() {
  const h = new Date().getHours();
  return h < 11 ? 'Breakfast' : h < 15 ? 'Lunch' : h < 18 ? 'Snack' : 'Dinner';
}
function openSheet() {
  sheetMeal = guessMeal();
  $$('#meal-pick button').forEach(b => b.classList.toggle('on', b.dataset.v === sheetMeal));
  $('#sheet .sheet-head .eyebrow').textContent = 'Add to';
  $('#meal-pick').classList.remove('hidden');
  $('#q').value = '';
  setMode('search');
  $('#sheet').classList.remove('hidden');
  renderSaved(); runSearch('');
}
function closeSheet() { $('#sheet').classList.add('hidden'); stopScan(); addingToMeal = null; }

function setMode(m) {
  $$('#add-mode button').forEach(b => b.classList.toggle('on', b.dataset.v === m));
  ['search', 'barcode', 'photo', 'manual'].forEach(x => $('#mode-' + x).classList.toggle('hidden', x !== m));
  if (m !== 'barcode') stopScan();
}

/* ── search ── */
let searchT, searchSeq = 0;
function normalise(s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

function renderSaved() {
  const strip = $('#saved-strip');
  const items = addingToMeal
    ? S.recent.slice(0, 12).map(f => ({ t: 'food', f }))
    : [...S.saved.map(m => ({ t: 'meal', m })), ...S.recent.slice(0, 12).map(f => ({ t: 'food', f }))];
  strip.innerHTML = '';
  if (!items.length) return;
  items.forEach(it => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = it.t === 'meal' ? '⌁ ' + it.m.name : it.f.n;
    b.onclick = () => it.t === 'meal' ? addSavedMeal(it.m) : openPortion(it.f, sheetMeal);
    strip.appendChild(b);
  });
}

function localMatches(q) {
  const nq = normalise(q);
  const pool = [...S.custom.map(f => ({ ...f, src: 'yours' })), ...FOODS];
  if (!nq) return pool.slice(0, 0);
  return pool.filter(f => normalise(f.n).includes(nq) || normalise(f.g || '').includes(nq)).slice(0, 40);
}

function runSearch(q) {
  const box = $('#results');
  searchSeq++;
  const seq = searchSeq;
  const local = localMatches(q);

  if (!q) {
    box.innerHTML = `<p class="empty">Type a food, or tap a shortcut above.</p>`;
    return;
  }
  box.innerHTML = local.length
    ? `<p class="group-label">In your database</p>` + local.map((f, i) => resultHTML(f, 'L' + i)).join('')
    : `<p class="group-label">In your database</p><p class="empty">No match here — checking Open Food Facts…</p>`;
  bindResults(box, local, 'L');

  if (q.length < 3 || !navigator.onLine) return;
  clearTimeout(searchT);
  searchT = setTimeout(async () => {
    const remote = await offSearch(q);
    if (seq !== searchSeq) return;
    if (!remote.length) return;
    box.insertAdjacentHTML('beforeend',
      `<p class="group-label">Open Food Facts</p>` + remote.map((f, i) => resultHTML(f, 'R' + i)).join(''));
    bindResults(box, remote, 'R');
  }, 420);
}

function resultHTML(f, id) {
  const tag = f.src === 'off' ? '<span class="src">OFF</span>'
            : f.src === 'yours' ? '<span class="src">Yours</span>'
            : f.src === 'ai' ? '<span class="src">Est.</span>' : '';
  // photo estimates are shown as the portion seen, not per 100 g
  const sc = f.src === 'ai' ? f.grams / 100 : 1;
  const per = f.src === 'ai' ? `about ${r0(f.grams)} g on the plate`
            : f.basis === 'portion' ? 'per portion' : 'per 100 g';
  const sub = f.src === 'ai' ? '' : esc(f.br || f.g || '') + (f.br || f.g ? ' · ' : '');
  return `<button class="res" data-id="${id}">
    <div class="res-n">${tag}${esc(f.n)}</div>
    <div class="res-k">${r0(f.k * sc)}</div>
    <div class="res-s">${sub}${per}</div>
    <div class="res-m">P ${r1(f.pr * sc)} · C ${r1(f.cb * sc)} · F ${r1(f.ft * sc)}</div>
  </button>`;
}
function bindResults(box, list, prefix) {
  list.forEach((f, i) => {
    const el = $(`.res[data-id="${prefix}${i}"]`, box);
    if (el) el.onclick = () => openPortion(f, sheetMeal);
  });
}

/* ── Open Food Facts ── */
function offToFood(p) {
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n['energy_100g'] != null) kcal = n['energy_100g'] / 4.184;
  if (kcal == null || !p.product_name) return null;
  const f = {
    n: p.product_name.trim().slice(0, 70),
    br: (p.brands || '').split(',')[0].trim(),
    k: +kcal, pr: +(n.proteins_100g || 0), cb: +(n.carbohydrates_100g || 0), ft: +(n.fat_100g || 0),
    u: [], basis: 'g', src: 'off', code: p.code
  };
  const sq = parseFloat(p.serving_quantity);
  if (sq > 0 && sq < 2000) f.u.push({ l: (p.serving_size || sq + ' g').trim().slice(0, 24), g: sq });
  return f;
}
async function offSearch(q) {
  try {
    const url = 'https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=20'
      + '&fields=code,product_name,brands,nutriments,serving_quantity,serving_size'
      + '&search_terms=' + encodeURIComponent(q);
    const res = await fetch(url);
    const data = await res.json();
    return (data.products || []).map(offToFood).filter(Boolean).slice(0, 15);
  } catch { return []; }
}
async function offBarcode(code) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`
    + '?fields=code,product_name,brands,nutriments,serving_quantity,serving_size';
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 1) return null;
  return offToFood(data.product);
}

async function lookupBarcode(code) {
  code = String(code).replace(/\D/g, '');
  if (code.length < 8) return toast('That does not look like a barcode');
  $('#bc-status').innerHTML = '<span class="thinking"></span>Looking up ' + code + '…';
  $('#bc-result').innerHTML = '';
  try {
    const f = await offBarcode(code);
    if (!f) {
      $('#bc-status').textContent = `${code} is not in Open Food Facts yet. Add it manually and it will be saved to your foods.`;
      return;
    }
    $('#bc-status').textContent = 'Found it.';
    $('#bc-result').innerHTML = resultHTML(f, 'B0');
    $('.res[data-id="B0"]', $('#bc-result')).onclick = () => openPortion(f, sheetMeal);
    stopScan();
  } catch {
    $('#bc-status').textContent = 'Could not reach Open Food Facts. Check your connection.';
  }
}

/* ── barcode camera ── */
let scanStream = null, scanTimer = null;
async function startScan() {
  if (!('BarcodeDetector' in window)) {
    $('#bc-status').textContent = 'This browser cannot read barcodes from the camera. Type the number instead — Chrome on Android and Edge support the camera.';
    return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
  } catch {
    $('#bc-status').textContent = 'Camera access was refused. Allow it in your browser settings, or type the number.';
    return;
  }
  const v = $('#scan-video');
  v.srcObject = scanStream; await v.play();
  $('#scan-wrap').classList.remove('hidden');
  $('#scan-start').textContent = 'Stop camera';
  $('#bc-status').textContent = 'Hold the barcode inside the frame.';
  const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
  scanTimer = setInterval(async () => {
    try {
      const codes = await det.detect(v);
      if (codes.length) { const c = codes[0].rawValue; stopScan(); lookupBarcode(c); }
    } catch { /* frame not ready */ }
  }, 400);
}
function stopScan() {
  clearInterval(scanTimer); scanTimer = null;
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  $('#scan-wrap').classList.add('hidden');
  $('#scan-start').textContent = 'Open camera';
}

/* ── photo estimation ── */
let photoData = null;
const PROMPT = `You estimate nutrition from photographs of food.

Identify every distinct food and drink in the image. For each one estimate the portion in grams as served, then the calories and macros for that portion. Use visible references for scale: cutlery, hands, standard plate (26 cm) and glass sizes. Assume normal home cooking oil unless the dish looks deep fried or dry.

Reply with a JSON array and nothing else. No prose, no markdown fences.
Each element: {"name": string, "grams": number, "kcal": number, "protein": number, "carbs": number, "fat": number}
The macro numbers are totals for that portion, in grams. If there is no food in the image, reply with [].`;

async function estimatePhoto() {
  if (!S.ai.key) { $('#ph-status').textContent = 'Add an API key in Settings first.'; return; }
  const note = $('#ph-note').value.trim();
  $('#ph-status').innerHTML = '<span class="thinking"></span>Reading the plate…';
  $('#ph-result').innerHTML = '';
  $('#ph-go').disabled = true;

  const text = PROMPT + (note ? `\n\nThe person adds: ${note}` : '');
  try {
    const raw = S.ai.provider === 'anthropic'
      ? await callAnthropic(text, photoData)
      : await callOpenAI(text, photoData);
    const items = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (!Array.isArray(items) || !items.length) {
      $('#ph-status').textContent = 'No food recognised. Try a closer, better-lit photo.'; return;
    }
    $('#ph-status').textContent = 'An estimate, not a measurement. Tap any line to adjust before it is logged.';
    const box = $('#ph-result');
    box.innerHTML = '<p class="group-label">Estimated</p>';
    const foods = items.map(it => {
      const g = Math.max(1, +it.grams || 100);
      return {
        n: String(it.name).slice(0, 60), br: 'photo estimate',
        k: (+it.kcal || 0) * 100 / g, pr: (+it.protein || 0) * 100 / g,
        cb: (+it.carbs || 0) * 100 / g, ft: (+it.fat || 0) * 100 / g,
        u: [], basis: 'g', src: 'ai', grams: g
      };
    });
    foods.forEach((f, i) => {
      box.insertAdjacentHTML('beforeend', resultHTML(f, 'P' + i));
      $(`.res[data-id="P${i}"]`, box).onclick = () => openPortion(f, sheetMeal, null, f.grams);
    });
    const all = document.createElement('button');
    all.className = 'primary big';
    all.textContent = `Log all ${foods.length} as estimated`;
    all.onclick = () => {
      foods.forEach(f => addEntry(f, f.grams, 0, sheetMeal));
      toast('Added to ' + sheetMeal); closeSheet(); renderToday();
    };
    box.appendChild(all);
  } catch (e) {
    $('#ph-status').textContent = 'That did not work: ' + (e.message || e) + '. Check the key and model name in Settings.';
  } finally { $('#ph-go').disabled = false; }
}

async function callAnthropic(text, img) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': S.ai.key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: S.ai.model || 'claude-sonnet-5', max_tokens: 1200,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.b64 } },
        { type: 'text', text }
      ] }]
    })
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return d.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function callOpenAI(text, img) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.ai.key },
    body: JSON.stringify({
      model: S.ai.model || 'gpt-4o-mini', max_tokens: 1200,
      messages: [{ role: 'user', content: [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } }
      ] }]
    })
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return d.choices[0].message.content;
}

/* shrink before upload — keeps requests small and fast */
function readImage(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const im = new Image();
      im.onload = () => {
        const max = 1024, s = Math.min(1, max / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        const url = c.toDataURL('image/jpeg', 0.82);
        resolve({ mime: 'image/jpeg', b64: url.split(',')[1], url });
      };
      im.onerror = reject; im.src = fr.result;
    };
    fr.onerror = reject; fr.readAsDataURL(file);
  });
}

/* ═══════════════ PORTION SHEET ═══════════════ */
let po = { food: null, meal: null, editing: null };

function openPortion(food, meal, editing = null, presetAmt = null) {
  po = { food, meal, editing };
  $('#po-name').textContent = food.n;
  $('#po-brand').textContent = food.br || food.g || (food.basis === 'portion' ? 'Portion' : 'Per 100 g');

  const sel = $('#po-unit');
  sel.innerHTML = '';
  if (food.basis === 'portion') {
    sel.innerHTML = '<option value="0">portion</option>';
  } else {
    sel.innerHTML = '<option value="0">grams</option>' +
      (food.u || []).map((u, i) => `<option value="${i + 1}">${esc(u.l)}</option>`).join('');
  }
  const defIdx = editing ? editing.unitIdx : (food.basis !== 'portion' && food.u && food.u.length ? 1 : 0);
  sel.value = defIdx;
  $('#po-amt').value = editing ? r1(editing.amt)
    : presetAmt != null ? r0(presetAmt)
    : food.basis === 'portion' ? 1
    : defIdx > 0 ? 1 : 100;

  $('#po-meal').textContent = meal;
  $('#po-add').textContent = editing ? 'Save changes' : 'Add to ' + meal;
  $('#po-del').classList.toggle('hidden', !editing);
  updatePortion();
  $('#portion').classList.remove('hidden');
}
function updatePortion() {
  const amt = +$('#po-amt').value || 0, idx = +$('#po-unit').value;
  const m = computeMacros(po.food, amt, idx);
  $('#po-k').textContent = r0(m.k); $('#po-p').textContent = r0(m.p);
  $('#po-c').textContent = r0(m.c); $('#po-f').textContent = r0(m.f);
}
function closePortion() { $('#portion').classList.add('hidden'); }

function addEntry(food, amt, unitIdx, meal) {
  const clean = { n: food.n, br: food.br || '', k: food.k, pr: food.pr, cb: food.cb, ft: food.ft, u: food.u || [], basis: food.basis || 'g', g: food.g };
  const m = computeMacros(clean, amt, unitIdx);
  (S.days[cursor] ||= []).push({ id: uid(), meal, food: clean, amt, unitIdx, ...m });
  S.recent = [clean, ...S.recent.filter(f => f.n !== clean.n)].slice(0, 14);
  save();
}
function saveMealAs(meal, items) {
  const suggested = items.length === 1 ? items[0].food.n : `${meal} — ${items.length} items`;
  const name = prompt('Name this meal so you can re-log it in one tap:', suggested);
  if (!name || !name.trim()) return;
  S.saved = [{ id: uid(), name: name.trim().slice(0, 40),
               items: items.map(e => ({ food: e.food, amt: e.amt, unitIdx: e.unitIdx })) },
             ...S.saved].slice(0, 40);
  save(); toast('Saved — find it under the + button');
}

function addSavedMeal(m) {
  m.items.forEach(it => addEntry(it.food, it.amt, it.unitIdx, sheetMeal));
  toast(m.name + ' added'); closeSheet(); renderToday();
}

/* ═══════════════ MEAL PLAN ═══════════════ */
let PLAN = null;
async function planFile() {
  if (!PLAN) PLAN = await (await fetch('./plan.json')).json();
  return PLAN;
}
const planFood = f => ({
  n: f.n, br: '', k: f.k, pr: f.pr, cb: f.cb, ft: f.ft,
  u: (f.u || []).map(u => ({ ...u })), basis: f.basis || 'g', g: f.g || 'Plan'
});

function resolveItem(plan, it, useOriginal) {
  const src = plan.foods.find(f => f.n === it.f);
  if (!src) return null;
  // prefer the version in her own list, so edits flow into the meals
  const own = useOriginal ? null : S.custom.find(c => c.n === it.f);
  const food = own ? { ...own } : planFood(src);
  let unitIdx = 0;
  if (food.basis !== 'portion' && it.unit && it.unit !== 'g') {
    const i = (food.u || []).findIndex(u => u.l === it.unit);
    unitIdx = i >= 0 ? i + 1 : 0;
  }
  return { food, amt: it.amt, unitIdx };
}

async function loadPlan(force) {
  const plan = await planFile();
  let nf = 0, nm = 0;
  plan.foods.forEach(f => {
    const i = S.custom.findIndex(c => c.n === f.n);
    if (i < 0) { S.custom.push(planFood(f)); nf++; }
    else if (force) { S.custom[i] = planFood(f); nf++; }
  });
  plan.meals.forEach(m => {
    const i = S.saved.findIndex(x => x.name === m.name);
    if (i >= 0 && !force) return;
    const rec = { id: i >= 0 ? S.saved[i].id : uid(), name: m.name,
                  items: m.items.map(it => resolveItem(plan, it, force)).filter(Boolean) };
    if (i >= 0) S.saved[i] = rec; else S.saved.push(rec);
    nm++;
  });
  S.planLoaded = true;
  save();
  return { nf, nm };
}

/* ═══════════════ EDITORS ═══════════════ */
let ed = { type: null, ref: null, draft: null };
const closeEditor = () => $('#editor').classList.add('hidden');

/* ── food editor ── */
function openFoodEditor(food) {
  ed = { type: 'food', ref: food, draft: { ...food, u: (food.u || []).map(u => ({ ...u })) } };
  $('#ed-kind').textContent = 'Food';
  $('#ed-title').textContent = food.n;
  $('#ed-body').innerHTML = `
    <label class="field"><span>Name</span><input id="ef-n" type="text"></label>
    <p class="field-label">These numbers are for</p>
    <div class="seg" id="ef-basis">
      <button type="button" data-v="g">100 g</button>
      <button type="button" data-v="portion">one portion</button>
    </div>
    <div class="field-grid four" style="margin-top:12px">
      <label class="field"><span>Calories</span><input id="ef-k" type="number" inputmode="decimal" step="any"></label>
      <label class="field"><span>Protein g</span><input id="ef-p" type="number" inputmode="decimal" step="any"></label>
      <label class="field"><span>Carbs g</span><input id="ef-c" type="number" inputmode="decimal" step="any"></label>
      <label class="field"><span>Fat g</span><input id="ef-f" type="number" inputmode="decimal" step="any"></label>
    </div>
    <p class="fine" id="ef-check"></p>
    <div id="ef-unit-block">
      <p class="field-label">Portions you'd rather count than weigh</p>
      <div id="ef-units"></div>
      <button id="ef-addunit" class="ghost" style="margin-top:9px">Add a portion</button>
    </div>`;

  const d = ed.draft;
  $('#ef-n').value = d.n;
  $('#ef-k').value = d.k; $('#ef-p').value = d.pr; $('#ef-c').value = d.cb; $('#ef-f').value = d.ft;
  $$('#ef-basis button').forEach(b => b.classList.toggle('on', b.dataset.v === (d.basis || 'g')));
  segInit($('#ef-basis'));
  $('#ef-basis').addEventListener('pick', e => {
    d.basis = e.detail;
    $('#ef-unit-block').classList.toggle('hidden', d.basis === 'portion');
  });
  $('#ef-unit-block').classList.toggle('hidden', d.basis === 'portion');

  ['#ef-k', '#ef-p', '#ef-c', '#ef-f'].forEach(s => $(s).oninput = energyCheck);
  $('#ef-addunit').onclick = () => { d.u.push({ l: '', g: 100 }); drawUnits(); };
  drawUnits(); energyCheck();

  $('#ed-del').classList.remove('hidden');
  $('#ed-del').textContent = 'Delete this food';
  $('#editor').classList.remove('hidden');
}

function drawUnits() {
  const box = $('#ef-units'); box.innerHTML = '';
  ed.draft.u.forEach((u, i) => {
    const row = document.createElement('div');
    row.className = 'row-inline';
    row.innerHTML = `<input type="text" placeholder="1 scoop" value="${esc(u.l)}" style="flex:2">
                     <input type="number" inputmode="decimal" step="any" placeholder="g" value="${u.g}" style="flex:1">
                     <button class="ghost danger" aria-label="Remove" style="flex:none;padding:0 13px">×</button>`;
    const [lab, gr] = $$('input', row);
    lab.oninput = e => u.l = e.target.value;
    gr.oninput = e => u.g = +e.target.value || 0;
    $('button', row).onclick = () => { ed.draft.u.splice(i, 1); drawUnits(); };
    box.appendChild(row);
  });
}

/* flags numbers that can't both be true — a common source of silent drift */
function energyCheck() {
  const k = +$('#ef-k').value || 0, p = +$('#ef-p').value || 0,
        c = +$('#ef-c').value || 0, f = +$('#ef-f').value || 0;
  const fromMacros = p * 4 + c * 4 + f * 9;
  const el = $('#ef-check');
  if (!k || !fromMacros) { el.textContent = ''; return; }
  const diff = Math.abs(k - fromMacros) / k;
  el.textContent = diff > 0.12
    ? `Those macros work out to about ${r0(fromMacros)} kcal, not ${r0(k)}. Fibre and alcohol explain small gaps; a big one usually means a typo.`
    : '';
}

/* ── meal editor ── */
let addingToMeal = null;

function openMealEditor(meal) {
  ed = { type: 'meal', ref: meal, draft: { ...meal, items: meal.items.map(i => ({ ...i })) } };
  $('#ed-kind').textContent = 'Saved meal';
  $('#ed-title').textContent = meal.name;
  $('#ed-body').innerHTML = `
    <label class="field"><span>Name</span><input id="em-n" type="text"></label>
    <p class="field-label">What's in it</p>
    <div id="em-items"></div>
    <button id="em-add" class="ghost" style="margin-top:10px">Add a food</button>
    <div class="po-strip">
      <div><p class="po-n" id="em-k">0</p><p class="po-c">kcal</p></div>
      <div><p class="po-n" id="em-p">0</p><p class="po-c">protein</p></div>
      <div><p class="po-n" id="em-c">0</p><p class="po-c">carbs</p></div>
      <div><p class="po-n" id="em-f">0</p><p class="po-c">fat</p></div>
    </div>`;
  $('#em-n').value = ed.draft.name;
  $('#em-n').oninput = e => ed.draft.name = e.target.value;
  $('#em-add').onclick = () => {
    addingToMeal = ed.draft;
    closeEditor(); openSheet();
    $('#sheet .sheet-head .eyebrow').textContent = 'Add to “' + ed.draft.name + '”';
    $('#meal-pick').classList.add('hidden');
  };
  drawMealItems();
  $('#ed-del').classList.remove('hidden');
  $('#ed-del').textContent = 'Delete this meal';
  $('#editor').classList.remove('hidden');
}

function drawMealItems() {
  const box = $('#em-items'); box.innerHTML = '';
  if (!ed.draft.items.length) box.innerHTML = `<p class="empty">Empty. Add a food below.</p>`;
  ed.draft.items.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'em-row';
    const units = it.food.basis === 'portion'
      ? '<option value="0">portion</option>'
      : '<option value="0">grams</option>' +
        (it.food.u || []).map((u, j) => `<option value="${j + 1}">${esc(u.l)}</option>`).join('');
    row.innerHTML = `<div class="em-name">${esc(it.food.n)}</div>
      <div class="row-inline" style="margin-top:5px">
        <input type="number" inputmode="decimal" step="any" value="${r1(it.amt)}" style="flex:1">
        <select style="flex:2">${units}</select>
        <button class="ghost danger" aria-label="Remove" style="flex:none;padding:0 13px">×</button>
      </div>
      <div class="em-macros" id="em-m${i}"></div>`;
    const amt = $('input', row), sel = $('select', row);
    sel.value = it.unitIdx;
    const sync = () => {
      it.amt = +amt.value || 0; it.unitIdx = +sel.value;
      const m = computeMacros(it.food, it.amt, it.unitIdx);
      $('#em-m' + i, row).textContent = `${r0(m.k)} kcal · P ${r1(m.p)} · C ${r1(m.c)} · F ${r1(m.f)}`;
      mealTotalsUI();
    };
    amt.oninput = sync;
    sel.onchange = sync;
    $('button', row).onclick = () => { ed.draft.items.splice(i, 1); drawMealItems(); };
    box.appendChild(row);
    sync();
  });
  mealTotalsUI();
}
function mealTotalsUI() {
  const t = mealTotals(ed.draft);
  $('#em-k').textContent = r0(t.k); $('#em-p').textContent = r0(t.p);
  $('#em-c').textContent = r0(t.c); $('#em-f').textContent = r0(t.f);
}

function saveEditor() {
  if (ed.type === 'food') {
    const d = ed.draft;
    const name = $('#ef-n').value.trim();
    if (!name) return toast('Give it a name');
    const oldName = ed.ref.n;
    Object.assign(ed.ref, {
      n: name, basis: d.basis || 'g',
      k: +$('#ef-k').value || 0, pr: +$('#ef-p').value || 0,
      cb: +$('#ef-c').value || 0, ft: +$('#ef-f').value || 0,
      u: d.basis === 'portion' ? [] : d.u.filter(u => u.l.trim() && u.g > 0)
    });
    // keep saved meals pointing at the same food in step with the edit
    S.saved.forEach(m => m.items.forEach(it => {
      if (it.food.n === oldName) {
        const keepIdx = it.unitIdx > 0 ? (ed.ref.u.findIndex(u => u.l === it.food.u?.[it.unitIdx - 1]?.l) + 1) : 0;
        it.food = { ...ed.ref };
        it.unitIdx = keepIdx > 0 ? keepIdx : 0;
      }
    }));
    toast('Food updated');
  } else {
    const name = $('#em-n').value.trim();
    if (!name) return toast('Give it a name');
    ed.ref.name = name;
    ed.ref.items = ed.draft.items;
    toast('Meal updated');
  }
  save(); closeEditor(); renderSettings(); renderToday();
}

function deleteEdited() {
  if (ed.type === 'food') {
    if (!confirm(`Remove “${ed.ref.n}” from your foods? Days you've already logged keep their numbers.`)) return;
    S.custom = S.custom.filter(f => f !== ed.ref);
  } else {
    if (!confirm(`Delete the saved meal “${ed.ref.name}”?`)) return;
    S.saved = S.saved.filter(m => m.id !== ed.ref.id);
  }
  save(); closeEditor(); renderSettings();
}

/* ═══════════════ DATA ═══════════════ */
function exportJSON() {
  download(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }),
    `panel-backup-${todayKey()}.json`);
  toast('Backup saved');
}
function exportCSV() {
  const rows = [['date', 'meal', 'food', 'brand', 'amount', 'kcal', 'protein_g', 'carbs_g', 'fat_g']];
  Object.entries(S.days).sort().forEach(([d, list]) =>
    list.forEach(e => rows.push([d, e.meal, e.food.n, e.food.br || '',
      amountLabel(e.food, e.amt, e.unitIdx), r0(e.k), r1(e.p), r1(e.c), r1(e.f)])));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  download(new Blob([csv], { type: 'text/csv' }), `panel-log-${todayKey()}.csv`);
  toast('CSV saved');
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ═══════════════ WIRING ═══════════════ */
function startApp() {
  $('#app').classList.remove('hidden');
  cursor = todayKey();
  showView('today');
  renderToday();
}

function bind() {
  /* nav */
  $$('.tabs button[data-view]').forEach(b => b.onclick = () => showView(b.dataset.view));
  $('#tab-add').onclick = openSheet;
  $('#day-prev').onclick = () => { cursor = shiftKey(cursor, -1); renderToday(); };
  $('#day-next').onclick = () => { if (cursor < todayKey()) { cursor = shiftKey(cursor, 1); renderToday(); } };

  /* sheet */
  $$('[data-close]').forEach(e => e.onclick = closeSheet);
  $$('[data-close-portion]').forEach(e => e.onclick = closePortion);
  segInit($('#meal-pick'));
  $('#meal-pick').addEventListener('pick', e => { sheetMeal = e.detail; $('#po-meal').textContent = sheetMeal; });
  $$('#add-mode button').forEach(b => b.onclick = () => setMode(b.dataset.v));
  $('#q').oninput = e => runSearch(e.target.value.trim());

  /* barcode */
  $('#scan-start').onclick = () => scanStream ? stopScan() : startScan();
  $('#bc-go').onclick = () => lookupBarcode($('#bc-manual').value);
  $('#bc-manual').onkeydown = e => { if (e.key === 'Enter') lookupBarcode(e.target.value); };

  /* photo */
  $('#ph-file').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    photoData = await readImage(file);
    const img = $('#ph-preview'); img.src = photoData.url; img.classList.remove('hidden');
    $('#ph-note').classList.remove('hidden'); $('#ph-go').classList.remove('hidden');
    $('#ph-status').textContent = S.ai.key ? '' : 'Add an API key in Settings to use this.';
  };
  $('#ph-go').onclick = estimatePhoto;

  /* manual */
  segInit($('#mn-basis'));
  $('#mn-add').onclick = () => {
    const n = $('#mn-name').value.trim();
    if (!n) return toast('Give it a name');
    const per = segVal($('#mn-basis'));
    const f = {
      n, br: '', k: +$('#mn-k').value || 0, pr: +$('#mn-p').value || 0,
      cb: +$('#mn-c').value || 0, ft: +$('#mn-f').value || 0,
      u: [], basis: per === '100' ? 'g' : 'portion', g: 'Yours'
    };
    if ($('#mn-keep').checked) { S.custom = [f, ...S.custom.filter(x => x.n !== n)].slice(0, 300); save(); }
    ['#mn-name', '#mn-k', '#mn-p', '#mn-c', '#mn-f'].forEach(s => $(s).value = '');
    openPortion(f, sheetMeal);
  };

  /* portion */
  $('#po-amt').oninput = updatePortion;
  $('#po-unit').onchange = () => {
    const idx = +$('#po-unit').value;
    $('#po-amt').value = idx > 0 || po.food.basis === 'portion' ? 1 : 100;
    updatePortion();
  };
  $('#po-add').onclick = () => {
    const amt = +$('#po-amt').value || 0, idx = +$('#po-unit').value;
    if (amt <= 0) return toast('How much?');
    if (addingToMeal) {
      const f = po.food;
      addingToMeal.items.push({
        food: { n: f.n, br: f.br || '', k: f.k, pr: f.pr, cb: f.cb, ft: f.ft, u: f.u || [], basis: f.basis || 'g', g: f.g },
        amt, unitIdx: idx
      });
      const meal = addingToMeal; addingToMeal = null;
      closePortion(); closeSheet();
      const live = S.saved.find(m => m.id === meal.id);
      openMealEditor(live || meal);
      ed.draft = meal; $('#em-n').value = meal.name; drawMealItems();
      return;
    }
    if (po.editing) {
      const e = po.editing, m = computeMacros(po.food, amt, idx);
      Object.assign(e, { amt, unitIdx: idx, ...m });
      save(); toast('Updated');
    } else {
      addEntry(po.food, amt, idx, po.meal);
      toast('Added to ' + po.meal);
    }
    closePortion(); closeSheet(); renderToday();
  };
  $('#po-del').onclick = () => {
    S.days[cursor] = dayEntries(cursor).filter(x => x.id !== po.editing.id);
    save(); closePortion(); renderToday(); toast('Removed');
  };

  /* settings */
  $('#t-save').onclick = () => {
    S.targets = {
      ...S.targets, k: +$('#t-kcal').value || S.targets.k, p: +$('#t-p').value || 0,
      c: +$('#t-c').value || 0, f: +$('#t-f').value || 0, custom: true
    };
    save(); renderSettings(); renderToday(); toast('Targets saved');
  };
  $('#t-recalc').onclick = () => { S.targets = computeTargets(S.profile); save(); renderSettings(); renderToday(); toast('Recalculated'); };
  $('#p-save').onclick = () => {
    Object.assign(S.profile, {
      age: +$('#p-age').value, h: +$('#p-height').value, w: +$('#p-weight').value,
      sex: $('#p-sex').value, act: +$('#p-activity').value, goal: +$('#p-goal').value
    });
    if (!S.targets.custom) S.targets = computeTargets(S.profile);
    save(); renderSettings(); renderToday(); toast('Saved');
  };
  $('#ai-save').onclick = () => {
    const v = $('#ai-key').value;
    if (v && !v.startsWith('•')) S.ai.key = v.trim();
    S.ai.provider = $('#ai-provider').value;
    S.ai.model = $('#ai-model').value.trim() || (S.ai.provider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o-mini');
    save(); renderSettings(); toast('Saved on this device');
  };
  $('#ai-provider').onchange = e => {
    $('#ai-model').value = e.target.value === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o-mini';
  };

  /* weight */
  $('#wt-add').onclick = () => {
    const d = $('#wt-date').value || todayKey(), kg = +$('#wt-kg').value;
    if (!(kg > 20 && kg < 300)) return toast('Weight in kilograms, please');
    S.weights[d] = kg;
    if (d === todayKey()) {
      S.profile.w = kg;
      if (!S.targets.custom) S.targets = computeTargets(S.profile);
    }
    $('#wt-kg').value = ''; save(); renderWeight(); renderToday(); toast('Logged');
  };

  /* meal plan */
  $('#plan-load').onclick = async () => {
    $('#plan-status').textContent = 'Loading…';
    try {
      const { nf, nm } = await loadPlan(false);
      $('#plan-status').textContent = nf || nm
        ? `Added ${nf} food${nf === 1 ? '' : 's'} and ${nm} meal${nm === 1 ? '' : 's'}. Edit any of them below.`
        : 'Everything from the plan is already here.';
      renderSettings();
    } catch { $('#plan-status').textContent = 'Could not read plan.json — check it is in the repository root.'; }
  };
  $('#plan-reset').onclick = async () => {
    if (!confirm('Put every plan food and meal back to its original numbers? Your own edits to them are lost. Foods and meals you created yourself are untouched.')) return;
    try { const { nf, nm } = await loadPlan(true);
      $('#plan-status').textContent = `Reset ${nf} foods and ${nm} meals.`; renderSettings();
    } catch { $('#plan-status').textContent = 'Could not read plan.json.'; }
  };
  $('#mf-filter').oninput = e => renderMyFoods(e.target.value.trim());

  /* editor */
  $$('[data-close-editor]').forEach(e => e.onclick = closeEditor);
  $('#ed-save').onclick = saveEditor;
  $('#ed-del').onclick = deleteEdited;

  /* data */
  $('#d-export').onclick = exportJSON;
  $('#d-csv').onclick = exportCSV;
  $('#d-import').onclick = () => $('#d-file').click();
  $('#d-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.profile || !data.days) throw 0;
      S = data; save(); renderSettings(); renderToday(); toast('Backup restored');
    } catch { $('#d-status').textContent = 'That file is not a Panel backup.'; }
    e.target.value = '';
  };
  $('#d-reset').onclick = () => {
    if (!confirm('Erase every logged day, weight and food on this device? This cannot be undone.')) return;
    store.del(KEY); location.reload();
  };

  /* keyboard */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#portion').classList.contains('hidden')) closePortion();
    else if (!$('#sheet').classList.contains('hidden')) closeSheet();
  });
}

/* ═══════════════ BOOT ═══════════════ */
(async function boot() {
  bind();
  try { FOODS = await (await fetch('./foods.json')).json(); } catch { FOODS = []; }

  if (S && S.profile) {
    S.ai ||= { provider: 'anthropic', model: 'claude-sonnet-5', key: '' };
    S.saved ||= []; S.recent ||= []; S.custom ||= []; S.weights ||= {}; S.days ||= {};
    startApp();
  } else {
    $('#setup').classList.remove('hidden');
    initSetup();
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
