console.log("✅ app.js loaded");

const $ = (id) => document.getElementById(id);

const state = {
  wallets: [],
  collections: [],        // grouped by contract after load
  selectedKeys: new Set(),// optional later; for now we build from all loaded
  chain: "eth",
  host: "eth-mainnet.g.alchemy.com",
};

// NOTE: For production, do NOT keep keys in frontend JS.
const ALCHEMY_KEY = "GYuepn7j7XCslBzxLwO5M";

const ALCHEMY_HOST = {
  eth: "eth-mainnet.g.alchemy.com",
  base: "base-mainnet.g.alchemy.com",
  polygon: "polygon-mainnet.g.alchemy.com",
};

// Cloudflare Worker proxy (MUST match your deployed worker)
const IMG_PROXY = "https://loflexgrid.littleollienft.workers.dev/img?url=";

// ---------- limiter ----------
function createLimiter(max = 3) {
  let active = 0;
  const q = [];
  const next = () => {
    if (active >= max || q.length === 0) return;
    active++;
    const { fn, resolve, reject } = q.shift();
    fn().then(resolve).catch(reject).finally(() => {
      active--;
      next();
    });
  };
  return (fn) => new Promise((resolve, reject) => { q.push({ fn, resolve, reject }); next(); });
}
const imgLimit = createLimiter(3);

function setImgSrcLimited(imgEl, src) {
  return imgLimit(() =>
    new Promise((resolve, reject) => {
      imgEl.onload = () => resolve(true);
      imgEl.onerror = () => reject(new Error("Image failed: " + src));
      imgEl.src = src;
    })
  );
}

// ---------- ui ----------
function setStatus(msg) { const el = $("status"); if (el) el.textContent = msg || ""; }
function enableButtons() {
  $("loadBtn").disabled = state.wallets.length === 0;
  $("buildBtn").disabled = state.collections.length === 0;
  $("exportBtn").disabled = true;
}

// ---------- url helpers ----------
function isAlreadyProxied(url) {
  return typeof url === "string" && url.startsWith(IMG_PROXY);
}

