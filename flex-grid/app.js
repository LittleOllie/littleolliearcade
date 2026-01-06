/* Little Ollie Flex Grid (SAFE export for file:// + Multi-Wallet)
   - Multiple wallets supported (accumulates across wallets)
   - Collections merged by contract address
   - De-dupe NFTs by contract+tokenId
   - Powered By overlay sits on top of first tile (grid top-left)
   - Export: tight crop to grid only + tiny LO-blue border + keeps watermark
   - Export placeholders are TEXT (no local logo.png) to avoid file:// CORS.
   - Custom grid supports ROWS x COLS (not forced square)
   - IPFS gateway fallback (fixes “some load, some don’t” + ERR_NAME_NOT_RESOLVED)
   - GRID loads via Worker proxy + Alchemy metadata fallback per token (best chance to load “missing” ones)
*/

const $ = (id) => document.getElementById(id);

const state = {
  collections: [],
  selectedKeys: new Set(),
  wallets: [],
  chain: "eth",
  host: "eth-mainnet.g.alchemy.com",
};

// NOTE: For production, do NOT keep keys in frontend JS.
const ALCHEMY_KEY = "GYuepn7j7XCslBzxLwO5M";

const ALCHEMY_HOST = {
  eth: "eth-mainnet.g.alchemy.com",
  base: "base-mainnet.g.alchemy.com",
  polygon: "polygon-mainnet.g.alchemy.com",
  apechain: null,
};

// Cloudflare Worker proxy (your worker must return image bytes with CORS headers)
const IMG_PROXY = "https://loflexgrid.littleollienft.workers.dev/img?url=";

// IPFS gateways (fallback order)
const IPFS_GWS = [
  "https://nftstorage.link/ipfs/",
  "https://w3s.link/ipfs/",
  "https://dweb.link/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
];

// ---------- UI helpers ----------
function setStatus(msg){
  const el = $("status");
  if(el) el.textContent = msg || "";
}
function showControlsPanel(show){
  const el = $("controlsPanel");
  if(el) el.style.display = show ? "" : "none";
}
function enableButtons(){
  const loadBtn = $("loadBtn");
  const buildBtn = $("buildBtn");
  const exportBtn = $("exportBtn");

  const hasWallets = state.wallets.length > 0;
  if(loadBtn) loadBtn.disabled = !hasWallets;
  if(buildBtn) buildBtn.disabled = state.selectedKeys.size === 0;
  if(exportBtn) exportBtn.disabled = true; // enabled after buildGrid()
}
function setGridColumns(cols){
  const grid = $("grid");
  if(grid) grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
}
function safeText(s){ return (s || "").toString(); }

