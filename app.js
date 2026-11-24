{
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const TCGDEX = "https://api.tcgdex.net/v2/en";
const PTCG = "https://api.pokemontcg.io/v2";
const REFRESH_MS = 6 * 3600e3;

const keyOf = c => [c.name, c.num, c.tot, c.hint].join("|");
let cards = load("cw.cards", null);
if (!cards) {
  cards = window.STARTER_CARDS.map(([name, num, tot, hint, old]) => ({ name, num, tot, hint, old: !!old }));
  save("cw.cards", cards);
}
let res = load("cw.res", {});      // key -> {src, id} or {fail:true}
let last = load("cw.last", {});    // key -> latest price info
let hist = load("cw.hist", {});    // key -> [[sourceDate, price], ...]
let settings = Object.assign({ cur: "CAD", cad: 1.38, autoRate: true, rateDate: "" }, load("cw.settings", {}));
let filter = "all", sort = "score", query = "";
let busy = false;

// ---------- networking ----------
async function getJSON(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function pool(items, n, fn) {
  let i = 0; const run = async () => { while (i < items.length) { const k = i++; try { await fn(items[k], k); } catch {} } };
  await Promise.all(Array.from({ length: n }, run));
}
const longestWord = name => (name.match(/[A-Za-zÀ-ÿ]+/g) || [name]).sort((a, b) => b.length - a.length)[0];
const stripZeros = n => /^\d+$/.test(n) ? String(parseInt(n, 10)) : n;
function matchScore(c, setName, setTotal, cardName) {
  let s = 0;
  if (c.tot && setTotal && +setTotal === +c.tot) s += 3;
  if (c.hint && setName) for (const w of c.hint.toLowerCase().split(/\s+/)) if (w.length > 2 && setName.toLowerCase().includes(w)) s += 1;
  if (cardName && cardName.toLowerCase().replace(/[^a-z]/g, "") === c.name.toLowerCase().replace(/[^a-z]/g, "")) s += 2;
  return s;
}

// TCGdex (primary, no key, updates daily)
function fromTcgdex(d) {
  const tp = d.pricing?.tcgplayer || {}, cmRaw = d.pricing?.cardmarket || {};
  const vk = Object.keys(tp).filter(k => typeof tp[k] === "object");
  const pick = ["holofoil", "holo", "normal", "reverse", "reverse-holofoil"].find(k => vk.includes(k)) || vk[0];
  const v = pick ? tp[pick] : {};
  const holo = /holo/.test(pick || "") && cmRaw["avg1-holo"] > 0;
  const sfx = holo ? "-holo" : "";
  return {
    src: "tcgdex", id: d.id, name: d.name, setName: d.set?.name, num: d.localId,
    img: d.image ? d.image + "/low.webp" : "",
    market: v?.marketPrice || 0, low: v?.lowPrice || 0,
    cm: { avg1: cmRaw["avg1" + sfx] || 0, avg7: cmRaw["avg7" + sfx] || 0, avg30: cmRaw["avg30" + sfx] || 0 },
    updated: tp.updated || cmRaw.updated || null,
  };
}
async function resolveTcgdex(c) {
  const word = longestWord(c.name);
  let list = [];
  for (const n of [...new Set([stripZeros(c.num), c.num])]) {
    list = await getJSON(`${TCGDEX}/cards?name=like:${encodeURIComponent(word)}&localId=eq:${encodeURIComponent(n)}`).catch(() => []);
    if (list.length) break;
  }
  if (!list.length) return null;
  const details = [];
  await pool(list.slice(0, 6), 3, async b => details.push(await getJSON(`${TCGDEX}/cards/${encodeURIComponent(b.id)}`)));
  details.sort((a, b) => matchScore(c, b.set?.name, b.set?.cardCount?.official, b.name) - matchScore(c, a.set?.name, a.set?.cardCount?.official, a.name));
  return details[0] ? fromTcgdex(details[0]) : null;
}

// pokemontcg.io (fallback)
function fromPtcg(d) {
  const tp = d.tcgplayer?.prices || {};
  const pick = ["holofoil", "unlimitedHolofoil", "1stEditionHolofoil", "normal", "reverseHolofoil"].find(k => tp[k]) || Object.keys(tp)[0];
  const v = pick ? tp[pick] : {};
  const cm = d.cardmarket?.prices || {};
  return {
    src: "ptcg", id: d.id, name: d.name, setName: d.set?.name, num: d.number,
    img: d.images?.small || "", market: v?.market || 0, low: v?.low || 0,
    cm: { avg1: cm.avg1 || 0, avg7: cm.avg7 || 0, avg30: cm.avg30 || 0 },
    updated: d.tcgplayer?.updatedAt ? d.tcgplayer.updatedAt.replace(/\//g, "-") : null,
  };
}
async function resolvePtcg(c) {
  const word = longestWord(c.name);
  for (const n of [...new Set([stripZeros(c.num), c.num])]) {
    const q = encodeURIComponent(`name:*${word}* number:${n}`);
    const r = await getJSON(`${PTCG}/cards?q=${q}&pageSize=10`).catch(() => ({ data: [] }));
    if (r.data?.length) {
      r.data.sort((a, b) => matchScore(c, b.set?.name, b.set?.printedTotal, b.name) - matchScore(c, a.set?.name, a.set?.printedTotal, a.name));
      return fromPtcg(r.data[0]);
    }
  }
  return null;
}

async function fetchById(r) {
  if (r.src === "tcgdex") return fromTcgdex(await getJSON(`${TCGDEX}/cards/${encodeURIComponent(r.id)}`));
  return fromPtcg((await getJSON(`${PTCG}/cards/${encodeURIComponent(r.id)}`)).data);
}

function record(c, info) {
  const k = keyOf(c);
  info.price = c.old ? (info.low || info.market) : (info.market || info.low);
  info.usesLow = c.old;
  info.fetched = Date.now();
  // One history point per source update (the stamp is the source's own date)
  const h = hist[k] || [];
  info.stamp = info.updated || new Date().toISOString().slice(0, 10);
  if (info.price > 0) {
    const same = h.find(x => x[0] === info.stamp);
    if (same) same[1] = info.price; else h.push([info.stamp, info.price]);
  }
  hist[k] = h.slice(-120);
  last[k] = info;
}

async function refresh(force) {
  if (busy) return; busy = true;
  const todo = cards.filter(c => force || !last[keyOf(c)] || Date.now() - last[keyOf(c)].fetched > REFRESH_MS);
  let done = 0; status(`Updating prices 0/${todo.length}`);
  await pool(todo, 4, async c => {
    const k = keyOf(c);
    try {
      let info = null;
      if (res[k]?.id) info = await fetchById(res[k]).catch(() => null);
      if (!info && !res[k]?.manual) { info = await resolveTcgdex(c); if (!info || !(info.market || info.low)) info = (await resolvePtcg(c)) || info; }
      if (info) { res[k] = { src: info.src, id: info.id, manual: res[k]?.manual }; record(c, info); }
      else res[k] = { fail: true };
    } finally { done++; if (done % 8 === 0 || done === todo.length) { status(`Updating prices ${done}/${todo.length}`); persist(); render(); } }
  });
  persist(); busy = false; status(todo.length ? `Updated ${new Date().toLocaleTimeString()}` : "Prices are up to date"); render(); notifyLows();
}
const persist = () => { save("cw.res", res); save("cw.last", last); save("cw.hist", hist); save("cw.cards", cards); };
const status = (t, g = "pokemon") => { if (g === game) $("#status").textContent = t; };
let armedK = null; // a Remove button waiting for its confirming second tap

// ---------- scoring + render ----------
const inCur = (v, cur) => cur === "CAD" ? v * settings.cad : v;
const money = (v, cur = settings.cur) => v > 0 ? `${cur === "CAD" ? "C$" : "US$"}${inCur(v, cur).toFixed(2)}` : "–";
async function updateRate() {
  const today = new Date().toLocaleDateString("en-CA");
  if (!settings.autoRate || settings.rateDate === today) return;
  try {
    const r = await getJSON("https://api.frankfurter.app/latest?from=USD&to=CAD");
    if (r?.rates?.CAD > 0) { settings.cad = r.rates.CAD; settings.rateDate = today; save("cw.settings", settings); $("#cad").value = settings.cad; showRate(); render(); }
  } catch {}
}
const showRate = () => { $("#rate").textContent = `1 US$ = ${settings.cad.toFixed(4)} C$${settings.rateDate ? " (updated " + settings.rateDate + ")" : " (set by you)"}`; };
// ---------- One Piece (prices saved daily into data/onepiece.json by the GitHub job) ----------
let game = settings.game === "op" ? "op" : "pokemon";
let op = null, opLoaded = false;
let opHidden = load("cw.opHidden", {});
let character = "";
async function loadOP() {
  status("Loading One Piece prices…", "op");
  try { op = await getJSON("data/onepiece.json?t=" + Date.now()); } catch { op = null; }
  opLoaded = true;
  if (op?.cards) {
    const chars = [...new Set(op.cards.map(c => c.character))].sort();
    $("#char").innerHTML = `<option value="">All characters</option>` + chars.map(c => `<option${c === character ? " selected" : ""}>${esc(c)}</option>`).join("");
  }
  status(op?.day ? `One Piece prices from ${op.day} (updates once a day)` : "One Piece prices aren't set up yet", "op");
  if (game === "op") { render(); notifyLows(); }
}
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
function opRows(now) {
  if (!op?.cards) return [];
  return op.cards.filter(c => !opHidden[c.id]).map(c => {
    const h = (c.hist || []).filter(x => x[1] > 0), vals = h.map(x => x[1]);
    // Use the job's own daily history for the 7- and 30-day averages once there's enough of it
    const cm = vals.length >= 8 && c.market > 0 ? { avg1: c.market, avg7: mean(vals.slice(-7)), avg30: mean(vals.slice(-30)) } : {};
    const info = { name: c.name, setName: c.set, num: c.number, img: c.img, url: c.url, rarity: c.rarity, sub: c.sub, character: c.character,
      market: c.market || 0, low: c.low || 0, price: c.market || c.low || 0, cm, updated: op.updated };
    const sc = scoreCard(info, h.filter(x => x[0] !== op.day), now, v => money(v));
    return { c: { name: c.name, num: c.number, tot: "", hint: c.set, old: false, op: true, character: c.character }, k: "op:" + c.id, info, sc, fail: false };
  });
}
function rows() {
  const now = Date.now();
  if (game === "op") return opRows(now);
  return cards.map(c => {
    const k = keyOf(c), info = last[k];
    const sc = scoreCard(info, (hist[k] || []).filter(x => x[0] !== info?.stamp), now, v => money(v));
    return { c, k, info, sc, fail: res[k]?.fail };
  });
}
function links(c, info) {
  const q = `${info?.name || c.name} ${c.num}`;
  if (c.op) {
    const base = info?.url || `https://www.tcgplayer.com/search/one-piece-card-game/product?q=${encodeURIComponent(q)}`;
    const tcgOp = base + (base.includes("?") ? "&" : "?") + "Condition=Near+Mint";
    const clean = (info?.name || c.name).replace(/\(.*?\)/g, " ");
    const ebayOp = `https://www.ebay.ca/sch/i.html?_nkw=${encodeURIComponent(clean + " " + c.num + " -psa -bgs -cgc -sgc -graded -slab -beckett")}&LH_Sold=1&LH_Complete=1`;
    return `<a href="${esc(tcgOp)}" target="_blank" rel="noopener">TCGplayer (NM)</a><a href="${esc(ebayOp)}" target="_blank" rel="noopener">eBay sold</a>`;
  }
  const tcg = `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(q)}${c.old ? "" : "&Condition=Near+Mint"}`;
  // Leave out graded slabs so eBay shows raw-card sales only
  const noGraded = " -psa -bgs -cgc -sgc -graded -slab -beckett";
  const ebay = `https://www.ebay.ca/sch/i.html?_nkw=${encodeURIComponent(q + (info?.setName ? " " + info.setName : "") + noGraded)}&LH_Sold=1&LH_Complete=1`;
  return `<a href="${esc(tcg)}" target="_blank" rel="noopener">TCGplayer${c.old ? "" : " (NM)"}</a><a href="${esc(ebay)}" target="_blank" rel="noopener">eBay sold</a>`;
}
function render() {
  let list = rows();
  const lows = list.filter(r => r.sc.newLow), good = list.filter(r => r.sc.score >= 68);
  $("#stat-n").textContent = list.length;
  $("#stat-good").textContent = good.length;
  $("#stat-low").textContent = lows.length;
  if (query) list = list.filter(r => (r.c.name + " " + (r.info?.setName || r.c.hint) + " " + (r.c.character || "")).toLowerCase().includes(query));
  if (game === "op" && character) list = list.filter(r => r.c.character === character);
  if (filter === "good") list = list.filter(r => r.sc.score >= 68);
  if (filter === "low") list = list.filter(r => r.sc.newLow);
  if (filter === "fix") list = list.filter(r => r.fail || !r.info?.price);
  const sorters = {
    score: (a, b) => (b.sc.newLow - a.sc.newLow) || ((b.sc.score ?? -1) - (a.sc.score ?? -1)),
    price: (a, b) => (b.info?.price || 0) - (a.info?.price || 0),
    name: (a, b) => a.c.name.localeCompare(b.c.name),
  };
  list.sort(sorters[sort]);
  const other = v => v > 0 ? `<small>${settings.cur === "CAD" ? money(v, "USD") + " on TCGplayer" : "≈ " + money(v, "CAD")}</small>` : "";
  $("#list").innerHTML = list.length ? list.map((r, i) => {
    const { c, info, sc } = r, cls = sc.score == null ? "none" : sc.score >= 68 ? "good" : sc.score >= 45 ? "fair" : "wait";
    return `<li class="row ${sc.newLow ? "is-low" : ""}">
      <div class="rank">${i + 1}</div>
      ${info?.img ? `<img src="${esc(info.img)}" alt="" loading="lazy">` : `<div class="noimg"></div>`}
      <div class="body">
        <div class="top"><strong>${esc(info?.name || c.name)}</strong>${sc.newLow ? `<span class="tag low">New low</span>` : ""}</div>
        <div class="meta">${c.op
          ? `${esc(info.setName)} · ${esc(c.num)} · ${esc(info.rarity)}${info.sub && info.sub !== "Normal" ? " · " + esc(info.sub) : ""}`
          : `${esc(info?.setName || c.hint || "Set unknown")} · #${esc(c.num)}${c.tot ? "/" + esc(c.tot) : ""}
          <button class="cond" data-k="${esc(r.k)}" title="Tap to change">${c.old ? "Played OK" : "Near mint"}</button>`}</div>
        <ul class="why">${sc.reasons.slice(0, 3).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
        <div class="links">${links(c, info)}${!c.op && (r.fail || !info?.price) ? `<button class="fix" data-k="${esc(r.k)}">Fix match</button>` : ""}<button class="rm" data-k="${esc(r.k)}">${armedK === r.k ? (c.op ? "Tap again to hide" : "Tap again to remove") : "Remove"}</button></div>
      </div>
      <div class="side">
        <div class="pill ${cls}">${sc.score ?? "–"}</div>
        <div class="lbl">${esc(sc.label)}</div>
        <div class="price">${money(info?.price)}${c.old ? "<small>lowest listing</small>" : ""}${other(info?.price)}</div>
      </div></li>`;
  }).join("") : `<li class="empty">${game === "op"
      ? (!opLoaded ? "Loading One Piece prices…" : !op?.cards ? "One Piece prices aren't set up yet. The README explains the one-time GitHub setup; after that, prices show up here once a day." : "No cards match.")
      : busy ? "Loading prices…" : "Nothing here yet."}</li>`;
}

// ---------- alerts ----------
function notifyLows() {
  const lows = rows().filter(r => r.sc.newLow);
  const seen = load("cw.seenLows", {});
  const fresh = lows.filter(r => seen[r.k] !== r.info.price);
  const b = $("#banner");
  if (fresh.length) {
    b.hidden = false;
    b.innerHTML = `<strong>${fresh.length} new low${fresh.length > 1 ? "s" : ""}:</strong> ${fresh.slice(0, 4).map(r => esc(r.info.name) + " " + money(r.info.price)).join(", ")}${fresh.length > 4 ? "…" : ""} <button id="seen">Got it</button>`;
    $("#seen").onclick = () => { fresh.forEach(r => seen[r.k] = r.info.price); save("cw.seenLows", seen); b.hidden = true; };
    try { if (window.Notification && Notification.permission === "granted") new Notification("New card price lows", { body: fresh.slice(0, 3).map(r => `${r.info.name} ${money(r.info.price)}`).join("\n"), icon: "icon-192.png" }); } catch {}
  } else b.hidden = true;
}

// ---------- search / add / fix ----------
let pickFor = null;
async function search(q) {
  const out = $("#results"); out.innerHTML = "<p>Searching…</p>";
  try {
    const list = await getJSON(`${TCGDEX}/cards?name=like:${encodeURIComponent(q)}&pagination:itemsPerPage=40`);
    out.innerHTML = list.length ? list.slice(0, 40).map(b => `<button class="hit" data-id="${esc(b.id)}">${b.image ? `<img src="${esc(b.image)}/low.webp" alt="" loading="lazy">` : ""}<span>${esc(b.name)}<small>${esc(b.id)}</small></span></button>`).join("") : "<p>No matches.</p>";
  } catch { out.innerHTML = "<p>Search failed. Check your connection.</p>"; }
}
async function pick(id) {
  const d = fromTcgdex(await getJSON(`${TCGDEX}/cards/${encodeURIComponent(id)}`));
  let c = pickFor;
  if (!c) { c = { name: d.name, num: d.num, tot: "", hint: d.setName || "", old: false }; cards.push(c); }
  res[keyOf(c)] = { src: "tcgdex", id: d.id, manual: true };
  record(c, d); persist(); $("#dlg").close(); render();
}

// ---------- events ----------
$("#refresh").onclick = () => game === "op" ? loadOP() : refresh(true);
const setGame = g => {
  game = g; settings.game = g; save("cw.settings", settings);
  document.querySelectorAll(".game button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.game === g)));
  document.body.dataset.game = g;
  $("#title-word").textContent = g === "op" ? "One Piece" : "Pokémon";
  if (g === "op") { if (!opLoaded) loadOP(); else status(op?.day ? `One Piece prices from ${op.day} (updates once a day)` : "One Piece prices aren't set up yet", "op"); }
  else status(busy ? "Updating prices…" : "Pokémon prices");
  render(); notifyLows();
};
document.querySelectorAll(".game button").forEach(b => b.onclick = () => setGame(b.dataset.game));
$("#char").onchange = e => { character = e.target.value; render(); };
$("#q").oninput = e => { query = e.target.value.trim().toLowerCase(); render(); };
$("#sort").onchange = e => { sort = e.target.value; render(); };
document.querySelectorAll(".chip").forEach(b => b.onclick = () => {
  document.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", "false"));
  b.setAttribute("aria-pressed", "true"); filter = b.dataset.f; render();
});
$("#list").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.k?.startsWith("op:")) {
    if (b.classList.contains("rm")) {
      if (armedK === b.dataset.k) { opHidden[b.dataset.k.slice(3)] = 1; save("cw.opHidden", opHidden); armedK = null; notifyLows(); }
      else armedK = b.dataset.k;
      render();
    }
    return;
  }
  const c = cards.find(x => keyOf(x) === b.dataset.k); if (!c) return;
  if (b.classList.contains("cond")) {
    const ok = keyOf(c); c.old = !c.old;
    // Price basis changes (market vs lowest listing), so restart this card's history
    if (last[ok]) { hist[ok] = []; record(c, last[ok]); }
    persist(); render();
  } else if (b.classList.contains("rm")) {
    if (armedK === b.dataset.k) { cards = cards.filter(x => x !== c); armedK = null; persist(); }
    else armedK = b.dataset.k;
    render();
  } else if (b.classList.contains("fix")) {
    pickFor = c; $("#dlg-title").textContent = `Pick the right card: ${c.name} #${c.num}`;
    $("#sq").value = longestWord(c.name); $("#dlg").showModal(); search($("#sq").value);
  }
};
$("#add").onclick = () => { pickFor = null; $("#dlg-title").textContent = "Add a card"; $("#sq").value = ""; $("#results").innerHTML = ""; $("#dlg").showModal(); $("#sq").focus(); };
$("#sform").onsubmit = e => { e.preventDefault(); const v = $("#sq").value.trim(); if (v) search(v); };
$("#results").onclick = e => { const h = e.target.closest(".hit"); if (h) pick(h.dataset.id).catch(() => { $("#results").insertAdjacentHTML("afterbegin", "<p>Couldn't load that card.</p>"); }); };
$("#close").onclick = () => $("#dlg").close();
$("#cad").value = settings.cad; $("#autorate").checked = settings.autoRate; showRate();
const setCur = cur => { settings.cur = cur; save("cw.settings", settings); document.querySelectorAll(".cur button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.cur === cur))); render(); };
document.querySelectorAll(".cur button").forEach(b => b.onclick = () => setCur(b.dataset.cur));
setCur(settings.cur);
$("#cad").onchange = e => { const v = parseFloat(e.target.value); if (v > 0) { settings.cad = v; settings.autoRate = false; settings.rateDate = ""; $("#autorate").checked = false; save("cw.settings", settings); showRate(); render(); } };
$("#autorate").onchange = e => { settings.autoRate = e.target.checked; settings.rateDate = ""; save("cw.settings", settings); updateRate(); };
$("#notif").onclick = async () => {
  try { const p = await Notification.requestPermission(); $("#notif").textContent = p === "granted" ? "Notifications on" : "Notifications blocked"; }
  catch { $("#notif").textContent = "Not supported here"; }
};
if (window.Notification && Notification.permission === "granted") $("#notif").textContent = "Notifications on";
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

setGame(game); updateRate(); refresh(false); loadOP();
}
