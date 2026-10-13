// 讀檔、縮圖、存檔等共用工具。

// iPhone Safari 的 canvas 有面積上限，先把照片縮小再處理。
export const MAX_WIDTH = 2000;
export const MAX_PIXELS = 2000 * 3000;

export function createCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("無法讀取這張圖片")); };
    img.src = url;
  });
}

/** 讀入圖片檔並縮到寬度 MAX_WIDTH 以內（同時限制總像素），回傳 canvas。 */
export async function fileToCanvas(file) {
  const img = await loadImageElement(file);
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  let scale = Math.min(1, MAX_WIDTH / w0, Math.sqrt(MAX_PIXELS / (w0 * h0)));
  const c = createCanvas(w0 * scale, h0 * scale);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** 圖片是否已經有大面積透明（用來預設勾選「已是透明背景」）。 */
export function hasTransparency(canvas) {
  const ctx = canvas.getContext("2d");
  const step = Math.max(1, Math.floor(Math.sqrt((canvas.width * canvas.height) / 40000)));
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let total = 0, clear = 0;
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      total++;
      if (data[(y * canvas.width + x) * 4 + 3] < 128) clear++;
    }
  }
  return clear / total > 0.2;
}

export function cropCanvas(src, rect) {
  const c = createCanvas(rect.w, rect.h);
  c.getContext("2d").drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
  return c;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("圖片轉檔失敗"))), "image/png"));
}

/** 存檔：手機上優先用分享選單（可直接「儲存影像」到相簿），其他情況直接下載。 */
export async function saveBlob(blob, filename) {
  const file = new File([blob], filename, { type: blob.type || "image/png" });
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function letterFilename(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `letter-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}.png`;
}
