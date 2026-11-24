// Runs once a day on GitHub Actions. Pulls TCGplayer One Piece prices from TCGCSV
// (https://tcgcsv.com), keeps only the characters and chase rarities on the watch list,
// and saves them with a running daily price history to data/onepiece.json.
// Follows TCGCSV's guidelines: once a day, custom User-Agent, short pause between requests.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const BASE = "https://tcgcsv.com/tcgplayer";
const OUT = new URL("../data/onepiece.json", import.meta.url);
const CONFIG = new URL("../data/onepiece-config.json", import.meta.url);
const UA = "CardBuyList/1.0 (personal price tracker; daily GitHub Action)";
// Bump this whenever the filter changes, so the next run rebuilds the list even if prices haven't changed.
const FILTER_VERSION = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path, asText = false) {
  await sleep(150);
  const r = await fetch(path.startsWith("http") ? path : BASE + path, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} for ${path}`);
  return asText ? r.text() : r.json();
}

// Chase cards only: Leaders, Secret Rares, SP, Treasure Rares, promos, and any
// Parallel / Alternate Art / Manga / full-art printing.
const CHASE_RARITIES = new Set(["L", "SEC", "SP", "TR", "LEADER", "SECRET RARE", "SECRET", "SPECIAL", "SPECIAL RARE", "SP CARD", "TREASURE RARE", "TREASURE", "PR", "P", "PROMO"]);
const CHASE_NAME = /\b(parallel|alternate art|alt art|manga|full art|treasure|sp card|special)\b|\(sp\)/i;
export function isChase(name, rarity) {
  if (/^DON!!/i.test(rarity || "") || /\bDON!! Card\b/i.test(name)) return false;
  return CHASE_RARITIES.has((rarity || "").toUpperCase()) || CHASE_NAME.test(name);
}
export function matchCharacter(name, characters) {
  const n = name.toLowerCase();
  return characters.find(c => c.match.some(m => n.includes(m.toLowerCase())))?.label || null;
}
const ext = (p, key) => (p.extendedData || []).find(e => e.name === key || e.displayName === key)?.value || "";

export async function run({ today = new Date().toISOString().slice(0, 10) } = {}) {
  const config = JSON.parse(await readFile(CONFIG, "utf8"));
  let prev = { cards: [] };
  try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch {}
  const prevById = new Map(prev.cards.map(c => [c.id, c]));

  const lastUpdated = (await get("https://tcgcsv.com/last-updated.txt", true)).trim();
  if (prev.source === lastUpdated && prev.filterVersion === FILTER_VERSION) { console.log("TCGCSV hasn't changed since last run. Nothing to do."); return false; }

  const cats = (await get("/categories")).results;
  const cat = cats.find(c => /^one piece card game$/i.test(c.name)) || cats.find(c => /one piece/i.test(c.name) && !/japan/i.test(c.name));
  if (!cat) throw new Error("One Piece category not found");
  const groups = (await get(`/${cat.categoryId}/groups`)).results;

  const cards = [];
  for (const g of groups) {
    let products, prices;
    try {
      products = (await get(`/${cat.categoryId}/${g.groupId}/products`)).results;
      prices = (await get(`/${cat.categoryId}/${g.groupId}/prices`)).results;
    } catch (e) { console.warn(`Skipping ${g.name}: ${e.message}`); continue; }
    const byPid = new Map(products.map(p => [p.productId, p]));
    for (const pr of prices) {
      const p = byPid.get(pr.productId);
      if (!p) continue;
      const rarity = ext(p, "Rarity"), number = ext(p, "Number");
      if (!number) continue; // sealed product, not a card
      const who = matchCharacter(p.name, config.characters);
      if (!who || !isChase(p.name, rarity)) continue;
      const id = `${pr.productId}-${pr.subTypeName || "Normal"}`;
      const market = pr.marketPrice ?? null, low = pr.lowPrice ?? null;
      const old = prevById.get(id);
      const hist = (old?.hist || []).filter(h => h[0] !== today);
      if (market > 0) hist.push([today, market]);
      cards.push({
        id, pid: pr.productId, name: p.name, character: who, number, rarity,
        set: g.name, sub: pr.subTypeName || "", img: p.imageUrl || "", url: p.url || "",
        market, low, hist: hist.slice(-180),
      });
    }
  }
  cards.sort((a, b) => a.character.localeCompare(b.character) || a.number.localeCompare(b.number));
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), source: lastUpdated, filterVersion: FILTER_VERSION, day: today, count: cards.length, cards }));
  console.log(`Saved ${cards.length} One Piece cards from ${groups.length} sets.`);
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) run().catch(e => { console.error(e); process.exit(1); });
