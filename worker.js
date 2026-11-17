// Sam Balzer website: mailing list.
// Serves the static site, plus a few small endpoints:
//   POST /api/subscribe     { email, website(honeypot) }  -> saves to the list, emails Sam
//   POST /api/unsubscribe   { email }                      -> removes from the list
//   GET  /api/list          (header X-Admin-Key)            -> list for the admin page
//   POST /api/remove        (header X-Admin-Key) { email }  -> admin removes an address
//   GET  /api/projects      (header X-Admin-Key)            -> paintings tracker list
//   POST /api/projects/save (header X-Admin-Key) { project } -> add or update a painting
//   POST /api/projects/delete (header X-Admin-Key) { id }   -> delete a painting
//   GET  /admin, /unsubscribe                               -> small pages
//
// Cloudflare setup (one-time, in the dashboard):
//   - KV namespace bound as SUBSCRIBERS (id goes in wrangler.jsonc)
//   - Secret ADMIN_KEY (Worker > Settings > Variables and Secrets)
//   - Optional: Email binding EMAIL for signup notifications (see README)

const NOTIFY_TO = "sam@sbalzer.com";
const NOTIFY_FROM = "noreply@notify.sbalzer.com";
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const html = (body) =>
  new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "x-frame-options": "DENY",
    },
  });

function cleanEmail(v) {
  const e = String(v || "").trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return await request.json().catch(() => ({}));
  const form = await request.formData().catch(() => null);
  return form ? Object.fromEntries(form) : {};
}

function isAdmin(request, env) {
  const key = request.headers.get("x-admin-key") || "";
  return Boolean(env.ADMIN_KEY) && key.length > 0 && key === env.ADMIN_KEY;
}

async function listAll(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.SUBSCRIBERS.list({ prefix: "sub:", cursor });
    for (const k of page.keys) out.push({ email: k.name.slice(4), joined: k.metadata?.d || "" });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  out.sort((a, b) => (b.joined || "").localeCompare(a.joined || ""));
  return out;
}

async function notify(env, email, total) {
  if (!env.EMAIL) return; // email notifications not set up yet
  try {
    await env.EMAIL.send({
      to: NOTIFY_TO,
      from: { email: NOTIFY_FROM, name: "sbalzer.com" },
      subject: `New mailing list signup: ${email}`,
      text: `${email} just joined your mailing list.\n\nYou now have ${total} subscriber${total === 1 ? "" : "s"}.\nSee the full list: https://sbalzer.com/admin\n`,
    });
  } catch (err) {
    console.log("notify failed", err && (err.code || err.message));
  }
}

// ---- Paintings tracker (admin only) ----
// All projects live as one JSON array under a single key in the same KV
// namespace (the mailing list uses the "sub:" prefix, so they never clash).
const PROJ_KEY = "tracker:projects";
const STATUSES = ["idea", "todo", "wip", "done"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, n) => String(v ?? "").slice(0, n);

async function getProjects(env) {
  const list = await env.SUBSCRIBERS.get(PROJ_KEY, "json");
  return Array.isArray(list) ? list : [];
}

function cleanProject(p, existing) {
  if (!p || typeof p !== "object") return null;
  const title = str(p.title, 200).trim();
  if (!title) return null;
  const now = new Date().toISOString();
  return {
    id: existing ? existing.id : crypto.randomUUID(),
    title,
    status: STATUSES.includes(p.status) ? p.status : "idea",
    progress: Math.max(0, Math.min(100, Math.round(Number(p.progress) || 0))),
    next: str(p.next, 500),
    notes: str(p.notes, 5000),
    medium: str(p.medium, 200),
    size: str(p.size, 100),
    due: DAY_RE.test(p.due || "") ? p.due : "",
    log: (Array.isArray(p.log) ? p.log : [])
      .slice(0, 1000)
      .map((e) => ({ d: DAY_RE.test(e?.d || "") ? e.d : now.slice(0, 10), t: str(e?.t, 1000).trim() }))
      .filter((e) => e.t),
    created: existing?.created || now,
    updated: now,
  };
}

