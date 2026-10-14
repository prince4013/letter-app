// 寄信流程：上傳 → 裁切 → 選樣式 → 預覽 → 寄出。

import { canvasToBlob, cropCanvas, fileToCanvas, hasTransparency, letterFilename, saveBlob } from "./image.js";
import { Cropper } from "./crop.js";
import { ensureBoxKey, getBoxKey } from "./boxes.js";
import { extractInk, inkBounds } from "./ink.js";
import { ENVELOPES, PAPERS, SEALS, composeLetter, envelopeLabels, envelopeMarkup, envelopeRatio } from "./paper.js";
import { MAX_STAMP_SCALE, MIN_STAMP_SCALE, STAMPS, stampMarkup, stampSvg } from "./stamps.js";

const $ = (id) => document.getElementById(id);
const STEPS = ["upload", "crop", "style", "preview", "done"];
const RECIPIENT_KEY = "letter-app:recipient";
const MAX_STAMPS = 12;

const state = {
  source: null,    // 縮圖後的原圖
  cropper: null,
  cropped: null,   // 裁切後的圖
  ink: null,       // 墨水遮罩（依是否透明背景快取）
  inkKey: "",
  paper: "cream",
  envelope: "pink",
  seal: "red",
  stamps: [],      // [{id, x, y, r, s}]，x/y 為信封上的相對位置，s 為大小倍率
  selected: -1,
  letter: null,    // 合成好的信紙 canvas
  sending: false,
};

// Render 免費方案會休眠，打開寄信頁就先叫醒伺服器，等按寄出時就不用等。
fetch("/healthz").catch(() => {});

function showDrawerLink() {
  const key = getBoxKey("drawer");
  if (!key) return;
  $("drawer-link").href = `/box/${key}`;
  $("done-drawer").href = `/box/${key}`;
}
showDrawerLink();
// 還沒有抽屜時，點「我的抽屜」就建立一個（可以把以前寄的信貼進去）
$("drawer-link").addEventListener("click", async (e) => {
  if (getBoxKey("drawer")) return;
  e.preventDefault();
  try {
    location.href = `/box/${await ensureBoxKey("drawer")}`;
  } catch (err) { /* 網路不通就算了 */ }
});

if (new URLSearchParams(location.search).has("reply")) $("reply-banner").classList.remove("hidden");
try {
  $("recipient").value = localStorage.getItem(RECIPIENT_KEY) || "";
} catch (e) { /* 無痕模式 */ }

function show(step) {
  STEPS.forEach((s) => $(`step-${s}`).classList.toggle("hidden", s !== step));
  const idx = Math.min(STEPS.indexOf(step), 3);
  [...$("steps").children].forEach((el, i) => el.classList.toggle("on", i <= idx));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
show("upload");

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
}

document.querySelectorAll("[data-back]").forEach((btn) =>
  btn.addEventListener("click", () => {
    if (btn.dataset.back === "upload") $("file").value = "";
    show(btn.dataset.back);
  }));

// ---------- 1. 上傳 ----------
$("file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  showError("upload-error", "");
  try {
    state.source = await fileToCanvas(file);
  } catch (err) {
    showError("upload-error", "讀不到這張圖片，請換一張試試（建議 JPG 或 PNG）。");
    return;
  }
  $("transparent").checked = file.type === "image/png" && hasTransparency(state.source);
  if (state.cropper) state.cropper.destroy();
  show("crop");
  // 要等容器顯示後才量得到寬度
  requestAnimationFrame(() => { state.cropper = new Cropper($("crop-wrap"), state.source); });
});

// ---------- 2. 裁切 ----------
$("crop-done").addEventListener("click", () => {
  state.cropped = cropCanvas(state.source, state.cropper.getRect());
  state.inkKey = "";
  show("style");
});

// ---------- 3. 樣式 ----------
function renderChoices() {
  $("paper-choices").innerHTML = Object.entries(PAPERS).map(([id, p]) => `
    <button type="button" class="choice" data-paper="${id}" aria-pressed="${id === state.paper}">
      <span class="swatch-paper" style="--paper-c:${p.color};--line-c:${p.line}"></span>${p.label}
    </button>`).join("");
  $("envelope-choices").innerHTML = Object.entries(ENVELOPES).map(([id, env]) => `
    <button type="button" class="choice" data-envelope="${id}" aria-pressed="${id === state.envelope}">
      <span class="swatch-env">${envelopeMarkup(id, "", '<span class="seal"></span>', state.seal)}</span>${env.label}
    </button>`).join("");
  $("seal-choices").innerHTML = Object.entries(SEALS).map(([id, s]) => `
    <button type="button" class="choice" data-seal="${id}" aria-pressed="${id === state.seal}">
      <span class="swatch-seal wax-${id}"><span class="seal"></span></span>${s.label}
    </button>`).join("");
}
renderChoices();

