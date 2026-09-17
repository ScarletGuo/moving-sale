"use strict";

/* ------------------------------------------------------------------ *
 *  Moving Sale — static catalog
 *  - items + list prices:  data/items.json
 *  - friend prices:        data/discounts.enc.json (AES-GCM, unlocked by code)
 *  - live status:          published Google Sheet CSV (id,status,note)
 *  - booking:              prefilled Google Form
 * ------------------------------------------------------------------ */

const STRINGS = {
  en: {
    all: "All",
    available: "Available",
    refresh: "Refresh",
    codeOk: "Friend prices unlocked — welcome 👋",
    codeErr: "That link's code didn't work.",
    statusErr: "Couldn't load live availability — showing everything as available.",
    statusStale: "Availability updates every few minutes. Hit Refresh for the latest.",
    reserved: "Reserved",
    sold: "Sold",
    book: "Book",
    bookHint: "I'll confirm and message you after you submit.",
    bookOff: "Booking isn't set up yet.",
    condition: "Condition",
    size: "Size",
    friendPrice: "friend price",
    retail: "Retail",
    productPage: "Product page",
    empty: "Nothing in this category yet.",
    emptyAvailable: "No available items right now.",
    footerNote: "Shared privately with friends. Prices negotiable.",
    langName: "中文",
  },
  zh: {
    all: "全部",
    available: "未售出",
    refresh: "刷新",
    codeOk: "已解锁朋友价 👋",
    codeErr: "这个链接的码不对。",
    statusErr: "没能加载实时状态——暂时都按「可预订」显示。",
    statusStale: "状态每隔几分钟更新一次，想看最新点「刷新」。",
    reserved: "已预订",
    sold: "已售出",
    book: "预订",
    bookHint: "提交后我会尽快确认并联系你。",
    bookOff: "预订还没配置好。",
    condition: "成色",
    size: "尺寸",
    friendPrice: "朋友价",
    retail: "原价",
    productPage: "原商品链接",
    empty: "这个分类还没有东西。",
    emptyAvailable: "目前没有未售出的物品。",
    footerNote: "仅私下分享给朋友，价格可小刀。",
    langName: "EN",
  },
};

const state = {
  lang: localStorage.getItem("ms-lang") || "zh",
  category: "all",
  config: {},
  categories: [],
  items: [],
  statusMap: {},        // id -> "available" | "reserved" | "sold"
  statusLoaded: false,
  codeMsg: null,        // "ok" | "err" | null
  statusMsg: null,      // "info" | "err" | null
  friendPrices: null,    // id -> number, once unlocked
  encPayload: null,      // raw discounts.enc.json
};

const $ = (sel) => document.querySelector(sel);
const offLabel = (pct) => (state.lang === "zh" ? `省 ${pct}%` : `${pct}% off`);
const t = (key) => STRINGS[state.lang][key];
const L = (obj) => (obj && (obj[state.lang] || obj.en || obj.zh)) || "";
const isPlaceholder = (s) => typeof s === "string" && s.includes("REPLACE_WITH");

/* ----------------------------- boot ------------------------------- */

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindChrome();
  try {
    const res = await fetch("data/items.json", { cache: "no-cache" });
    const data = await res.json();
    state.config = data.config || {};
    state.categories = data.categories || [];
    state.items = data.items || [];
  } catch (err) {
    console.error(err);
    $("#catalog").innerHTML = `<p class="empty">Failed to load items.json</p>`;
    return;
  }

  applyStaticText();
  renderCategoryBar();
  render();

  loadStatus();

  // Friend prices are invisible by default: no input, no hint, and
  // discounts.enc.json is never even fetched unless we have a code to try.
  const urlCode = readCodeFromUrl();
  const savedCode = localStorage.getItem("ms-code");
  if (urlCode) tryUnlock(urlCode, { silent: false });
  else if (savedCode) tryUnlock(savedCode, { silent: true });
}

/* Accepts #f=CODE (preferred — a fragment never reaches a server or a
   referrer header) and legacy ?code=CODE, then scrubs it from the address
   bar so a shared screenshot or a forwarded URL doesn't leak it. */
function readCodeFromUrl() {
  let code = null;

  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  if (hash) {
    const hp = new URLSearchParams(hash);
    code = hp.get("f") || hp.get("code");
  }
  const qp = new URLSearchParams(location.search);
  if (!code) code = qp.get("f") || qp.get("code");

  if (code) {
    qp.delete("f");
    qp.delete("code");
    const q = qp.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : ""));
  }
  return code;
}

