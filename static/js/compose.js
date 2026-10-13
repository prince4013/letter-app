// 寄信流程：上傳 → 裁切 → 選樣式 → 預覽 → 寄出。

import { canvasToBlob, cropCanvas, fileToCanvas, hasTransparency, letterFilename, saveBlob } from "./image.js";
import { Cropper } from "./crop.js";
import { extractInk, inkBounds } from "./ink.js";
import { ENVELOPES, PAPERS, composeLetter, envelopeMarkup } from "./paper.js";

const $ = (id) => document.getElementById(id);
const STEPS = ["upload", "crop", "style", "preview", "done"];
const SENDER_KEY = "letter-app:sender";

const state = {
  source: null,    // 縮圖後的原圖
  cropper: null,
  cropped: null,   // 裁切後的圖
  ink: null,       // 墨水遮罩（依 strength 快取）
  inkKey: "",
  paper: "cream",
  envelope: "kraft",
  letter: null,    // 合成好的信紙 canvas
  sending: false,
};

// Render 免費方案會休眠，打開寄信頁就先叫醒伺服器，等按寄出時就不用等。
fetch("/healthz").catch(() => {});

if (new URLSearchParams(location.search).has("reply")) $("reply-banner").classList.remove("hidden");
try { $("sender").value = localStorage.getItem(SENDER_KEY) || ""; } catch (e) { /* 無痕模式 */ }

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
});

$("to-preview").addEventListener("click", () => {
  const sender = $("sender").value.trim();
  if (!sender) {
    showError("style-error", "請填寫署名，對方會在信封上看到。");
    $("sender").focus();
    return;
  }
  showError("style-error", "");
  try { localStorage.setItem(SENDER_KEY, sender); } catch (e) { /* 無痕模式 */ }
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