// ---------- 蓋章 ----------
$("stamp-palette").innerHTML = Object.entries(STAMPS).map(([id, st]) =>
  `<button type="button" data-stamp="${id}" aria-label="${st.label}">${stampSvg(id)}<span>${st.label}</span></button>`).join("");

function renderBoard() {
  const labels = envelopeLabels($("recipient").value.trim());
  const stamps = state.stamps.map((s, i) => stampMarkup(s, i)).join("");
  $("stamp-board").innerHTML = envelopeMarkup(state.envelope, "", '<span class="seal"></span>' + labels + stamps, state.seal);
  const sel = $("stamp-board").querySelector(`.stamp[data-index="${state.selected}"]`);
  if (sel) sel.classList.add("selected");
  $("stamp-remove").disabled = state.selected < 0;
}

$("stamp-palette").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-stamp]");
  if (!btn || state.stamps.length >= MAX_STAMPS) return;
  // 新的章先放在右上角（郵票的位置），稍微錯開、帶一點隨機角度
  const n = state.stamps.length;
  state.stamps.push({
    id: btn.dataset.stamp,
    x: Math.max(0.1, 0.78 - (n % 4) * 0.15),
    y: 0.3 + Math.floor(n / 4) * 0.2,
    r: Math.round(Math.random() * 24 - 12),
    s: 1,
  });
  state.selected = state.stamps.length - 1;
  renderBoard();
});

$("stamp-board").addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".stamp");
  if (!el) {
    state.selected = -1;
    renderBoard();
    return;
  }
  e.preventDefault();
  const i = Number(el.dataset.index);
  state.selected = i;
  $("stamp-board").querySelectorAll(".stamp").forEach((s) => s.classList.toggle("selected", s === el));
  $("stamp-remove").disabled = false;
  const env = $("stamp-board").querySelector(".envelope").getBoundingClientRect();
  el.setPointerCapture(e.pointerId);
  // 拖曳左下角的圓點：放大縮小（依手指到印章中心的距離）
  const resizing = e.target.closest(".stamp-handle");
  // 拖曳右上角的箭頭：旋轉（依手指繞印章中心轉了幾度）
  const rotating = e.target.closest(".stamp-rotate");
  const box = el.getBoundingClientRect();
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  const startDist = Math.max(10, Math.hypot(e.clientX - cx, e.clientY - cy));
  const startScale = state.stamps[i].s || 1;
  const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
  const startR = state.stamps[i].r || 0;
  const move = rotating ? (ev) => {
    const deg = (Math.atan2(ev.clientY - cy, ev.clientX - cx) - startAngle) * 180 / Math.PI;
    let r = Math.round(startR + deg);
    r = ((r + 540) % 360) - 180;  // 收在 -180~180
    state.stamps[i].r = r;
    el.style.setProperty("--r", `${r}deg`);
  } : resizing ? (ev) => {
    const d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
    const sc = Math.min(MAX_STAMP_SCALE, Math.max(MIN_STAMP_SCALE, startScale * d / startDist));
    state.stamps[i].s = Math.round(sc * 100) / 100;
    el.style.setProperty("--s", state.stamps[i].s);
  } : (ev) => {
    const x = Math.min(1, Math.max(0, (ev.clientX - env.left) / env.width));
    const y = Math.min(1, Math.max(0, (ev.clientY - env.top) / env.height));
    state.stamps[i].x = x;
    state.stamps[i].y = y;
    el.style.left = `${x * 100}%`;
    el.style.top = `${y * 100}%`;
  };
  const end = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", end);
    el.removeEventListener("pointercancel", end);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
});

$("stamp-remove").addEventListener("click", () => {
  if (state.selected < 0) return;
  state.stamps.splice(state.selected, 1);
  state.selected = -1;
  renderBoard();
});
$("stamp-clear").addEventListener("click", () => {
  state.stamps = [];
  state.selected = -1;
  renderBoard();
});
$("recipient").addEventListener("input", renderBoard);
renderBoard();