function bindChrome() {
  $("#lang-toggle").addEventListener("click", () => {
    state.lang = state.lang === "zh" ? "en" : "zh";
    localStorage.setItem("ms-lang", state.lang);
    document.documentElement.lang = state.lang === "zh" ? "zh" : "en";
    applyStaticText();
    renderCategoryBar();
    render();
  });

  bindSecretEntry();

  $("#refresh-btn").addEventListener("click", () => loadStatus({ force: true }));

  document.addEventListener("click", (e) => {
    const img = e.target.closest(".thumb");
    if (img && img.dataset.full) openLightbox(img.dataset.full);
  });
}

/* Escape hatch for you (and for a friend who has the code but not the link):
   tap the site title 5 times within 3s to get a prompt. Empty input re-locks,
   which is also how you check what a stranger sees. */
function bindSecretEntry() {
  let taps = 0;
  let timer = null;
  $("#site-title").addEventListener("click", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { taps = 0; }, 3000);
    if (++taps < 5) return;
    taps = 0;
    const code = (window.prompt("") || "").trim();
    if (code) tryUnlock(code, { silent: false });
    else relock();
  });
}

function relock() {
  localStorage.removeItem("ms-code");
  state.friendPrices = null;
  state.codeMsg = null;
  renderMessages();
  render();
}

/* --------------------------- static text -------------------------- */

function applyStaticText() {
  document.documentElement.lang = state.lang === "zh" ? "zh" : "en";
  const title = L(state.config.title) || "Moving Sale";
  document.title = title;
  $("#site-title").textContent = title;
  $("#site-intro").textContent = L(state.config.intro);
  $("#lang-toggle").textContent = t("langName");
  $("#pickup-info").textContent = L(state.config.pickupInfo);
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  renderMessages();
}

function renderMessages() {
  const cm = $("#code-msg");
  if (state.codeMsg) {
    cm.textContent = state.codeMsg === "ok" ? t("codeOk") : t("codeErr");
    cm.className = "code-msg " + (state.codeMsg === "ok" ? "ok" : "err");
    cm.hidden = false;
  } else {
    cm.hidden = true;
  }

  const sm = $("#status-msg");
  if (state.statusMsg) {
    sm.textContent = state.statusMsg === "err" ? t("statusErr") : t("statusStale");
    sm.hidden = false;
  } else {
    sm.hidden = true;
  }
}

/* ------------------------- category filter ------------------------ */

function renderCategoryBar() {
  const bar = $("#category-bar");
  const cats = [
    { id: "all", zh: STRINGS.zh.all, en: STRINGS.en.all },
    { id: "available", zh: STRINGS.zh.available, en: STRINGS.en.available },
    ...state.categories,
  ];
  bar.innerHTML = "";
  for (const c of cats) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (state.category === c.id ? " active" : "");
    btn.textContent = L(c);
    btn.addEventListener("click", () => {
      state.category = c.id;
      renderCategoryBar();
      render();
    });
    bar.appendChild(btn);
  }
}

/* ----------------------------- render ----------------------------- */

function render() {
  const catalog = $("#catalog");
  catalog.innerHTML = "";

  const availableOnly = state.category === "available";
  const isVisible = (item) => !availableOnly || (state.statusMap[item.id] || "available") === "available";

  const groups = state.categories
    .filter((c) => state.category === "all" || availableOnly || c.id === state.category)
    .map((c) => ({
      cat: c,
      items: state.items.filter((it) => it.category === c.id && isVisible(it)),
    }))
    .filter((g) => g.items.length);

  const known = new Set(state.categories.map((c) => c.id));
  const orphans = state.items.filter((it) => !known.has(it.category) && isVisible(it));
  if (orphans.length && (state.category === "all" || availableOnly)) {
    groups.push({ cat: { id: "_other", zh: "其他", en: "Other" }, items: orphans });
  }

  const empty = $("#empty-msg");
  if (!groups.length) {
    empty.textContent = t(availableOnly ? "emptyAvailable" : "empty");
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const g of groups) {
    const section = document.createElement("section");
    section.className = "cat-group";
    const h2 = document.createElement("h2");
    h2.textContent = L(g.cat);
    section.appendChild(h2);

    const grid = document.createElement("div");
    grid.className = "grid";
    for (const item of g.items) grid.appendChild(renderCard(item));
    section.appendChild(grid);
    catalog.appendChild(section);
  }
}

