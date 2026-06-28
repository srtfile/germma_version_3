// resolver.js

const BASE = "https://gemma416okl.com";

const PROXY_LIST = [
  { name: "corsproxy.io",      wrap: u => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  { name: "allorigins",        wrap: u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { name: "codetabs",          wrap: u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` },
  { name: "htmldriven",        wrap: u => `https://cors.htmldriven.com/?url=${encodeURIComponent(u)}` },
  { name: "thingproxy",        wrap: u => `https://thingproxy.freeboard.io/fetch/${u}` },
  { name: "corsanywhere-demo", wrap: u => `https://cors-anywhere.herokuapp.com/${u}` },
];

let activeProxy = null;
let csrfToken   = null;
let pageReferer = null;

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg, cls = "") {
  const el = document.getElementById("log");
  el.innerHTML += `<span class="${cls}">${escHtml(msg)}</span>\n`;
  el.scrollTop = el.scrollHeight;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function setProxyStatus(msg, color) {
  document.getElementById("proxyStatus").innerHTML =
    `Proxy: <span style="color:${color}">${msg}</span>`;
}

function clearAll() {
  document.getElementById("log").textContent = "Ready.";
  document.getElementById("results").innerHTML = "";
  document.getElementById("summary").textContent = "";
  activeProxy  = null;
  csrfToken    = null;
  pageReferer  = null;
  setProxyStatus("not tested", "#555");
}

// ── Try base64 decode ─────────────────────────────────────────────────────────
function tryBase64(text) {
  try {
    const decoded = atob(text.trim());
    if (["{", "[", "#", "h"].includes(decoded[0])) return decoded;
  } catch (_) {}
  return text;
}

// ── Proxy negotiation ─────────────────────────────────────────────────────────
async function findProxy(testUrl) {
  setProxyStatus("searching…", "#ffb86c");
  for (const proxy of PROXY_LIST) {
    log(`  Trying proxy: ${proxy.name} ...`, "warn");
    try {
      const res = await fetch(proxy.wrap(testUrl), {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const text = await res.text();
        if (text.length > 100) {
          activeProxy = proxy;
          setProxyStatus(`✓ ${proxy.name}`, "#6dff6d");
          log(`  ✓ Using proxy: ${proxy.name}\n`, "ok");
          return text; // return page HTML directly
        }
      }
      log(`  ✗ ${proxy.name} — bad response`, "err");
    } catch (e) {
      log(`  ✗ ${proxy.name} — ${e.message}`, "err");
    }
  }
  setProxyStatus("✗ all proxies failed", "#ff6d6d");
  log(`\n  ✗ All proxies failed.\n`, "err");
  return null;
}

// ── GET via proxy (with optional headers injected as query params) ─────────────
async function proxyGet(url) {
  const res = await fetch(activeProxy.wrap(url), {
    signal: AbortSignal.timeout(14000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// ── POST-as-GET: append token to URL as query param fallback ──────────────────
async function fetchPlaylist(url) {
  // Strategy 1: plain GET via proxy (token already in URL usually)
  try {
    const text = await proxyGet(url);
    if (text && text.length > 10) return tryBase64(text);
  } catch (e) {
    log(`    GET failed: ${e.message} — trying with token param...`, "warn");
  }

  // Strategy 2: append token as query param
  try {
    const sep = url.includes("?") ? "&" : "?";
    const urlWithToken = `${url}${sep}_token=${encodeURIComponent(csrfToken)}`;
    const text = await proxyGet(urlWithToken);
    if (text && text.length > 10) return tryBase64(text);
  } catch (e) {
    log(`    token-param GET failed: ${e.message}`, "warn");
  }

  // Strategy 3: try next proxies in list for this specific URL
  for (const proxy of PROXY_LIST) {
    if (proxy.name === activeProxy.name) continue;
    try {
      log(`    retrying with proxy: ${proxy.name}`, "warn");
      const res = await fetch(proxy.wrap(url), { signal: AbortSignal.timeout(12000) });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 10) return tryBase64(text);
      }
    } catch (_) {}
  }

  throw new Error("all strategies exhausted");
}

// ── Flatten nested objects/arrays ─────────────────────────────────────────────
function flatten(obj) {
  if (Array.isArray(obj)) return obj.flatMap(flatten);
  if (obj && typeof obj === "object") return [obj];
  return [];
}

// ── Render card ───────────────────────────────────────────────────────────────
function renderCard(lang, content) {
  const wrap = document.getElementById("results");
  const card = document.createElement("div");
  card.className = "track-card";

  const lines = content.split("\n").filter(l => l.trim().startsWith("http"));
  let inner = "";
  if (lines.length > 0) {
    inner = lines.map(u => `
      <div class="stream-row">
        <span class="stream-url">${escHtml(u.trim())}</span>
        <button class="copy-btn" onclick="copyUrl(this, '${escHtml(u.trim())}')">Copy</button>
      </div>`).join("");
  } else {
    inner = `<div class="raw-block">${escHtml(content.slice(0, 2000))}</div>`;
  }

  card.innerHTML = `<div class="track-title">[${escHtml(lang)}]</div>${inner}`;
  wrap.appendChild(card);
  return lines.length;
}

function copyUrl(btn, url) {
  navigator.clipboard.writeText(url).catch(() => prompt("Copy:", url));
  btn.textContent = "✓";
  setTimeout(() => btn.textContent = "Copy", 1500);
}

// ── Main resolve ──────────────────────────────────────────────────────────────
async function resolve() {
  const imdbId = document.getElementById("imdbId").value.trim();
  if (!imdbId) { alert("Enter an IMDb ID"); return; }

  document.getElementById("resolveBtn").disabled = true;
  document.getElementById("results").innerHTML   = "";
  document.getElementById("summary").textContent = "";
  document.getElementById("log").textContent     = "";

  pageReferer = `${BASE}/play/${imdbId}`;

  // Step 1 — fetch page + find proxy simultaneously
  log(`Fetching page: ${pageReferer}\n`);
  const html = await findProxy(pageReferer);
  if (!html) {
    document.getElementById("resolveBtn").disabled = false;
    return;
  }
  log(`  ✓ Page fetched (${html.length} bytes)`, "ok");

  // Step 2 — extract p3 config
  const cfgMatch = html.match(/let\s+p3\s*=\s*(\{[\s\S]+?\});/);
  if (!cfgMatch) {
    log(`  ✗ p3 config not found.`, "err");
    log(`\nPage snippet:\n${html.slice(0, 800)}`, "warn");
    document.getElementById("resolveBtn").disabled = false;
    return;
  }

  let cfg;
  try { cfg = JSON.parse(cfgMatch[1]); }
  catch (e) {
    log(`  ✗ Failed to parse p3: ${e.message}`, "err");
    document.getElementById("resolveBtn").disabled = false;
    return;
  }

  csrfToken      = cfg.key;
  const filePath = cfg.file;
  log(`  ✓ Token:  ${csrfToken.slice(0, 30)}...`, "ok");
  log(`  ✓ File:   ${filePath.slice(0, 60)}...`, "ok");

  // Step 3 — fetch track list
  log(`\nFetching track list...`);
  let tracks;
  try {
    const rawStr  = await fetchPlaylist(filePath);
    const rawData = JSON.parse(rawStr);
    tracks = flatten(rawData).filter(t => t.file);
    log(`  ✓ ${tracks.length} track(s) found`, "ok");
  } catch (e) {
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

    log(`\nFetching [${lang}]: ${pl.slice(0, 60)}...`);
    try {
      const raw   = await fetchPlaylist(plUrl);
      const count = renderCard(lang, raw.trim());
      totalUrls  += count;
      log(`  ✓ ${count} URL(s)`, "ok");
    } catch (e) {
      log(`  ✗ [${lang}] failed: ${e.message}`, "err");
    }
  }

  log(`\nDone — ${totalUrls} stream URL(s) found`);
  document.getElementById("summary").textContent =
    `✓ ${totalUrls} stream URL(s) across ${tracks.length} track(s)  |  proxy: ${activeProxy?.name}`;
  document.getElementById("resolveBtn").disabled = false;
}