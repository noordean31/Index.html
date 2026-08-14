import * as db from './db.js';
import * as foods from './foods.js';
import * as charts from './charts.js';
import * as drive from './drive-sync.js';

const MEALS = [
  { key: 'breakfast', label: 'Petit-déjeuner' },
  { key: 'lunch', label: 'Déjeuner' },
  { key: 'dinner', label: 'Dîner' },
  { key: 'snack', label: 'Collations' },
];
const ACTIVITY_FACTORS = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };

let state = {
  date: todayStr(),
  statsRange: 7,
};

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return todayStr(d);
}
function formatDateLabel(dateStr) {
  if (dateStr === todayStr()) return "Aujourd'hui";
  if (dateStr === addDays(todayStr(), -1)) return 'Hier';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------- toast/sheet
export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function openSheet(title, bodyHTML) {
  const backdrop = document.getElementById('sheet-backdrop');
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-hdr">
      <div class="sheet-title">${title}</div>
      <button class="sheet-close" id="sheet-close-btn">✕</button>
    </div>
    <div id="sheet-body">${bodyHTML}</div>
  `;
  backdrop.classList.add('open');
  document.getElementById('sheet-close-btn').onclick = closeSheet;
  backdrop.onclick = (e) => { if (e.target === backdrop) closeSheet(); };
  return document.getElementById('sheet-body');
}
function closeSheet() {
  document.getElementById('sheet-backdrop').classList.remove('open');
}

// ---------------------------------------------------------------- navigation
export function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${name}`));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
  refreshScreen(name);
}

export function refreshScreen(name = currentScreen()) {
  if (name === 'home') renderHome();
  else if (name === 'stats') renderStats();
  else if (name === 'weight') renderWeightScreen();
  else if (name === 'profile') renderProfile();
}
function currentScreen() {
  const active = document.querySelector('.screen.active');
  return active ? active.id.replace('screen-', '') : 'home';
}

