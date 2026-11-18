/* Repas Healthy — partage en temps réel du foyer (Supabase) */
"use strict";

// Clés publiques du projet Supabase (conçues pour être visibles dans une app web).
// La sécurité repose sur le code du foyer, exigé par les fonctions SQL (voir supabase.sql).
const SUPABASE_URL = "https://gvsjugfmvfzrnqbopptz.supabase.co";
const SUPABASE_KEY = "sb_publishable_xr6Dx9RZ5wDr8xtNztq3Xg_k2R1JDju";

const HH_KEY = "rh_household";
const SHARED = ["menu", "checked", "extras", "prefs"];

const sync = { client: null, channel: null, code: null, snap: {}, timer: null, busy: false, rev: 0, dirty: false, status: "off", pendingRender: false };

function syncEnabled() {
  return !!(SUPABASE_URL && SUPABASE_KEY && window.supabase);
}

// ---------- Code du foyer ----------
function genCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O ni 1/I
  const a = new Uint32Array(16);
  crypto.getRandomValues(a);
  return [...a].map((n) => abc[n % 32]).join("");
}
const fmtCode = (c) => c.match(/.{1,4}/g).join("-");
const cleanCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const inviteLink = () => `${location.origin}${location.pathname}?foyer=${sync.code}`;

// ---------- Outils ----------
function snapshot() {
  sync.snap = {};
  for (const f of SHARED) sync.snap[f] = JSON.stringify(state[f] ?? null);
}
function sharedData() {
  const d = {};
  for (const f of SHARED) d[f] = state[f];
  return d;
}
async function rpc(fn, args) {
  const { data, error } = await sync.client.rpc(fn, args);
  if (error) throw error;
  return data;
}
function setStatus(s) {
  sync.status = s;
  const el = document.getElementById("sync-dot");
  if (!el) return;
  el.hidden = s === "off";
  el.dataset.s = s;
  el.title = { on: "Synchronisé avec le foyer", connecting: "Connexion…", err: "Hors ligne : les changements seront envoyés au retour du réseau" }[s] || "";
}
// Ne pas re-dessiner pendant qu'on tape dans un champ
function safeRender() {
  const a = document.activeElement;
  if (a && a.tagName === "INPUT" && a.closest("#view")) { sync.pendingRender = true; return; }
  render();
}
document.addEventListener("focusout", () => {
  if (sync.pendingRender) setTimeout(() => {
    const a = document.activeElement;
    if (!(a && a.tagName === "INPUT")) { sync.pendingRender = false; render(); }
  }, 50);
});

// ---------- Réception ----------
function applyRemote(data) {
  if (!data) return;
  for (const f of SHARED) if (data[f] !== undefined && data[f] !== null) state[f] = data[f];
  state.prefs = { ...DEFAULT_STATE.prefs, ...state.prefs };
  state.checked = state.checked || {};
  state.extras = state.extras || [];
  state.menu = state.menu || [];
  snapshot();
  save(true);
  safeRender();
}
function applyPatch({ path, value }) {
  if (!Array.isArray(path) || !path.length || !SHARED.includes(path[0])) return;
  let obj = state;
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof obj[path[i]] !== "object" || obj[path[i]] === null) obj[path[i]] = {};
    obj = obj[path[i]];
  }
  obj[path[path.length - 1]] = value;
  sync.snap[path[0]] = JSON.stringify(state[path[0]] ?? null);
  save(true);
  safeRender();
}
async function refresh() {
  if (!sync.code || sync.timer || sync.busy) return;
  if (sync.dirty) await pushAll();
  if (!sync.channel) { // la connexion avait échoué au démarrage (hors ligne)
    try { await connect(sync.code, false); } catch (e) { setStatus("err"); }
    return;
  }
  if (sync.dirty) return;
  const rev = sync.rev;
  try {
    const data = await rpc("hh_get", { p_code: sync.code });
    // une modification locale a eu lieu pendant la lecture : on ne l'écrase pas, elle va partir
    if (rev === sync.rev && !sync.timer && !sync.busy) applyRemote(data);
    setStatus("on");
  } catch (e) { setStatus("err"); }
}

// ---------- Envoi ----------
// Appelée par save() dans app.js après chaque modification locale
function syncPush() {
  if (!sync.code || !sync.client) return;
  sync.rev++;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(pushDiff, 300);
}
async function send(ops) {
  sync.busy = true;
  try {
    for (const op of ops) {
      await rpc("hh_set", { p_code: sync.code, p_path: op.path, p_value: op.value });
      if (sync.channel) sync.channel.send({ type: "broadcast", event: "set", payload: op });
    }
    sync.dirty = false;
    setStatus("on");
  } catch (e) {
    sync.dirty = true;
    setStatus("err");
  } finally {
    sync.busy = false;
  }
}
async function pushDiff() {
  sync.timer = null;
  const ops = [];
  for (const f of SHARED) {
    const cur = JSON.stringify(state[f] ?? null);
    if (cur === sync.snap[f]) continue;
    if (f === "checked") {
      // case par case, pour que deux personnes puissent cocher en même temps
      const old = JSON.parse(sync.snap[f] || "{}") || {};
      const now = state.checked || {};
      const changed = [...new Set([...Object.keys(old), ...Object.keys(now)])].filter((k) => !!old[k] !== !!now[k]);
      if (changed.length > 8) ops.push({ path: ["checked"], value: now });
      else for (const k of changed) ops.push({ path: ["checked", k], value: !!now[k] });
    } else {
      ops.push({ path: [f], value: state[f] });
    }
    sync.snap[f] = cur;
  }
  if (ops.length) await send(ops);
}
async function pushAll() {
  snapshot();
  await send(SHARED.map((f) => ({ path: [f], value: state[f] })));
}