function getIpfsPath(url) {
  if (!url) return "";
  const s = String(url).trim();
  if (s.startsWith("ipfs://")) {
    let p = s.slice("ipfs://".length);
    p = p.replace(/^ipfs\//, "");
    return p.replace(/^\/+/, "");
  }
  try {
    const u = new URL(s);
    const idx = u.pathname.indexOf("/ipfs/");
    if (idx !== -1) return u.pathname.slice(idx + 6).replace(/^\/+/, "");
  } catch {}
  return "";
}

function normalizeImageUrl(url) {
  if (!url) return "";
  if (isAlreadyProxied(url)) return url;
  const ipfsPath = getIpfsPath(url);
  if (ipfsPath) return "ipfs://" + ipfsPath;
  try { return new URL(String(url)).toString(); } catch { return String(url); }
}

function safeProxyUrl(src) {
  if (!src) return "";
  if (isAlreadyProxied(src)) return src;
  const direct = normalizeImageUrl(src);
  if (isAlreadyProxied(direct)) return direct;
  return IMG_PROXY + encodeURIComponent(direct);
}

// ---------- watermark (DOM overlay) ----------
function syncWatermarkDOMToOneTile() {
  const wm = $("wmGrid");
  const grid = $("grid");
  if (!wm || !grid) return;

  const firstTile = grid.querySelector(".tile");
  if (!firstTile) return;

  wm.style.left = "4px";
  wm.style.top = "4px";

  const tileW = firstTile.getBoundingClientRect().width || 220;
  wm.style.maxWidth = `${Math.max(90, tileW - 8)}px`;

  const s = Math.max(0.62, Math.min(1, tileW / 260));
  wm.style.transform = `scale(${s})`;
  wm.style.transformOrigin = "top left";
}

// ---------- wallets ----------
function normalizeWallet(w) {
  return (w || "").trim().replace(/\s+/g, "").toLowerCase();
}

function renderWalletList() {
  const wrap = $("walletList");
  if (!wrap) return;

  if (!state.wallets.length) {
    wrap.style.display = "none";
    wrap.innerHTML = "";
    return;
  }

  wrap.style.display = "flex";
  wrap.innerHTML = "";

  state.wallets.forEach((w) => {
    const row = document.createElement("div");
    row.className = "walletChip";

    const left = document.createElement("div");
    left.style.minWidth = "0";

    const addr = document.createElement("div");
    addr.className = "walletAddr";
    addr.textContent = w;

    const meta = document.createElement("div");
    meta.className = "walletMeta";
    meta.textContent = "Ready";

    left.appendChild(addr);
    left.appendChild(meta);

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "btnSmall";
    rm.textContent = "🗑 Remove";
    rm.addEventListener("click", () => {
      state.wallets = state.wallets.filter(x => x !== w);
      renderWalletList();
      enableButtons();
      setStatus(`Wallet removed ✅ (${state.wallets.length} remaining)`);
    });

    row.appendChild(left);
    row.appendChild(rm);
    wrap.appendChild(row);
  });
}

function addWallet() {
  const input = $("walletInput");
  const w = normalizeWallet(input?.value);

  if (!w) return setStatus("Paste a wallet address first.");
  if (!/^0x[a-f0-9]{40}$/.test(w)) return setStatus("That doesn’t look like a valid 0x wallet address.");
  if (state.wallets.includes(w)) return setStatus("That wallet is already added.");

  state.wallets.push(w);
  if (input) { input.value = ""; input.blur(); }

  renderWalletList();
  enableButtons();
  setStatus(`Wallet added ✅ (${state.wallets.length} total)`);
}

function clearWallets() {
  state.wallets = [];
  state.collections = [];
  renderWalletList();
  $("grid").innerHTML = "";
  $("stageTitle").textContent = "Ready";
  $("stageMeta").textContent = "Add wallet(s) → Load → Build → Export";
  enableButtons();
  setStatus("Wallets cleared ✅");
}

// ---------- alchemy ----------
async function fetchAlchemyNFTs({ wallet, host }) {
  const baseUrl = `https://${host}/nft/v3/${ALCHEMY_KEY}/getNFTsForOwner`;
  let pageKey = null;
  let all = [];
  const hardCap = 800;

  while (all.length < hardCap) {
    const url = new URL(baseUrl);
    url.searchParams.set("owner", wallet);
    url.searchParams.set("withMetadata", "true");
    url.searchParams.set("pageSize", "100");
    if (pageKey) url.searchParams.set("pageKey", pageKey);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Alchemy error (${res.status})`);
    const json = await res.json();

    all.push(...(json.ownedNfts || []));
    if (!json.pageKey) break;
    pageKey = json.pageKey;
  }

  return all;
}

function groupByCollection(nfts) {
  const map = new Map();
  for (const nft of nfts) {
    const contract = (nft?.contract?.address || "unknown").toLowerCase();
    const colName = nft?.contract?.name || nft?.collection?.name || "Unknown Collection";
    const tokenId = (nft?.tokenId || "").toString();
    const name = nft?.name || (tokenId ? `#${tokenId}` : "NFT");

    const image =
      nft?.image?.cachedUrl ||
      nft?.image?.pngUrl ||
      nft?.image?.thumbnailUrl ||
      nft?.image?.originalUrl ||
      nft?.rawMetadata?.image ||
      "";

    if (!map.has(contract)) map.set(contract, { key: contract, name: colName, items: [] });
    map.get(contract).items.push({ name, tokenId, contract, image });
  }
  return [...map.values()].sort((a, b) => b.items.length - a.items.length);
}

async function loadWallets() {
  const chain = $("chainSelect")?.value || "eth";
  const host = ALCHEMY_HOST[chain];
  if (!host) return setStatus("Chain not configured.");
  if (!state.wallets.length) return setStatus("Add at least one wallet first.");

  if (!ALCHEMY_KEY || ALCHEMY_KEY.includes("PASTE_"))
    return setStatus("Alchemy key not set yet.");

  state.chain = chain;
  state.host = host;

  try {
    setStatus(`Loading NFTs… (${state.wallets.length} wallet(s))`);

    const all = [];
    for (let i = 0; i < state.wallets.length; i++) {
      setStatus(`Loading NFTs… wallet ${i + 1}/${state.wallets.length}`);
      const nfts = await fetchAlchemyNFTs({ wallet: state.wallets[i], host });
      all.push(...(nfts || []));
    }

    state.collections = groupByCollection(all);

    $("stageTitle").textContent = "Wallets loaded";
    $("stageMeta").textContent = `${state.wallets.length} wallet(s) • ${state.collections.length} collection(s). Press 🧩 Build.`;

    enableButtons();
    setStatus("Loaded ✅");
  } catch (e) {
    console.error(e);
    setStatus(e?.message || "Error loading NFTs.");
  }
}

// ---------- build grid ----------
function closestSquareCols(n) {
  return Math.max(1, Math.ceil(Math.sqrt(n)));
}

function setGridCols(cols) {
  $("grid").style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
}

function makeFillerTile(text = "LO ⚡") {
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.dataset.src = "";
  const d = document.createElement("div");
  d.className = "fillerText";
  d.textContent = text;
  tile.appendChild(d);
  return tile;
}

function makeNFTTile(it) {
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.dataset.src = normalizeImageUrl(it.image || "");

  if (!it.image) {
    tile.appendChild(makeFillerTile("Missing"));
    return tile;
  }

  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = it.name || "NFT";
  img.referrerPolicy = "no-referrer";
  img.crossOrigin = "anonymous";

  setImgSrcLimited(img, safeProxyUrl(it.image)).catch(() => {
    tile.innerHTML = "";
    tile.appendChild(makeFillerTile("Missing"));
    tile.dataset.src = "";
  });

  tile.appendChild(img);
  return tile;
}

function buildGrid() {
  const grid = $("grid");
  grid.innerHTML = "";

  const sizeChoice = $("gridSize")?.value || "auto";

  // flatten all collections (for this baseline)
  const items = state.collections.flatMap(c => c.items);

  if (!items.length) {
    setStatus("No NFTs loaded.");
    return;
  }

  // cap (keeps it snappy + avoids worker stampede)
  const HARD_CAP = 400;
  const used = items.slice(0, HARD_CAP);

  let cols;
  let cap;
  if (sizeChoice === "auto") {
    cols = closestSquareCols(used.length);
    cap = cols * cols;
  } else {
    cap = Number(sizeChoice);
    cols = Math.round(Math.sqrt(cap));
  }

  setGridCols(cols);

  used.forEach(it => grid.appendChild(makeNFTTile(it)));
  while (grid.children.length < cap) grid.appendChild(makeFillerTile());

  $("stageTitle").textContent = "Little Ollie Flex Grid";
  $("stageMeta").textContent = `${state.wallets.length} wallet(s) • ${state.collections.length} collection(s) • ${used.length} NFT(s) • grid ${cols}×${cols}`;

  syncWatermarkDOMToOneTile();
  $("exportBtn").disabled = false;
  setStatus("Grid built ✅");
}

// ---------- export ----------
function getComputedGridCols() {
  const cs = getComputedStyle($("grid"));
  const tmpl = cs.gridTemplateColumns || "";
  const m = tmpl.match(/repeat\((\d+),/);
  if (m) return Math.max(1, parseInt(m[1], 10));
  return Math.max(1, tmpl.split(" ").filter(Boolean).length);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const ir = iw / ih;
  const tr = w / h;

  let sx = 0, sy = 0, sw = iw, sh = ih;
  if (ir > tr) { sh = ih; sw = ih * tr; sx = (iw - sw) / 2; }
  else { sw = iw; sh = iw / tr; sy = (ih - sh) / 2; }

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function ellipsizeToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ell = "…";
  let t = text;
  while (t.length > 1 && ctx.measureText(t + ell).width > maxWidth) t = t.slice(0, -1);
  return t + ell;
}

async function exportPNG() {
  try {
    setStatus("Exporting…");

    const tiles = Array.from(document.querySelectorAll("#grid .tile"));
    if (!tiles.length) return setStatus("Nothing to export.");

    const cols = getComputedGridCols();
    const rows = Math.ceil(tiles.length / cols);

    const rect = tiles[0].getBoundingClientRect();
    let tileSize = Math.round(rect.width) || 140;

    const scale = 2;
    const pad = 2;

    const outW = Math.round((cols * tileSize + pad * 2) * scale);
    const outH = Math.round((rows * tileSize + pad * 2) * scale);

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, outW, outH);

    for (let i = 0; i < tiles.length; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = Math.round((pad + c * tileSize) * scale);
      const y = Math.round((pad + r * tileSize) * scale);
      const size = Math.round(tileSize * scale);

      const srcDirect = tiles[i].dataset?.src || "";
      if (!srcDirect) continue;

      try {
        const img = await loadImage(safeProxyUrl(srcDirect));
        drawCover(ctx, img, x, y, size, size);
      } catch {}
    }

    // watermark: pinned top-left, width = one tile
    const wmText = "⚡ Powered by Little Ollie Studio";
    const boxX = Math.round((pad + 4) * scale);
    const boxY = Math.round((pad + 4) * scale);
    const boxW = Math.round(tileSize * scale);
    const boxPadX = Math.round(6 * scale);
    const boxPadY = Math.round(4 * scale);
    const maxTextW = Math.max(10, boxW - boxPadX * 2);

    let fontPx = Math.round(Math.max(9, tileSize * 0.11) * scale);
    const minFontPx = Math.round(7 * scale);
    while (fontPx > minFontPx) {
      ctx.font = `900 ${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      if (ctx.measureText(wmText).width <= maxTextW) break;
      fontPx--;
    }

    ctx.font = `900 ${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const finalText = ellipsizeToWidth(ctx, wmText, maxTextW);
    const boxH = Math.round(fontPx + boxPadY * 2);

    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(boxX, boxY, boxW, boxH);

    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.textBaseline = "alphabetic";
    const textY = boxY + boxPadY + fontPx - Math.round(fontPx * 0.10);
    ctx.fillText(finalText, boxX + boxPadX, textY);

    canvas.toBlob((blob) => {
      if (!blob) return setStatus("Export failed.");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "LO-FlexGrid.png";
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setStatus("Exported PNG ✅");
    }, "image/png");
  } catch (e) {
    console.error(e);
    setStatus("Export failed.");
  }
}

// ---------- events (iPhone-safe add wallet) ----------
(function bindEvents() {
  const walletInput = $("walletInput");
  if (walletInput) {
    walletInput.autocapitalize = "none";
    walletInput.autocomplete = "off";
    walletInput.spellcheck = false;
    walletInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addWallet(); }
    });
  }

  const addBtn = $("addWalletBtn");
  if (addBtn) {
    const handler = (e) => { try { e.preventDefault(); } catch {} addWallet(); };
    addBtn.addEventListener("click", handler, { passive:false });
    addBtn.addEventListener("pointerup", handler, { passive:false });
    addBtn.addEventListener("touchend", handler, { passive:false });
  }

  $("clearWalletsBtn")?.addEventListener("click", clearWallets);
  $("loadBtn")?.addEventListener("click", loadWallets);
  $("buildBtn")?.addEventListener("click", buildGrid);
  $("exportBtn")?.addEventListener("click", exportPNG);

  window.addEventListener("resize", syncWatermarkDOMToOneTile);
  window.addEventListener("orientationchange", syncWatermarkDOMToOneTile);

  enableButtons();
  setStatus("Ready ✅");
})();
