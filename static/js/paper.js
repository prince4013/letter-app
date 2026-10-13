// 信紙、信封的樣式定義，以及把墨水合成到信紙上。
// 代號要和 app.py 的 PAPERS / ENVELOPES 一致。

import { createCanvas } from "./image.js";
import { hexToRgb, inkBounds, tintInk } from "./ink.js";

export const PAPERS = {
  cream: { label: "奶油白", color: "#FBF6EA", line: "#E3D5BC", margin: "#EDB8A8" },
  blush: { label: "櫻花粉", color: "#F9E4E1", line: "#EBC3BE", margin: "#E39C93" },
  night: { label: "夜空藍", color: "#26324D", line: "#3E4C6E", margin: "#5B6B92" },
};

export const ENVELOPES = {
  kraft: { label: "牛皮紙" },
  airmail: { label: "航空信" },
  sage: { label: "霧綠" },
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

// 輸出尺寸（像素）
const OUT_WIDTH = 1400;
const PAD_X = 110;
const PAD_TOP = 140;
const PAD_BOTTOM = 130;
const LINE_GAP = 72;
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

  const contentW = OUT_WIDTH - PAD_X * 2;
  const scale = Math.min(MAX_INK_SCALE, contentW / bounds.w);
  const drawW = bounds.w * scale, drawH = bounds.h * scale;
  const height = Math.max(Math.round(OUT_WIDTH * 1.0), Math.ceil(PAD_TOP + drawH + PAD_BOTTOM));

  const c = createCanvas(OUT_WIDTH, height);
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
    ctx.lineTo(OUT_WIDTH - PAD_X * 0.55, y + 0.5);
    ctx.stroke();
  }
  // 頂端雙線
  ctx.strokeStyle = paper.margin;
  ctx.lineWidth = 2;
  for (const y of [PAD_TOP - 56, PAD_TOP - 48]) {
    ctx.beginPath();
    ctx.moveTo(PAD_X * 0.55, y);
    ctx.lineTo(OUT_WIDTH - PAD_X * 0.55, y);
    ctx.stroke();
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const x = (OUT_WIDTH - drawW) / 2;
  ctx.drawImage(inkCanvas, x, PAD_TOP, drawW, drawH);
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
  return `<div class="envelope env-${envId}">
    <div class="env-inside"></div>
    ${inner}
    <div class="env-pocket"></div>
    <div class="env-flap"></div>
    ${front}
  </div>`;
}
