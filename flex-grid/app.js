/* Little Ollie Flex Grid (SAFE export for file:// + Multi-Wallet)
   - Multiple wallets supported (accumulates across wallets)
   - Collections merged by contract address
   - De-dupe NFTs by contract+tokenId
   - Powered By overlay sits on top of first tile (grid top-left)
   - Export: square only; shows "Exporting... may take a moment"
   - Export placeholders are TEXT (no local logo.png) to avoid file:// CORS.
*/

const $ = (id) => document.getElementById(id);

const state = {
  collections: [],
  selectedKeys: new Set(),
  wallets: [], // multiple wallets
};

// NOTE: For production, do NOT keep keys in frontend JS.
const ALCHEMY_KEY = "GYuepn7j7XCslBzxLwO5M";

const ALCHEMY_HOST = {
  eth: "eth-mainnet.g.alchemy.com",
  base: "base-mainnet.g.alchemy.com",
  polygon: "polygon-mainnet.g.alchemy.com",
  apechain: null,
};

// Cloudflare Worker proxy:
const IMG_PROXY = "https://loflexgrid.littleollienft.workers.dev/img?url=";

function setStatus(msg){ $("status").textContent = msg || ""; }
function showControlsPanel(show){ $("controlsPanel").style.display = show ? "" : "none"; }

function enableButtons(){
  const hasWallets = state.wallets.length > 0;
  $("loadBtn").disabled = !hasWallets;
  $("buildBtn").disabled = state.selectedKeys.size === 0;
  $("exportBtn").disabled = true; // only after build
}

function setGridColumns(cols){
  $("grid").style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
}

function safeText(s){ return (s || "").toString(); }

// ---------- URL HELPERS ----------
function normalizeImageUrl(url){
  if(!url) return "";

  if(url.startsWith("ipfs://")){
    const path = url.replace("ipfs://","").replace(/^ipfs\//,"");
    return `https://cloudflare-ipfs.com/ipfs/${path}`;
  }

  try{
    const u = new URL(url);
    if(u.hostname === "ipfs.io"){
      u.hostname = "cloudflare-ipfs.com";
      return u.toString();
    }
  }catch(e){}

  return url;
}

function exportSafeUrl(src){
  const direct = normalizeImageUrl(src);
  return IMG_PROXY + encodeURIComponent(direct);
}

// ---------- WALLET LIST UI ----------
function normalizeWallet(w){
  return (w || "").trim();
}

function addWallet(){
  const w = normalizeWallet($("walletInput").value);
  if(!w){
    setStatus("Paste a wallet address first.");
    return;
  }
  if(!/^0x[a-fA-F0-9]{40}$/.test(w)){
    setStatus("That doesn’t look like a valid 0x wallet address.");
    return;
  }
  if(state.wallets.includes(w)){
    setStatus("That wallet is already added.");
    return;
  }
  state.wallets.push(w);
  $("walletInput").value = "";
  renderWalletList();
  enableButtons();
  setStatus(`Wallet added ✅ (${state.wallets.length} total)`);
}

function removeWallet(w){
  state.wallets = state.wallets.filter(x => x !== w);
  renderWalletList();
  enableButtons();
  setStatus(`Wallet removed ✅ (${state.wallets.length} remaining)`);
}

function clearWallets(){
  state.wallets = [];
  renderWalletList();
  enableButtons();
  setStatus("Wallets cleared ✅");
}

function renderWalletList(){
  const wrap = $("walletList");
  if(!state.wallets.length){
    wrap.style.display = "none";
    wrap.innerHTML = "";
    return;
  }

  wrap.style.display = "";
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
    meta.textContent = "Ready to load";

    left.appendChild(addr);
    left.appendChild(meta);

    const btns = document.createElement("div");
    btns.className = "chipBtns";

    const rm = document.createElement("button");
    rm.className = "btnSmall";
    rm.type = "button";
    rm.textContent = "🗑 Remove";
    rm.addEventListener("click", () => removeWallet(w));

    btns.appendChild(rm);

    row.appendChild(left);
    row.appendChild(btns);
    wrap.appendChild(row);
  });
}