const PAGE_STYLE = `
  body{margin:0;background:#f2f0eb;color:#141414;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;line-height:1.5}
  main{max-width:760px;margin:0 auto;padding:48px 20px}
  h1{font-weight:500;font-size:26px;margin:0 0 6px}
  p{color:#5f5c56}
  input,button{font:inherit;padding:10px 12px;border:1px solid #c9c6bf;background:#fff;border-radius:4px}
  button{background:#141414;color:#fff;border-color:#141414;cursor:pointer}
  button.ghost{background:transparent;color:#141414}
  table{width:100%;border-collapse:collapse;margin-top:18px;background:#fff}
  td,th{text-align:left;padding:9px 10px;border-bottom:1px solid #e2e0da;font-size:14px}
  th{font-weight:500;color:#5f5c56}
  .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .msg{margin-top:12px;min-height:1.5em}
  a{color:inherit}`;

const ADMIN_STYLE = `
  select,textarea{font:inherit;padding:10px 12px;border:1px solid #c9c6bf;background:#fff;border-radius:4px;color:#141414}
  .tabs{display:flex;gap:2px;margin:8px 0 22px;border-bottom:1px solid #d8d5ce;align-items:flex-end}
  .tabs button{background:none;border:0;border-bottom:2px solid transparent;border-radius:0;color:#5f5c56;padding:10px 12px}
  .tabs button.on{color:#141414;border-bottom-color:#141414}
  .sp{flex:1}
  .chips{display:flex;gap:6px;flex-wrap:wrap;margin:16px 0}
  .chips button{padding:6px 12px;border-radius:999px;background:#fff;color:#141414;border-color:#c9c6bf;font-size:14px}
  .chips button.on{background:#141414;color:#fff;border-color:#141414}
  .card{background:#fff;border:1px solid #e2e0da;border-radius:6px;padding:14px 16px;margin-bottom:10px;cursor:pointer}
  .card:hover{border-color:#a9a59c}
  .ct{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
  .ct b{font-weight:500;font-size:16px}
  .pill{font-size:12px;padding:2px 9px;border-radius:999px;white-space:nowrap;background:#ece9e2;color:#5f5c56}
  .s-wip{background:#fbe7bd;color:#6e4a00}.s-todo{background:#dde7f3;color:#24476b}.s-done{background:#d9ecd9;color:#2d5a2d}
  .bar{height:6px;background:#ece9e2;border-radius:3px;margin:10px 0 6px;overflow:hidden}
  .bar i{display:block;height:100%;background:#141414}
  .meta{font-size:13px;color:#5f5c56}
  h2{font-weight:500;font-size:20px;margin:0 0 4px}
  .f label{display:block;font-size:13px;color:#5f5c56;margin:16px 0 5px}
  .f input,.f select,.f textarea{width:100%;box-sizing:border-box}
  .f .row input{width:auto;flex:1;min-width:0}
  .f input[type=range]{padding:0;border:0;background:none;accent-color:#141414}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .log{list-style:none;padding:0;margin:10px 0 0}
  .log li{display:flex;gap:12px;align-items:baseline;padding:8px 0;border-bottom:1px solid #e2e0da;font-size:14px}
  .log .d{color:#5f5c56;white-space:nowrap;font-size:13px;min-width:92px}
  .log li span:nth-child(2){flex:1}
  .log .x{padding:0 6px;border:0;background:none;color:#8a867e;font-size:18px;line-height:1}
  .danger{color:#a3271b!important;border-color:#e0b4ae!important}
  @media(max-width:520px){.two{grid-template-columns:1fr}}`;

const ADMIN_PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Admin · Sam Balzer</title><style>${PAGE_STYLE}${ADMIN_STYLE}</style></head><body><main>
<h1>Admin</h1>
<div id="login"><p>Enter your admin password.</p>
 <form class="row" id="lf"><input type="password" id="pw" placeholder="Password" autocomplete="current-password" required><button>Open</button></form>
 <div class="msg" id="lmsg"></div></div>