// ---------- Connexion ----------
function subscribe() {
  if (sync.channel) sync.client.removeChannel(sync.channel);
  sync.channel = sync.client
    .channel("hh-" + sync.code, { config: { broadcast: { self: false } } })
    .on("broadcast", { event: "set" }, ({ payload }) => applyPatch(payload))
    .subscribe((status) => {
      if (status === "SUBSCRIBED") { setStatus("on"); refresh(); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setStatus("err");
    });
}
async function connect(code, create) {
  setStatus("connecting");
  let data = await rpc("hh_get", { p_code: code });
  if (!data) {
    if (!create) throw new Error("introuvable");
    data = await rpc("hh_create", { p_code: code, p_data: sharedData() });
  }
  sync.code = code;
  try { localStorage.setItem(HH_KEY, code); } catch (e) {}
  applyRemote(data);
  subscribe();
}
async function createHousehold() {
  try {
    await connect(genCode(), true);
    render();
    toast("Foyer créé ✓ Invitez l'autre téléphone");
  } catch (e) {
    setStatus("off");
    toast("Création impossible : vérifiez la connexion");
  }
}
async function joinHousehold(raw) {
  const code = cleanCode(raw);
  if (code.length < 16) return toast("Code incomplet (16 caractères)");
  try {
    await connect(code, false);
    render();
    toast("Foyer rejoint ✓ Tout est synchronisé");
  } catch (e) {
    setStatus("off");
    toast(e.message === "introuvable" ? "Code inconnu" : "Connexion impossible");
  }
}
function syncLeave() {
  if (sync.channel) sync.client.removeChannel(sync.channel);
  sync.channel = null;
  sync.code = null;
  try { localStorage.removeItem(HH_KEY); } catch (e) {}
  setStatus("off");
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});
window.addEventListener("online", () => refresh());

// ---------- Réglages ----------
function syncSettingsHtml() {
  if (!syncEnabled()) return "";
  if (!sync.code) {
    return `<div class="section-title">Partage avec le foyer</div>
    <div class="card" style="padding:14px">
      <p class="small" style="margin-top:0">Le menu et la liste de courses identiques et à jour sur vos deux téléphones.</p>
      <button class="btn primary block" data-sync="create">👨‍👩‍👧 Créer notre foyer partagé</button>
      <div class="help" style="margin:16px 0 8px">Déjà un foyer sur l'autre téléphone ? Entrez son code :</div>
      <form class="add-row" data-sync-form="join">
        <input class="input" name="code" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <button class="btn primary" type="submit">OK</button>
      </form>
    </div>`;
  }
  const label = { on: "🟢 Synchronisé", connecting: "🟡 Connexion…", err: "🔴 Hors ligne (envoi au retour du réseau)" }[sync.status] || "";
  return `<div class="section-title">Partage avec le foyer</div>
    <div class="card" style="padding:14px">
      <p class="small" style="margin-top:0">${label}</p>
      <div class="help" style="margin-bottom:6px">Code du foyer, à saisir sur l'autre téléphone (Réglages → Partage) :</div>
      <div class="code-box">${fmtCode(sync.code)}</div>
      <div class="row" style="margin-top:12px; flex-wrap:wrap">
        <button class="btn sm primary" data-sync="invite">📤 Envoyer l'invitation</button>
        <button class="btn sm" data-sync="copy">📋 Copier le code</button>
        <span class="spacer"></span>
        <button class="btn sm ghost" data-sync="leave">Quitter</button>
      </div>
    </div>`;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-sync]");
  if (!b) return;
  const act = b.dataset.sync;
  if (act === "create") createHousehold();
  if (act === "copy") {
    navigator.clipboard?.writeText(fmtCode(sync.code)).then(() => toast("Code copié ✓"), () => toast(fmtCode(sync.code)));
  }
  if (act === "invite") {
    const text = `Rejoins notre foyer Repas Healthy 🥗\n1. Ouvre ${location.origin}${location.pathname} et installe l'app sur l'écran d'accueil\n2. Dans l'app : Réglages → Partage → entre le code ${fmtCode(sync.code)}\n\n(ou ouvre directement ce lien : ${inviteLink()})`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(() => toast("Invitation copiée ✓"));
  }
  if (act === "leave" && confirm("Quitter le foyer ? Ce téléphone gardera une copie du menu, mais ne sera plus synchronisé.")) {
    syncLeave();
    render();
  }
});
document.addEventListener("submit", (e) => {
  const f = e.target.closest("[data-sync-form]");
  if (!f) return;
  e.preventDefault();
  const code = f.elements.code.value;
  if (state.menu.length && !confirm("Rejoindre ce foyer ? Le menu et la liste de ce téléphone seront remplacés par ceux du foyer.")) return;
  joinHousehold(code);
});

// ---------- Démarrage ----------
(function syncInit() {
  if (!syncEnabled()) return;
  sync.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const fromUrl = cleanCode(new URLSearchParams(location.search).get("foyer"));
  let saved = null;
  try { saved = localStorage.getItem(HH_KEY); } catch (e) {}
  if (fromUrl) {
    history.replaceState(null, "", location.pathname);
    if (fromUrl !== saved && confirm("Rejoindre le foyer partagé ? Le menu et la liste de ce téléphone seront remplacés par ceux du foyer.")) {
      joinHousehold(fromUrl);
      return;
    }
  }
  if (saved) {
    sync.code = saved;
    snapshot();
    connect(saved, false).catch(() => setStatus("err"));
  }
})();
