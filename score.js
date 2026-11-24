// Buy-timing score. Pure functions so they can be tested on their own.
(function (root) {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // hist: [[sourceDate, price], ...] oldest first, NOT including today's price
  // p: { price, market, low, cm: {avg1, avg7, avg30}, updated }
  function scoreCard(p, hist, now, fmt) {
    fmt = fmt || (v => `$${v.toFixed(2)}`);
    const reasons = [];
    if (!p || !(p.price > 0)) return { score: null, label: "No price", reasons: ["No price data for this card yet."], newLow: false };
    let s = 50;
    const price = p.price;

    // 1. Where today's price sits vs. 30-day average (Cardmarket sales averages)
    const cm = p.cm || {};
    if (cm.avg30 > 0 && cm.avg1 > 0) {
      const dip = (cm.avg30 - cm.avg1) / cm.avg30; // + means cheaper than usual
      s += clamp(dip / 0.2, -1, 1) * 25;
      if (dip > 0.03) reasons.push(`Selling ${Math.round(dip * 100)}% under its 30-day average`);
      else if (dip < -0.03) reasons.push(`Selling ${Math.round(-dip * 100)}% over its 30-day average`);
      else reasons.push("Selling right around its 30-day average");

      // 2. Direction: still sliding, or levelling off?
      if (cm.avg7 > 0) {
        if (cm.avg1 < cm.avg7 && cm.avg7 < cm.avg30) { s -= 4; reasons.push("Still trending down, could dip more"); }
        else if (cm.avg7 < cm.avg30 && cm.avg1 >= cm.avg7) { s += 6; reasons.push("Dropped this month and now levelling off"); }
        else if (cm.avg1 > cm.avg7 && cm.avg7 > cm.avg30) { s -= 6; reasons.push("Climbing, price is rising"); }
      }
    }

    // 3. Your own price history (one point each time the source updates)
    let newLow = false;
    const prev = (hist || []).map(h => h[1]).filter(v => v > 0);
    if (prev.length >= 2) {
      const lo = Math.min(...prev), hi = Math.max(...prev);
      if (price < lo) { newLow = true; s += 15; reasons.unshift(`New low: under the previous low of ${fmt(lo)}`); }
      else if (hi > lo) {
        const pos = (price - lo) / (hi - lo); // 0 = at the low, 1 = at the high
        s += (0.5 - pos) * 24;
        if (pos <= 0.15) reasons.push("Near the lowest price you've tracked");
        else if (pos >= 0.85) reasons.push("Near the highest price you've tracked");
      }
    } else {
      reasons.push("Building price history (needs a few updates)");
    }

    // 4. A cheap listing available right now
    if (p.low > 0 && p.market > 0 && p.low < p.market * 0.85 && !p.usesLow) {
      s += 4; reasons.push(`Listings from ${fmt(p.low)} (check condition)`);
    }

    // 5. Stale data lowers confidence
    let stale = false;
    if (p.updated) {
      const days = (now - new Date(p.updated).getTime()) / 864e5;
      if (days > 14) { stale = true; s = 50 + (s - 50) * 0.5; reasons.push(`Prices last updated ${Math.round(days)} days ago`); }
    }

    s = Math.round(clamp(s, 0, 100));
    const label = s >= 68 ? "Good time to buy" : s >= 45 ? "Fair price" : "Wait";
    return { score: s, label, reasons, newLow, stale };
  }

  root.scoreCard = scoreCard;
  if (typeof module !== "undefined") module.exports = { scoreCard };
})(typeof window !== "undefined" ? window : globalThis);