// ---------- IPFS + URL HELPERS ----------
function getIpfsPath(url){
  if(!url) return "";
  const s = String(url).trim();

  // ipfs://CID/path or ipfs://ipfs/CID/path
  if(s.startsWith("ipfs://")){
    let p = s.slice("ipfs://".length);
    p = p.replace(/^ipfs\//, "");
    return p.replace(/^\/+/, "");
  }

  // https://<gateway>/ipfs/CID/path
  try{
    const u = new URL(s);
    const idx = u.pathname.indexOf("/ipfs/");
    if(idx !== -1){
      return u.pathname.slice(idx + "/ipfs/".length).replace(/^\/+/, "");
    }
  }catch(e){}

  return "";
}

function buildIpfsGatewayUrls(ipfsPath){
  const p = (ipfsPath || "").replace(/^\/+/, "");
  if(!p) return [];
  return IPFS_GWS.map((gw) => gw + p);
}

// For export (CORS-safe URLs via Worker)
function exportSafeUrl(src){
  const direct = normalizeImageUrl(src);
  return IMG_PROXY + encodeURIComponent(direct);
}

function normalizeImageUrl(url){
  if(!url) return "";

  const ipfsPath = getIpfsPath(url);
  if(ipfsPath){
    return (buildIpfsGatewayUrls(ipfsPath)[0] || "");
  }

  try{
    const u = new URL(String(url));
    return u.toString();
  }catch(e){
    return String(url);
  }
}

// IMPORTANT: For GRID rendering, we proxy URLs too (fixes DNS / ERR_NAME_NOT_RESOLVED)
function gridSafeUrl(directUrl){
  if(!directUrl) return "";
  return IMG_PROXY + encodeURIComponent(directUrl);
}

// ---------- WALLET LIST UI ----------
function normalizeWallet(w){ return (w || "").trim(); }

function addWallet(){
  const input = $("walletInput");
  const w = normalizeWallet(input ? input.value : "");

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
  if(input) input.value = "";

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
  if(!wrap) return;

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
  if(!wrap) return;

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

      const buildBtn = $("buildBtn");
      const exportBtn = $("exportBtn");
      if(buildBtn) buildBtn.disabled = state.selectedKeys.size === 0;
      if(exportBtn) exportBtn.disabled = true;
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
  const buildBtn = $("buildBtn");
  const exportBtn = $("exportBtn");
  if(buildBtn) buildBtn.disabled = state.selectedKeys.size === 0;
  if(exportBtn) exportBtn.disabled = true;
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

function clampInt(v, min, max, fallback){
  const n = Number(v);
  if(!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function getGridChoice(){
  const v = $("gridSize")?.value || "auto";

  if(v === "custom"){
    const cols = clampInt($("customCols")?.value, 2, 50, 6);
    const rows = clampInt($("customRows")?.value, 2, 50, 6);
    const cap = rows * cols;
    return { mode:"fixed", cap, rows, cols };
  }

  if(v === "auto") return { mode:"auto" };

  const cap = Math.max(1, Number(v));
  const side = Math.round(Math.sqrt(cap));
  return { mode:"fixed", cap, rows: side, cols: side };
}

// ---------- BUILD GRID ----------
function buildGrid(){
  const chosen = getSelectedCollections();
  const exportBtn = $("exportBtn");

  if(!chosen.length){
    setStatus("Select at least one collection.");
    if(exportBtn) exportBtn.disabled = true;
    return;
  }

  const mixMode = $("mixMode")?.value || "mix";
  let items = (mixMode === "mix") ? mixEvenly(chosen) : flattenItems(chosen);

  const HARD_CAP = 400;
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
  if(!grid) return;
  grid.innerHTML = "";

  const stageTitle = $("stageTitle");
  const stageMeta = $("stageMeta");
  if(stageTitle) stageTitle.textContent = "Little Ollie Flex Grid";
  if(stageMeta){
    stageMeta.textContent =
      `${state.wallets.length} wallet(s) • ${chosen.length} collection(s) • ${usedItems.length} NFT(s) • grid ${rows}×${cols}`;
  }

  for(let i=0; i<usedItems.length; i++){
    grid.appendChild(makeNFTTile(usedItems[i]));
  }

  const remaining = totalSlots - usedItems.length;
  for(let j=0; j<remaining; j++){
    grid.appendChild(makeFillerTile());
  }

  const wm = $("wmGrid");
  if(wm){
    wm.style.display = "";
    wm.style.left = "0";
    wm.style.top = "0";
  }

  if(exportBtn) exportBtn.disabled = false;
  setStatus("Grid built ✅ (drag tiles to reorder on desktop)");
  enableDragDrop();
}

// ---------- IMAGE FALLBACK (GRID RENDER) ----------
function makeMissingInner(){
  const d = document.createElement("div");
  d.className = "fillerText";
  d.textContent = "Missing";
  d.style.fontSize = "16px";
  d.style.opacity = "0.92";
  return d;
}

async function tryAlchemyImageFallback(tile, img){
  // Only if we know contract+tokenId
  const contract = tile.dataset.contract || "";
  const tokenId = tile.dataset.tokenId || "";
  if(!contract || !tokenId) return false;

  // Avoid repeated retries
  if(tile.dataset.alchemyTried === "1") return false;
  tile.dataset.alchemyTried = "1";

  try{
    const meta = await fetchAlchemyNFTMetadata({ contract, tokenId, host: state.host });

    const image =
      meta?.image?.cachedUrl ||
      meta?.image?.pngUrl ||
      meta?.image?.thumbnailUrl ||
      meta?.image?.originalUrl ||
      meta?.rawMetadata?.image ||
      "";

    if(!image) return false;

    // If the rawMetadata image is ipfs://..., normalize it
    const direct = normalizeImageUrl(image);
    tile.dataset.src = direct;

    // Use proxy for grid display
    img.src = gridSafeUrl(direct);
    return true;
  }catch(e){
    return false;
  }
}

function setImgWithFallback(tile, img, rawUrl){
  const ipfsPath = getIpfsPath(rawUrl);
  tile.dataset.ipfsPath = ipfsPath || "";
  tile.dataset.gwIndex = "0";
  tile.dataset.alchemyTried = "0";

  if(!rawUrl){
    img.src = "";
    return;
  }

  // Non-IPFS URL: try direct via proxy (more reliable)
  if(!ipfsPath){
    const direct = normalizeImageUrl(rawUrl);
    tile.dataset.src = direct;
    img.src = gridSafeUrl(direct);

    img.onerror = async () => {
      // Try Alchemy metadata if possible
      const ok = await tryAlchemyImageFallback(tile, img);
      if(ok) return;

      // Show "Missing" if truly dead
      try{ img.remove(); }catch(e){}
      tile.dataset.src = "";
      tile.dataset.kind = "missing";
      tile.appendChild(makeMissingInner());
    };

    return;
  }

  // IPFS path: start with first gateway, but ALWAYS via proxy
  const urls = buildIpfsGatewayUrls(ipfsPath);
  const firstDirect = urls[0] || "";
  tile.dataset.src = firstDirect;
  img.src = gridSafeUrl(firstDirect);

  img.onerror = async () => {
    // Try next gateway(s)
    const ip = tile.dataset.ipfsPath || "";
    if(ip){
      const list = buildIpfsGatewayUrls(ip);
      let idx = parseInt(tile.dataset.gwIndex || "0", 10);
      idx = Number.isFinite(idx) ? idx : 0;
      idx++;

      if(idx < list.length){
        tile.dataset.gwIndex = String(idx);
        tile.dataset.src = list[idx];
        img.src = gridSafeUrl(list[idx]);
        return;
      }
    }

    // No gateway worked -> try Alchemy metadata per token
    const ok = await tryAlchemyImageFallback(tile, img);
    if(ok) return;

    // Truly missing
    try{ img.remove(); }catch(e){}
    tile.dataset.src = "";
    tile.dataset.kind = "missing";
    tile.appendChild(makeMissingInner());
  };
}

function makeNFTTile(it){
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.draggable = true;

  // Store these so Alchemy fallback can re-query the token
  const contract = (it?.contract || it?.contractAddress || it?.sourceKey || "").toLowerCase();
  const tokenId = (it?.tokenId || "").toString();
  tile.dataset.contract = contract;
  tile.dataset.tokenId = tokenId;

  const raw = (it?.image || "");
  tile.dataset.kind = raw ? "nft" : "empty";

  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = safeText(it.name || "NFT");
  img.referrerPolicy = "no-referrer";

  if(raw){
    setImgWithFallback(tile, img, raw);
    tile.appendChild(img);
  }else{
    tile.dataset.src = "";
    tile.dataset.kind = "empty";
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
  const chain = $("chainSelect")?.value || "eth";

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

  // store current chain/host so the per-token fallback knows where to call
  state.chain = chain;
  state.host = host;

  try{
    setStatus(`Loading NFTs… (${state.wallets.length} wallet(s))`);

    const allNfts = [];
    for(let i=0; i<state.wallets.length; i++){
      const w = state.wallets[i];
      setStatus(`Loading NFTs… wallet ${i+1}/${state.wallets.length}`);
      const nfts = await fetchAlchemyNFTs({wallet: w, host});
      allNfts.push(...(nfts || []));
    }

    const deduped = dedupeNFTs(allNfts);
    const grouped = groupByCollection(deduped);

    state.collections = grouped;
    state.selectedKeys = new Set(); // start unchecked

    renderCollectionsList();
    showControlsPanel(true);

    const buildBtn = $("buildBtn");
    const exportBtn = $("exportBtn");
    if(buildBtn) buildBtn.disabled = true;
    if(exportBtn) exportBtn.disabled = true;

    const stageTitle = $("stageTitle");
    const stageMeta = $("stageMeta");
    if(stageTitle) stageTitle.textContent = "Wallets loaded";
    if(stageMeta) stageMeta.textContent = "Select collections, then 🧩 Build grid.";

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

// Per-token metadata fallback (only used after image failures)
async function fetchAlchemyNFTMetadata({contract, tokenId, host}){
  // v3 endpoint: getNFTMetadata
  const url = new URL(`https://${host}/nft/v3/${ALCHEMY_KEY}/getNFTMetadata`);
  url.searchParams.set("contractAddress", contract);
  url.searchParams.set("tokenId", tokenId);
  url.searchParams.set("refreshCache", "false");

  const res = await fetch(url.toString());
  if(!res.ok) throw new Error(`Alchemy metadata error (${res.status})`);
  return await res.json();
}

function groupByCollection(nfts){
  const map = new Map();

  for(const nft of nfts){
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

    if(!map.has(contract)){
      map.set(contract, { key: contract, name: colName, count: 0, items: [] });
    }
    const entry = map.get(contract);
    entry.count++;
    // store contract+tokenId on each item so grid can retry via Alchemy
    entry.items.push({ name, tokenId, contract, image, sourceKey: contract });
  }

  return [...map.values()].sort((a,b)=> b.count - a.count);
}

// ---------- EXPORT (tight crop to grid) — PNG + watermark = 1 tile (clipped) ----------
async function exportPNG(){
  try{
    setStatus("Exporting… may take a moment");

    const tiles = Array.from(document.querySelectorAll("#grid .tile"));
    if(!tiles.length){
      setStatus("Nothing to export. Build grid first.");
      return;
    }

    const gridEl = $("grid");
    const cols = getComputedGridCols(gridEl);
    const rows = Math.ceil(tiles.length / cols);

    const rect = tiles[0].getBoundingClientRect();
    let tileSize = Math.round(rect.width);
    if(!tileSize || tileSize < 10) tileSize = 140;

    const scale = 2;
    const pad = 2;
    const borderPx = 2;

    const outW = Math.round((cols * tileSize + pad * 2) * scale);
    const outH = Math.round((rows * tileSize + pad * 2) * scale);

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, outW, outH);

    for(let i = 0; i < tiles.length; i++){
      const r = Math.floor(i / cols);
      const c = i % cols;

      const x = Math.round((pad + c * tileSize) * scale);
      const y = Math.round((pad + r * tileSize) * scale);
      const size = Math.round(tileSize * scale);

      const srcDirect = tiles[i].dataset?.src || "";

      try{
        if(srcDirect && srcDirect.length > 5){
          const img = await loadImage(exportSafeUrl(srcDirect));
          drawCover(ctx, img, x, y, size, size);
        }else{
          drawPlaceholder(ctx, x, y, size, " ");
        }
      }catch(e){
        drawPlaceholder(ctx, x, y, size, " ");
      }
    }

    // Watermark (exactly 1 tile wide, clipped)
    const boxX = Math.round(pad * scale);
    const boxY = Math.round(pad * scale);
    const boxW = Math.round(tileSize * scale);

    const wmSingle = "⚡ Powered by Little Ollie Studio";
    const wm1 = "⚡ Powered by";
    const wm2 = "Little Ollie Studio";

    const boxPadX = Math.round(tileSize * 0.10) * scale;
    const boxPadY = Math.round(tileSize * 0.08) * scale;
    const maxTextW = Math.max(10, boxW - boxPadX * 2);

    let useTwoLines = false;
    let fontPx = Math.max(10, Math.round(tileSize * 0.14)) * scale;

    while(fontPx > 8 * scale){
      ctx.font = `900 ${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      if(ctx.measureText(wmSingle).width <= maxTextW) break;
      fontPx -= 1;
    }

    ctx.font = `900 ${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    if(ctx.measureText(wmSingle).width > maxTextW){
      useTwoLines = true;
      fontPx = Math.max(10, Math.round(tileSize * 0.13)) * scale;

      while(fontPx > 8 * scale){
        ctx.font = `900 ${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
        const w = Math.max(ctx.measureText(wm1).width, ctx.measureText(wm2).width);
        if(w <= maxTextW) break;
        fontPx -= 1;
      }
    }

    const lineGap = Math.round(fontPx * 0.25);
    const textH = useTwoLines ? (fontPx * 2 + lineGap) : fontPx;
    const boxH = Math.round(textH + boxPadY * 2);

    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(boxX, boxY, boxW, boxH);

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(boxX, boxY, boxW, boxH);
    ctx.clip();

    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.textBaseline = "alphabetic";

    if(!useTwoLines){
      const y = boxY + Math.round((boxH + fontPx) / 2) - Math.round(fontPx * 0.15);
      ctx.fillText(wmSingle, boxX + boxPadX, y);
    }else{
      const y1 = boxY + boxPadY + fontPx;
      const y2 = y1 + fontPx + lineGap;
      ctx.fillText(wm1, boxX + boxPadX, y1);
      ctx.fillText(wm2, boxX + boxPadX, y2);
    }

    ctx.restore();

    // Outline
    ctx.strokeStyle = "rgba(109,224,255,0.70)";
    ctx.lineWidth = borderPx * scale;
    ctx.strokeRect(1, 1, outW - 2, outH - 2);

    canvas.toBlob((blob) => {
      if(!blob){
        setStatus("Export failed: could not create PNG.");
        return;
      }
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

// ---------- CANVAS / DRAW HELPERS ----------
function getComputedGridCols(gridEl){
  if(!gridEl) return 1;
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
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(x, y, size, size);
  // keep empty (no LO) so missing items don’t look “fake loaded”
  if(label && label.trim()){
    ctx.fillStyle = "rgba(255,255,255,0.90)";
    ctx.font = `900 ${Math.round(size*0.16)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + size/2, y + size/2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
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

// ---------- EVENTS ----------
(function bindEvents(){
  const addBtn = $("addWalletBtn");
  if(addBtn) addBtn.addEventListener("click", addWallet);

  const clearBtn = $("clearWalletsBtn");
  if(clearBtn) clearBtn.addEventListener("click", clearWallets);

  const walletInput = $("walletInput");
  if(walletInput){
    walletInput.addEventListener("keydown", (e) => {
      if(e.key === "Enter") addWallet();
    });
  }

  const gridSizeEl = $("gridSize");
  if(gridSizeEl){
    gridSizeEl.addEventListener("change", () => {
      const wrap = $("customGridWrap");
      if(wrap) wrap.style.display = (gridSizeEl.value === "custom") ? "" : "none";
      const exportBtn = $("exportBtn");
      if(exportBtn) exportBtn.disabled = true;
    });
  }

  const customRows = $("customRows");
  const customCols = $("customCols");
  if(customRows) customRows.addEventListener("input", () => { const e = $("exportBtn"); if(e) e.disabled = true; });
  if(customCols) customCols.addEventListener("input", () => { const e = $("exportBtn"); if(e) e.disabled = true; });

  const loadBtn = $("loadBtn");
  const buildBtn = $("buildBtn");
  const exportBtn = $("exportBtn");

  if(loadBtn) loadBtn.addEventListener("click", loadWallets);
  if(buildBtn) buildBtn.addEventListener("click", buildGrid);
  if(exportBtn) exportBtn.addEventListener("click", exportPNG);

  const selectAllBtn = $("selectAllBtn");
  const selectNoneBtn = $("selectNoneBtn");
  if(selectAllBtn) selectAllBtn.addEventListener("click", () => setAllCollections(true));
  if(selectNoneBtn) selectNoneBtn.addEventListener("click", () => setAllCollections(false));

  enableButtons();
  setStatus("Ready ✅ ➕ Add wallet(s) → 🔍 Load wallet(s) → select collections → 🧩 Build → 📸 Export");
})();