// ---------- COLLECTION LIST ----------
function renderCollectionsList(){
  const wrap = $("collectionsList");
  wrap.innerHTML = "";

  state.collections.forEach((c) => {
    const row = document.createElement("div");
    row.className = "collectionItem";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedKeys.has(c.key);
    checkbox.addEventListener("change", () => {
      if(checkbox.checked) state.selectedKeys.add(c.key);
      else state.selectedKeys.delete(c.key);

      $("buildBtn").disabled = state.selectedKeys.size === 0;
      $("exportBtn").disabled = true;
    });

    const label = document.createElement("div");
    label.style.minWidth = "0";

    const name = document.createElement("div");
    name.className = "collectionName";
    name.textContent = c.name;

    const count = document.createElement("div");
    count.className = "collectionCount";
    count.textContent = `${c.count} owned`;

    label.appendChild(name);
    label.appendChild(count);

    row.appendChild(checkbox);
    row.appendChild(label);
    wrap.appendChild(row);
  });
}

function setAllCollections(checked){
  state.selectedKeys.clear();
  if(checked){
    state.collections.forEach(c => state.selectedKeys.add(c.key));
  }
  renderCollectionsList();
  $("buildBtn").disabled = state.selectedKeys.size === 0;
  $("exportBtn").disabled = true;
}

function getSelectedCollections(){
  return state.collections.filter(c => state.selectedKeys.has(c.key));
}

// ---------- GRID INPUTS ----------
function flattenItems(chosen){
  const all = [];
  chosen.forEach(c => c.items.forEach(it => all.push({...it, sourceKey: c.key})));
  return all;
}

function mixEvenly(chosen){
  const queues = chosen.map(c => ({ key: c.key, items: [...c.items] }));
  const out = [];
  let alive = true;

  while(alive){
    alive = false;
    for(const q of queues){
      if(q.items.length){
        alive = true;
        out.push({...q.items.shift(), sourceKey: q.key});
      }
    }
  }
  return out;
}

function closestSquareDims(n){
  const side = Math.max(1, Math.ceil(Math.sqrt(n)));
  return { rows: side, cols: side };
}

function getGridChoice(){
  const v = $("gridSize")?.value || "auto";
  if(v === "auto") return { mode:"auto" };
  const cap = Math.max(1, Number(v));
  const side = Math.round(Math.sqrt(cap));
  return { mode:"fixed", cap, rows: side, cols: side };
}

// ---------- BUILD GRID ----------
function buildGrid(){
  const chosen = getSelectedCollections();
  if(!chosen.length){
    setStatus("Select at least one collection.");
    $("exportBtn").disabled = true;
    return;
  }

  const mixMode = $("mixMode").value;
  let items = (mixMode === "mix") ? mixEvenly(chosen) : flattenItems(chosen);

  // cap for UX/export speed
  const HARD_CAP = 100;
  if(items.length > HARD_CAP) items = items.slice(0, HARD_CAP);

  const choice = getGridChoice();

  let rows, cols, totalSlots, usedItems;

  if(choice.mode === "fixed"){
    rows = choice.rows;
    cols = choice.cols;
    totalSlots = choice.cap;
    usedItems = items.slice(0, totalSlots);
  }else{
    const dims = closestSquareDims(items.length);
    rows = dims.rows;
    cols = dims.cols;
    totalSlots = rows * cols;
    usedItems = items;
  }

  setGridColumns(cols);

  const grid = $("grid");
  grid.innerHTML = "";

  $("stageTitle").textContent = "Little Ollie Flex Grid";
  $("stageMeta").textContent =
    `${state.wallets.length} wallet(s) • ${chosen.length} collection(s) • ${usedItems.length} NFT(s) • grid ${rows}×${cols}`;

  for(let i=0; i<usedItems.length; i++){
    grid.appendChild(makeNFTTile(usedItems[i]));
  }

  const remaining = totalSlots - usedItems.length;
  for(let j=0; j<remaining; j++){
    grid.appendChild(makeFillerTile());
  }

  // show watermark on top of first tile (grid corner)
  const wm = $("wmGrid");
  wm.style.display = "";
  wm.style.left = "0";
  wm.style.top = "0";

  $("exportBtn").disabled = false;
  setStatus("Grid built ✅ (drag tiles to reorder on desktop)");
  enableDragDrop();
}

