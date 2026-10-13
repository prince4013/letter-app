// 去背：從手寫照片萃取墨水，輸出一張 alpha 遮罩（紙面透明、墨水不透明）。
//
// 做法：灰階 ÷ 模糊後的紙面背景（消除陰影、光線不均）→ 門檻值（含柔邊）。
// 不用 AI，全部在瀏覽器完成。

import { createCanvas } from "./image.js";

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function boxBlur(src, w, h, r) {
  // 可分離的盒狀模糊（水平 + 垂直），邊緣夾住
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[row + Math.min(w - 1, Math.max(0, x + k))];
      tmp[row + x] = s / n;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      out[y * w + x] = s / n;
    }
  }
  return out;
}

/** 估計紙面亮度：分塊取最亮值（墨水會被排除）→ 擴張一格 → 模糊。回傳小尺寸網格。 */
function estimatePaper(gray, w, h, block) {
  const sw = Math.ceil(w / block), sh = Math.ceil(h / block);
  const grid = new Float32Array(sw * sh);
  for (let by = 0; by < sh; by++) {
    for (let bx = 0; bx < sw; bx++) {
      let m = 0;
      const y1 = Math.min(h, (by + 1) * block), x1 = Math.min(w, (bx + 1) * block);
      for (let y = by * block; y < y1; y++) {
        const row = y * w;
        for (let x = bx * block; x < x1; x++) if (gray[row + x] > m) m = gray[row + x];
      }
      grid[by * sw + bx] = m;
    }
  }
  // 擴張（3x3 取最大），把比區塊還粗的筆畫也排除掉
  const dil = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(sh - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(sw - 1, Math.max(0, x + dx));
          if (grid[yy * sw + xx] > m) m = grid[yy * sw + xx];
        }
      }
      dil[y * sw + x] = m;
    }
  }
  const blurred = boxBlur(boxBlur(dil, sw, sh, 2), sw, sh, 2);
  return { grid: blurred, sw, sh };
}

/**
 * 從照片萃取墨水。
 * @param {HTMLCanvasElement} src
 * @param {{transparent?: boolean, strength?: number}} opts
 *   transparent：原圖已是透明背景，直接用原本的 alpha。
 *   strength：0~1，越大越容易把淡的筆跡當成墨水（預設 0.5）。
 * @returns {{width:number, height:number, alpha:Uint8ClampedArray, rgb:Uint8ClampedArray}}
 *   rgb：每個像素的墨水原色（保留原本的筆色，例如藍筆就是藍色）。
 */
export function extractInk(src, { transparent = false, strength = 0.5 } = {}) {
  const w = src.width, h = src.height;
  const { data } = src.getContext("2d").getImageData(0, 0, w, h);
  const alpha = new Uint8ClampedArray(w * h);
  const rgb = new Uint8ClampedArray(w * h * 3);

  if (transparent) {
    for (let i = 0; i < w * h; i++) {
      alpha[i] = data[i * 4 + 3];
      rgb[i * 3] = data[i * 4]; rgb[i * 3 + 1] = data[i * 4 + 1]; rgb[i * 3 + 2] = data[i * 4 + 2];
    }
    return { width: w, height: h, alpha, rgb };
  }

  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const block = Math.max(8, Math.round(Math.max(w, h) / 120));
  const { grid, sw, sh } = estimatePaper(gray, w, h, block);

  // 門檻值：墨水深度 d = 1 - 灰階/紙面。strength 越大門檻越低。
  const center = 0.24 - 0.17 * Math.min(1, Math.max(0, strength));
  const lo = center * 0.55, hi = center * 1.5;

  const paperAt = new Float32Array(w * h);
  const depth = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    // 雙線性取樣紙面亮度（網格中心對齊區塊中心）
    const gy = Math.min(sh - 1, Math.max(0, (y + 0.5) / block - 0.5));
    const y0 = Math.floor(gy), y1 = Math.min(sh - 1, y0 + 1), fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(sw - 1, Math.max(0, (x + 0.5) / block - 0.5));
      const x0 = Math.floor(gx), x1 = Math.min(sw - 1, x0 + 1), fx = gx - x0;
      const top = grid[y0 * sw + x0] * (1 - fx) + grid[y0 * sw + x1] * fx;
      const bot = grid[y1 * sw + x0] * (1 - fx) + grid[y1 * sw + x1] * fx;
      const paper = Math.max(1, top * (1 - fy) + bot * fy);
      const d = 1 - Math.min(1, gray[y * w + x] / paper);
      paperAt[y * w + x] = paper;
      depth[y * w + x] = d;
      alpha[y * w + x] = Math.round(255 * smoothstep(lo, hi, d));
    }
  }

  // 墨水原色：先除以紙面亮度把光線拉平，再把筆畫邊緣（和紙混在一起的淡色）
  // 依「實心筆畫的深度」還原成筆的顏色，避免字邊發白。
  const solid = [];
  for (let i = 0; i < w * h; i += 7) if (alpha[i] > 220) solid.push(depth[i]);
  solid.sort((a, b) => a - b);
  const full = solid.length ? Math.max(0.2, solid[Math.floor(solid.length / 2)]) : 0.5;
  for (let i = 0; i < w * h; i++) {
    if (!alpha[i]) continue;
    const t = Math.min(1, Math.max(0.05, depth[i] / full));
    const k = 255 / paperAt[i];
    for (let ch = 0; ch < 3; ch++) {
      const n = Math.min(1, data[i * 4 + ch] * k / 255);
      rgb[i * 3 + ch] = Math.round(255 * Math.max(0, 1 - (1 - n) / t));
    }
  }
  return { width: w, height: h, alpha, rgb };
}

/** 找出墨水的範圍並留邊，避免信紙上方或旁邊空一大塊。沒有墨水時回傳 null。 */
export function inkBounds(ink, threshold = 60) {
  const { width: w, height: h, alpha } = ink;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = Math.round(Math.max(w, h) * 0.02);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 墨水的平均顏色（只看實心筆畫），用來判斷原色在信紙上看不看得清楚。 */
export function averageInkColor(ink) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < ink.alpha.length; i += 3) {
    if (ink.alpha[i] > 200) {
      r += ink.rgb[i * 3]; g += ink.rgb[i * 3 + 1]; b += ink.rgb[i * 3 + 2]; n++;
    }
  }
  return n ? [r / n, g / n, b / n] : null;
}

/** 把墨水遮罩畫成 canvas（只畫 bounds 範圍）。color 為 null 時用墨水原色。 */
export function tintInk(ink, color, bounds) {
  const b = bounds || { x: 0, y: 0, w: ink.width, h: ink.height };
  const c = createCanvas(b.w, b.h);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(b.w, b.h);
  const fixed = color ? hexToRgb(color) : null;
  for (let y = 0; y < b.h; y++) {
    const srcRow = (y + b.y) * ink.width + b.x;
    for (let x = 0; x < b.w; x++) {
      const o = (y * b.w + x) * 4;
      if (fixed) {
        img.data[o] = fixed[0]; img.data[o + 1] = fixed[1]; img.data[o + 2] = fixed[2];
      } else {
        const p = (srcRow + x) * 3;
        img.data[o] = ink.rgb[p]; img.data[o + 1] = ink.rgb[p + 1]; img.data[o + 2] = ink.rgb[p + 2];
      }
      img.data[o + 3] = ink.alpha[srcRow + x];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function hexToRgb(hex) {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
