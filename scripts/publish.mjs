// Publish job: copies the public projects from the SharePoint list "Town Projects"
// into data/projects.json, which the public page reads.
//
// Runs in GitHub Actions. Signs in to Microsoft with GitHub's own short-lived token
// (federated credential on the "Projects in Motion – Publisher" app), so no password
// or secret is stored anywhere. The app can only READ the Projects in Motion site.
//
// Only rows with "Show on public page" checked are written, and only public fields.
// The file is rewritten only when something residents can see has changed.

import { readFile, writeFile } from "node:fs/promises";

const TENANT = "87f37485-0c5b-4a9d-9306-13d4f69f209e";
const CLIENT_ID = process.env.PUBLISHER_CLIENT_ID;
const SITE = "middletownri.sharepoint.com,d850d23a-f608-4897-a8c0-f188b5c53ed4,32fc5993-d2b2-46fa-a5c1-28ec1584eb9b";
const LIST = "Town Projects";
const OUT = "data/projects.json";
const DRY = process.argv.includes("--dry-run");
const KEEPALIVE_DAYS = 45; // GitHub pauses scheduled jobs in repos idle for 60 days

const FIELDS = ["Title", "CIPNumber", "Department", "ProjectStatus", "PercentComplete", "StartDate", "EndDate",
  "OriginalBudget", "CurrentSpend", "FinalCost", "BudgetStatus", "ProjectDescription", "Narrative",
  "Contingencies", "MoreInfoLink", "ShowOnPublic"];

function fail(msg) { console.error(`::error::${msg}`); process.exit(1); }

async function githubToken() {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: bearer } = process.env;
  if (!url || !bearer) fail("No GitHub sign-in token. The workflow needs 'id-token: write'.");
  const r = await fetch(`${url}&audience=api://AzureADTokenExchange`, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!r.ok) fail(`GitHub token request failed: ${r.status}`);
  return (await r.json()).value;
}

async function graphToken() {
  if (!CLIENT_ID) fail("PUBLISHER_CLIENT_ID is not set.");
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await githubToken(),
  });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: "POST", body });
  const j = await r.json();
  if (!r.ok) fail(`Microsoft sign-in failed: ${j.error} ${j.error_description || ""}`);
  return j.access_token;
}

async function graph(token, path) {
  const r = await fetch(path.startsWith("https://") ? path : `https://graph.microsoft.com/v1.0${path}`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) fail(`Graph ${r.status} on ${path.split("?")[0]}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// Dates are stored at noon UTC; give the Eastern calendar date
const ymd = v => v ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(v)) : null;
const num = v => (v === null || v === undefined || v === "") ? null : Number(v);
const text = v => (typeof v === "string" && v.trim()) ? v.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim() : null;

function toPublic(item) {
  const f = item.fields;
  return {
    id: String(item.id),
    name: text(f.Title),
    department: text(f.Department),
    cipNumber: text(f.CIPNumber),
    projectStatus: text(f.ProjectStatus),
    percentComplete: num(f.PercentComplete),
    startDate: ymd(f.StartDate),
    endDate: ymd(f.EndDate),
    originalBudget: num(f.OriginalBudget),
    currentSpend: num(f.CurrentSpend),
    finalCost: num(f.FinalCost),
    budgetStatus: text(f.BudgetStatus),
    description: text(f.ProjectDescription),
    narrative: text(f.Narrative),
    contingencies: text(f.Contingencies),
    moreInfoUrl: text(f.MoreInfoLink),
    lastUpdated: ymd(item.lastModifiedDateTime),
    published: true,
  };
}

const token = await graphToken();
const lists = await graph(token, `/sites/${SITE}/lists?$select=id,displayName`);
const list = lists.value.find(l => l.displayName === LIST) || fail(`List "${LIST}" not found.`);

let items = [];
let next = `/sites/${SITE}/lists/${list.id}/items?$expand=fields($select=${FIELDS.join(",")})&$select=id,lastModifiedDateTime&$top=200`;
while (next) { const page = await graph(token, next); items.push(...page.value); next = page["@odata.nextLink"]; }

const projects = items.filter(i => i.fields.ShowOnPublic === true && text(i.fields.Title)).map(toPublic)
  .sort((a, b) => (b.lastUpdated || "").localeCompare(a.lastUpdated || "") || a.name.localeCompare(b.name));

let old = {};
try { old = JSON.parse(await readFile(OUT, "utf8")); } catch {}
const changed = JSON.stringify(old.projects) !== JSON.stringify(projects);
const lastChecked = old.checkedOn ? new Date(old.checkedOn) : new Date(0);
const keepalive = (Date.now() - lastChecked) / 864e5 > KEEPALIVE_DAYS;

console.log(`SharePoint rows: ${items.length}. Public: ${projects.length}. Changed: ${changed}.`);
if (DRY) {
  const spacing = [];
  const before = new Map((old.projects || []).map(p => [p.name, p]));
  for (const p of projects) {
    const o = before.get(p.name);
    if (!o) { console.log(`  new on public page: ${p.name}`); continue; }
    const norm = v => typeof v === "string" ? v.replace(/\s+/g, " ").trim() : JSON.stringify(v);
    const short = v => { const t = typeof v === "string" ? v.replace(/\s+/g, " ") : JSON.stringify(v); return t && t.length > 70 ? t.slice(0, 67) + "..." : t; };
    const diffs = Object.keys(p).filter(k => !["id", "lastUpdated"].includes(k) && norm(p[k]) !== norm(o[k]));
    const ws = Object.keys(p).filter(k => !["id", "lastUpdated"].includes(k) && JSON.stringify(p[k]) !== JSON.stringify(o[k]) && !diffs.includes(k));
    if (diffs.length) console.log(`  ${p.name}:\n${diffs.map(k => `      ${k}: ${short(o[k])}  ->  ${short(p[k])}`).join("\n")}`);
    if (ws.length) spacing.push(p.name);
    before.delete(p.name);
  }
  for (const n of before.keys()) console.log(`  leaves public page: ${n}`);
  if (spacing.length) console.log(`  Spacing or line breaks only (no visible change): ${spacing.join(", ")}`);
  console.log("Dry run: nothing written.");
  process.exit(0);
}

if (changed || keepalive) {
  const now = new Date().toISOString();
  const out = { source: "SharePoint: Projects in Motion / Town Projects", publishedOn: changed ? now : (old.publishedOn || now), checkedOn: now, projects };
  await writeFile(OUT, JSON.stringify(out, null, 1) + "\n");
  console.log(changed ? "Public data updated." : "No changes; refreshed the keepalive date.");
} else console.log("No changes.");