function makeNFTTile(it){
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.draggable = true;

  const src = normalizeImageUrl(it.image || "");
  tile.dataset.src = (src && src.length > 5) ? src : "";
  tile.dataset.kind = (tile.dataset.src ? "nft" : "empty");

  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = safeText(it.name || "NFT");
  img.src = tile.dataset.src || "";

  img.onerror = () => {
    try{ img.remove(); }catch(e){}
    tile.dataset.src = "";
    tile.dataset.kind = "empty";
    tile.appendChild(makeFillerInner());
  };

  if(tile.dataset.src){
    tile.appendChild(img);
  }else{
    tile.appendChild(makeFillerInner());
  }

  return tile;
}

function makeFillerInner(){
  const d = document.createElement("div");
  d.className = "fillerText";
  d.textContent = "LO ⚡";
  return d;
}

function makeFillerTile(){
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.draggable = true;
  tile.dataset.src = "";
  tile.dataset.kind = "empty";
  tile.appendChild(makeFillerInner());
  return tile;
}

// ---------- DRAG & DROP ----------
function enableDragDrop(){
  const grid = $("grid");
  if(!grid) return;

  const tiles = Array.from(grid.querySelectorAll(".tile"));
  let dragEl = null;

  tiles.forEach((t) => {
    t.addEventListener("dragstart", (e) => {
      dragEl = t;
      t.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "tile");
    });

    t.addEventListener("dragend", () => {
      t.classList.remove("dragging");
      tiles.forEach(x => x.classList.remove("dropTarget"));
      dragEl = null;
    });

    t.addEventListener("dragover", (e) => {
      e.preventDefault();
      if(!dragEl || dragEl === t) return;
      t.classList.add("dropTarget");
      e.dataTransfer.dropEffect = "move";
    });

    t.addEventListener("dragleave", () => t.classList.remove("dropTarget"));

    t.addEventListener("drop", (e) => {
      e.preventDefault();
      if(!dragEl || dragEl === t) return;

      const a = dragEl;
      const b = t;

      const aNext = a.nextSibling === b ? a : a.nextSibling;
      grid.insertBefore(a, b);
      grid.insertBefore(b, aNext);

      tiles.forEach(x => x.classList.remove("dropTarget"));
    });
  });
}

// ---------- WALLET LOAD (MULTI) ----------
async function loadWallets(){
  const chain = $("chainSelect").value;

  if(chain === "solana"){
    setStatus("Solana coming soon. For now use ETH, Base, or Polygon.");
    return;
  }
  if(chain === "apechain"){
    setStatus("ApeChain coming soon. For now use ETH, Base, or Polygon.");
    return;
  }
  if(!state.wallets.length){
    setStatus("Add at least one wallet first.");
    return;
  }
  if(!ALCHEMY_KEY || ALCHEMY_KEY.includes("PASTE_")){
    setStatus("Alchemy key not set yet. Paste your Alchemy key into app.js");
    return;
  }

  const host = ALCHEMY_HOST[chain];
  if(!host){
    setStatus("Chain not configured.");
    return;
  }

  try{
    setStatus(`Loading NFTs… (${state.wallets.length} wallet(s))`);

    // Load each wallet sequentially (safer for rate limits)
    const allNfts = [];
    for(let i=0; i<state.wallets.length; i++){
      const w = state.wallets[i];
      setStatus(`Loading NFTs… wallet ${i+1}/${state.wallets.length}`);
      const nfts = await fetchAlchemyNFTs({wallet: w, host});
      allNfts.push(...(nfts || []));
    }

    // De-dupe by contract+tokenId across wallets
    const deduped = dedupeNFTs(allNfts);

    // Group + merge collections
    const grouped = groupByCollection(deduped);

    state.collections = grouped;

    // Start unchecked
    state.selectedKeys = new Set();

    renderCollectionsList();
    showControlsPanel(true);

    $("buildBtn").disabled = true;
    $("exportBtn").disabled = true;

    $("stageTitle").textContent = "Wallets loaded";
    $("stageMeta").textContent = "Select collections, then 🧩 Build grid.";
    setStatus(`Loaded ${state.wallets.length} wallet(s) ✅ Found ${grouped.length} collections`);
  }catch(err){
    console.error(err);
    setStatus(err?.message || "Error loading NFTs.");
  }
}

