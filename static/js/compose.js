// 寄信流程：上傳 → 裁切 → 選樣式 → 預覽 → 寄出。

import { canvasToBlob, cropCanvas, fileToCanvas, hasTransparency, letterFilename, saveBlob } from "./image.js";
import { Cropper } from "./crop.js";
import { extractInk, inkBounds } from "./ink.js";
import { ENVELOPES, PAPERS, composeLetter, envelopeLabels, envelopeMarkup } from "./paper.js";
import { STAMPS, stampMarkup, stampSvg } from "./stamps.js";

const $ = (id) => document.getElementById(id);
const STEPS = ["upload", "crop", "style", "preview", "done"];
const SENDER_KEY = "letter-app:sender";
const RECIPIENT_KEY = "letter-app:recipient";
const MAX_STAMPS = 12;

const state = {
  source: null,    // 縮圖後的原圖
  cropper: null,
  cropped: null,   // 裁切後的圖
  ink: null,       // 墨水遮罩（依 strength 快取）
  inkKey: "",
  paper: "cream",
  envelope: "pink",
  stamps: [],      // [{id, x, y, r}]，x/y 為信封上的相對位置
  selected: -1,
  letter: null,    // 合成好的信紙 canvas
  sending: false,
};

// Render 免費方案會休眠，打開寄信頁就先叫醒伺服器，等按寄出時就不用等。
fetch("/healthz").catch(() => {});

if (new URLSearchParams(location.search).has("reply")) $("reply-banner").classList.remove("hidden");
try {
  $("sender").value = localStorage.getItem(SENDER_KEY) || "";
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
      <span class="swatch-env">${envelopeMarkup(id, "", '<span class="seal"></span>')}</span>${env.label}
    </button>`).join("");
}
renderChoices();

// ---------- 蓋章 ----------
$("stamp-palette").innerHTML = Object.entries(STAMPS).map(([id, st]) =>
  `<button type="button" data-stamp="${id}" aria-label="${st.label}">${stampSvg(id)}<span>${st.label}</span></button>`).join("");

function renderBoard() {
  const labels = envelopeLabels($("recipient").value.trim(), $("sender").value.trim());
  const stamps = state.stamps.map((s, i) => stampMarkup(s, i)).join("");
  $("stamp-board").innerHTML = envelopeMarkup(state.envelope, "", '<span class="seal"></span>' + labels + stamps);
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
    x: Math.max(0.1, 0.86 - (n % 4) * 0.15),
    y: 0.22 + Math.floor(n / 4) * 0.2,
    r: Math.round(Math.random() * 24 - 12),
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
  const move = (ev) => {
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
$("sender").addEventListener("input", renderBoard);
renderBoard();

$("paper-choices").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-paper]");
  if (!btn) return;
  state.paper = btn.dataset.paper;
  renderChoices();
});
$("envelope-choices").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-envelope]");
  if (!btn) return;
  state.envelope = btn.dataset.envelope;
  renderChoices();
  renderBoard();
});

$("to-preview").addEventListener("click", () => {
  const sender = $("sender").value.trim();
  if (!sender) {
    showError("style-error", "請填寫放件人，對方會在信封上看到。");
    $("sender").focus();
    return;
  }
  showError("style-error", "");
  try {
    localStorage.setItem(SENDER_KEY, sender);
    localStorage.setItem(RECIPIENT_KEY, $("recipient").value.trim());
  } catch (e) { /* 無痕模式 */ }
  show("preview");
  renderPreview();
});

// ---------- 4. 預覽 ----------
function renderPreview() {
  const transparent = $("transparent").checked;
  $("strength-field").classList.toggle("hidden", transparent);
  $("processing").classList.remove("hidden");
  $("preview").classList.add("hidden");
  $("send").disabled = true;
  $("download").disabled = true;

  // 讓「處理中」先畫出來再做運算
  setTimeout(() => {
    const strength = parseFloat($("strength").value);
    const key = `${transparent}:${strength}`;
    if (state.inkKey !== key) {
      state.ink = extractInk(state.cropped, { transparent, strength });
      state.inkKey = key;
    }
    showError("send-error", inkBounds(state.ink) ? "" :
      "沒有偵測到字跡。若是拍照的圖，請取消勾選「已是透明背景」，或把「筆跡濃淡」往右調。");
    state.letter = composeLetter(state.ink, state.paper);
    $("preview").src = state.letter.toDataURL("image/png");
    $("preview").classList.remove("hidden");
    $("processing").classList.add("hidden");
    $("send").disabled = false;
    $("download").disabled = false;
  }, 30);
}

let strengthTimer = null;
$("strength").addEventListener("input", () => {
  clearTimeout(strengthTimer);
  strengthTimer = setTimeout(renderPreview, 200);
});

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
    const form = new FormData();
    form.append("image", await canvasToBlob(state.letter), "letter.png");
    form.append("sender_name", $("sender").value.trim());
    form.append("recipient_name", $("recipient").value.trim());
    form.append("stamps", JSON.stringify(state.stamps));
    form.append("paper", state.paper);
    form.append("envelope", state.envelope);
    const resp = await fetch("/api/letters", { method: "POST", body: form });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "寄送失敗，請再試一次。");
    $("letter-url").value = data.url;
    if (navigator.share) $("share").classList.remove("hidden");
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

$("share").addEventListener("click", () => {
  navigator.share({ title: "給你的一封信", url: $("letter-url").value }).catch(() => {});
});