// ---------------------------------------------------------------- HOME
async function renderHome() {
  const root = document.getElementById('screen-home');
  const profile = await db.getProfile();
  const [logs, waterAll, weightsAll, activitiesAll] = await Promise.all([
    db.getByDate('logs', state.date),
    db.getByDate('water', state.date),
    db.getAll('weights'),
    db.getByDate('activities', state.date),
  ]);

  const consumed = logs.reduce((s, l) => s + l.kcal, 0);
  const burned = activitiesAll.reduce((s, a) => s + a.kcal, 0);
  const goal = profile.calorieGoal + burned; // exercise adds back to the budget
  const protein = logs.reduce((s, l) => s + (l.protein || 0), 0);
  const carbs = logs.reduce((s, l) => s + (l.carbs || 0), 0);
  const fat = logs.reduce((s, l) => s + (l.fat || 0), 0);
  const water = waterAll.reduce((s, w) => s + w.ml, 0);
  const todaysWeight = weightsAll.filter(w => w.date === state.date).sort((a, b) => a.updatedAt < b.updatedAt ? 1 : -1)[0];

  root.innerHTML = `
    <div class="date-nav" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <button class="nav-btn" id="date-prev" style="width:40px;">‹</button>
      <div style="font-weight:700;font-size:15px;">${formatDateLabel(state.date)}</div>
      <button class="nav-btn" id="date-next" style="width:40px;" ${state.date >= todayStr() ? 'disabled' : ''}>›</button>
    </div>

    <div class="card">
      <div class="ring-row">
        <div id="ring-host"></div>
        <div class="macro-col" id="macro-host"></div>
      </div>
    </div>

    <div class="stat-chips">
      <div class="stat-chip" id="chip-water">
        <div class="stat-chip-val">${water} ml</div>
        <div class="stat-chip-lbl">💧 Eau · +250ml</div>
      </div>
      <div class="stat-chip" id="chip-weight">
        <div class="stat-chip-val">${todaysWeight ? todaysWeight.kg + ' kg' : '—'}</div>
        <div class="stat-chip-lbl">⚖️ Poids du jour</div>
      </div>
      <div class="stat-chip" id="chip-activity">
        <div class="stat-chip-val">${burned || 0} kcal</div>
        <div class="stat-chip-lbl">🏃 Activité</div>
      </div>
    </div>

    <div id="meal-groups"></div>
  `;

  charts.renderCalorieRing(document.getElementById('ring-host'), { consumed, goal, size: 150 });
  charts.renderMacroBars(document.getElementById('macro-host'), [
    { label: 'Protéines', value: protein, goal: profile.macroGoals.protein_g, color: 'var(--protein)' },
    { label: 'Glucides', value: carbs, goal: profile.macroGoals.carbs_g, color: 'var(--carbs)' },
    { label: 'Lipides', value: fat, goal: profile.macroGoals.fat_g, color: 'var(--fat)' },
  ]);

  const mealGroupsEl = document.getElementById('meal-groups');
  for (const meal of MEALS) {
    const entries = logs.filter(l => l.meal === meal.key);
    const total = entries.reduce((s, e) => s + e.kcal, 0);
    const group = document.createElement('div');
    group.className = 'meal-group';
    group.innerHTML = `
      <div class="meal-hdr">
        <div><span class="meal-hdr-name">${meal.label}</span> <span class="meal-hdr-kcal">${total} kcal</span></div>
        <button class="add-btn" data-meal="${meal.key}">+ Ajouter</button>
      </div>
      <div class="meal-entries"></div>
    `;
    const entriesEl = group.querySelector('.meal-entries');
    if (!entries.length) {
      entriesEl.innerHTML = `<div class="empty-hint">Aucun aliment ajouté</div>`;
    } else {
      for (const e of entries) {
        const row = document.createElement('div');
        row.className = 'entry-row';
        row.innerHTML = `
          <div class="entry-main">
            <div class="entry-name">${e.name}</div>
            <div class="entry-sub">${e.qty} ${e.unit} · P${e.protein}g G${e.carbs}g L${e.fat}g</div>
          </div>
          <div style="display:flex;align-items:center;">
            <div class="entry-kcal">${e.kcal}</div>
            <button class="entry-del" data-id="${e.id}" data-store="logs">🗑</button>
          </div>
        `;
        entriesEl.appendChild(row);
      }
    }
    mealGroupsEl.appendChild(group);
    group.querySelector('.add-btn').onclick = () => openAddFoodSheet(meal.key);
  }

  root.querySelectorAll('.entry-del').forEach(btn => {
    btn.onclick = async () => { await db.softDelete(btn.dataset.store, btn.dataset.id); renderHome(); };
  });

  document.getElementById('date-prev').onclick = () => { state.date = addDays(state.date, -1); renderHome(); };
  document.getElementById('date-next').onclick = () => { state.date = addDays(state.date, 1); renderHome(); };
  document.getElementById('chip-water').onclick = async () => {
    await db.put('water', { id: db.uuid(), date: state.date, ml: 250, updatedAt: db.nowISO(), deleted: false });
    toast('+250 ml ajoutés');
    renderHome();
  };
  document.getElementById('chip-weight').onclick = () => openWeightSheet();
  document.getElementById('chip-activity').onclick = () => openActivitySheet();
}

