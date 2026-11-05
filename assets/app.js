(() => {
  const M = window.MTP;
  const $ = id => document.getElementById(id);
  const els = { q: $("q"), dept: $("dept"), status: $("status"), sort: $("sort"), closed: $("closed"),
                grid: $("grid"), count: $("count"), summary: $("summary"), dlg: $("detail"), report: $("report") };
  let all = [];

  function populate() {
    const depts = [...new Set(all.map(p => p.department))].sort();
    els.dept.insertAdjacentHTML("beforeend", depts.map(d => `<option>${M.esc(d)}</option>`).join(""));
    els.status.insertAdjacentHTML("beforeend", M.PROJECT_STATUSES.map(s => `<option>${s}</option>`).join(""));
  }

  function visible() {
    const q = els.q.value.trim().toLowerCase();
    const d = els.dept.value, s = els.status.value, incClosed = els.closed.checked || M.CLOSED.has(s);
    let list = all.filter(p => p.published !== false)
      .filter(p => !d || p.department === d)
      .filter(p => !s || p.projectStatus === s)
      .filter(p => incClosed || !M.CLOSED.has(p.projectStatus))
      .filter(p => !q || [p.name, p.description, p.narrative, p.department, p.cipNumber].join(" ").toLowerCase().includes(q));
    const by = els.sort.value;
    list.sort((a, b) =>
      by === "name" ? a.name.localeCompare(b.name) :
      by === "end" ? (a.endDate || "9999").localeCompare(b.endDate || "9999") :
      (b.lastUpdated || "").localeCompare(a.lastUpdated || ""));
    return list;
  }

  function renderSummary() {
    const pub = all.filter(p => p.published !== false);
    const active = pub.filter(p => !M.CLOSED.has(p.projectStatus));
    const n = s => active.filter(p => p.projectStatus === s).length;
    const parts = [`<span><strong>${active.length}</strong> active projects</span>`];
    for (const s of ["On track", "At risk", "Delayed", "On hold", "Not started"]) if (n(s)) parts.push(`<span><strong>${n(s)}</strong> ${s.toLowerCase()}</span>`);
    const over = active.filter(p => p.budgetStatus === "Over budget").length;
    if (over) parts.push(`<span><strong>${over}</strong> over budget</span>`);
    els.summary.innerHTML = parts.join("");
  }

  function card(p) {
    return `<article class="card">
      <p class="dept">${M.esc(p.department)}</p>
      <h2>${M.esc(p.name)}</h2>
      <div class="badges">${M.statusBadge(p.projectStatus)}${M.budgetBadge(p.budgetStatus)}</div>
      ${M.progress(p)}
      <div class="meta"><span>${M.fmtDate(p.startDate)} to ${M.fmtDate(p.endDate)}</span><span>Updated ${M.fmtDate(p.lastUpdated)}</span></div>
      <p class="excerpt">${M.esc(p.description)}</p>
      <button class="btn secondary" type="button" data-id="${M.esc(p.id)}">View details</button>
    </article>`;
  }

  function render() {
    const list = visible();
    els.count.textContent = `Showing ${list.length} of ${all.filter(p => p.published !== false).length} projects`;
    els.grid.innerHTML = list.length ? list.map(card).join("")
      : `<div class="empty-state">No projects match these filters. Clear the search or choose another department or status.</div>`;
  }

  function moneyRow(label, v) {
    const f = M.fmtMoney(v);
    return `<tr><th scope="row">${label}</th><td>${f || '<span class="muted">Not yet reported</span>'}</td></tr>`;
  }

  function detailHtml(p, forPrint) {
    const url = p.moreInfoUrl && M.safeUrl(p.moreInfoUrl);
    const facts = `<table class="facts"><tbody>
      <tr><th scope="row">Department</th><td>${M.esc(p.department)}</td></tr>
      <tr><th scope="row">CIP reference number</th><td>${p.cipNumber ? M.esc(p.cipNumber) : '<span class="muted">Not assigned</span>'}</td></tr>
      <tr><th scope="row">Project status</th><td>${M.esc(p.projectStatus)}</td></tr>
      <tr><th scope="row">Percent complete</th><td>${(p.percentComplete ?? "") !== "" ? M.esc(p.percentComplete) + "%" : '<span class="muted">Not yet reported</span>'}</td></tr>
      <tr><th scope="row">Start date</th><td>${M.fmtDate(p.startDate)}</td></tr>
      <tr><th scope="row">End date</th><td>${M.fmtDate(p.endDate)}</td></tr>
      <tr><th scope="row">Budget status</th><td>${M.esc(p.budgetStatus)}</td></tr>
      ${moneyRow("Original budget", p.originalBudget)}
      ${moneyRow("Current spend", p.currentSpend)}
      ${p.projectStatus === "Completed" ? moneyRow("Final cost", p.finalCost) : ""}
      <tr><th scope="row">Last updated</th><td>${M.fmtDate(p.lastUpdated)}</td></tr>
    </tbody></table>`;
    const sections = `
      <section><h3>Project description</h3><p>${M.esc(p.description)}</p></section>
      <section><h3>Latest update</h3><p>${M.esc(p.narrative)}</p></section>
      ${p.contingencies ? `<section><h3>Contingencies</h3><p>${M.esc(p.contingencies)}</p></section>` : ""}
      ${url && !forPrint ? `<p><a href="${M.esc(url)}" target="_blank" rel="noopener">More information about this project</a></p>` : ""}
      ${url && forPrint ? `<p>More information: ${M.esc(url)}</p>` : ""}`;
    return { facts, sections };
  }

  function openDetail(id) {
    const p = all.find(x => x.id === id); if (!p) return;
    const { facts, sections } = detailHtml(p, false);
    els.dlg.innerHTML = `<div class="dlg-head">
        <button class="btn quiet dlg-close" type="button" data-close>Close</button>
        <p class="eyebrow" style="color:var(--ink-2)">${M.esc(p.department)}</p>
        <h2 id="d-title">${M.esc(p.name)}</h2>
        <div class="badges">${M.statusBadge(p.projectStatus)}${M.budgetBadge(p.budgetStatus)}</div>
        ${M.progress(p)}
      </div><div class="dlg-body">${facts}${sections}</div>`;
    els.dlg.showModal();
  }

  function buildReport() {
    const list = visible();
    const today = M.fmtDate(new Date().toISOString().slice(0, 10));
    els.report.innerHTML = list.map(p => {
      const { facts, sections } = detailHtml(p, true);
      return `<section class="rpage"><div class="rhead"><span>Town of Middletown, RI · Projects in Motion</span><span>Report date ${today}</span></div>
        <h2>${M.esc(p.name)}</h2>${facts}${sections}</section>`;
    }).join("");
  }

  els.grid.addEventListener("click", e => { const b = e.target.closest("[data-id]"); if (b) openDetail(b.dataset.id); });
  els.dlg.addEventListener("click", e => { if (e.target.closest("[data-close]") || e.target === els.dlg) els.dlg.close(); });
  for (const k of ["q", "dept", "status", "sort", "closed"]) els[k].addEventListener("input", render);
  $("print").addEventListener("click", () => { buildReport(); window.print(); });

  M.load().then(list => { all = list; populate(); renderSummary(); render(); })
    .catch(err => { els.grid.innerHTML = `<div class="empty-state">The project list didn't load. Refresh the page to try again. (${M.esc(err.message)})</div>`; });
})();
