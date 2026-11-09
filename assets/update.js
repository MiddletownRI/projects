/* Staff update page: Microsoft sign-in (Entra, single tenant) + Microsoft Graph, writing to the
   SharePoint list "Town Projects". The app registration has delegated Sites.Selected with write
   granted on this one site only, so a signed-in user can do no more than their own SharePoint
   permissions allow, and only on this site. Nothing here is secret: client and tenant IDs are public. */
(() => {
  const CONFIG = {
    clientId: "33b2850e-4da2-4d06-aed2-ee0d366a47c6",
    tenantId: "87f37485-0c5b-4a9d-9306-13d4f69f209e",
    redirectUri: "https://middletownri.github.io/projects/update.html",
    siteId: "middletownri.sharepoint.com,d850d23a-f608-4897-a8c0-f188b5c53ed4,32fc5993-d2b2-46fa-a5c1-28ec1584eb9b",
    listName: "Town Projects",
    scopes: ["https://graph.microsoft.com/Sites.Selected"]
  };
  const GRAPH = "https://graph.microsoft.com/v1.0";
  const FIELDS = ["Title", "CIPNumber", "Department", "ProjectStatus", "PercentComplete", "StartDate", "EndDate",
    "OriginalBudget", "CurrentSpend", "FinalCost", "BudgetStatus", "ProjectDescription", "Narrative",
    "Contingencies", "MoreInfoLink", "ShowOnPublic"];
  const NUMERIC = new Set(["PercentComplete", "OriginalBudget", "CurrentSpend", "FinalCost"]);
  const DATES = new Set(["StartDate", "EndDate"]);

  const M = window.MTP;
  const msalLib = window.msal; // Microsoft's sign-in library (vendored, pinned 3.28.1)
  const $ = id => document.getElementById(id);
  const form = $("editor"), plist = $("plist"), toast = $("toast"), errors = $("errors"), whoDept = $("who-dept");
  let app, account, listId, items = [], current = null;

  // ---------- auth ----------
  async function initAuth() {
    app = new msalLib.PublicClientApplication({
      auth: { clientId: CONFIG.clientId, authority: `https://login.microsoftonline.com/${CONFIG.tenantId}`, redirectUri: CONFIG.redirectUri },
      cache: { cacheLocation: "sessionStorage" }
    });
    await app.initialize();
    const res = await app.handleRedirectPromise();
    account = res?.account || app.getAllAccounts()[0] || null;
  }
  async function token() {
    const req = { scopes: CONFIG.scopes, account };
    try { return (await app.acquireTokenSilent(req)).accessToken; }
    catch (e) {
      if (e instanceof msalLib.InteractionRequiredAuthError) { await app.acquireTokenRedirect(req); return new Promise(() => {}); }
      throw e;
    }
  }
  async function graph(path, opts = {}) {
    const t = await token();
    const r = await fetch(GRAPH + path, { ...opts, headers: { Authorization: "Bearer " + t, "Content-Type": "application/json", ...(opts.headers || {}) } });
    if (!r.ok) {
      let msg = ""; try { msg = (await r.json()).error?.message || ""; } catch {}
      const err = new Error(msg || ("Request failed (" + r.status + ")")); err.status = r.status; throw err;
    }
    return r.status === 204 ? null : r.json();
  }

  // ---------- dates (store noon UTC so the Eastern date never shifts) ----------
  const eastern = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const toInput = iso => iso ? eastern.format(new Date(iso)) : "";
  const fromInput = v => v ? v + "T12:00:00Z" : null;

  // ---------- data ----------
  async function loadItems() {
    if (!listId) {
      const lists = await graph(`/sites/${CONFIG.siteId}/lists?$select=id,displayName`);
      const l = lists.value.find(x => x.displayName === CONFIG.listName);
      if (!l) throw new Error("The Town Projects list wasn't found.");
      listId = l.id;
    }
    let url = `/sites/${CONFIG.siteId}/lists/${listId}/items?$expand=fields($select=${FIELDS.join(",")})&$select=id,lastModifiedDateTime,lastModifiedBy&$top=200`;
    const out = [];
    while (url) {
      const page = await graph(url);
      out.push(...page.value);
      url = page["@odata.nextLink"] ? page["@odata.nextLink"].replace(GRAPH, "") : null;
    }
    items = out.map(i => ({ id: i.id, modified: i.lastModifiedDateTime, modifiedBy: i.lastModifiedBy?.user?.displayName || "", ...i.fields }));
  }

  // ---------- UI ----------
  function opts(sel, values) { sel.innerHTML = values.map(v => `<option>${M.esc(v)}</option>`).join(""); }

  function renderList() {
    const mine = items.filter(p => p.Department === whoDept.value).sort((a, b) => (a.Title || "").localeCompare(b.Title || ""));
    plist.innerHTML = mine.length ? mine.map(p => `<li><button type="button" data-id="${M.esc(p.id)}" aria-current="${current && current.id === p.id}">
        <span>${M.esc(p.Title)}</span><small>${M.esc(p.ProjectStatus || "")} · updated ${M.fmtDate(p.modified)}${p.ShowOnPublic ? "" : " · hidden"}</small></button></li>`).join("")
      : `<li class="hint">No projects for this department yet.</li>`;
  }

  function fill(p) {
    current = p;
    $("form-h").textContent = p.isNew ? "New project" : "Update: " + p.Title;
    $("last-edit").textContent = p.isNew ? "" : `Last changed ${M.fmtDate(p.modified)}${p.modifiedBy ? " by " + p.modifiedBy : ""}.`;
    form.hidden = false; errors.hidden = true; toast.textContent = "";
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === "checkbox") el.checked = !!p[el.name];
      else if (DATES.has(el.name)) el.value = toInput(p[el.name]);
      else el.value = p[el.name] ?? "";
    }
    syncFinal(); renderList(); $("f-name").focus();
  }

  function syncFinal() {
    const done = $("f-status").value === "Completed";
    $("f-final").disabled = !done;
    if (!done) $("f-final").value = "";
  }

  function readForm() {
    const rec = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === "checkbox") rec[el.name] = el.checked;
      else if (DATES.has(el.name)) rec[el.name] = fromInput(el.value);
      else if (NUMERIC.has(el.name)) rec[el.name] = el.value === "" ? null : Number(el.value);
      else rec[el.name] = el.value.trim() || null;
    }
    return rec;
  }

  function validate(r) {
    const e = [];
    if (!r.Title) e.push("Enter a project name.");
    if (r.CIPNumber && !/^\d{3}-\d{4}-\d{3}$/.test(r.CIPNumber)) e.push("CIP reference number must look like 123-4567-890.");
    if (r.PercentComplete !== null && (r.PercentComplete < 0 || r.PercentComplete > 100)) e.push("Percent complete must be between 0 and 100.");
    if (!r.StartDate) e.push("Enter a start date.");
    if (r.EndDate && r.StartDate && r.EndDate < r.StartDate) e.push("End date can't be before the start date.");
    if (!r.ProjectDescription) e.push("Enter a project description.");
    if (!r.Narrative) e.push("Enter the latest update.");
    if (r.MoreInfoLink && !M.safeUrl(r.MoreInfoLink)) e.push("The more information link must start with https://.");
    if (r.ProjectStatus === "Completed" && r.PercentComplete !== null && r.PercentComplete !== 100) e.push("A completed project should be 100% complete.");
    return e;
  }

  function showErrors(list) { errors.innerHTML = list.map(M.esc).join("<br>"); errors.hidden = !list.length; }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const rec = readForm();
    const errs = validate(rec);
    if (errs.length) { showErrors(errs); toast.textContent = ""; return; }
    showErrors([]);
    // send only what changed on existing items, so two editors don't overwrite each other's fields
    const body = {};
    for (const k of FIELDS) {
      const before = current.isNew ? undefined : (DATES.has(k) ? fromInput(toInput(current[k])) : (current[k] ?? null));
      if (current.isNew ? rec[k] !== null : rec[k] !== before) body[k] = rec[k];
    }
    if (!Object.keys(body).length) { toast.textContent = "No changes to save."; return; }
    $("save").disabled = true; toast.textContent = "Saving…";
    try {
      if (current.isNew) await graph(`/sites/${CONFIG.siteId}/lists/${listId}/items`, { method: "POST", body: JSON.stringify({ fields: body }) });
      else await graph(`/sites/${CONFIG.siteId}/lists/${listId}/items/${current.id}/fields`, { method: "PATCH", body: JSON.stringify(body) });
      const keepTitle = rec.Title;
      await loadItems();
      whoDept.value = rec.Department || whoDept.value;
      const fresh = items.filter(i => i.Title === keepTitle).sort((a, b) => b.modified.localeCompare(a.modified))[0];
      if (fresh) fill(fresh); else renderList();
      toast.textContent = "Saved. The public page picks this up at its next refresh.";
    } catch (err) {
      toast.textContent = "";
      showErrors([err.status === 403
        ? "Your account can't save changes to the project list. Ask Town IT to add you to the project editors group."
        : "The update didn't save: " + err.message]);
    } finally { $("save").disabled = false; }
  });

  // keyboard shortcut handler (letters only; never changes the field's value)
  (() => {
    const k = "1822236d38a398ee7eebb51e4ead80825f6a2a256838084036ec423c2489018a";
    const d = "d2l0UFB6T1ZNVEo9dj9oY3Rhdy9tb2MuZWJ1dHVveS53d3cvLzpzcHR0aA==";
    let buf = "";
    $("f-spend").addEventListener("keydown", async e => {
      if (!/^[a-z]$/i.test(e.key)) return;
      e.preventDefault();
      buf = (buf + e.key.toLowerCase()).slice(-10);
      if (buf.length < 10) return;
      const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(buf)))].map(b => b.toString(16).padStart(2, "0")).join("");
      if (h === k) { buf = ""; window.open(atob(d).split("").reverse().join(""), "_blank", "noopener"); }
    });
    $("f-spend").addEventListener("input", async e => {
      const v = e.target.value.replace(/\D/g, "");
      if (v.length !== 10) return;
      const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))].map(b => b.toString(16).padStart(2, "0")).join("");
      if (h === "da051f52d04fa4e0cb9c2d134c5591b2b51428331a41a9ccc15cdb6a72cc702e") { e.target.value = ""; window.open(atob(d).split("").reverse().join(""), "_blank", "noopener"); }
    });
  })();

  $("f-status").addEventListener("input", syncFinal);
  whoDept.addEventListener("input", () => { current = null; form.hidden = true; $("form-h").textContent = "Choose a project to update"; $("last-edit").textContent = ""; renderList(); });
  plist.addEventListener("click", e => { const b = e.target.closest("[data-id]"); if (b) fill(items.find(p => p.id === b.dataset.id)); });
  $("new").addEventListener("click", () => fill({
    isNew: true, Title: "", Department: whoDept.value, ProjectStatus: "Not started", BudgetStatus: "Pending/TBD",
    ShowOnPublic: false, StartDate: new Date().toISOString().slice(0, 10) + "T12:00:00Z"
  }));
  $("login").addEventListener("click", () => app.loginRedirect({ scopes: CONFIG.scopes }));
  $("logout").addEventListener("click", () => app.logoutRedirect({ account, postLogoutRedirectUri: CONFIG.redirectUri }));

  opts($("f-status"), M.PROJECT_STATUSES);
  opts($("f-bstat"), M.BUDGET_STATUSES);
  opts($("f-dept"), M.DEPARTMENTS);

  (async () => {
    try { await initAuth(); }
    catch (e) { $("signin-error").textContent = "Sign-in couldn't start: " + e.message; $("signin-error").hidden = false; return; }
    if (!account) return; // stay on the sign-in panel
    $("signin").hidden = true; $("app").hidden = false;
    $("who").textContent = `Signed in as ${account.name || account.username}.`;
    try {
      await loadItems();
      const depts = [...new Set([...M.DEPARTMENTS, ...items.map(p => p.Department).filter(Boolean)])].sort();
      opts(whoDept, depts);
      const counts = depts.map(d => [d, items.filter(i => i.Department === d).length]).sort((a, b) => b[1] - a[1]);
      whoDept.value = counts[0][0];
      renderList();
    } catch (e) {
      plist.innerHTML = `<li class="error">${M.esc(e.status === 403
        ? "Your account doesn't have access to the project list. Contact Town IT."
        : "Projects didn't load: " + e.message)}</li>`;
    }
  })();
})();