// ---------------------------------------------------------------- ADD FOOD SHEET
function openAddFoodSheet(mealKey) {
  const body = openSheet('Ajouter un aliment', `
    <input type="text" class="search-input" id="food-search" placeholder="Rechercher un aliment…" autocomplete="off">
    <div class="btn-row" style="margin-bottom:10px;">
      <button class="btn btn-secondary" id="scan-btn">📷 Scanner un code-barres</button>
      <button class="btn btn-secondary" id="manual-btn">✍️ Aliment libre</button>
    </div>
    <div id="video-scan-wrap" style="display:none;margin-bottom:10px;">
      <video id="video-scan" autoplay playsinline muted></video>
      <button class="btn btn-ghost" id="scan-cancel">Annuler le scan</button>
    </div>
    <div id="food-results"></div>
  `);

  const resultsEl = body.querySelector('#food-results');
  const searchEl = body.querySelector('#food-search');

  async function runSearch(q) {
    if (!q.trim()) { resultsEl.innerHTML = ''; return; }
    const local = await foods.searchLocalFoods(q);
    renderResults(local);
    const online = await foods.searchOpenFoodFacts(q);
    if (online.length) {
      const existingNames = new Set(local.map(f => f.name.toLowerCase()));
      renderResults([...local, ...online.filter(f => !existingNames.has(f.name.toLowerCase()))]);
    }
  }
  function renderResults(list) {
    resultsEl.innerHTML = '';
    for (const f of list) {
      const row = document.createElement('div');
      row.className = 'food-result';
      row.innerHTML = `
        <div>
          <div class="food-result-name">${f.name}${f.fromOpenFoodFacts ? '<span class="tag">OFF</span>' : f.builtin ? '' : '<span class="tag">Perso</span>'}</div>
          <div class="food-result-sub">${f.kcalPer100} kcal / 100g · P${f.proteinPer100} G${f.carbsPer100} L${f.fatPer100}</div>
        </div>
        <div style="font-size:18px;">›</div>
      `;
      row.onclick = () => openQuantitySheet(f, mealKey);
      resultsEl.appendChild(row);
    }
  }

  searchEl.oninput = debounce(() => runSearch(searchEl.value), 350);
  runSearch('');

  body.querySelector('#manual-btn').onclick = () => openManualFoodSheet(mealKey);
  body.querySelector('#scan-btn').onclick = () => startBarcodeScan(body, mealKey);
}

function openQuantitySheet(food, mealKey) {
  const body = openSheet(food.name, `
    <div class="field">
      <label>Quantité (g ou ml)</label>
      <input type="number" id="qty-input" value="100" inputmode="decimal">
    </div>
    <div class="meal-picker" id="meal-picker"></div>
    <div id="qty-preview" class="card" style="text-align:center;"></div>
    <button class="btn btn-primary" id="qty-save">Ajouter au journal</button>
  `);
  const pickerEl = body.querySelector('#meal-picker');
  let chosenMeal = mealKey;
  for (const m of MEALS) {
    const b = document.createElement('div');
    b.className = 'meal-opt' + (m.key === chosenMeal ? ' active' : '');
    b.textContent = m.label;
    b.onclick = () => { chosenMeal = m.key; pickerEl.querySelectorAll('.meal-opt').forEach(el => el.classList.remove('active')); b.classList.add('active'); };
    pickerEl.appendChild(b);
  }
  const qtyInput = body.querySelector('#qty-input');
  const preview = body.querySelector('#qty-preview');
  function updatePreview() {
    const g = Number(qtyInput.value) || 0;
    const c = foods.computeForQuantity(food, g);
    preview.innerHTML = `<b style="font-size:20px;">${c.kcal} kcal</b><div style="color:var(--text-dim);font-size:12px;margin-top:4px;">P${c.protein}g · G${c.carbs}g · L${c.fat}g</div>`;
  }
  qtyInput.oninput = updatePreview;
  updatePreview();

  body.querySelector('#qty-save').onclick = async () => {
    const g = Number(qtyInput.value) || 0;
    const c = foods.computeForQuantity(food, g);
    await db.put('logs', {
      id: db.uuid(), date: state.date, meal: chosenMeal,
      name: food.name, qty: g, unit: 'g',
      kcal: c.kcal, protein: c.protein, carbs: c.carbs, fat: c.fat,
      updatedAt: db.nowISO(), deleted: false,
    });
    closeSheet();
    toast('Ajouté au journal');
    renderHome();
  };
}