$("paper-choices").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-paper]");
  if (!btn) return;
  state.paper = btn.dataset.paper;
  renderChoices();
});
$("seal-choices").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-seal]");
  if (!btn) return;
  state.seal = btn.dataset.seal;
  renderChoices();
  renderBoard();
});
$("envelope-choices").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-envelope]");
  if (!btn) return;
  state.envelope = btn.dataset.envelope;
  renderChoices();
  renderBoard();
});

$("to-preview").addEventListener("click", () => {
  showError("style-error", "");
  try {
    localStorage.setItem(RECIPIENT_KEY, $("recipient").value.trim());
  } catch (e) { /* 無痕模式 */ }
  show("preview");
  renderPreview();
});

// ---------- 4. 預覽 ----------
function renderPreview() {
  const transparent = $("transparent").checked;
  $("processing").classList.remove("hidden");
  $("preview").classList.add("hidden");
  $("send").disabled = true;
  $("download").disabled = true;

  // 讓「處理中」先畫出來再做運算
  setTimeout(() => {
    const key = String(transparent);
    if (state.inkKey !== key) {
      state.ink = extractInk(state.cropped, { transparent });
      state.inkKey = key;
    }
    showError("send-error", inkBounds(state.ink) ? "" :
      "沒有偵測到字跡。若是拍照的圖，請回上一步取消勾選「已是透明背景」，或換一張光線較均勻的照片。");
    state.letter = composeLetter(state.ink, state.paper);
    $("preview").src = state.letter.toDataURL("image/png");
    renderEnvelopePreview();
    $("preview").classList.remove("hidden");
    $("processing").classList.add("hidden");
    $("send").disabled = false;
    $("download").disabled = false;
  }, 30);
}

/** 預覽的信封：和收信者看到的一樣（收件人、印章、封蠟）。 */
function renderEnvelopePreview() {
  const front = envelopeLabels($("recipient").value.trim()) +
    state.stamps.map((s) => stampMarkup(s)).join("") + '<span class="seal"></span>';
  $("preview-envelope").innerHTML = envelopeMarkup(state.envelope, "", front, state.seal);
  const env = $("preview-envelope").firstElementChild;
  env.style.aspectRatio = String(envelopeRatio(state.letter.width, state.letter.height));
}

$("download").addEventListener("click", async () => {
  if (!state.letter) return;
  await saveBlob(await canvasToBlob(state.letter), letterFilename());
});

$("send").addEventListener("click", async () => {
  if (!state.letter || state.sending) return;
  state.sending = true;
  $("send").disabled = true;
  $("send").textContent = "寄送中…";
  showError("send-error", "");
  try {
    // 寄出的信自動放進自己的抽屜（第一次寄信時建立抽屜）
    let drawerKey = "";
    try {
      drawerKey = await ensureBoxKey("drawer");
    } catch (e) { /* 抽屜建立失敗也照常寄信 */ }
    const form = new FormData();
    form.append("drawer_key", drawerKey);
    form.append("collectible", $("collectible").checked ? "1" : "0");
    form.append("image", await canvasToBlob(state.letter), "letter.png");
    form.append("recipient_name", $("recipient").value.trim());
    form.append("stamps", JSON.stringify(state.stamps));
    form.append("paper", state.paper);
    form.append("envelope", state.envelope);
    form.append("seal", state.seal);
    const resp = await fetch("/api/letters", { method: "POST", body: form });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "寄送失敗，請再試一次。");
    $("letter-url").value = data.url;
    $("open-letter").href = data.url;
    $("ttl-note").textContent = drawerKey ? "這封信已放進你的抽屜，會一直保存。" : $("ttl-note").textContent;
    showDrawerLink();
    show("done");
  } catch (err) {
    showError("send-error", err.message || "寄送失敗，請檢查網路後再試一次。");
  } finally {
    state.sending = false;
    $("send").disabled = false;
    $("send").textContent = "寄出";
  }
});

// ---------- 5. 完成 ----------
$("copy").addEventListener("click", async () => {
  const url = $("letter-url").value;
  try {
    await navigator.clipboard.writeText(url);
  } catch (e) {
    $("letter-url").select();
    document.execCommand("copy");
  }
  $("copy").textContent = "已複製";
  setTimeout(() => { $("copy").textContent = "複製"; }, 1800);
});