function dedupeNFTs(nfts){
  const seen = new Set();
  const out = [];
  for(const nft of nfts){
    const contract = (nft?.contract?.address || "").toLowerCase();
    const tokenId = (nft?.tokenId || "").toString();
    const key = `${contract}:${tokenId}`;
    if(!contract || !tokenId) continue;

    if(seen.has(key)) continue;
    seen.add(key);
    out.push(nft);
  }
  return out;
}

async function fetchAlchemyNFTs({wallet, host}){
  const baseUrl = `https://${host}/nft/v3/${ALCHEMY_KEY}/getNFTsForOwner`;

  let pageKey = null;
  let all = [];
  const hardCap = 800;

  while(all.length < hardCap){
    const url = new URL(baseUrl);
    url.searchParams.set("owner", wallet);
    url.searchParams.set("withMetadata", "true");
    url.searchParams.set("pageSize", "100");
    if(pageKey) url.searchParams.set("pageKey", pageKey);

    const res = await fetch(url.toString());
    if(!res.ok) throw new Error(`Alchemy error (${res.status})`);
    const json = await res.json();

    all.push(...(json.ownedNfts || []));
    if(!json.pageKey) break;
    pageKey = json.pageKey;
  }

  return all;
}

function groupByCollection(nfts){
  const map = new Map();

  for(const nft of nfts){
    const contract = (nft?.contract?.address || "unknown").toLowerCase();
    const colName = nft?.contract?.name || nft?.collection?.name || "Unknown Collection";

    const tokenId = nft?.tokenId || "";
    const name = nft?.name || (tokenId ? `#${tokenId}` : "NFT");
    const image =
      nft?.image?.cachedUrl ||
      nft?.image?.pngUrl ||
      nft?.image?.thumbnailUrl ||
      nft?.image?.originalUrl ||
      "";

    if(!map.has(contract)){
      map.set(contract, { key: contract, name: colName, count: 0, items: [] });
    }
    const entry = map.get(contract);
    entry.count++;
    entry.items.push({ name, tokenId, image, sourceKey: contract });
  }

  return [...map.values()].sort((a,b)=> b.count - a.count);
}

