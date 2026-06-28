const BASE = "https://gemma416okl.com";

// Ordered by POST+custom-header support
const PROXY_LIST = [
  // These forward custom headers (POST friendly)
  { name: "corsanywhere-demo", wrap: u => `https://cors-anywhere.herokuapp.com/${u}`,              supportsPost: true  },
  { name: "corsproxy.io",      wrap: u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,   supportsPost: true  },
  // GET only fallbacks
  { name: "allorigins",        wrap: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,          supportsPost: false },
  { name: "codetabs",          wrap: u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,     supportsPost: false },
  { name: "htmldriven",        wrap: u => `https://cors.htmldriven.com/?url=${encodeURIComponent(u)}`,            supportsPost: false },
  { name: "thingproxy",        wrap: u => `https://thingproxy.freeboard.io/fetch/${u}`,            supportsPost: false },
];

let activeProxy  = null;
let postProxy    = null; // best proxy that supports POST
let csrfToken    = null;
let pageReferer  = null;

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg, cls = "") {
  const el = document.getElementById("log");
  el.innerHTML += `<span class="${cls}">${escHtml(msg)}</span>\n`;
  el.scrollTop = el.scrollHeight;
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function setProxyStatus(msg, color) {
  document.getElementById("proxyStatus").innerHTML =
    `Proxy: <span style="color:${color}">${msg}</span>`;
}

function clearAll() {
  document.getElementById("log").textContent = "Ready.";
  document.getElementById("results").innerHTML = "";
  document.getElementById("summary").textContent = "";
  activeProxy = null; postProxy = null; csrfToken = null; pageReferer = null;
  setProxyStatus("not tested", "#555");
}

function tryBase64(text) {
  try {
    const d = atob(text.trim());
    if (["{","[","#","h"].includes(d[0])) return d;
  } catch (_) {}
  return text;
}

// ── Find working GET proxy ─────────────────────────────────────────────────────
async function findGetProxy(testUrl) {
  setProxyStatus("searching…", "#ffb86c");
  for (const proxy of PROXY_LIST) {
    log(`  Trying [GET] ${proxy.name} ...`, "warn");
    try {
      const res = await fetch(proxy.wrap(testUrl), { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const text = await res.text();
        if (text.length > 100) {
          activeProxy = proxy;
          setProxyStatus(`✓ ${proxy.name}`, "#6dff6d");
          log(`  ✓ GET proxy: ${proxy.name}\n`, "ok");
          return text;
        }
      }
      log(`  ✗ ${proxy.name} — bad response`, "err");
    } catch (e) {
      log(`  ✗ ${proxy.name} — ${e.message}`, "err");
    }
  }
  return null;
}

// ── Find working POST proxy ───────────────────────────────────────────────────
async function findPostProxy(testUrl) {
  // Try POST-capable proxies first
  const candidates = [...PROXY_LIST].sort((a,b) => (b.supportsPost ? 1 : 0) - (a.supportsPost ? 1 : 0));
  for (const proxy of candidates) {
    log(`  Trying [POST] ${proxy.name} ...`, "warn");
    try {
      const res = await fetch(proxy.wrap(testUrl), {
        method: "POST",
        headers: {
          "X-CSRF-Token":  csrfToken,
          "Referer":       pageReferer,
          "Origin":        BASE,
          "Content-Type":  "application/x-www-form-urlencoded",
        },
        body: "",
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 5) {
          postProxy = proxy;
          log(`  ✓ POST proxy: ${proxy.name}\n`, "ok");
          return tryBase64(text);
        }
      }
      log(`  ✗ ${proxy.name} — status ${res.status}`, "err");
    } catch (e) {
      log(`  ✗ ${proxy.name} — ${e.message}`, "err");
    }
  }
  return null;
}

// ── POST with full fallback chain ─────────────────────────────────────────────
async function postWithFallback(url) {
  // Strategy 1: use known working postProxy
  if (postProxy) {
    try {
      const res = await fetch(postProxy.wrap(url), {
        method: "POST",
        headers: {
          "X-CSRF-Token":  csrfToken,
          "Referer":       pageReferer,
          "Origin":        BASE,
          "Content-Type":  "application/x-www-form-urlencoded",
        },
        body: "",
        signal: AbortSignal.timeout(14000),
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 5) return tryBase64(text);
      }
    } catch (e) {
      log(`    ✗ postProxy failed: ${e.message} — trying others...`, "warn");
      postProxy = null;
    }
  }

  // Strategy 2: try all proxies with POST
  for (const proxy of PROXY_LIST) {
    log(`    retrying POST via ${proxy.name}...`, "warn");
    try {
      const res = await fetch(proxy.wrap(url), {
        method: "POST",
        headers: {
          "X-CSRF-Token":  csrfToken,
          "Referer":       pageReferer,
          "Origin":        BASE,
          "Content-Type":  "application/x-www-form-urlencoded",
        },
        body: "",
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 5) {
          postProxy = proxy;
          log(`    ✓ found working POST proxy: ${proxy.name}`, "ok");
          return tryBase64(text);
        }
      }
    } catch (_) {}
  }

  // Strategy 3: GET fallback with token in URL
  log(`    trying GET fallback with token in URL...`, "warn");
  for (const proxy of PROXY_LIST) {
    try {
      const sep = url.includes("?") ? "&" : "?";
      const tokenUrl = `${url}${sep}_token=${encodeURIComponent(csrfToken)}`;
      const res = await fetch(proxy.wrap(tokenUrl), { signal: AbortSignal.timeout(12000) });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 5) {
          log(`    ✓ GET+token worked via ${proxy.name}`, "ok");
          return tryBase64(text);
        }
      }
    } catch (_) {}
  }

  throw new Error("all proxies and strategies exhausted");
}