function openManualFoodSheet(mealKey) {
  const body = openSheet('Aliment libre', `
    <div class="field"><label>Nom</label><input id="mf-name" type="text" placeholder="Ex. Sandwich jambon"></div>
    <div class="field-row">
      <div class="field"><label>Calories (kcal)</label><input id="mf-kcal" type="number" inputmode="numeric"></div>
      <div class="field"><label>Quantité</label><input id="mf-qty" type="number" value="1" inputmode="numeric"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Protéines (g)</label><input id="mf-p" type="number" value="0" inputmode="decimal"></div>
      <div class="field"><label>Glucides (g)</label><input id="mf-c" type="number" value="0" inputmode="decimal"></div>
      <div class="field"><label>Lipides (g)</label><input id="mf-f" type="number" value="0" inputmode="decimal"></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:14px;">
      <input type="checkbox" id="mf-save-food"> Enregistrer comme aliment réutilisable
    </label>
    <button class="btn btn-primary" id="mf-save">Ajouter au journal</button>
  `);
  body.querySelector('#mf-save').onclick = async () => {
    const name = body.querySelector('#mf-name').value.trim() || 'Aliment';
    const kcal = Number(body.querySelector('#mf-kcal').value) || 0;
    const qty = Number(body.querySelector('#mf-qty').value) || 1;
    const protein = Number(body.querySelector('#mf-p').value) || 0;
    const carbs = Number(body.querySelector('#mf-c').value) || 0;
    const fat = Number(body.querySelector('#mf-f').value) || 0;
    await db.put('logs', {
      id: db.uuid(), date: state.date, meal: mealKey,
      name, qty, unit: 'portion', kcal, protein, carbs, fat,
      updatedAt: db.nowISO(), deleted: false,
    });
    if (body.querySelector('#mf-save-food').checked) {
      await foods.saveCustomFood({ name, kcalPer100: kcal, proteinPer100: protein, carbsPer100: carbs, fatPer100: fat });
    }
    closeSheet();
    toast('Ajouté au journal');
    renderHome();
  };
}

async function startBarcodeScan(sheetBody, mealKey) {
  const wrap = sheetBody.querySelector('#video-scan-wrap');
  const video = sheetBody.querySelector('#video-scan');
  wrap.style.display = 'block';
  if (!foods.isBarcodeDetectorSupported()) {
    wrap.innerHTML = `<div class="banner">Le scan caméra n'est pas pris en charge par ce navigateur. Entrez le code-barres manuellement.</div>
      <div class="field"><input id="manual-barcode" type="text" inputmode="numeric" placeholder="Code-barres (EAN)"></div>
      <button class="btn btn-primary" id="manual-barcode-go">Rechercher</button>`;
    sheetBody.querySelector('#manual-barcode-go').onclick = async () => {
      const code = sheetBody.querySelector('#manual-barcode').value.trim();
      if (!code) return;
      toast('Recherche du produit…');
      const product = await foods.lookupBarcode(code);
      if (product) openQuantitySheet(product, mealKey);
      else toast('Produit introuvable hors-ligne ou inconnu');
    };
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    let stopped = false;
    sheetBody.querySelector('#scan-cancel').onclick = () => { stopped = true; stream.getTracks().forEach(t => t.stop()); wrap.style.display = 'none'; };
    (async function loop() {
      while (!stopped) {
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            stopped = true;
            stream.getTracks().forEach(t => t.stop());
            toast('Code détecté, recherche…');
            const product = await foods.lookupBarcode(codes[0].rawValue);
            if (product) openQuantitySheet(product, mealKey);
            else toast('Produit introuvable');
            return;
          }
        } catch { /* keep scanning */ }
        await new Promise(r => setTimeout(r, 300));
      }
    })();
  } catch {
    wrap.innerHTML = `<div class="banner">Accès à la caméra refusé ou indisponible.</div>`;
  }
}

// ---------------------------------------------------------------- WEIGHT
function openWeightSheet() {
  const body = openSheet('Enregistrer le poids', `
    <div class="field"><label>Date</label><input id="w-date" type="date" value="${state.date}"></div>
    <div class="field"><label>Poids (kg)</label><input id="w-kg" type="number" inputmode="decimal" step="0.1"></div>
    <button class="btn btn-primary" id="w-save">Enregistrer</button>
  `);
  body.querySelector('#w-save').onclick = async () => {
    const kg = Number(body.querySelector('#w-kg').value);
    if (!kg) { toast('Entrez un poids valide'); return; }
    await db.put('weights', { id: db.uuid(), date: body.querySelector('#w-date').value, kg, updatedAt: db.nowISO(), deleted: false });
    closeSheet();
    toast('Poids enregistré');
    refreshScreen();
  };
}

