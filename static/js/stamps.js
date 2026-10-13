// 信封印章：單色線條圖（像橡皮章），顏色由 CSS 的 color 決定。
// 代號要和 app.py 的 STAMPS 一致。

const S = 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';

export const STAMPS = {
  heart: {
    label: "愛心",
    svg: `<path d="M32 54C14 42 6 32 6 22a12 12 0 0 1 26-6 12 12 0 0 1 26 6c0 10-8 20-26 32z" fill="currentColor"/>`,
  },
  sun: {
    label: "太陽",
    svg: `<g ${S}><circle cx="32" cy="32" r="13"/>
      <path d="M32 6v7M32 51v7M6 32h7M51 32h7M13.6 13.6l5 5M45.4 45.4l5 5M13.6 50.4l5-5M45.4 18.6l5-5"/>
      <path d="M27 35q5 4 10 0"/></g>
      <circle cx="27.5" cy="29" r="1.8" fill="currentColor"/><circle cx="36.5" cy="29" r="1.8" fill="currentColor"/>`,
  },
  cat: {
    label: "躺著的貓",
    svg: `<g ${S}>
      <path d="M20 44c-6 0-11-4-11-9s4-9 9-9l3-6 3 6h4l3-6 3 6c3 2 4 5 4 8"/>
      <path d="M26 44h22c6 0 9-3 9-8s-4-8-11-8H38"/>
      <path d="M57 38c4 0 5 5 1 7"/>
      <path d="M14 34q2 2 4 0M22 34q2 2 4 0"/>
      <path d="M44 20h5l-5 5h5M52 13h4l-4 4h4"/></g>`,
  },
  book: {
    label: "笑臉書本",
    svg: `<g ${S}>
      <path d="M14 10h30l6 6v38H14z"/><path d="M44 10v6h6"/><path d="M18 10v44"/>
      <path d="M26 36q6 6 12 0"/><path d="M14 34H7M50 34h7M24 54v5M40 54v5"/></g>
      <circle cx="27" cy="28" r="2" fill="currentColor"/><circle cx="37" cy="28" r="2" fill="currentColor"/>`,
  },
  meatball: {
    label: "貢丸",
    svg: `<g ${S}>
      <path d="M14 58L52 6"/>
      <circle cx="22" cy="44" r="9"/><circle cx="32" cy="31" r="9"/><circle cx="42" cy="18" r="9"/>
      <path d="M19 46q3 2 6 0M29 33q3 2 6 0M39 20q3 2 6 0"/></g>`,
  },
  rabbit: {
    label: "兔子",
    svg: `<g ${S}>
      <path d="M24 26c-4-8-5-18 0-20s7 10 6 19M40 26c4-8 5-18 0-20s-7 10-6 19"/>
      <path d="M32 24c-12 0-20 9-20 19 0 8 7 13 20 13s20-5 20-13c0-10-8-19-20-19z"/>
      <path d="M29 42q3 3 6 0"/></g>
      <circle cx="25" cy="37" r="2" fill="currentColor"/><circle cx="39" cy="37" r="2" fill="currentColor"/>`,
  },
};

Object.assign(STAMPS, {
  baozi: {
    label: "笑臉肉包",
    svg: `<g ${S}>
      <path d="M8 44c0-14 11-26 24-26s24 12 24 26c0 6-5 9-24 9S8 50 8 44z"/>
      <path d="M32 18c-2 4-6 6-6 6M32 18c2 4 6 6 6 6M32 18v-4"/>
      <path d="M28 40q4 4 8 0"/></g>
      <circle cx="24" cy="35" r="2" fill="currentColor"/><circle cx="40" cy="35" r="2" fill="currentColor"/>
      <ellipse cx="18" cy="41" rx="3" ry="1.6" fill="currentColor" opacity=".35"/><ellipse cx="46" cy="41" rx="3" ry="1.6" fill="currentColor" opacity=".35"/>`,
  },
  marshmallow: {
    label: "棉花糖",
    svg: `<g ${S}>
      <path d="M14 20c0-5 8-8 18-8s18 3 18 8v24c0 5-8 8-18 8s-18-3-18-8z"/>
      <path d="M14 20c0 5 8 8 18 8s18-3 18-8"/>
      <path d="M29 42q3 3 6 0"/></g>
      <circle cx="26" cy="37" r="2" fill="currentColor"/><circle cx="38" cy="37" r="2" fill="currentColor"/>`,
  },
});

export function stampSvg(id) {
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${STAMPS[id].svg}</svg>`;
}

export const MIN_STAMP_SCALE = 0.5;
export const MAX_STAMP_SCALE = 2.5;

/** 印章在信封上的 HTML。s 為大小倍率（舊信件沒有就是 1）。 */
export function stampMarkup(s, index = null) {
  const idx = index === null ? "" : ` data-index="${index}"`;
  const handle = index === null ? "" :
    `<span class="stamp-rotate" aria-hidden="true">↻</span><span class="stamp-handle" aria-hidden="true"></span>`;
  return `<span class="stamp"${idx} style="left:${s.x * 100}%;top:${s.y * 100}%;--r:${s.r || 0}deg;--s:${s.s || 1}">${stampSvg(s.id)}${handle}</span>`;
}