function renderCard(item) {
  const status = state.statusMap[item.id] || "available";
  const card = document.createElement("article");
  card.className = "card" + (status === "available" ? "" : " gone");

  const imgName = (item.images && item.images[0]) || "placeholder.svg";
  const src = `images/${imgName}`;
  const img = document.createElement("img");
  img.className = "thumb";
  img.loading = "lazy";
  img.alt = L(item.name);
  img.src = src;
  img.dataset.full = src;
  card.appendChild(img);

  const body = document.createElement("div");
  body.className = "card-body";

  const h3 = document.createElement("h3");
  h3.textContent = L(item.name);
  if (status !== "available") {
    const badge = document.createElement("span");
    badge.className = `badge ${status}`;
    badge.textContent = status === "sold" ? t("sold") : t("reserved");
    h3.append(" ", badge);
  }
  body.appendChild(h3);

  if (L(item.desc)) {
    const p = document.createElement("p");
    p.className = "desc";
    p.textContent = L(item.desc);
    body.appendChild(p);
  }

  const meta = document.createElement("div");
  meta.className = "meta-row";
  if (L(item.condition)) meta.appendChild(span(`${t("condition")}: ${L(item.condition)}`));
  if (item.dimensions) meta.appendChild(span(`${t("size")}: ${item.dimensions}`));
  if (meta.childNodes.length) body.appendChild(meta);

  body.appendChild(renderPrice(item));

  if (status === "available") {
    body.appendChild(renderBook(item));
  }

  card.appendChild(body);
  return card;
}

function span(text) {
  const s = document.createElement("span");
  s.textContent = text;
  return s;
}

function renderPrice(item) {
  const wrap = document.createElement("div");
  wrap.className = "price-block";

  const cur = item.currency ? `${item.currency} ` : "$";
  const money = (n) => `${cur}${n}`;
  const friend = state.friendPrices && state.friendPrices[item.id];
  const now = friend != null ? friend : item.listPrice;

  const row = document.createElement("div");
  row.className = "price-row";

  // list price is struck only once a friend price replaces it
  if (friend != null) {
    const old = document.createElement("span");
    old.className = "price struck";
    old.textContent = money(item.listPrice);
    row.appendChild(old);
  }

  const p = document.createElement("span");
  p.className = "price" + (friend != null ? " friend" : "");
  p.textContent = money(now);
  row.appendChild(p);

  if (friend != null) {
    const tag = document.createElement("span");
    tag.className = "friend-tag";
    tag.textContent = t("friendPrice");
    row.appendChild(tag);
  }

  // discount is always measured against retail, so it moves when a friend unlocks
  const pct = discountPct(item.retailPrice, now);
  if (pct != null) {
    const off = document.createElement("span");
    off.className = "off-badge";
    off.textContent = offLabel(pct);
    row.appendChild(off);
  }

  wrap.appendChild(row);
  const retail = renderRetailLine(item, money);
  if (retail) wrap.appendChild(retail);
  return wrap;
}

// null unless retail is a real number that actually beats the current price
function discountPct(retail, now) {
  const r = Number(retail);
  if (!Number.isFinite(r) || r <= 0 || !Number.isFinite(now) || now >= r) return null;
  const pct = Math.round((1 - now / r) * 100);
  return pct >= 1 ? pct : null;
}

/* Small muted line under the price: "Retail $329 ↗", linking to the original
   listing when `link` is set. Both fields are optional and independent. */
function renderRetailLine(item, money) {
  const r = Number(item.retailPrice);
  const hasRetail = Number.isFinite(r) && r > 0;
  const link = typeof item.link === "string" && /^https?:\/\//.test(item.link) ? item.link : null;
  if (!hasRetail && !link) return null;

  const line = document.createElement("p");
  line.className = "retail-line";

  const text = hasRetail ? `${t("retail")} ${money(item.retailPrice)}` : t("productPage");
  if (link) {
    const a = document.createElement("a");
    a.href = link;
    a.target = "_blank";
    a.rel = "noopener nofollow";
    a.textContent = text + " ↗";
    line.appendChild(a);
  } else {
    line.textContent = text;
  }
  return line;
}

