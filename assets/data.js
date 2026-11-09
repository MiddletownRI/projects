/* Shared data layer. In this prototype, department edits are kept in the viewer's own browser
   (localStorage) on top of the published data file. Production replaces this with a shared store. */
window.MTP = (() => {
  const EDITS_KEY = "mtp-prototype-edits-v1";

  const PROJECT_STATUSES = ["Not started", "On track", "At risk", "Delayed", "On hold", "Completed", "Canceled"];
  const BUDGET_STATUSES = ["Within budget", "At risk", "Over budget", "Under budget", "Pending/TBD"];
  const DEPARTMENTS = [
    "Beaches", "Boards & Committees", "Building & Zoning", "Facilities", "Finance, HR & Purchasing",
    "Fire Department", "Library", "Outreach Program", "Parks & Recreation", "Planning & Economic Development",
    "Police Department", "Public Works", "Refuse & Recycling", "School Department", "Senior Center",
    "Tax Assessment & Collection", "Town Administrator", "Town Clerk & Canvassing"
  ];
  const CLOSED = new Set(["Completed", "Canceled"]);

  const statusTone = {
    "Not started": "s-none", "On track": "s-good", "At risk": "s-warn", "Delayed": "s-bad",
    "On hold": "s-hold", "Completed": "s-info", "Canceled": "s-none"
  };
  const budgetTone = {
    "Within budget": "s-good", "At risk": "s-warn", "Over budget": "s-bad",
    "Under budget": "s-info", "Pending/TBD": "s-none"
  };

  function readEdits() {
    try { return JSON.parse(localStorage.getItem(EDITS_KEY)) || {}; } catch { return {}; }
  }
  function writeEdits(edits) {
    try { localStorage.setItem(EDITS_KEY, JSON.stringify(edits)); return true; } catch { return false; }
  }

  async function load() {
    const res = await fetch("data/projects.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load project data (" + res.status + ")");
    const base = (await res.json()).projects;
    const edits = readEdits();
    const byId = new Map(base.map(p => [p.id, p]));
    for (const [id, rec] of Object.entries(edits)) byId.set(id, { ...(byId.get(id) || {}), ...rec });
    return [...byId.values()];
  }

  function saveProject(rec) {
    const edits = readEdits();
    edits[rec.id] = rec;
    return writeEdits(edits);
  }
  function resetEdits() { try { localStorage.removeItem(EDITS_KEY); } catch {} }
  function hasEdits() { return Object.keys(readEdits()).length > 0; }

  const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  function fmtDate(iso) {
    if (!iso) return "Not set";
    const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
    return isNaN(d) ? iso : dateFmt.format(d);
  }
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  function fmtMoney(n) { return (n === null || n === undefined || n === "") ? null : money.format(Number(n)); }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function safeUrl(u) {
    try { const url = new URL(u); return (url.protocol === "https:" || url.protocol === "http:") ? url.href : null; } catch { return null; }
  }


  // Budget status is a formula, not a choice (administration review, Nov 2026).
  // cost = final cost once Completed, otherwise the contract amount.
  function budgetStatusFor(budget, contract, final, status) {
    const n = v => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? null : Number(v);
    const b = n(budget), done = status === "Completed", f = n(final);
    const cost = done && f !== null ? f : n(contract);
    if (b === null || b <= 0 || cost === null) return "Pending/TBD";
    if (cost > b) return "Over budget";
    if (done && f !== null && f < b) return "Under budget";
    return "Within budget";
  }

  // CIP reference number: digits only, dashes inserted as ###-####-###
  function formatCip(v) {
    const d = String(v || "").replace(/\D/g, "").slice(0, 10);
    return d.length > 7 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
  }

  // Completed projects drop off the public page a year after their end date
  function agedOut(status, endDate, now = new Date()) {
    if (status !== "Completed" || !endDate) return false;
    const end = new Date(String(endDate).length === 10 ? endDate + "T12:00:00Z" : endDate);
    if (isNaN(end)) return false;
    const cutoff = new Date(now); cutoff.setFullYear(cutoff.getFullYear() - 1);
    return end < cutoff;
  }

  // Shared bits for both update pages: CIP dashes, budget formula, print
  function wireEditor({ cip, budget, contract, final, status, bstat, printBtn }) {
    cip.addEventListener("input", () => {
      const atEnd = cip.selectionStart === cip.value.length;
      cip.value = formatCip(cip.value);
      if (atEnd) cip.setSelectionRange(cip.value.length, cip.value.length);
    });
    const sync = () => { bstat.value = budgetStatusFor(budget.value, contract.value, final.value, status.value); };
    for (const el of [budget, contract, final, status]) el.addEventListener("input", sync);
    // Text boxes don't split across printed pages, so print a plain copy of each one instead
    const mirror = () => document.querySelectorAll("form.editor textarea").forEach(t => {
      let m = t.nextElementSibling;
      if (!m || !m.classList.contains("print-text")) { m = document.createElement("div"); m.className = "print-text"; t.after(m); }
      m.textContent = t.value || "—";
    });
    window.addEventListener("beforeprint", mirror);
    printBtn.addEventListener("click", () => { mirror(); window.print(); });
    return sync;
  }

  function statusBadge(s) { return `<span class="badge ${statusTone[s] || "s-none"}"><span class="k">Status:</span> ${esc(s || "Not set")}</span>`; }
  function budgetBadge(s) { return `<span class="badge ${budgetTone[s] || "s-none"}"><span class="k">Budget:</span> ${esc(s || "Pending/TBD")}</span>`; }
  function progress(p) {
    const has = p.percentComplete !== null && p.percentComplete !== undefined && p.percentComplete !== "";
    const v = has ? Math.max(0, Math.min(100, Number(p.percentComplete))) : 0;
    return `<div class="progress${has ? "" : " empty"}"><span>${has ? v + "% complete" : "Progress not yet reported"}</span>
      <div class="bar" role="img" aria-label="${has ? v + " percent complete" : "Progress not yet reported"}"><span style="width:${v}%"></span></div></div>`;
  }

  return { PROJECT_STATUSES, BUDGET_STATUSES, DEPARTMENTS, CLOSED, load, saveProject, resetEdits, hasEdits,
           fmtDate, fmtMoney, esc, safeUrl, statusBadge, budgetBadge, progress,
           budgetStatusFor, formatCip, agedOut, wireEditor };
})();