<div id="app" hidden>
 <div class="tabs">
  <button data-t="paint" class="on">Paintings</button><button data-t="list">Mailing list</button>
  <span class="sp"></span><button id="out">Log out</button>
 </div>

 <section id="t-paint">
  <div id="plist">
   <button id="new">+ New painting</button>
   <div class="chips" id="chips"></div>
   <div id="cards"></div>
  </div>
  <form id="editor" class="f" hidden>
   <h2 id="e-head"></h2>
   <label for="e-title">Title</label><input id="e-title" required maxlength="200" placeholder="e.g. Low tide, Ahuriri">
   <div class="two">
    <div><label for="e-status">Status</label><select id="e-status">
     <option value="idea">Idea</option><option value="todo">To do</option><option value="wip">In progress</option><option value="done">Done</option></select></div>
    <div><label for="e-due">Due date (optional)</label><input type="date" id="e-due"></div>
   </div>
   <label for="e-progress">Progress: <span id="e-pv"></span></label><input type="range" id="e-progress" min="0" max="100" step="5">
   <label for="e-next">Next step</label><input id="e-next" maxlength="500" placeholder="e.g. Block in the sky">
   <label for="e-lt">Progress log</label>
   <div class="row"><input id="e-lt" maxlength="1000" placeholder="What did you do today?"><button type="button" class="ghost" id="e-add">Add</button></div>
   <ul class="log" id="e-log"></ul>
   <div class="two">
    <div><label for="e-medium">Medium</label><input id="e-medium" maxlength="200" placeholder="Oil on linen"></div>
    <div><label for="e-size">Size</label><input id="e-size" maxlength="100" placeholder="60 × 40 cm"></div>
   </div>
   <label for="e-notes">Notes</label><textarea id="e-notes" rows="4" maxlength="5000" placeholder="Colours, references, where it's going…"></textarea>
   <div class="row" style="margin-top:20px">
    <button id="e-save">Save</button><button type="button" class="ghost" id="e-cancel">Cancel</button>
    <span class="sp"></span><button type="button" class="ghost danger" id="e-del">Delete</button>
   </div>
   <div class="msg" id="emsg"></div>
  </form>
 </section>

 <section id="t-list" hidden>
  <p id="count"></p>
  <div class="row">
   <button id="copy">Copy all (for BCC)</button>
   <button class="ghost" id="csv">Download CSV</button>
  </div>
  <div class="msg" id="msg"></div>
  <table><thead><tr><th>Email</th><th>Joined</th><th></th></tr></thead><tbody id="rows"></tbody></table>
 </section>
</div>
<script>
let KEY=sessionStorage.getItem("ak")||"",LIST=[],PROJ=[],FILTER="all",CUR=null;
const $=id=>document.getElementById(id);
const ST={idea:"Idea",todo:"To do",wip:"In progress",done:"Done"};
const ORDER=["wip","todo","idea","done"];
const FIELDS=["title","status","next","notes","medium","size","due"];
const today=()=>new Date().toLocaleDateString("en-CA");
const fmt=d=>d?new Date(d+"T00:00:00").toLocaleDateString("en-NZ",{day:"numeric",month:"short",year:"numeric"}):"";
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}

async function api(path,body){
  const opt={headers:{"x-admin-key":KEY}};
  if(body!==undefined){opt.method="POST";opt.headers["content-type"]="application/json";opt.body=JSON.stringify(body)}
  const r=await fetch(path,opt);
  if(r.status===403){sessionStorage.removeItem("ak");$("lmsg").textContent="That password didn't work.";
    $("login").hidden=false;$("app").hidden=true;throw new Error("auth")}
  if(!r.ok)throw new Error("error "+r.status);
  return r.json();
}
async function start(){
  try{PROJ=(await api("/api/projects")).projects;sessionStorage.setItem("ak",KEY);
    $("login").hidden=true;$("app").hidden=false;renderProjects()}
  catch(e){if(e.message!=="auth")$("lmsg").textContent="Couldn't load ("+e.message+")."}
}
function tab(name){
  document.querySelectorAll(".tabs button[data-t]").forEach(b=>b.classList.toggle("on",b.dataset.t===name));
  $("t-paint").hidden=name!=="paint";$("t-list").hidden=name!=="list";
  if(name==="list")loadList();
}
document.querySelectorAll(".tabs button[data-t]").forEach(b=>b.onclick=()=>tab(b.dataset.t));