function renderBook(item) {
  const wrap = document.createElement("div");
  const base = state.config.formBaseUrl || "";
  const entry = state.config.formItemEntry || "";

  if (isPlaceholder(base) || !base) {
    const btn = document.createElement("button");
    btn.className = "btn book";
    btn.type = "button";
    btn.disabled = true;
    btn.textContent = t("book");
    btn.title = t("bookOff");
    wrap.appendChild(btn);
    return wrap;
  }

  const url = new URL(base);
  if (entry && !isPlaceholder(entry)) {
    const currency = item.currency || "USD";
    const friendPrice = state.friendPrices && state.friendPrices[item.id];
    const priceSnapshot = friendPrice != null
      ? `Friend price: ${currency} ${friendPrice} | List price: ${currency} ${item.listPrice}`
      : `List price: ${currency} ${item.listPrice}`;
    url.searchParams.set(
      entry,
      `${L(item.name)} [${item.id}] | ${priceSnapshot}`
    );
  }
  const a = document.createElement("a");
  a.className = "btn book";
  a.href = url.toString();
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = t("book");
  wrap.appendChild(a);

  const hint = document.createElement("p");
  hint.className = "book-hint";
  hint.textContent = t("bookHint");
  wrap.appendChild(hint);
  return wrap;
}

/* --------------------------- status CSV --------------------------- */

async function loadStatus({ force = false } = {}) {
  const url = state.config.statusCsvUrl;
  if (!url || isPlaceholder(url)) return;

  try {
    const bust = (url.includes("?") ? "&" : "?") + "_=" + Date.now();
    const res = await fetch(url + (force ? bust : ""), { cache: force ? "reload" : "default" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    state.statusMap = parseStatusCsv(text);
    state.statusLoaded = true;
    state.statusMsg = "info";
    renderMessages();
    render();
  } catch (err) {
    console.warn("status load failed", err);
    state.statusLoaded = false;
    state.statusMsg = "err";
    renderMessages();
  }
}

function parseStatusCsv(text) {
  const rows = csvRows(text);
  if (!rows.length) return {};
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idIdx = header.indexOf("id");
  const stIdx = header.indexOf("status");
  const map = {};
  if (idIdx === -1 || stIdx === -1) return map;
  for (let i = 1; i < rows.length; i++) {
    const id = (rows[i][idIdx] || "").trim();
    let st = (rows[i][stIdx] || "").trim().toLowerCase();
    if (!id) continue;
    if (!["available", "reserved", "sold"].includes(st)) st = "available";
    map[id] = st;
  }
  return map;
}

// minimal CSV: handles quoted fields, commas, CRLF
function csvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ----------------------- friend price unlock ---------------------- */

async function loadEncrypted() {
  try {
    const res = await fetch("data/discounts.enc.json", { cache: "no-cache" });
    if (res.ok) state.encPayload = await res.json();
  } catch (err) {
    console.warn("no discounts file", err);
  }
}

async function tryUnlock(code, { silent }) {
  if (!state.encPayload) {
    // encrypted file may still be loading; wait for it
    await loadEncrypted();
  }
  if (!state.encPayload) return;

  try {
    const discountConfig = await decryptDiscounts(state.encPayload, code);
    state.friendPrices = resolveFriendPrices(discountConfig);
    localStorage.setItem("ms-code", code);
    if (!silent) {
      state.codeMsg = "ok";
      renderMessages();
    }
    render();
  } catch (err) {
    if (!silent) {
      state.codeMsg = "err";
      renderMessages();
    }
    localStorage.removeItem("ms-code");
  }
}

function resolveFriendPrices(discountConfig) {
  if (discountConfig?.type !== "percentage") return discountConfig;

  const percentOff = Number(discountConfig.percentOff);
  if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff >= 100) {
    throw new Error("Invalid friend discount percentage");
  }

  const prices = {};
  for (const item of state.items) {
    const listPrice = Number(item.listPrice);
    if (!Number.isFinite(listPrice)) continue;
    prices[item.id] = Math.round(listPrice * (100 - percentOff)) / 100;
  }
  return prices;
}

async function decryptDiscounts(payload, code) {
  const dec = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const salt = dec(payload.salt);
  const iv = dec(payload.iv);
  const data = dec(payload.data);
  const iterations = payload.iterations || 150000;

  const baseKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ---------------------------- lightbox ---------------------------- */

function openLightbox(src) {
  const box = document.createElement("div");
  box.className = "lightbox";
  const img = document.createElement("img");
  img.src = src;
  box.appendChild(img);
  box.addEventListener("click", () => box.remove());
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { box.remove(); document.removeEventListener("keydown", esc); }
  });
  document.body.appendChild(box);
}
