// 拆信頁：信件準備中 → 信封 → 拆信動畫 → 信的內容。

import { letterFilename, saveBlob } from "./image.js";
import { envelopeLabels, envelopeMarkup, envelopeRatio } from "./paper.js";
import { stampMarkup } from "./stamps.js";

const $ = (id) => document.getElementById(id);
const token = $("root").dataset.token;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let letter = null;
let imageBlob = null;

function showError(title, text) {
  $("loading").classList.add("hidden");
  $("error-title").textContent = title;
  $("error-text").textContent = text;
  $("error").classList.remove("hidden");
}

async function fetchWithRetry(url, tries = 4) {
  // 伺服器剛被叫醒時偶爾會失敗，多試幾次
  for (let i = 0; ; i++) {
    try {
      const resp = await fetch(url);
      if (resp.status < 500 || i >= tries - 1) return resp;
    } catch (e) {
      if (i >= tries - 1) throw e;
    }
    await wait(1500 * (i + 1));
  }
}

async function load() {
  const slow = setTimeout(() => { $("loading-note").textContent = "第一次打開比較久，再等一下下…"; }, 4000);
  try {
    const resp = await fetchWithRetry(`/api/letters/${encodeURIComponent(token)}`);
    if (resp.status === 404) return showError("找不到這封信", "網址可能不完整，請再確認一次。");
    if (resp.status === 410) return showError("這封信已超過保存期限", "請對方再寄一次吧。");
    if (!resp.ok) throw new Error();
    letter = await resp.json();

    const imgResp = await fetchWithRetry(letter.image_url);
    if (!imgResp.ok) throw new Error();
    imageBlob = await imgResp.blob();
    const url = URL.createObjectURL(imageBlob);
    const img = $("letter-img");
    img.src = url;
    await img.decode();
    showEnvelope(url);
  } catch (e) {
    showError("信件暫時打不開", "請檢查網路，稍後重新整理一次。");
  } finally {
    clearTimeout(slow);
  }
}

function showEnvelope(imgUrl) {
  const inner = `
    <div class="letter-card"><img src="${imgUrl}" alt=""></div>`;
  $("envelope-slot").innerHTML = envelopeMarkup(letter.envelope, inner);
  const env = $("envelope-slot").firstElementChild;
  env.classList.add("env-shadow");
  // 信封比例跟著信的版面走，信卡才不會留白
  const img = $("letter-img");
  env.style.aspectRatio = String(envelopeRatio(img.naturalWidth, img.naturalHeight));
  env.insertAdjacentHTML("beforeend", `
    ${envelopeLabels(letter.recipient_name || "")}
    ${(letter.stamps || []).map((s) => stampMarkup(s)).join("")}
    <button class="seal" id="open-btn" aria-label="拆信">拆信</button>`);
  $("loading").classList.add("hidden");
  $("scene").classList.remove("hidden");
  $("open-btn").addEventListener("click", () => openLetter(env), { once: true });
}

async function openLetter(env) {
  $("hint").style.opacity = 0;
  env.classList.add("opening");
  await wait(250);
  env.classList.add("flap-open");
  await wait(600);
  env.classList.add("flap-behind");
  env.classList.add("card-out");
  await wait(1200);
  env.classList.add("fade");
  await wait(450);
  $("scene").classList.add("hidden");

  const expires = new Date(letter.expires_at);
  $("letter-meta").textContent =
    `${letter.sender_name ? `來自 ${letter.sender_name} · ` : ""}信件保存到 ${expires.getFullYear()}/${expires.getMonth() + 1}/${expires.getDate()}，記得收下存檔`;
  const view = $("letter-view");
  view.classList.remove("hidden");
  requestAnimationFrame(() => requestAnimationFrame(() => view.classList.add("show")));
}

// ---------- 放大縮小 ----------
const ZOOMS = [1, 1.5, 2, 3];
let zoomIdx = 0;
function setZoom(i, focus) {
  const box = $("letter-zoom");
  const prev = ZOOMS[zoomIdx];
  zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, i));
  const z = ZOOMS[zoomIdx];
  // 以點擊位置（或畫面中心）為中心縮放
  const fx = focus ? focus.x : box.clientWidth / 2;
  const fy = focus ? focus.y : box.clientHeight / 2;
  const cx = (box.scrollLeft + fx) / prev, cy = (box.scrollTop + fy) / prev;
  box.style.setProperty("--zoom", z);
  box.style.maxHeight = z > 1 ? "75vh" : "";
  box.scrollLeft = cx * z - fx;
  box.scrollTop = cy * z - fy;
  $("zoom-level").textContent = `${Math.round(z * 100)}%`;
  $("zoom-out").disabled = zoomIdx === 0;
  $("zoom-in").disabled = zoomIdx === ZOOMS.length - 1;
}
$("zoom-in").addEventListener("click", () => setZoom(zoomIdx + 1));
$("zoom-out").addEventListener("click", () => setZoom(zoomIdx - 1));
// 點兩下：放大到 200% ／ 回到 100%
let lastTap = 0;
$("letter-zoom").addEventListener("click", (e) => {
  const now = Date.now();
  if (now - lastTap < 300) {
    const r = $("letter-zoom").getBoundingClientRect();
    setZoom(zoomIdx === 0 ? 2 : 0, { x: e.clientX - r.left, y: e.clientY - r.top });
    lastTap = 0;
  } else {
    lastTap = now;
  }
});
setZoom(0);

$("save").addEventListener("click", async () => {
  if (!imageBlob) return;
  await saveBlob(imageBlob, letterFilename(new Date(letter.created_at)));
});

load();
