(() => {
  const RANGE_START = "2026-04-06";
  const RANGE_END = "2026-10-08";
  const RB = "https://rocket-boys.co.jp/security-measures-lab/";
  const DOW = ["月", "", "水", "", "金", "", ""];

  const rows = LEAKS
    .filter((r) => r.d >= RANGE_START && r.d <= RANGE_END)
    .map((r) => ({ ...r, src: r.src.map((s) => (s.startsWith("rb:") ? RB + s.slice(3) : s)) }));

  const state = { q: "", month: "", cause: "", size: "", day: "", sortKey: "d", sortDir: -1 };

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => n.toLocaleString("ja-JP");
  const compact = (n) => new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  const fmtDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${y}年${m}月${d}日`; };
  const hostLabel = (url) => {
    const h = new URL(url).hostname.replace(/^www\d?\./, "");
    return h === "rocket-boys.co.jp" ? "セキュリティ対策Lab" : h;
  };
  // Dates are handled as UTC midnights so day arithmetic never drifts with DST.
  const toUTC = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const toISO = (dt) => dt.toISOString().slice(0, 10);

  // ── Per-day index ────────────────────────────────────────
  const byDay = new Map();
  rows.forEach((r) => { if (!byDay.has(r.d)) byDay.set(r.d, []); byDay.get(r.d).push(r); });

  // ── Calendar heatmap ─────────────────────────────────────────
  const level = (n) => (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4);
  const cal = $("#calendar");
  const tip = $("#tooltip");

  function buildCalendar() {
    const start = toUTC(RANGE_START);
    const end = toUTC(RANGE_END);
    // Grid starts on the Monday on/before RANGE_START.
    const gridStart = new Date(start);
    gridStart.setUTCDate(gridStart.getUTCDate() - ((gridStart.getUTCDay() + 6) % 7));
    const frag = document.createDocumentFragment();

    // Day-of-week labels column.
    frag.appendChild(Object.assign(document.createElement("span"), { className: "month-label" }));
    DOW.forEach((t) => frag.appendChild(Object.assign(document.createElement("span"), { className: "dow", textContent: t })));

    let lastMonth = -1;
    for (let wk = new Date(gridStart); wk <= end; wk.setUTCDate(wk.getUTCDate() + 7)) {
      // Month label sits above the first week containing the 1st (or the range start).
      const label = document.createElement("span");
      label.className = "month-label";
      for (let i = 0; i < 7; i++) {
        const dt = new Date(wk); dt.setUTCDate(dt.getUTCDate() + i);
        if (dt >= start && dt <= end && dt.getUTCMonth() !== lastMonth) {
          lastMonth = dt.getUTCMonth();
          label.textContent = `${lastMonth + 1}月`;
          break;
        }
      }
      frag.appendChild(label);

      for (let i = 0; i < 7; i++) {
        const dt = new Date(wk); dt.setUTCDate(dt.getUTCDate() + i);
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "day";
        if (dt < start || dt > end) {
          cell.classList.add("empty");
          cell.tabIndex = -1;
          cell.setAttribute("aria-hidden", "true");
        } else {
          const iso = toISO(dt);
          const n = (byDay.get(iso) || []).length;
          cell.dataset.date = iso;
          cell.classList.add(`lv${level(n)}`);
          cell.setAttribute("aria-label", `${fmtDate(iso)}：${n}件`);
        }
        frag.appendChild(cell);
      }
    }
    cal.appendChild(frag);
  }

  function showTip(cell) {
    const iso = cell.dataset.date;
    const list = byDay.get(iso) || [];
    const names = list.slice(0, 8).map((r) => `<li>${esc(r.ja)}${r.n != null ? `（${compact(r.n)}）` : ""}</li>`).join("");
    const more = list.length > 8 ? `<li>ほか${list.length - 8}件</li>` : "";
    tip.innerHTML = `<strong>${fmtDate(iso)}：${list.length}件</strong>${list.length ? `<ul>${names}${more}</ul>` : ""}`;
    tip.hidden = false;
    const r = cell.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(8, Math.min(x, innerWidth - tw - 8));
    let y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  cal.addEventListener("mouseover", (e) => { const c = e.target.closest(".day[data-date]"); if (c) showTip(c); });
  cal.addEventListener("mouseleave", () => { tip.hidden = true; });
  cal.addEventListener("focusin", (e) => { const c = e.target.closest(".day[data-date]"); if (c) showTip(c); });
  cal.addEventListener("focusout", () => { tip.hidden = true; });
  cal.addEventListener("click", (e) => {
    const c = e.target.closest(".day[data-date]");
    if (!c) return;
    state.day = state.day === c.dataset.date ? "" : c.dataset.date;
    if (state.day) state.month = "";
    $("#f-month").value = state.month;
    render();
  });

  // ── Filters ──────────────────────────────────────────────────
  const monthSel = $("#f-month");
  [...new Set(rows.map((r) => r.d.slice(0, 7)))].sort().reverse().forEach((ym) => {
    const [y, m] = ym.split("-").map(Number);
    monthSel.add(new Option(`${y}年${m}月`, ym));
  });
  const causeSel = $("#f-cause");
  [...new Set(rows.map((r) => r.cause))].sort((a, b) => a.localeCompare(b, "ja")).forEach((c) => causeSel.add(new Option(c, c)));

  $("#q").addEventListener("input", (e) => { state.q = e.target.value.trim().toLowerCase(); render(); });
  monthSel.addEventListener("change", (e) => { state.month = e.target.value; state.day = ""; render(); });
  causeSel.addEventListener("change", (e) => { state.cause = e.target.value; render(); });
  $("#f-size").addEventListener("change", (e) => { state.size = e.target.value; render(); });
  $("#clear").addEventListener("click", () => {
    Object.assign(state, { q: "", month: "", cause: "", size: "", day: "" });
    $("#q").value = ""; monthSel.value = ""; causeSel.value = ""; $("#f-size").value = "";
    render();
  });

  document.querySelectorAll("thead button[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sort;
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = key === "ja" || key === "cause" ? 1 : -1; }
      render();
    });
  });

  function matches(r) {
    if (state.day && r.d !== state.day) return false;
    if (state.month && !r.d.startsWith(state.month)) return false;
    if (state.cause && r.cause !== state.cause) return false;
    if (state.size === "known" && r.n == null) return false;
    if (state.size === "unknown" && r.n != null) return false;
    if (/^\d+$/.test(state.size) && !(r.n >= Number(state.size))) return false;
    if (state.q) {
      const hay = `${r.en} ${r.ja} ${r.info} ${r.cause} ${r.nl}`.toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    return true;
  }

  function compare(a, b) {
    const k = state.sortKey, dir = state.sortDir;
    if (k === "n") {
      // Undisclosed counts always sink to the bottom.
      if (a.n == null && b.n == null) return b.d.localeCompare(a.d);
      if (a.n == null) return 1;
      if (b.n == null) return -1;
      return (a.n - b.n) * dir;
    }
    const cmp = String(a[k]).localeCompare(String(b[k]), "ja");
    return (cmp || b.d.localeCompare(a.d)) * (cmp ? dir : 1);
  }

  function rowHTML(r) {
    const records = r.n != null
      ? `${fmt(r.n)}<span class="label">${esc(r.nl)}</span>`
      : `<span class="undisclosed">${esc(r.nl)}</span>`;
    const sources = r.src.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(hostLabel(u))} ↗</a>`).join("");
    return `<tr>
      <td class="date">${fmtDate(r.d)}</td>
      <td class="org">${esc(r.ja)}</td>
      <td class="num">${records}</td>
      <td class="info">${esc(r.info)}</td>
      <td class="cause"><span class="tag">${esc(r.cause)}</span></td>
      <td class="src">${sources}</td>
    </tr>`;
  }

  function render() {
    const list = rows.filter(matches).sort(compare);
    $("#leaks tbody").innerHTML = list.length
      ? list.map(rowHTML).join("")
      : `<tr class="empty-row"><td colspan="6">条件に一致する事案はありません。</td></tr>`;

    document.querySelectorAll("thead button[data-sort]").forEach((btn) => {
      const active = btn.dataset.sort === state.sortKey;
      btn.querySelector(".arrow").textContent = active ? (state.sortDir === 1 ? "▲" : "▼") : "";
      btn.closest("th").setAttribute("aria-sort", active ? (state.sortDir === 1 ? "ascending" : "descending") : "none");
    });
    cal.querySelectorAll(".day.selected").forEach((c) => c.classList.remove("selected"));
    if (state.day) cal.querySelector(`.day[data-date="${state.day}"]`)?.classList.add("selected");
  }

  buildCalendar();
  render();
})();
