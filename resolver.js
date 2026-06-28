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
  activeProxy = null;
  setProxyStatus("not tested", "#555");
}

// ── Fetch via active proxy ────────────────────────────────────────────────────
async function proxyFetch(url, options = {}) {
  const wrapped = activeProxy.wrap(url);
  const res = await fetch(wrapped, { signal: AbortSignal.timeout(14000), ...options });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// ── Proxy negotiation ─────────────────────────────────────────────────────────
async function findProxy(testUrl) {
  setProxyStatus("searching…", "#ffb86c");
  for (const proxy of PROXY_LIST) {
    log(`  Trying proxy: ${proxy.name} ...`, "warn");
    try {
      const res = await fetch(proxy.wrap(testUrl), { signal: AbortSignal.timeout(9000) });
      if (res.ok) {
        const text = await res.text();
        if (text.length > 100) {
          activeProxy = proxy;
          setProxyStatus(`✓ ${proxy.name}`, "#6dff6d");
          log(`  ✓ Using proxy: ${proxy.name}\n`, "ok");
          return true;
        }
      }
      log(`  ✗ ${proxy.name} — bad response`, "err");
    } catch (e) {
      log(`  ✗ ${proxy.name} — ${e.message}`, "err");
    }
  }
  setProxyStatus("✗ all proxies failed", "#ff6d6d");
  log(`\n  ✗ All proxies failed.\n`, "err");
  return false;
}

// ── Flatten nested objects/arrays to find items with .file ────────────────────
function flatten(obj) {
  if (Array.isArray(obj)) return obj.flatMap(flatten);
  if (obj && typeof obj === "object") return [obj];
  return [];
}

// ── Render a track card ───────────────────────────────────────────────────────
function renderCard(lang, content) {
  const wrap = document.getElementById("results");
  const card = document.createElement("div");
  card.className = "track-card";

  // Try to detect m3u8 lines
  const lines = content.split("\n").filter(l => l.trim().startsWith("http"));
  let inner = "";
  if (lines.length > 0) {
    inner = lines.map(u => `
      <div class="stream-row">
        <span class="stream-url">${escHtml(u.trim())}</span>
        <button class="copy-btn" onclick="copyUrl('${escHtml(u.trim())}')">Copy</button>
      </div>`).join("");
  } else {
    inner = `<div class="raw-block">${escHtml(content.slice(0, 1000))}</div>`;
  }

  card.innerHTML = `<div class="track-title">[${escHtml(lang)}]</div>${inner}`;
  wrap.appendChild(card);
  return lines.length;
}

function copyUrl(url) {
  navigator.clipboard.writeText(url).catch(() => prompt("Copy:", url));
}

// ── Main resolve ──────────────────────────────────────────────────────────────
async function resolve() {
  const imdbId = document.getElementById("imdbId").value.trim();
  if (!imdbId) { alert("Enter an IMDb ID"); return; }

  document.getElementById("resolveBtn").disabled = true;
  document.getElementById("results").innerHTML   = "";
  document.getElementById("summary").textContent = "";
  document.getElementById("log").textContent     = "";

  const referer = `${BASE}/play/${imdbId}`;

  // Step 1 — find proxy
  if (!activeProxy) {
    const ok = await findProxy(referer);
    if (!ok) {
      document.getElementById("resolveBtn").disabled = false;
      return;
    }
  }

  // Step 2 — fetch page HTML
  log(`Fetching page: ${referer}\n`);
  let html;
  try {
    const res = await proxyFetch(referer);
    html = await res.text();
    log(`  ✓ Page fetched (${html.length} bytes)`, "ok");
  } catch (e) {
    log(`  ✗ Page fetch failed: ${e.message}`, "err");
    document.getElementById("resolveBtn").disabled = false;
    return;
  }

  // Step 3 — extract p3 config
  const cfgMatch = html.match(/let\s+p3\s*=\s*(\{.+?\});/s);
  if (!cfgMatch) {
    log(`  ✗ p3 config not found in page HTML.`, "err");
    log(`\nRaw page snippet:\n${html.slice(0, 500)}`, "warn");
    document.getElementById("resolveBtn").disabled = false;
    return;
  }

  let cfg;
  try {
    cfg = JSON.parse(cfgMatch[1]);
  } catch (e) {
    log(`  ✗ Failed to parse p3 config: ${e.message}`, "err");
    document.getElementById("resolveBtn").disabled = false;
    return;
  }

  const token   = cfg.key;
  const filePath = cfg.file;
  log(`  ✓ Token:  ${token.slice(0, 30)}...`, "ok");
  log(`  ✓ File:   ${filePath.slice(0, 60)}...`, "ok");

  // Step 4 — POST helper
  async function post(url) {
    const proxied = activeProxy.wrap(url);
    const res = await fetch(proxied, {
      method: "POST",
      headers: {
        "X-CSRF-Token":  token,
        "Referer":       referer,
        "Origin":        BASE,
        "Content-Type":  "application/x-www-form-urlencoded",
      },
      body: "",
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // try base64 decode
    try {
      const decoded = atob(text.trim());
      if (["{","[","#","h"].includes(decoded[0])) return decoded;
    } catch (_) {}
    return text;
  }

  // Step 5 — fetch track list
  log(`\nFetching track list...`);
  let tracks;
  try {
    const rawStr = await post(filePath);
    const rawTracks = JSON.parse(rawStr);
    tracks = flatten(rawTracks).filter(t => t.file);
    log(`  ✓ ${tracks.length} track(s) found`, "ok");
  } catch (e) {
    log(`  ✗ Track list failed: ${e.message}`, "err");
    document.getElementById("resolveBtn").disabled = false;
    return;
  }

  // Step 6 — fetch each playlist
  let totalUrls = 0;
  for (const t of tracks) {
    const fp   = String(t.file || "");
    const lang = String(t.title || "unknown");
    const pl   = fp.startsWith("~") ? fp.slice(1) + ".txt" : fp;
    const plUrl = `${BASE}/playlist/${encodeURIComponent(pl)}`;

    log(`\nFetching playlist [${lang}]: ${pl.slice(0, 60)}...`);
    try {
      const raw = await post(plUrl);
      log(`  ✓ Got ${raw.length} bytes`, "ok");
      const count = renderCard(lang, raw.trim());
      totalUrls += count;
    } catch (e) {
      log(`  ✗ [${lang}] failed: ${e.message}`, "err");
    }
  }

  log(`\nDone — ${totalUrls} stream URL(s) found`);
  document.getElementById("summary").textContent =
    `✓ ${totalUrls} stream URL(s) across ${tracks.length} track(s)  |  proxy: ${activeProxy.name}`;
  document.getElementById("resolveBtn").disabled = false;
}