// 裁切框：拖曳框內移動、拖曳四角縮放。座標以原圖像素儲存。

const MIN_SIZE = 40; // 原圖像素

export class Cropper {
  /**
   * @param {HTMLElement} wrap 容器（.crop-wrap）
   * @param {HTMLCanvasElement} source 要裁切的圖
   */
  constructor(wrap, source) {
    this.wrap = wrap;
    this.source = source;
    wrap.innerHTML = "";
    const view = document.createElement("canvas");
    view.width = source.width;
    view.height = source.height;
    view.getContext("2d").drawImage(source, 0, 0);
    wrap.appendChild(view);

    this.box = document.createElement("div");
    this.box.className = "crop-box";
    this.box.innerHTML = '<i class="h nw"></i><i class="h ne"></i><i class="h sw"></i><i class="h se"></i>';
    wrap.appendChild(this.box);

    const inset = Math.round(Math.min(source.width, source.height) * 0.04);
    this.rect = { x: inset, y: inset, w: source.width - inset * 2, h: source.height - inset * 2 };
    this.render();

    this.box.addEventListener("pointerdown", (e) => this.start(e));
    this.onResize = () => this.render();
    window.addEventListener("resize", this.onResize);
  }

  get scale() {
    return this.wrap.clientWidth / this.source.width;
  }

  render() {
    const s = this.scale, r = this.rect;
    Object.assign(this.box.style, {
      left: `${r.x * s}px`, top: `${r.y * s}px`, width: `${r.w * s}px`, height: `${r.h * s}px`,
    });
  }

  start(e) {
    e.preventDefault();
    const handle = e.target.classList.contains("h") ? [...e.target.classList].find((c) => c !== "h") : "move";
    const startX = e.clientX, startY = e.clientY;
    const r0 = { ...this.rect };
    const W = this.source.width, H = this.source.height;
    this.box.setPointerCapture(e.pointerId);

    const move = (ev) => {
      const s = this.scale;
      const dx = (ev.clientX - startX) / s, dy = (ev.clientY - startY) / s;
      let { x, y, w, h } = r0;
      if (handle === "move") {
        x = Math.min(W - w, Math.max(0, x + dx));
        y = Math.min(H - h, Math.max(0, y + dy));
      } else {
        let x1 = x + w, y1 = y + h;
        if (handle.includes("w")) x = Math.min(x1 - MIN_SIZE, Math.max(0, x + dx));
        if (handle.includes("e")) x1 = Math.max(x + MIN_SIZE, Math.min(W, x1 + dx));
        if (handle.includes("n")) y = Math.min(y1 - MIN_SIZE, Math.max(0, y + dy));
        if (handle.includes("s")) y1 = Math.max(y + MIN_SIZE, Math.min(H, y1 + dy));
        w = x1 - x; h = y1 - y;
      }
      this.rect = { x, y, w, h };
      this.render();
    };
    const end = () => {
      this.box.removeEventListener("pointermove", move);
      this.box.removeEventListener("pointerup", end);
      this.box.removeEventListener("pointercancel", end);
    };
    this.box.addEventListener("pointermove", move);
    this.box.addEventListener("pointerup", end);
    this.box.addEventListener("pointercancel", end);
  }

  /** 回傳整數像素的裁切範圍。 */
  getRect() {
    const r = this.rect;
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
  }

  destroy() {
    window.removeEventListener("resize", this.onResize);
  }
}