async function renderWeightScreen() {
  const root = document.getElementById('screen-weight');
  const all = (await db.getAll('weights')).sort((a, b) => a.date.localeCompare(b.date));
  const recent = all.slice(-60);
  root.innerHTML = `
    <div class="page-title">Poids</div>
    <div class="card"><canvas class="chart-canvas" id="weight-chart"></canvas></div>
    <button class="btn btn-primary" id="add-weight-btn" style="margin-bottom:14px;">+ Ajouter une pesée</button>
    <div id="weight-list"></div>
  `;
  charts.renderLineChart(document.getElementById('weight-chart'), recent.map(w => ({ x: w.date.slice(5), y: w.kg })), { unit: 'kg' });
  document.getElementById('add-weight-btn').onclick = () => openWeightSheet();
  const listEl = document.getElementById('weight-list');
  for (const w of [...all].reverse().slice(0, 20)) {
    const row = document.createElement('div');
    row.className = 'entry-row';
    row.innerHTML = `
      <div class="entry-main"><div class="entry-name">${w.date}</div></div>
      <div style="display:flex;align-items:center;">
        <div class="entry-kcal">${w.kg} kg</div>
        <button class="entry-del" data-id="${w.id}">🗑</button>
      </div>`;
    row.querySelector('.entry-del').onclick = async () => { await db.softDelete('weights', w.id); renderWeightScreen(); };
    listEl.appendChild(row);
  }
}

// ---------------------------------------------------------------- ACTIVITY
function openActivitySheet() {
  const body = openSheet('Activité physique', `
    <div class="field"><label>Nom</label><input id="a-name" type="text" placeholder="Ex. Course à pied"></div>
    <div class="field-row">
      <div class="field"><label>Durée (min)</label><input id="a-min" type="number" inputmode="numeric"></div>
      <div class="field"><label>Calories brûlées</label><input id="a-kcal" type="number" inputmode="numeric"></div>
    </div>
    <button class="btn btn-primary" id="a-save">Ajouter</button>
  `);
  body.querySelector('#a-save').onclick = async () => {
    const name = body.querySelector('#a-name').value.trim() || 'Activité';
    const minutes = Number(body.querySelector('#a-min').value) || 0;
    const kcal = Number(body.querySelector('#a-kcal').value) || 0;
    await db.put('activities', { id: db.uuid(), date: state.date, name, minutes, kcal, updatedAt: db.nowISO(), deleted: false });
    closeSheet();
    toast('Activité ajoutée');
    renderHome();
  };
}

// ---------------------------------------------------------------- STATS
async function renderStats() {
  const root = document.getElementById('screen-stats');
  root.innerHTML = `
    <div class="page-title">Statistiques</div>
    <div class="range-tabs" id="range-tabs">
      <div class="range-tab" data-r="7">7 j</div>
      <div class="range-tab" data-r="30">30 j</div>
      <div class="range-tab" data-r="90">90 j</div>
    </div>
    <div class="card">
      <div class="card-title">Calories par jour</div>
      <canvas class="chart-canvas" id="cal-chart"></canvas>
    </div>
    <div class="card">
      <div class="card-title">Répartition des macros (période)</div>
      <div style="display:flex;align-items:center;gap:18px;">
        <div id="macro-donut"></div>
        <div id="macro-legend" style="font-size:12px;flex:1;"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Constance (12 dernières semaines)</div>
      <div id="heatmap-host"></div>
    </div>
  `;
  document.querySelectorAll('#range-tabs .range-tab').forEach(t => {
    t.classList.toggle('active', Number(t.dataset.r) === state.statsRange);
    t.onclick = () => { state.statsRange = Number(t.dataset.r); renderStats(); };
  });

  const profile = await db.getProfile();
  const logs = await db.getAll('logs');
  const days = [];
  for (let i = state.statsRange - 1; i >= 0; i--) days.push(addDays(todayStr(), -i));
  const byDay = Object.fromEntries(days.map(d => [d, 0]));
  const macroTotals = { protein: 0, carbs: 0, fat: 0 };
  for (const l of logs) {
    if (byDay[l.date] !== undefined) {
      byDay[l.date] += l.kcal;
      macroTotals.protein += l.protein || 0;
      macroTotals.carbs += l.carbs || 0;
      macroTotals.fat += l.fat || 0;
    }
  }
  charts.renderBarChart(document.getElementById('cal-chart'), days.map(d => ({ x: d.slice(5), y: byDay[d] })), { goal: profile.calorieGoal });

  charts.renderDonut(document.getElementById('macro-donut'), [
    { label: 'Protéines', value: macroTotals.protein * 4, color: 'var(--protein)' },
    { label: 'Glucides', value: macroTotals.carbs * 4, color: 'var(--carbs)' },
    { label: 'Lipides', value: macroTotals.fat * 9, color: 'var(--fat)' },
  ], { size: 110 });
  const legend = document.getElementById('macro-legend');
  const kcalP = Math.round(macroTotals.protein * 4), kcalC = Math.round(macroTotals.carbs * 4), kcalF = Math.round(macroTotals.fat * 9);
  legend.innerHTML = `
    <div style="margin-bottom:6px;"><span style="color:var(--protein);">●</span> Protéines — ${Math.round(macroTotals.protein)}g (${kcalP} kcal)</div>
    <div style="margin-bottom:6px;"><span style="color:var(--carbs);">●</span> Glucides — ${Math.round(macroTotals.carbs)}g (${kcalC} kcal)</div>
    <div><span style="color:var(--fat);">●</span> Lipides — ${Math.round(macroTotals.fat)}g (${kcalF} kcal)</div>
  `;

  const heatDays = [];
  for (let i = 83; i >= 0; i--) {
    const d = addDays(todayStr(), -i);
    heatDays.push({ date: d, value: byDay[d] ?? logsTotalForDate(logs, d), goal: profile.calorieGoal });
  }
  charts.renderHeatmap(document.getElementById('heatmap-host'), heatDays);
}
function logsTotalForDate(logs, date) {
  return logs.filter(l => l.date === date).reduce((s, l) => s + l.kcal, 0);
}