// ── Flatten ───────────────────────────────────────────────────────────────────
function flatten(obj) {
  if (Array.isArray(obj)) return obj.flatMap(flatten);
  if (obj && typeof obj === "object") return [obj];
  return [];
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderCard(lang, content) {
  const wrap = document.getElementById("results");
  const card = document.createElement("div");
  card.className = "track-card";
  const lines = content.split("\n").filter(l => l.trim().startsWith("http"));
  let inner = lines.length > 0
    ? lines.map(u => `
        <div class="stream-row">
          <span class="stream-url">${escHtml(u.trim())}</span>
          <button class="copy-btn" onclick="copyUrl(this,'${escHtml(u.trim())}')">Copy</button>
        </div>`).join("")
    : `<div class="raw-block">${escHtml(content.slice(0,2000))}</div>`;
  card.innerHTML = `<div class="track-title">[${escHtml(lang)}]</div>${inner}`;
  wrap.appendChild(card);
  return lines.length;
}

function copyUrl(btn, url) {
  navigator.clipboard.writeText(url).catch(() => prompt("Copy:", url));
  btn.textContent = "✓";
  setTimeout(() => btn.textContent = "Copy", 1500);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function resolve() {
  const imdbId = document.getElementById("imdbId").value.trim();
  if (!imdbId) { alert("Enter an IMDb ID"); return; }

  document.getElementById("resolveBtn").disabled = true;
  document.getElementById("results").innerHTML   = "";
  document.getElementById("summary").textContent = "";
  document.getElementById("log").textContent     = "";

  pageReferer = `${BASE}/play/${imdbId}`;
  log(`Fetching page: ${pageReferer}\n`);

  // Step 1 — find GET proxy + fetch page
  const html = await findGetProxy(pageReferer);
  if (!html) {
    log("✗ Cannot fetch page — all proxies failed.", "err");
    document.getElementById("resolveBtn").disabled = false;
    return;
  }
  log(`  ✓ Page fetched (${html.length} bytes)`, "ok");

  // Step 2 — extract p3 config
  const cfgMatch = html.match(/let\s+p3\s*=\s*(\{[\s\S]+?\});/);
  if (!cfgMatch) {
    log("  ✗ p3 config not found in page.", "err");
    log(`Page snippet:\n${html.slice(0,800)}`, "warn");
    document.getElementById("resolveBtn").disabled = false;
    return;
  }

  let cfg;
  try { cfg = JSON.parse(cfgMatch[1]); }
  catch(e) { log(`  ✗ p3 parse error: ${e.message}`, "err"); document.getElementById("resolveBtn").disabled = false; return; }

  csrfToken       = cfg.key;
  const filePath  = cfg.file;
  log(`  ✓ Token: ${csrfToken.slice(0,30)}...`, "ok");
  log(`  ✓ File:  ${filePath.slice(0,60)}...`, "ok");

  // Step 3 — find POST proxy + fetch track list
  log(`\nFinding POST proxy + fetching track list...`);
  let tracks;
  try {
    const rawStr = await findPostProxy(filePath) ?? await postWithFallback(filePath);
    const rawData = JSON.parse(rawStr);
    tracks = flatten(rawData).filter(t => t.file);
    log(`  ✓ ${tracks.length} track(s) found`, "ok");
  } catch(e) {
    log(`  ✗ Track list failed: ${e.message}`, "err");
    document.getElementById("resolveBtn").disabled = false;
    return;
  }

  // Step 4 — fetch each playlist
  let totalUrls = 0;
  for (const t of tracks) {
    const fp   = String(t.file || "");
    const lang = String(t.title || "unknown");
    const pl   = fp.startsWith("~") ? fp.slice(1) + ".txt" : fp;
    const plUrl = `${BASE}/playlist/${encodeURIComponent(pl)}`;

    log(`\nFetching [${lang}]: ${pl.slice(0,60)}...`);
    try {
      const raw   = await postWithFallback(plUrl);
      const count = renderCard(lang, raw.trim());
      totalUrls  += count;
      log(`  ✓ ${count} URL(s)`, "ok");
    } catch(e) {
      log(`  ✗ [${lang}] failed: ${e.message}`, "err");
    }
  }

  log(`\nDone — ${totalUrls} stream URL(s) found`);
  document.getElementById("summary").textContent =
    `✓ ${totalUrls} URL(s) | GET proxy: ${activeProxy?.name} | POST proxy: ${postProxy?.name ?? "none"}`;
  document.getElementById("resolveBtn").disabled = false;
}