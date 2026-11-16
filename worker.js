// Sam Balzer website: mailing list.
// Serves the static site, plus a few small endpoints:
//   POST /api/subscribe     { email, website(honeypot) }  -> saves to the list, emails Sam
//   POST /api/unsubscribe   { email }                      -> removes from the list
//   GET  /api/list          (header X-Admin-Key)            -> list for the admin page
//   POST /api/remove        (header X-Admin-Key) { email }  -> admin removes an address
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

const ADMIN_PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Mailing list · Sam Balzer</title><style>${PAGE_STYLE}</style></head><body><main>
<h1>Mailing list</h1>
<div id="login"><p>Enter your admin password.</p>
 <form class="row" id="lf"><input type="password" id="pw" placeholder="Password" autocomplete="current-password" required><button>Open</button></form>
 <div class="msg" id="lmsg"></div></div>
<div id="app" hidden>
 <p id="count"></p>
 <div class="row">
  <button id="copy">Copy all (for BCC)</button>
  <button class="ghost" id="csv">Download CSV</button>
  <button class="ghost" id="out">Log out</button>
 </div>
 <div class="msg" id="msg"></div>
 <table><thead><tr><th>Email</th><th>Joined</th><th></th></tr></thead><tbody id="rows"></tbody></table>
</div>
<script>
let KEY=sessionStorage.getItem("ak")||"", LIST=[];
const $=id=>document.getElementById(id);
async function load(){
  const r=await fetch("/api/list",{headers:{"x-admin-key":KEY}});
  if(r.status===403){$("lmsg").textContent="That password didn't work.";$("login").hidden=false;$("app").hidden=true;return}
  if(!r.ok){$("lmsg").textContent="Couldn't load the list ("+r.status+").";return}
  LIST=(await r.json()).subscribers; sessionStorage.setItem("ak",KEY);
  $("login").hidden=true;$("app").hidden=false;
  $("count").textContent=LIST.length+" subscriber"+(LIST.length===1?"":"s");
  $("rows").innerHTML="";
  LIST.forEach(s=>{const tr=document.createElement("tr");
    tr.innerHTML="<td></td><td></td><td><button class='ghost'>Remove</button></td>";
    tr.children[0].textContent=s.email; tr.children[1].textContent=(s.joined||"").slice(0,10);
    tr.querySelector("button").onclick=async()=>{if(!confirm("Remove "+s.email+"?"))return;
      await fetch("/api/remove",{method:"POST",headers:{"x-admin-key":KEY,"content-type":"application/json"},body:JSON.stringify({email:s.email})});load()};
    $("rows").appendChild(tr)});
}
$("lf").onsubmit=e=>{e.preventDefault();KEY=$("pw").value;load()};
$("copy").onclick=async()=>{const t=LIST.map(s=>s.email).join(", ");
  try{await navigator.clipboard.writeText(t);$("msg").textContent="Copied "+LIST.length+" addresses. Paste them into BCC."}
  catch(e){prompt("Copy these addresses:",t)}};
$("csv").onclick=()=>{const csv="email,joined\\n"+LIST.map(s=>s.email+","+s.joined).join("\\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  a.download="sbalzer-mailing-list.csv";a.click()};
$("out").onclick=()=>{sessionStorage.removeItem("ak");location.reload()};
if(KEY)load();
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

      return json({ ok: false, error: "not_found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