// ---------------------------------------------------------------- PROFILE
async function renderProfile() {
  const root = document.getElementById('screen-profile');
  const profile = await db.getProfile();
  const meta = await db.getMeta();
  const latestWeight = (await db.getAll('weights')).sort((a, b) => a.date.localeCompare(b.date)).pop();

  root.innerHTML = `
    <div class="page-title">Profil & Réglages</div>

    <div class="card" id="drive-card"></div>

    <div class="card">
      <div class="card-title">Objectifs</div>
      <div class="field-row">
        <div class="field"><label>Sexe</label>
          <select id="p-sex"><option value="f">Femme</option><option value="m">Homme</option><option value="other">Autre</option></select>
        </div>
        <div class="field"><label>Âge</label><input id="p-age" type="number" inputmode="numeric"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Taille (cm)</label><input id="p-height" type="number" inputmode="numeric"></div>
        <div class="field"><label>Poids actuel (kg)</label><input id="p-weight" type="number" inputmode="decimal" step="0.1"></div>
      </div>
      <div class="field">
        <label>Niveau d'activité</label>
        <select id="p-activity">
          <option value="sedentary">Sédentaire</option>
          <option value="light">Légèrement actif</option>
          <option value="moderate">Modérément actif</option>
          <option value="active">Actif</option>
          <option value="very_active">Très actif</option>
        </select>
      </div>
      <div class="field">
        <label>Objectif</label>
        <div class="segmented" id="p-goaltype">
          <button data-v="lose">Perdre</button><button data-v="maintain">Maintenir</button><button data-v="gain">Prendre</button>
        </div>
      </div>
      <button class="btn btn-secondary" id="p-recalc" style="margin-bottom:14px;">↻ Recalculer les objectifs</button>
      <div class="field-row">
        <div class="field"><label>Objectif calories (kcal)</label><input id="p-kcalgoal" type="number" inputmode="numeric"></div>
        <div class="field"><label>Objectif eau (ml)</label><input id="p-water" type="number" inputmode="numeric"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Protéines (g)</label><input id="p-protein" type="number" inputmode="numeric"></div>
        <div class="field"><label>Glucides (g)</label><input id="p-carbs" type="number" inputmode="numeric"></div>
        <div class="field"><label>Lipides (g)</label><input id="p-fat" type="number" inputmode="numeric"></div>
      </div>
      <button class="btn btn-primary" id="p-save">Enregistrer</button>
    </div>

    <div class="card">
      <div class="card-title">Apparence</div>
      <div class="settings-row">
        <div>
          <div class="settings-row-lbl">Thème</div>
          <div class="settings-row-sub">Clair, sombre ou automatique</div>
        </div>
        <div class="segmented" id="p-theme" style="width:180px;">
          <button data-v="system">Auto</button><button data-v="light">Clair</button><button data-v="dark">Sombre</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Sauvegarde locale</div>
      <div class="settings-row-sub" style="margin-bottom:10px;">Vos données sont toujours stockées sur cet appareil, même sans connexion. Exportez un fichier de secours à tout moment.</div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="export-btn">⬇️ Exporter (JSON)</button>
        <label class="btn btn-secondary" style="text-align:center;">⬆️ Importer<input type="file" id="import-file" accept="application/json" style="display:none;"></label>
      </div>
    </div>
  `;

  root.querySelector('#p-sex').value = profile.sex;
  root.querySelector('#p-age').value = profile.age;
  root.querySelector('#p-height').value = profile.heightCm;
  root.querySelector('#p-weight').value = latestWeight ? latestWeight.kg : '';
  root.querySelector('#p-activity').value = profile.activityLevel;
  root.querySelector('#p-kcalgoal').value = profile.calorieGoal;
  root.querySelector('#p-water').value = profile.waterGoalMl;
  root.querySelector('#p-protein').value = profile.macroGoals.protein_g;
  root.querySelector('#p-carbs').value = profile.macroGoals.carbs_g;
  root.querySelector('#p-fat').value = profile.macroGoals.fat_g;

  setSegmented(root.querySelector('#p-goaltype'), profile.goalType);
  setSegmented(root.querySelector('#p-theme'), profile.theme);

  root.querySelector('#p-recalc').onclick = () => {
    const sex = root.querySelector('#p-sex').value;
    const age = Number(root.querySelector('#p-age').value) || 30;
    const heightCm = Number(root.querySelector('#p-height').value) || 170;
    const weightKg = Number(root.querySelector('#p-weight').value) || 65;
    const activity = root.querySelector('#p-activity').value;
    const goalType = getSegmented(root.querySelector('#p-goaltype'));
    const bmr = sex === 'm'
      ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
    const tdee = bmr * (ACTIVITY_FACTORS[activity] || 1.375);
    let goal = tdee;
    if (goalType === 'lose') goal = tdee - 500;
    if (goalType === 'gain') goal = tdee + 350;
    goal = Math.round(goal / 10) * 10;
    root.querySelector('#p-kcalgoal').value = goal;
    root.querySelector('#p-protein').value = Math.round((goal * 0.30) / 4);
    root.querySelector('#p-carbs').value = Math.round((goal * 0.40) / 4);
    root.querySelector('#p-fat').value = Math.round((goal * 0.30) / 9);
    toast('Objectifs recalculés — pensez à enregistrer');
  };

  root.querySelector('#p-save').onclick = async () => {
    const updated = {
      ...profile,
      sex: root.querySelector('#p-sex').value,
      age: Number(root.querySelector('#p-age').value) || profile.age,
      heightCm: Number(root.querySelector('#p-height').value) || profile.heightCm,
      activityLevel: root.querySelector('#p-activity').value,
      goalType: getSegmented(root.querySelector('#p-goaltype')),
      calorieGoal: Number(root.querySelector('#p-kcalgoal').value) || profile.calorieGoal,
      waterGoalMl: Number(root.querySelector('#p-water').value) || profile.waterGoalMl,
      macroGoals: {
        protein_g: Number(root.querySelector('#p-protein').value) || 0,
        carbs_g: Number(root.querySelector('#p-carbs').value) || 0,
        fat_g: Number(root.querySelector('#p-fat').value) || 0,
      },
      theme: getSegmented(root.querySelector('#p-theme')),
    };
    await db.saveProfile(updated);
    applyTheme(updated.theme);
    const newWeight = Number(root.querySelector('#p-weight').value);
    if (newWeight && (!latestWeight || latestWeight.date !== todayStr() || latestWeight.kg !== newWeight)) {
      await db.put('weights', { id: db.uuid(), date: todayStr(), kg: newWeight, updatedAt: db.nowISO(), deleted: false });
    }
    toast('Profil enregistré');
    renderHome();
  };

  root.querySelector('#p-theme').querySelectorAll('button').forEach(b => {
    b.onclick = () => { setSegmented(root.querySelector('#p-theme'), b.dataset.v); applyTheme(b.dataset.v); };
  });

  root.querySelector('#export-btn').onclick = async () => {
    const snapshot = await db.exportSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `calorie-tracker-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  root.querySelector('#import-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const snapshot = JSON.parse(text);
      await db.importSnapshot(snapshot, { merge: true });
      toast('Import fusionné avec les données locales');
      refreshScreen();
    } catch (err) {
      toast('Fichier invalide');
      console.error(err);
    }
  };

  renderDriveCard(root.querySelector('#drive-card'), meta);
}

function setSegmented(el, value) {
  el.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.v === value);
    b.onclick = b.onclick || (() => setSegmented(el, b.dataset.v));
  });
}
function getSegmented(el) {
  const active = el.querySelector('button.active');
  return active ? active.dataset.v : el.querySelector('button').dataset.v;
}

function renderDriveCard(el, meta) {
  const { status } = drive.getStatus();
  const configured = drive.isConfigured();
  let body = '';
  if (!configured) {
    body = `
      <div class="banner">Google Drive n'est pas encore configuré. Suivez les instructions du fichier README.md (Client ID Google Cloud) pour activer la synchronisation multi-appareils.</div>
    `;
  } else if (drive.isSignedIn() || status === 'synced' || status === 'syncing') {
    body = `
      <div class="settings-row">
        <div>
          <div class="settings-row-lbl">Google Drive</div>
          <div class="settings-row-sub">${status === 'syncing' ? 'Synchronisation…' : meta.lastSyncedAt ? 'Dernière synchro : ' + new Date(meta.lastSyncedAt).toLocaleString('fr-FR') : 'Jamais synchronisé'}</div>
        </div>
        <button class="btn btn-secondary" id="drive-sync-btn" style="width:auto;padding:8px 12px;">↻ Synchroniser</button>
      </div>
      <button class="btn btn-ghost" id="drive-signout-btn">Se déconnecter</button>
    `;
  } else {
    body = `
      <div class="settings-row-sub" style="margin-bottom:10px;">Connectez votre Google Drive pour retrouver votre journal sur iPhone et Mac. Vos données restent toujours enregistrées sur cet appareil même sans connexion.</div>
      <button class="btn btn-primary" id="drive-signin-btn">🔗 Connecter Google Drive</button>
    `;
  }
  el.innerHTML = `<div class="card-title">Synchronisation</div>${body}`;
  const signinBtn = el.querySelector('#drive-signin-btn');
  if (signinBtn) signinBtn.onclick = async () => {
    try { await drive.signIn(); toast('Connecté à Google Drive'); await drive.syncNow({ interactive: true }); renderProfile(); }
    catch (e) { toast('Connexion annulée ou refusée'); }
  };
  const syncBtn = el.querySelector('#drive-sync-btn');
  if (syncBtn) syncBtn.onclick = async () => { await drive.syncNow({ interactive: true }); renderProfile(); };
  const signoutBtn = el.querySelector('#drive-signout-btn');
  if (signoutBtn) signoutBtn.onclick = () => { drive.signOut(); renderProfile(); };
}

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
}

export function updateSyncPill() {
  const pill = document.getElementById('sync-pill');
  if (!pill) return;
  const { status } = drive.getStatus();
  pill.dataset.status = status;
  const labels = {
    'idle': 'Local', 'synced': 'Synchronisé', 'syncing': 'Synchro…',
    'offline': 'Hors-ligne', 'signed-out': 'Reconnecter', 'error': 'Erreur sync',
    'not-configured': 'Local uniquement',
  };
  pill.querySelector('span:last-child').textContent = labels[status] || status;
  if (status === 'signed-out' && drive.isConfigured()) {
    pill.onclick = async () => { try { await drive.signIn(); await drive.syncNow({ interactive: true }); } catch {} };
  } else {
    pill.onclick = () => showScreen('profile');
  }
}

export { openWeightSheet, openActivitySheet, openAddFoodSheet };