// ---------- EXPORT (safe for file://) ----------
async function exportPNG(){
  try{
    setStatus("Exporting… may take a moment");

    const dims = { w: 1400, h: 1400 };

    const canvas = document.createElement("canvas");
    canvas.width = dims.w;
    canvas.height = dims.h;
    const ctx = canvas.getContext("2d");

    // Background
    const g = ctx.createRadialGradient(dims.w*0.5, dims.h*0.15, dims.w*0.1, dims.w*0.5, dims.h*0.15, dims.w*0.9);
    g.addColorStop(0, "#6de0ff");
    g.addColorStop(1, "#4c6fff");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,dims.w,dims.h);

    const pad = Math.round(dims.w * 0.04);
    const headerH = Math.round(dims.h * 0.10);

    const gridX = pad;
    const gridY = pad + headerH * 0.35;
    const gridW = dims.w - pad*2;
    const gridH = dims.h - gridY - pad;

    const tiles = Array.from(document.querySelectorAll("#grid .tile"));
    if(!tiles.length){
      setStatus("Nothing to export. Build grid first.");
      return;
    }

    const cols = getComputedGridCols($("grid"));
    const rows = Math.ceil(tiles.length / cols);

    const gap = 0;
    const tileSize = Math.floor((gridW - gap*(cols-1)) / cols);
    const totalGridH = tileSize*rows + gap*(rows-1);

    const startY = gridY + Math.max(0, Math.floor((gridH - totalGridH)/2));
    const startX = gridX;

    // Header strip
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    roundRect(ctx, pad, pad, dims.w - pad*2, Math.round(headerH), 18);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = `900 ${Math.round(dims.w*0.03)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillText("Little Ollie Flex Grid", pad + Math.round(dims.w*0.02), pad + Math.round(headerH*0.62));

    const meta = $("stageMeta")?.textContent || "";
    if(meta){
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `600 ${Math.round(dims.w*0.018)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.fillText(meta, pad + Math.round(dims.w*0.02), pad + Math.round(headerH*0.88));
    }

    // Draw tiles
    for(let i=0; i<tiles.length; i++){
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = startX + c*(tileSize + gap);
      const y = startY + r*(tileSize + gap);

      const src = tiles[i].dataset?.src || "";
      if(src && src.length > 5){
        try{
          const img = await loadImage(exportSafeUrl(src));
          drawCover(ctx, img, x, y, tileSize, tileSize);
        }catch(e){
          drawPlaceholder(ctx, x, y, tileSize, "LO ⚡");
        }
      }else{
        drawPlaceholder(ctx, x, y, tileSize, "LO ⚡");
      }
    }

    // Tiny blue outline
    ctx.strokeStyle = "rgba(109,224,255,0.70)";
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, tileSize*cols, tileSize*rows);

    // Powered By placed on top of first tile (harder to crop)
    const wmText = "⚡ Powered by Little Ollie Studio";
    ctx.font = `900 ${Math.round(dims.w*0.015)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const tw = ctx.measureText(wmText).width;

    const boxPadX = Math.round(dims.w*0.010);
    const boxPadY = Math.round(dims.h*0.006);
    const boxW = Math.round(tw + boxPadX*2);
    const boxH = Math.round(boxPadY*2 + Math.round(dims.w*0.015));

    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(startX, startY, boxW, boxH);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, boxW, boxH);

    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.textBaseline = "middle";
    ctx.fillText(wmText, startX + boxPadX, startY + boxH/2);

    // Download
    canvas.toBlob((blob) => {
      if (!blob) { setStatus("Export failed: could not create PNG."); return; }
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

  }catch(err){
    console.error(err);
    setStatus("Export failed (unexpected). Check console for details.");
  }
}

function getComputedGridCols(gridEl){
  const cs = window.getComputedStyle(gridEl);
  const tmpl = cs.gridTemplateColumns || "";

  const m = tmpl.match(/repeat\((\d+),/);
  if(m) return Math.max(1, parseInt(m[1], 10));

  const parts = tmpl.split(" ").filter(Boolean);
  return Math.max(1, parts.length);
}

function loadImage(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawPlaceholder(ctx, x, y, size, label){
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(x, y, size, size);

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `900 ${Math.round(size*0.18)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + size/2, y + size/2);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawCover(ctx, img, x, y, w, h){
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const ir = iw/ih;
  const tr = w/h;

  let sx=0, sy=0, sw=iw, sh=ih;
  if(ir > tr){
    sh = ih;
    sw = ih * tr;
    sx = (iw - sw)/2;
  }else{
    sw = iw;
    sh = iw / tr;
    sy = (ih - sh)/2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}
// ---------- EVENTS ----------
$("addWalletBtn").addEventListener("click", addWallet);

const clearWalletsBtn = $("clearWalletsBtn");
if (clearWalletsBtn) clearWalletsBtn.addEventListener("click", clearWallets);

// allow Enter key in wallet input to add
$("walletInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addWallet();
});

$("loadBtn").addEventListener("click", loadWallets);
$("buildBtn").addEventListener("click", buildGrid);
$("exportBtn").addEventListener("click", exportPNG);

$("selectAllBtn").addEventListener("click", () => setAllCollections(true));
$("selectNoneBtn").addEventListener("click", () => setAllCollections(false));

enableButtons();
setStatus("Ready ✅ ➕ Add wallet(s) → 🔍 Load wallet(s) → select collections → 🧩 Build → 📸 Export");