/* ---- Paintings ---- */
function renderProjects(){
  $("editor").hidden=true;$("plist").hidden=false;
  const counts={all:PROJ.length};ORDER.forEach(s=>counts[s]=PROJ.filter(p=>p.status===s).length);
  const chips=$("chips");chips.innerHTML="";
  [["all","All"],["wip","In progress"],["todo","To do"],["idea","Ideas"],["done","Done"]].forEach(([k,l])=>{
    const b=el("button",FILTER===k?"on":"",l+" ("+counts[k]+")");b.onclick=()=>{FILTER=k;renderProjects()};chips.append(b)});
  const items=PROJ.filter(p=>FILTER==="all"||p.status===FILTER)
    .sort((a,b)=>ORDER.indexOf(a.status)-ORDER.indexOf(b.status)||(b.updated||"").localeCompare(a.updated||""));
  const box=$("cards");box.innerHTML="";
  if(!items.length)box.append(el("p",null,PROJ.length?"Nothing here.":"No paintings yet. Add your first one."));
  items.forEach(p=>{
    const c=el("div","card"),t=el("div","ct");
    t.append(el("b",null,p.title),el("span","pill s-"+p.status,ST[p.status]));c.append(t);
    const bar=el("div","bar"),i=el("i");i.style.width=p.progress+"%";bar.append(i);c.append(bar);
    const bits=[p.progress+"%"];
    if(p.next&&p.status!=="done")bits.push("Next: "+p.next);
    if(p.due&&p.status!=="done")bits.push("Due "+fmt(p.due));
    if(p.log&&p.log[0])bits.push("Last worked on "+fmt(p.log[0].d));
    c.append(el("div","meta",bits.join(" · ")));
    c.onclick=()=>openEditor(p);box.append(c)});
}
function openEditor(p){
  CUR=p?JSON.parse(JSON.stringify(p)):{title:"",status:"idea",progress:0,next:"",notes:"",medium:"",size:"",due:"",log:[]};
  $("plist").hidden=true;$("editor").hidden=false;$("emsg").textContent="";
  $("e-head").textContent=p?"Edit painting":"New painting";
  FIELDS.forEach(k=>$("e-"+k).value=CUR[k]||"");
  $("e-progress").value=CUR.progress;$("e-pv").textContent=CUR.progress+"%";
  $("e-del").hidden=!p;$("e-lt").value="";renderLog();window.scrollTo(0,0);
}
function renderLog(){
  const ul=$("e-log");ul.innerHTML="";
  CUR.log.forEach((e,idx)=>{const li=el("li");li.append(el("span","d",fmt(e.d)),el("span",null,e.t));
    const x=el("button","x","×");x.type="button";x.title="Remove this note";
    x.onclick=()=>{CUR.log.splice(idx,1);renderLog()};li.append(x);ul.append(li)});
  if(!CUR.log.length)ul.append(el("li","meta","No progress notes yet."));
}
$("e-progress").oninput=e=>$("e-pv").textContent=e.target.value+"%";
$("e-status").onchange=e=>{if(e.target.value==="done"){$("e-progress").value=100;$("e-pv").textContent="100%"}};
$("e-add").onclick=()=>{const t=$("e-lt").value.trim();if(!t)return;CUR.log.unshift({d:today(),t:t});$("e-lt").value="";renderLog()};
$("e-lt").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();$("e-add").click()}};
$("editor").onsubmit=async e=>{e.preventDefault();
  const pending=$("e-lt").value.trim();if(pending){CUR.log.unshift({d:today(),t:pending});$("e-lt").value=""}
  FIELDS.forEach(k=>CUR[k]=$("e-"+k).value);CUR.progress=Number($("e-progress").value);
  $("e-save").disabled=true;$("emsg").textContent="Saving…";
  try{PROJ=(await api("/api/projects/save",{project:CUR})).projects;renderProjects()}
  catch(err){if(err.message!=="auth")$("emsg").textContent="Couldn't save ("+err.message+"). Try again."}
  finally{$("e-save").disabled=false}};
$("e-del").onclick=async()=>{if(!confirm('Delete "'+CUR.title+'"? This cannot be undone.'))return;
  try{PROJ=(await api("/api/projects/delete",{id:CUR.id})).projects;renderProjects()}
  catch(err){if(err.message!=="auth")$("emsg").textContent="Couldn't delete ("+err.message+")."}};
$("e-cancel").onclick=renderProjects;
$("new").onclick=()=>openEditor(null);

/* ---- Mailing list ---- */
async function loadList(){
  try{LIST=(await api("/api/list")).subscribers}
  catch(e){if(e.message!=="auth")$("msg").textContent="Couldn't load the list ("+e.message+").";return}
  $("count").textContent=LIST.length+" subscriber"+(LIST.length===1?"":"s");
  $("rows").innerHTML="";
  LIST.forEach(s=>{const tr=document.createElement("tr");
    tr.innerHTML="<td></td><td></td><td><button class='ghost'>Remove</button></td>";
    tr.children[0].textContent=s.email; tr.children[1].textContent=(s.joined||"").slice(0,10);
    tr.querySelector("button").onclick=async()=>{if(!confirm("Remove "+s.email+"?"))return;
      await api("/api/remove",{email:s.email}).catch(()=>{});loadList()};
    $("rows").appendChild(tr)});
}
$("lf").onsubmit=e=>{e.preventDefault();KEY=$("pw").value;start()};
$("copy").onclick=async()=>{const t=LIST.map(s=>s.email).join(", ");
  try{await navigator.clipboard.writeText(t);$("msg").textContent="Copied "+LIST.length+" addresses. Paste them into BCC."}
  catch(e){prompt("Copy these addresses:",t)}};
