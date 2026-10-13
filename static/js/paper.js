// 信紙、信封的樣式定義，以及把墨水合成到信紙上。
// 代號要和 app.py 的 PAPERS / ENVELOPES 一致。

import { createCanvas } from "./image.js";
import { hexToRgb, inkBounds, tintInk } from "./ink.js";

export const PAPERS = {
  cream: { label: "奶油白", color: "#FBF6EA", line: "#E3D5BC", margin: "#EDB8A8" },
  blush: { label: "淡藍", color: "#E8F1F8", line: "#C6D8E8", margin: "#9EBAD4" },
  night: { label: "夜空藍", color: "#26324D", line: "#3E4C6E", margin: "#5B6B92" },
};

// 素色信封：body 信封本體、flap 封口、inside 內裡、seal 封蠟（拆信按鈕）
export const ENVELOPES = {
  blue: { label: "淺藍", body: "#A9D4D6", flap: "#9CCACC", inside: "#86B4B6", seal: "#4F8587" },
  pink: { label: "粉紅", body: "#F3CEC7", flap: "#ECC2BA", inside: "#D9A9A1", seal: "#B8645A" },
  cream: { label: "米黃", body: "#F6F0C9", flap: "#EEE7BB", inside: "#D9D1A0", seal: "#9C8B45" },
  peach: { label: "杏橘", body: "#F2C9A1", flap: "#EBBD92", inside: "#D6A478", seal: "#B06A35" },
  yellow: { label: "鵝黃", body: "#F4E69B", flap: "#EEDD87", inside: "#D8C66C", seal: "#A88A1E" },
  green: { label: "淺綠", body: "#C9E1B6", flap: "#BCD8A7", inside: "#A2C28B", seal: "#5E8A45" },
};

const DARK_INK = "#2B2D42";
const LIGHT_INK = "#F4ECDC";

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 深色信紙用淺色墨水，淺色信紙用深色墨水。 */
export function inkColorFor(paperId) {
  return luminance(PAPERS[paperId].color) < 0.25 ? LIGHT_INK : DARK_INK;
}

// 輸出尺寸（像素）：信紙大小跟著字的範圍走，不留大片空白
const MAX_CONTENT = 1400;   // 字的最大寬／高
const MIN_WIDTH = 900;
const MIN_HEIGHT = 560;
const PAD_X = 100;
const PAD_TOP = 120;
const PAD_BOTTOM = 80;
const LINE_GAP = 64;
const MAX_INK_SCALE = 1.5;

/**
 * 把墨水合成到橫條信紙上，回傳 canvas。
 * @param {{width:number,height:number,alpha:Uint8ClampedArray}} ink
 * @param {string} paperId
 */
export function composeLetter(ink, paperId) {
  const paper = PAPERS[paperId];
  const bounds = inkBounds(ink) || { x: 0, y: 0, w: ink.width, h: ink.height };
  const inkCanvas = tintInk(ink, inkColorFor(paperId), bounds);

  const scale = Math.min(MAX_INK_SCALE, MAX_CONTENT / bounds.w, MAX_CONTENT / bounds.h);
  const drawW = bounds.w * scale, drawH = bounds.h * scale;
  const width = Math.max(MIN_WIDTH, Math.ceil(drawW + PAD_X * 2));
  const height = Math.max(MIN_HEIGHT, Math.ceil(drawH + PAD_TOP + PAD_BOTTOM));

  const c = createCanvas(width, height);
  const ctx = c.getContext("2d");

  ctx.fillStyle = paper.color;
  ctx.fillRect(0, 0, c.width, c.height);
  drawGrain(ctx, c.width, c.height, paperId === "night" ? 255 : 0);

  // 橫條
  ctx.strokeStyle = paper.line;
  ctx.lineWidth = 2;
  for (let y = PAD_TOP - 24 + LINE_GAP; y < height - PAD_BOTTOM / 2; y += LINE_GAP) {
    ctx.beginPath();
    ctx.moveTo(PAD_X * 0.55, y + 0.5);
    ctx.lineTo(width - PAD_X * 0.55, y + 0.5);
    ctx.stroke();
  }
  // 頂端雙線
  ctx.strokeStyle = paper.margin;
  ctx.lineWidth = 2;
  for (const y of [PAD_TOP - 56, PAD_TOP - 48]) {
    ctx.beginPath();
    ctx.moveTo(PAD_X * 0.55, y);
    ctx.lineTo(width - PAD_X * 0.55, y);
    ctx.stroke();
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // 置左、置上
  ctx.drawImage(inkCanvas, PAD_X, PAD_TOP, drawW, drawH);
  return c;
}

/** 一點點紙張顆粒感（固定亂數種子，同樣的輸入產生同樣的結果）。 */
function drawGrain(ctx, w, h, shade) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = `rgba(${shade},${shade},${shade},0.035)`;
  const count = Math.round((w * h) / 900);
  for (let i = 0; i < count; i++) {
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

/** 產生信封的 HTML（寄信頁縮圖與拆信頁共用）。 */
export function envelopeMarkup(envId, inner = "", front = "") {
  const e = ENVELOPES[envId];
  // 新的素色信封用 inline 顏色；舊信件（kraft/airmail/sage）沿用 CSS class
  const style = e ? ` style="--body:${e.body};--flap:${e.flap};--inside:${e.inside};--seal:${e.seal};--seal-text:#fffaf2"` : "";
  return `<div class="envelope env-${envId}"${style}>
    <div class="env-inside"></div>
    ${inner}
    <div class="env-pocket"></div>
    <div class="env-flap"></div>
    ${front}
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** 信封左上的收件人。 */
export function envelopeLabels(recipient) {
  return recipient ? `<p class="env-to"><small>收件人</small>${escapeHtml(recipient)}</p>` : "";
}
