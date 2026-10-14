// 抽屜／信箱頁：列出收藏的信，可貼網址收進來；抽屜裡可以逐封開放對方收進信箱。

import { addToBox, setBoxKey } from "./boxes.js";
import { envelopeLabels, envelopeMarkup } from "./paper.js";
import { stampMarkup } from "./stamps.js";

const $ = (id) => document.getElementById(id);
const key = $("root").dataset.key;
let box = null;
let filter = "all";

const TEXT = {
  drawer: { title: "我的抽屜", name: "抽屜", sub: "寄出去的信都收在這裡。打開「允許收進信箱」，對方就能把信收進他的信箱。", empty: "抽屜還是空的，寄出第一封信吧。" },
  mailbox: { title: "我的信箱", name: "信箱", sub: "收進來的信會一直留著，想念的時候就打開看看。", empty: "信箱還是空的。拆信後按「收進信箱」，信就會出現在這裡。" },
};

function fmt(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function render() {
  const t = TEXT[box.kind];
  const unread = box.letters.filter((l) => !l.read).length;
  if (box.kind === "mailbox") {
    $("tabs").innerHTML = `
      <button type="button" data-f="all" class="${filter === "all" ? "on" : ""}">全部 ${box.letters.length}</button>
      <button type="button" data-f="unread" class="${filter === "unread" ? "on" : ""}">未讀 ${unread}</button>`;
  }
  const list = filter === "unread" ? box.letters.filter((l) => !l.read) : box.letters;
  $("grid").innerHTML = list.map((l) => {
    const front = envelopeLabels(l.recipient_name) +
      l.stamps.map((s) => stampMarkup(s)).join("") + '<span class="seal"></span>';
    const status = box.kind === "mailbox"
      ? (l.read ? "<span>已讀</span>" : '<span class="new">● 未讀</span>')
      : "";
    const toggle = box.kind === "drawer" && l.mine ? `
      <label class="allow"><input type="checkbox" data-allow="${l.token}" ${l.collectible ? "checked" : ""}>允許收進信箱</label>` : "";
    return `<div class="box-item">
      <a href="/l/${encodeURIComponent(l.token)}?box=${encodeURIComponent(key)}">${envelopeMarkup(l.envelope, "", front, l.seal)}</a>
      <div class="box-meta"><span>${fmt(l.created_at)}</span>${status}</div>${toggle}
    </div>`;
  }).join("");
  $("empty").textContent = t.empty;
  $("empty").classList.toggle("hidden", list.length > 0);
}

async function load() {
  try {
    const resp = await fetch(`/api/boxes/${encodeURIComponent(key)}`);
    if (!resp.ok) throw new Error();
    box = await resp.json();
  } catch (e) {
    $("loading").classList.add("hidden");
    $("error").classList.remove("hidden");
    return;
  }
  // 從鑰匙網址打開，就記在這支手機上（換手機找回）
  setBoxKey(box.kind, key);
  const t = TEXT[box.kind];
  document.title = t.title;
  $("box-title").textContent = t.title;
  $("box-sub").textContent = t.sub;
  $("key-name").textContent = t.name;
  $("key-url").value = box.url;
  $("add-url").placeholder = box.kind === "drawer" ? "貼上你寄過的信件網址" : "貼上收到的信件網址";
  render();
  $("loading").classList.add("hidden");
  $("content").classList.remove("hidden");
}

$("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-f]");
  if (!btn) return;
  filter = btn.dataset.f;
  render();
});

$("grid").addEventListener("change", async (e) => {
  const cb = e.target.closest("[data-allow]");
  if (!cb) return;
  cb.disabled = true;
  try {
    const resp = await fetch(`/api/boxes/${encodeURIComponent(key)}/letters/${encodeURIComponent(cb.dataset.allow)}/collectible`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allow: cb.checked }),
    });
    if (!resp.ok) throw new Error();
    box.letters.find((l) => l.token === cb.dataset.allow).collectible = cb.checked;
  } catch (err) {
    cb.checked = !cb.checked;
  } finally {
    cb.disabled = false;
  }
});

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = $("add-url").value.trim();
  if (!value) return;
  $("add-error").classList.add("hidden");
  try {
    await addToBox(key, value);
    $("add-url").value = "";
    await load();
  } catch (err) {
    $("add-error").textContent = err.message;
    $("add-error").classList.remove("hidden");
  }
});

$("copy-key").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("key-url").value);
  } catch (e) {
    $("key-url").select();
    document.execCommand("copy");
  }
  $("copy-key").textContent = "已複製";
  setTimeout(() => { $("copy-key").textContent = "複製"; }, 1800);
});

load();
