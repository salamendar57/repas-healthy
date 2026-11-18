/* Repas Healthy — v1 (données locales sur l'appareil) */
"use strict";

// ---------- État ----------
const STORE_KEY = "rh_state_v1";
const DEFAULT_STATE = {
  prefs: { maxTime: 30, portions: 2, meals: 5, dislikes: [], driveUrl: "", searchOverrides: {} },
  menu: [],          // [{ id, portions, done }]
  checked: {},       // clé article -> true
  extras: [],        // [{ name, checked }]
  tab: "menu",
};
let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { ...DEFAULT_STATE, ...s, prefs: { ...DEFAULT_STATE.prefs, ...(s.prefs || {}) } };
    }
  } catch (e) { /* stockage indisponible */ }
  return structuredClone(DEFAULT_STATE);
}
// fromRemote = true quand la modification vient de l'autre téléphone (pas de renvoi)
function save(fromRemote) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  if (!fromRemote && typeof syncPush === "function") syncPush();
}

// ---------- Utilitaires ----------
const $ = (sel, root = document) => root.querySelector(sel);
const byId = (id) => RECIPES.find((r) => r.id === id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmtNum(n) {
  const fr = { 0.25: "¼", 0.5: "½", 0.75: "¾" };
  const whole = Math.floor(n + 1e-9);
  const dec = Math.round((n - whole) * 100) / 100;
  if (dec === 0) return String(whole);
  if (fr[dec]) return (whole ? whole + " " : "") + fr[dec];
  if (Math.abs(dec - 0.33) < 0.02) return (whole ? whole + " " : "") + "⅓";
  if (Math.abs(dec - 0.67) < 0.02) return (whole ? whole + " " : "") + "⅔";
  return (Math.round(n * 10) / 10).toString().replace(".", ",");
}

// Quantité affichée dans une recette
function fmtQty(q, unit) {
  if (unit === "g" || unit === "ml") {
    const v = Math.round(q / 5) * 5 || Math.round(q);
    if (v >= 1000) return (Math.round(v / 100) / 10).toString().replace(".", ",") + (unit === "g" ? " kg" : " L");
    return v + " " + unit;
  }
  return fmtNum(Math.round(q * 4) / 4 || q) + (unit ? " " + unit : "");
}

// Quantité à acheter (arrondi au supérieur)
function fmtBuy(q, unit) {
  if (unit === "g" || unit === "ml") {
    const v = Math.ceil(q / 10) * 10;
    if (v >= 1000) return (Math.round(v / 100) / 10).toString().replace(".", ",") + (unit === "g" ? " kg" : " L");
    return v + " " + unit;
  }
  if (unit === "" || unit === "botte" || unit === "gousse") {
    const v = Math.ceil(q - 0.05);
    return v + (unit ? " " + unit + (v > 1 ? "s" : "") : "");
  }
  return fmtNum(q) + " " + unit;
}

function searchTerm(name) {
  const custom = state.prefs.searchOverrides && state.prefs.searchOverrides[name];
  if (custom) return custom;
  if (SEARCH[name]) return SEARCH[name];
  return name.replace(/\(.*?\)/g, "").replace(/\bou\b.*$/i, "").replace(/œ/g, "oe").replace(/Œ/g, "Oe").replace(/\s+/g, " ").trim().toLowerCase();
}

// Magasin par défaut du foyer (Leclerc Drive Saint-Jean-de-la-Ruelle)
const DEFAULT_DRIVE = "https://fd9-courses.leclercdrive.fr/magasin-034521-034521-saint-jean-de-la-ruelle/recherche.aspx?TexteRecherche=tomate";

// Accepte soit une page de résultats « tomate », soit la page d'accueil d'un magasin Leclerc Drive
function driveTemplate() {
  const u = (state.prefs.driveUrl || "").trim();
  if (/tomate/i.test(u)) return u;
  const m = u.match(/^(https:\/\/[^/]+leclercdrive\.fr\/magasin-[^/?#]+?)(?:\.aspx)?(?:[/?#].*)?$/i);
  if (m) return m[1] + "/recherche.aspx?TexteRecherche=tomate";
  return DEFAULT_DRIVE;
}

function driveLink(name) {
  return driveTemplate().replace(/tomate/i, encodeURIComponent(searchTerm(name)));
}

function isEligible(r) {
  if (r.time > state.prefs.maxTime) return false;
  const dis = state.prefs.dislikes.map(norm);
  return !r.ing.some(([name]) => dis.some((d) => d && norm(name).includes(d)));
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2200);
}

// ---------- Génération du menu ----------
function pickMenu(n) {
  const pool = shuffle(RECIPES.filter(isEligible));
  const maxPerProtein = Math.max(1, Math.ceil(n / 3));
  const picked = [];
  const count = {};
  for (const r of pool) {
    if (picked.length >= n) break;
    if ((count[r.protein] || 0) >= maxPerProtein) continue;
    picked.push(r);
    count[r.protein] = (count[r.protein] || 0) + 1;
  }
  for (const r of pool) { // complète si pas assez de variété possible
    if (picked.length >= n) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked;
}
const repeats = (list) => list.filter((r, i) => i > 0 && r.protein === list[i - 1].protein).length;

function generateMenu() {
  const n = state.prefs.meals;
  // plusieurs tirages : on garde celui qui évite le plus la même protéine deux jours de suite
  let picked = pickMenu(n);
  for (let t = 0; t < 40 && repeats(picked) > 0; t++) {
    const alt = shuffle(picked);
    if (repeats(alt) < repeats(picked)) picked = alt;
  }
  state.menu = picked.map((r) => ({ id: r.id, portions: state.prefs.portions, done: false }));
  state.checked = {};
  save();
  if (picked.length < n) toast(`Seulement ${picked.length} recettes correspondent à vos filtres`);
}

function swapMeal(i) {
  const inMenu = new Set(state.menu.map((m) => m.id));
  const cur = byId(state.menu[i].id);
  let pool = RECIPES.filter((r) => isEligible(r) && !inMenu.has(r.id));
  const diff = pool.filter((r) => r.protein !== cur.protein);
  if (diff.length) pool = diff;
  if (!pool.length) return toast("Aucune autre recette disponible avec vos filtres");
  const r = pool[Math.floor(Math.random() * pool.length)];
  state.menu[i] = { id: r.id, portions: state.menu[i].portions, done: false };
  save();
  render();
  toast("Recette remplacée : " + r.title);
}

function addToMenu(id) {
  if (state.menu.some((m) => m.id === id)) return toast("Déjà dans le menu");
  state.menu.push({ id, portions: state.prefs.portions, done: false });
  save();
  toast("Ajoutée au menu ✓");
}

// ---------- Liste de courses ----------
function buildShopping() {
  const map = new Map();
  for (const m of state.menu) {
    const r = byId(m.id);
    if (!r) continue;
    for (const [name, q, unit, ray] of r.ing) {
      const key = ray === "X" ? "X|" + name : name + "|" + unit;
      const it = map.get(key) || { key, name, unit, ray, q: 0, from: [] };
      it.q += q * m.portions;
      it.from.push(r.title);
      map.set(key, it);
    }
  }
  return [...map.values()];
}

// ---------- Rendu ----------
const TITLES = { menu: "Menu de la semaine", courses: "Liste de courses", recettes: "Recettes", reglages: "Réglages" };

function render() {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  $("#view-title").textContent = TITLES[state.tab];
  const v = $("#view");
  v.innerHTML = ({ menu: viewMenu, courses: viewCourses, recettes: viewRecettes, reglages: viewReglages })[state.tab]();
}

function plateLegend() {
  return `<div class="plate" aria-hidden="true"><i></i><i></i><i></i></div>
  <div class="legend"><span><b style="background:#4caf6a"></b>½ légumes</span><span><b style="background:#e07a5f"></b>¼ protéines</span><span><b style="background:#e9c46a"></b>¼ féculents complets</span></div>`;
}

function recipeCard(r, extra = "") {
  return `<div class="card meal" data-open="${r.id}">
    <div class="meal-emoji">${r.emoji}</div>
    <div class="meal-body">
      <div class="meal-title">${esc(r.title)}</div>
      <div class="meal-meta"><span class="badge time">⏱ ${r.time} min</span><span class="badge">${PROTEINS[r.protein]}</span></div>
      ${extra}
    </div>
  </div>`;
}

function viewMenu() {
  const p = state.prefs;
  if (!state.menu.length) {
    return `<div class="empty card">
      <div class="big">🥗</div>
      <h2>Pas encore de menu</h2>
      <p class="muted">${p.meals} repas · ${p.portions} portions · ≤ ${p.maxTime} min de préparation</p>
      <button class="btn primary" data-action="generate">✨ Générer mon menu</button>
    </div>`;
  }
  const done = state.menu.filter((m) => m.done).length;
  const items = state.menu.map((m, i) => {
    const r = byId(m.id);
    if (!r) return "";
    return `<div class="card meal ${m.done ? "done" : ""}">
      <div class="meal-emoji" data-open="${r.id}" data-portions="${m.portions}">${r.emoji}</div>
      <div class="meal-body">
        <div class="meal-title" data-open="${r.id}" data-portions="${m.portions}">${esc(r.title)}</div>
        <div class="meal-meta"><span class="badge time">⏱ ${r.time} min</span><span class="badge">${PROTEINS[r.protein]}</span></div>
        <div class="meal-actions">
          <div class="stepper">
            <button data-action="portions" data-i="${i}" data-d="-1" aria-label="Moins de portions">−</button>
            <span>${m.portions} pers.</span>
            <button data-action="portions" data-i="${i}" data-d="1" aria-label="Plus de portions">+</button>
          </div>
          <span class="spacer"></span>
          <button class="icon-btn" data-action="cook" data-i="${i}" title="Cuisiner">▶️</button>
          <button class="icon-btn" data-action="swap" data-i="${i}" title="Remplacer">🔄</button>
          <button class="icon-btn" data-action="toggle-done" data-i="${i}" title="Marquer comme cuisiné">${m.done ? "↩️" : "✅"}</button>
          <button class="icon-btn" data-action="remove" data-i="${i}" title="Retirer">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join("");
  return `
    <p class="muted small" style="margin-top:0">${state.menu.length} repas · ${done} cuisiné${done > 1 ? "s" : ""} · filtre ≤ ${p.maxTime} min</p>
    ${items}
    <div class="row" style="margin-top:14px">
      <button class="btn" data-action="add-random">＋ Ajouter un repas</button>
      <span class="spacer"></span>
      <button class="btn" data-action="regenerate">✨ Nouveau menu</button>
    </div>
    <button class="btn primary block" style="margin-top:12px" data-goto="courses">🛒 Voir la liste de courses</button>
    <div class="section-title">Chaque assiette</div>
    ${plateLegend()}`;
}

function viewCourses() {
  const items = buildShopping();
  const extras = state.extras;
  if (!items.length && !extras.length) {
    return `<div class="empty card"><div class="big">🛒</div><h2>Liste vide</h2><p class="muted">Générez d'abord votre menu de la semaine.</p><button class="btn primary" data-goto="menu">Aller au menu</button></div>`;
  }
  const total = items.filter((i) => i.ray !== "X").length + extras.length;
  const checked = items.filter((i) => i.ray !== "X" && state.checked[i.key]).length + extras.filter((e) => e.checked).length;
  const pct = total ? Math.round((checked / total) * 100) : 0;

  const order = ["L", "V", "P", "C", "B", "S", "E", "X"];
  const groups = order.map((ray) => {
    const list = items.filter((i) => i.ray === ray).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    if (!list.length) return "";
    const rows = list.map((it) => {
      const on = !!state.checked[it.key];
      const qty = ray === "X" ? "" : fmtBuy(it.q, it.unit);
      return `<div class="item ${on ? "checked" : ""}">
        <button class="check" data-action="check" data-key="${esc(it.key)}" aria-label="Cocher">${on ? "✓" : ""}</button>
        <div class="item-name"><span data-action="check" data-key="${esc(it.key)}">${esc(it.name)}</span>
          <div class="small muted" data-action="check" data-key="${esc(it.key)}">${it.from.length > 1 ? it.from.length + " recettes" : esc(it.from[0])}</div>
          ${ray === "X" ? "" : `<button class="kw" data-action="edit-kw" data-name="${esc(it.name)}">🔍 ${esc(searchTerm(it.name))} ✏️</button>`}</div>
        <span class="item-qty">${qty}</span>
        ${ray === "X" ? "" : `<a class="drive-btn" href="${esc(driveLink(it.name))}" target="_blank" rel="noopener">Leclerc ↗</a>`}
      </div>`;
    }).join("");
    return `<div class="card group"><div class="group-head"><span>${RAYONS[ray].icon}</span><span>${RAYONS[ray].name}</span></div>${rows}</div>`;
  }).join("");

  const extraRows = extras.map((e, i) => `<div class="item ${e.checked ? "checked" : ""}">
      <button class="check" data-action="check-extra" data-i="${i}" aria-label="Cocher">${e.checked ? "✓" : ""}</button>
      <div class="item-name" data-action="check-extra" data-i="${i}">${esc(e.name)}</div>
      <a class="drive-btn" href="${esc(driveLink(e.name))}" target="_blank" rel="noopener">Leclerc ↗</a>
      <button class="icon-btn" style="width:32px;height:32px;font-size:.8rem" data-action="del-extra" data-i="${i}" aria-label="Supprimer">✕</button>
    </div>`).join("");

  const quick = ["Lait", "Pain", "Yaourts nature", "Fruits de saison", "Café", "Œufs", "Papier toilette", "Liquide vaisselle", "Eau"];
  const quickChips = quick.filter((q) => !extras.some((e) => norm(e.name) === norm(q)))
    .map((q) => `<button class="chip" data-action="quick-extra" data-name="${esc(q)}">＋ ${esc(q)}</button>`).join("");

  const driveBanner = "";

  return `
    ${driveBanner}
    <div class="row small"><span>${checked}/${total} dans le panier</span><span class="spacer"></span>
      <button class="btn sm" data-action="copy-list">📋 Copier</button>
      <button class="btn sm ghost" data-action="uncheck-all">Tout décocher</button>
    </div>
    <div class="progress"><i style="width:${pct}%"></i></div>
    ${groups}
    <div class="card group">
      <div class="group-head"><span>${RAYONS.Q.icon}</span><span>${RAYONS.Q.name}</span></div>
      ${extraRows}
      <div style="padding:12px 14px">
        <form class="add-row" data-form="extra">
          <input class="input" name="name" placeholder="Ajouter un produit…" autocomplete="off">
          <button class="btn primary" type="submit">＋</button>
        </form>
        <div class="chips">${quickChips}</div>
      </div>
    </div>
    <p class="muted small">Astuce : touchez « Leclerc ↗ » pour chercher le produit dans votre drive, ajoutez-le au panier, puis cochez-le ici.</p>`;
}

let recipeFilter = { q: "", time: 0, protein: "" };
function viewRecettes() {
  const f = recipeFilter;
  const list = RECIPES.filter((r) =>
    (!f.time || r.time <= f.time) &&
    (!f.protein || r.protein === f.protein) &&
    (!f.q || norm(r.title + " " + r.ing.map((i) => i[0]).join(" ")).includes(norm(f.q)))
  );
  const timeChips = [[0, "Tous"], [15, "≤ 15 min"], [30, "≤ 30 min"], [45, "≤ 45 min"]]
    .map(([t, l]) => `<button class="chip ${f.time === t ? "on" : ""}" data-action="f-time" data-v="${t}">${l}</button>`).join("");
  const protChips = [["", "Toutes"], ...Object.entries(PROTEINS)]
    .map(([k, l]) => `<button class="chip ${f.protein === k ? "on" : ""}" data-action="f-prot" data-v="${k}">${l}</button>`).join("");
  return `
    <div class="filters">
      <input class="input" type="search" placeholder="🔍 Rechercher une recette, un ingrédient…" value="${esc(f.q)}" data-input="f-q">
      <div class="chips">${timeChips}</div>
      <div class="chips">${protChips}</div>
    </div>
    <p class="muted small">${list.length} recette${list.length > 1 ? "s" : ""}</p>
    <div class="recipe-list">${list.map((r) => recipeCard(r)).join("") || '<p class="muted">Aucune recette.</p>'}</div>`;
}

function viewReglages() {
  const p = state.prefs;
  const timeChips = [15, 30, 45].map((t) => `<button class="chip ${p.maxTime === t ? "on" : ""}" data-action="p-time" data-v="${t}">≤ ${t} min</button>`).join("");
  const dislikes = p.dislikes.map((d, i) => `<button class="chip removable" data-action="p-del-dislike" data-i="${i}">${esc(d)}</button>`).join("");
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `
    <div class="field">
      <label>Temps de préparation maximum</label>
      <div class="chips">${timeChips}</div>
    </div>
    <div class="field">
      <label>Repas par semaine</label>
      <div class="stepper"><button data-action="p-meals" data-d="-1">−</button><span>${p.meals} repas</span><button data-action="p-meals" data-d="1">+</button></div>
    </div>
    <div class="field">
      <label>Portions par défaut</label>
      <div class="stepper"><button data-action="p-portions" data-d="-1">−</button><span>${p.portions} pers.</span><button data-action="p-portions" data-d="1">+</button></div>
      <div class="help">Modifiable ensuite pour chaque repas.</div>
    </div>
    <div class="field">
      <label>Ingrédients à éviter</label>
      <form class="add-row" data-form="dislike">
        <input class="input" name="name" placeholder="ex : aubergine, champignons…" autocomplete="off">
        <button class="btn primary" type="submit">＋</button>
      </form>
      <div class="chips">${dislikes || '<span class="muted small">Aucun</span>'}</div>
    </div>

    <div class="section-title">Mon Leclerc Drive</div>
    <div class="field card" style="padding:14px">
      <label>Magasin</label>
      <p class="small" style="margin:0 0 10px">${p.driveUrl ? "Magasin personnalisé" : "Saint-Jean-de-la-Ruelle (par défaut)"}</p>
      <a class="btn sm" href="${esc(driveLink("Courgette"))}" target="_blank" rel="noopener">Tester avec « courgette » ↗</a>
      <div class="help" style="margin-top:14px">
        Changer de magasin : collez l'adresse de la page d'accueil de votre Leclerc Drive (ou d'une recherche « tomate »). Laissez vide pour revenir au magasin par défaut.
      </div>
      <input class="input" style="margin-top:8px" data-input="drive-url" placeholder="https://fdX-courses.leclercdrive.fr/magasin-…" value="${esc(p.driveUrl)}">
    </div>

    ${typeof syncSettingsHtml === "function" ? syncSettingsHtml() : ""}

    <div class="section-title">Installer l'app</div>
    <div class="card" style="padding:14px" >
      <p class="small" style="margin:0">${isIOS
        ? "Sur iPhone : touchez <b>Partager</b> ⬆️ puis <b>Sur l'écran d'accueil</b>."
        : "Sur Android : menu <b>⋮</b> de Chrome puis <b>Installer l'application</b> (ou « Ajouter à l'écran d'accueil »)."}</p>
    </div>

    <div class="section-title">Données</div>
    <button class="btn block" data-action="reset">Réinitialiser l'application</button>
    <p class="muted small" style="text-align:center;margin-top:20px">Repas Healthy · v1 · ${RECIPES.length} recettes<br>${typeof sync !== "undefined" && sync.code ? "Données partagées avec le foyer" : "Données enregistrées sur cet appareil"}</p>`;
}

// ---------- Fiche recette ----------
let sheetState = null;
function openRecipe(id, portions) {
  sheetState = { id, portions: portions || state.prefs.portions };
  renderSheet();
  $("#sheet").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  $("#sheet").hidden = true;
  document.body.style.overflow = "";
  sheetState = null;
}
function renderSheet() {
  const r = byId(sheetState.id);
  const n = sheetState.portions;
  const inMenu = state.menu.some((m) => m.id === r.id);
  $("#sheet").innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${esc(r.title)}">
    <div class="sheet-head"><h2>${esc(r.title)}</h2><button class="icon-btn" data-action="close-sheet" aria-label="Fermer">✕</button></div>
    <div class="hero">${r.emoji}</div>
    <div class="row" style="margin:12px 0"><span class="badge time">⏱ ${r.time} min</span><span class="badge">${PROTEINS[r.protein]}</span><span class="spacer"></span>
      <div class="stepper"><button data-action="sheet-portions" data-d="-1">−</button><span>${n} pers.</span><button data-action="sheet-portions" data-d="1">+</button></div>
    </div>
    ${plateLegend()}
    <div class="section-title">Ingrédients</div>
    <ul class="ing-list">${r.ing.map(([name, q, u]) => `<li><span>${esc(name)}</span><span>${fmtQty(q * n, u)}</span></li>`).join("")}</ul>
    <p class="muted small">+ sel, poivre</p>
    <div class="section-title">Étapes</div>
    <ol class="step-list">${r.steps.map(([t, min], i) => `<li><span class="step-num">${i + 1}</span><span>${esc(t)}${min ? ` <span class="badge time">⏱ ${min} min</span>` : ""}</span></li>`).join("")}</ol>
    <div class="sticky-actions">
      ${inMenu ? "" : `<button class="btn" data-action="sheet-add">＋ Au menu</button>`}
      <button class="btn primary" data-action="sheet-cook">▶️ Cuisiner</button>
    </div>
  </div>`;
}

// ---------- Mode cuisine ----------
let cook = null;       // { id, portions, step }
let timers = [];       // { id, label, total, endsAt, left, paused, ringing }
let wakeLock = null;
let audioCtx = null;
let tickHandle = null;

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch (e) { /* refusé ou non supporté */ }
}
document.addEventListener("visibilitychange", () => {
  if (cook && document.visibilityState === "visible") requestWakeLock();
});

function startCook(id, portions) {
  closeSheet();
  cook = { id, portions: portions || state.prefs.portions, step: 0 };
  $("#cook").hidden = false;
  document.body.style.overflow = "hidden";
  requestWakeLock();
  renderCook();
}
function exitCook() {
  if (timers.some((t) => !t.ringing && t.left > 0) && !confirm("Des minuteurs sont en cours. Quitter le mode cuisine ?")) return;
  cook = null;
  timers = [];
  $("#cook").hidden = true;
  document.body.style.overflow = "";
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

function renderCook() {
  const r = byId(cook.id);
  const total = r.steps.length + 1;
  const s = cook.step;
  let body;
  if (s === 0) {
    body = `<div class="cook-step-label">Préparez les ingrédients · ${cook.portions} pers.</div>
      <ul class="ing-list cook-ings">${r.ing.map(([name, q, u]) => `<li><span>${esc(name)}</span><span class="muted">${fmtQty(q * cook.portions, u)}</span></li>`).join("")}</ul>`;
  } else {
    const [text, min] = r.steps[s - 1];
    const tid = `${r.id}-${s}`;
    const existing = timers.find((t) => t.id === tid);
    body = `<div class="cook-step-label">Étape ${s} / ${r.steps.length}</div>
      <div class="cook-text">${esc(text)}</div>
      ${min ? `<button class="btn primary big-timer" data-action="timer-start" data-tid="${tid}" data-min="${min}" data-label="Étape ${s}">
        ${existing ? "⏱ Minuteur en cours" : `⏱ Lancer ${min} min`}</button>` : ""}`;
  }
  const last = s === total - 1;
  $("#cook").innerHTML = `
    <div class="cook-head">
      <button class="icon-btn" data-action="cook-exit" aria-label="Quitter">✕</button>
      <div class="title">${r.emoji} ${esc(r.title)}</div>
    </div>
    <div class="cook-progress">${Array.from({ length: total }, (_, i) => `<i class="${i <= s ? "on" : ""}"></i>`).join("")}</div>
    <div class="timers" id="timers"></div>
    <div class="cook-body" id="cook-body">${body}</div>
    <div class="cook-nav">
      <button class="btn" data-action="cook-prev" ${s === 0 ? "disabled style='opacity:.4'" : ""}>← Précédent</button>
      <button class="btn primary" data-action="${last ? "cook-finish" : "cook-next"}">${last ? "Terminé 🎉" : "Suivant →"}</button>
    </div>`;
  renderTimers();
}

function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function renderTimers() {
  const el = $("#timers");
  if (!el) return;
  el.innerHTML = timers.map((t) => `<button class="timer-chip ${t.paused ? "paused" : ""} ${t.ringing ? "ring" : ""}" data-action="timer-tap" data-tid="${t.id}">
    ${t.ringing ? "🔔 " + esc(t.label) + " terminé !" : `⏱ ${esc(t.label)} · ${fmtClock(t.left)}${t.paused ? " ⏸" : ""}`}
    <span data-action="timer-del" data-tid="${t.id}" aria-label="Supprimer" style="opacity:.7">✕</span></button>`).join("");
}

function ensureAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) {}
}
function beep() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  for (let i = 0; i < 3; i++) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, now + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.4, now + i * 0.35 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.35 + 0.25);
    o.connect(g).connect(audioCtx.destination);
    o.start(now + i * 0.35);
    o.stop(now + i * 0.35 + 0.3);
  }
}

function startTimer(id, min, label) {
  ensureAudio();
  if (timers.some((t) => t.id === id)) return;
  timers.push({ id, label, total: min * 60, endsAt: Date.now() + min * 60000, left: min * 60, paused: false, ringing: false });
  if (!tickHandle) tickHandle = setInterval(tick, 500);
  renderCook();
}
function tick() {
  if (!timers.length) { clearInterval(tickHandle); tickHandle = null; return; }
  const now = Date.now();
  let ringNow = false;
  for (const t of timers) {
    if (t.paused || t.ringing) continue;
    t.left = (t.endsAt - now) / 1000;
    if (t.left <= 0) { t.ringing = true; t.lastBeep = 0; }
  }
  for (const t of timers) {
    if (t.ringing && now - (t.lastBeep || 0) > 2500) { t.lastBeep = now; ringNow = true; }
  }
  if (ringNow) {
    beep();
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
  }
  renderTimers();
}
function tapTimer(id) {
  const t = timers.find((x) => x.id === id);
  if (!t) return;
  if (t.ringing) { timers = timers.filter((x) => x !== t); }
  else if (t.paused) { t.paused = false; t.endsAt = Date.now() + t.left * 1000; }
  else { t.paused = true; }
  renderCook();
}

// Glisser pour changer d'étape
let touchX = null;
document.addEventListener("touchstart", (e) => { if (cook) touchX = e.touches[0].clientX; }, { passive: true });
document.addEventListener("touchend", (e) => {
  if (!cook || touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  const r = byId(cook.id);
  if (dx < -70 && cook.step < r.steps.length) { cook.step++; renderCook(); }
  else if (dx > 70 && cook.step > 0) { cook.step--; renderCook(); }
}, { passive: true });

// ---------- Événements ----------
document.addEventListener("click", (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) { state.tab = tab.dataset.tab; save(); render(); window.scrollTo(0, 0); return; }

  const go = e.target.closest("[data-goto]");
  if (go) { e.preventDefault(); state.tab = go.dataset.goto; save(); render(); window.scrollTo(0, 0); return; }

  const a = e.target.closest("[data-action]");
  if (!a) {
    const open = e.target.closest("[data-open]");
    if (open) openRecipe(open.dataset.open, Number(open.dataset.portions) || undefined);
    else if (e.target.id === "sheet") closeSheet();
    return;
  }
  const act = a.dataset.action;
  const i = Number(a.dataset.i);
  const p = state.prefs;

  switch (act) {
    case "generate": generateMenu(); render(); break;
    case "regenerate":
      if (!state.menu.length || confirm("Remplacer le menu actuel par un nouveau ?")) { generateMenu(); render(); toast("Nouveau menu généré ✨"); }
      break;
    case "add-random": {
      const inMenu = new Set(state.menu.map((m) => m.id));
      const pool = RECIPES.filter((r) => isEligible(r) && !inMenu.has(r.id));
      if (!pool.length) { toast("Plus de recette disponible avec vos filtres"); break; }
      const r = pool[Math.floor(Math.random() * pool.length)];
      state.menu.push({ id: r.id, portions: p.portions, done: false }); save(); render();
      break;
    }
    case "portions": state.menu[i].portions = Math.min(12, Math.max(1, state.menu[i].portions + Number(a.dataset.d))); save(); render(); break;
    case "swap": swapMeal(i); break;
    case "remove": state.menu.splice(i, 1); save(); render(); break;
    case "toggle-done": state.menu[i].done = !state.menu[i].done; save(); render(); break;
    case "cook": startCook(state.menu[i].id, state.menu[i].portions); break;

    case "check": state.checked[a.dataset.key] = !state.checked[a.dataset.key]; save(); render(); break;
    case "check-extra": state.extras[i].checked = !state.extras[i].checked; save(); render(); break;
    case "del-extra": state.extras.splice(i, 1); save(); render(); break;
    case "quick-extra": state.extras.push({ name: a.dataset.name, checked: false }); save(); render(); break;
    case "uncheck-all": state.checked = {}; state.extras.forEach((x) => (x.checked = false)); save(); render(); break;
    case "copy-list": copyList(); break;
    case "edit-kw": {
      const name = a.dataset.name;
      const v = prompt(`Mot-clé de recherche Leclerc pour « ${name} » :\n(laisser vide pour revenir au mot-clé par défaut)`, searchTerm(name));
      if (v === null) break;
      p.searchOverrides = p.searchOverrides || {};
      if (v.trim()) p.searchOverrides[name] = v.trim(); else delete p.searchOverrides[name];
      save(); render(); toast("Mot-clé enregistré ✓");
      break;
    }

    case "f-time": recipeFilter.time = Number(a.dataset.v); render(); break;
    case "f-prot": recipeFilter.protein = a.dataset.v; render(); break;

    case "p-time": p.maxTime = Number(a.dataset.v); save(); render(); break;
    case "p-meals": p.meals = Math.min(14, Math.max(1, p.meals + Number(a.dataset.d))); save(); render(); break;
    case "p-portions": p.portions = Math.min(12, Math.max(1, p.portions + Number(a.dataset.d))); save(); render(); break;
    case "p-del-dislike": p.dislikes.splice(i, 1); save(); render(); break;
    case "reset":
      if (confirm("Effacer le menu, la liste et les réglages de ce téléphone ? (il quittera aussi le foyer partagé)")) {
        if (typeof syncLeave === "function") syncLeave();
        state = structuredClone(DEFAULT_STATE); save(); render();
      }
      break;

    case "close-sheet": closeSheet(); break;
    case "sheet-portions": sheetState.portions = Math.min(12, Math.max(1, sheetState.portions + Number(a.dataset.d))); renderSheet(); break;
    case "sheet-add": addToMenu(sheetState.id); renderSheet(); render(); break;
    case "sheet-cook": startCook(sheetState.id, sheetState.portions); break;

    case "cook-exit": exitCook(); break;
    case "cook-prev": if (cook.step > 0) { cook.step--; renderCook(); } break;
    case "cook-next": cook.step++; renderCook(); $("#cook-body").scrollTop = 0; break;
    case "cook-finish": {
      const m = state.menu.find((x) => x.id === cook.id);
      if (m) { m.done = true; save(); }
      timers = [];
      exitCook();
      render();
      toast("Bon appétit ! 🍽️");
      break;
    }
    case "timer-start": startTimer(a.dataset.tid, Number(a.dataset.min), a.dataset.label); break;
    case "timer-tap": tapTimer(a.dataset.tid); break;
    case "timer-del": e.stopPropagation(); timers = timers.filter((t) => t.id !== a.dataset.tid); renderCook(); break;
  }
});

document.addEventListener("submit", (e) => {
  const f = e.target.closest("[data-form]");
  if (!f) return;
  e.preventDefault();
  const val = f.elements.name.value.trim();
  if (!val) return;
  if (f.dataset.form === "extra") state.extras.push({ name: val, checked: false });
  if (f.dataset.form === "dislike" && !state.prefs.dislikes.some((d) => norm(d) === norm(val))) state.prefs.dislikes.push(val);
  save();
  render();
  const input = $(`[data-form="${f.dataset.form}"] input`);
  if (input) input.focus();
});

document.addEventListener("input", (e) => {
  const k = e.target.dataset.input;
  if (k === "f-q") {
    recipeFilter.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const inp = $('[data-input="f-q"]');
    inp.focus();
    inp.setSelectionRange(pos, pos);
  }
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.input === "drive-url") {
    state.prefs.driveUrl = e.target.value.trim();
    save();
    render();
    toast(state.prefs.driveUrl ? "Magasin enregistré ✓" : "Magasin par défaut rétabli");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (cook) exitCook(); else if (sheetState) closeSheet(); }
});

function copyList() {
  const items = buildShopping().filter((i) => i.ray !== "X" && !state.checked[i.key]);
  const lines = items.map((i) => `- ${i.name} : ${fmtBuy(i.q, i.unit)}`)
    .concat(state.extras.filter((x) => !x.checked).map((x) => `- ${x.name}`));
  const text = "🛒 Courses de la semaine\n" + lines.join("\n");
  if (navigator.share && /android|iphone|ipad/i.test(navigator.userAgent)) {
    navigator.share({ text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast("Liste copiée ✓"), () => toast("Copie impossible"));
  }
}

// ---------- Démarrage ----------
render();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