$("csv").onclick=()=>{const csv="email,joined\\n"+LIST.map(s=>s.email+","+s.joined).join("\\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  a.download="sbalzer-mailing-list.csv";a.click()};
$("out").onclick=()=>{sessionStorage.removeItem("ak");location.reload()};
if(KEY)start();
</script></main></body></html>`;

const UNSUB_PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Unsubscribe · Sam Balzer</title><style>${PAGE_STYLE}</style></head><body><main>
<h1>Unsubscribe</h1>
<p>Enter your email to stop receiving updates from Sam Balzer.</p>
<form class="row" id="f"><input type="email" id="e" placeholder="you@example.com" required><button>Unsubscribe</button></form>
<div class="msg" id="m"></div>
<p><a href="/">← Back to sbalzer.com</a></p>
<script>
const q=new URLSearchParams(location.search).get("email"); if(q) document.getElementById("e").value=q;
document.getElementById("f").onsubmit=async e=>{e.preventDefault();
  const r=await fetch("/api/unsubscribe",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:document.getElementById("e").value})});
  document.getElementById("m").textContent=r.ok?"Done. You've been removed from the list.":"Something went wrong. Please email sam@sbalzer.com."};
</script></main></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/admin") return html(ADMIN_PAGE);
    if (path === "/unsubscribe") return html(UNSUB_PAGE);

    if (path.startsWith("/api/")) {
      if (!env.SUBSCRIBERS) return json({ ok: false, error: "not_configured" }, 503);

      if (path === "/api/subscribe" && request.method === "POST") {
        const body = await readBody(request);
        if (body.website) return json({ ok: true }); // honeypot: bots fill hidden field
        const email = cleanEmail(body.email);
        if (!email) return json({ ok: false, error: "invalid_email" }, 400);
        const key = "sub:" + email;
        const existing = await env.SUBSCRIBERS.get(key);
        if (existing) return json({ ok: true, already: true });
        const joined = new Date().toISOString();
        await env.SUBSCRIBERS.put(key, JSON.stringify({ joined }), { metadata: { d: joined } });
        const total = (await listAll(env)).length;
        await notify(env, email, total);
        return json({ ok: true });
      }

      if (path === "/api/unsubscribe" && request.method === "POST") {
        const email = cleanEmail((await readBody(request)).email);
        if (email) await env.SUBSCRIBERS.delete("sub:" + email);
        return json({ ok: true });
      }

      if (path === "/api/list" && request.method === "GET") {
        if (!isAdmin(request, env)) return json({ ok: false }, 403);
        return json({ ok: true, subscribers: await listAll(env) });
      }

      if (path === "/api/remove" && request.method === "POST") {
        if (!isAdmin(request, env)) return json({ ok: false }, 403);
        const email = cleanEmail((await readBody(request)).email);
        if (email) await env.SUBSCRIBERS.delete("sub:" + email);
        return json({ ok: true });
      }

      if (path === "/api/projects" && request.method === "GET") {
        if (!isAdmin(request, env)) return json({ ok: false }, 403);
        return json({ ok: true, projects: await getProjects(env) });
      }

      if (path === "/api/projects/save" && request.method === "POST") {
        if (!isAdmin(request, env)) return json({ ok: false }, 403);
        const input = (await readBody(request)).project;
        const list = await getProjects(env);
        const i = list.findIndex((p) => p.id === input?.id);
        const project = cleanProject(input, i >= 0 ? list[i] : null);
        if (!project) return json({ ok: false, error: "title_required" }, 400);
        if (i >= 0) list[i] = project;
        else list.push(project);
        await env.SUBSCRIBERS.put(PROJ_KEY, JSON.stringify(list));
        return json({ ok: true, project, projects: list });
      }

      if (path === "/api/projects/delete" && request.method === "POST") {
        if (!isAdmin(request, env)) return json({ ok: false }, 403);
        const id = (await readBody(request)).id;
        const list = (await getProjects(env)).filter((p) => p.id !== id);
        await env.SUBSCRIBERS.put(PROJ_KEY, JSON.stringify(list));
        return json({ ok: true, projects: list });
      }

      return json({ ok: false, error: "not_found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
