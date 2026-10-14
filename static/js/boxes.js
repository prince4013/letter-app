// 抽屜（寄信者）與信箱（收信者）的鑰匙：存在這支手機，換手機時用鑰匙網址 /box/<key> 找回。

const STORE = { drawer: "letter-app:drawer", mailbox: "letter-app:mailbox" };

export function getBoxKey(kind) {
  try {
    return localStorage.getItem(STORE[kind]) || "";
  } catch (e) {
    return "";
  }
}

export function setBoxKey(kind, key) {
  try {
    localStorage.setItem(STORE[kind], key);
  } catch (e) { /* 無痕模式 */ }
}

/** 取得鑰匙，沒有就向伺服器建立一個。 */
export async function ensureBoxKey(kind) {
  const existing = getBoxKey(kind);
  if (existing) return existing;
  const resp = await fetch("/api/boxes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  });
  if (!resp.ok) throw new Error("建立失敗");
  const { key } = await resp.json();
  setBoxKey(kind, key);
  return key;
}

export async function addToBox(key, token) {
  const resp = await fetch(`/api/boxes/${encodeURIComponent(key)}/letters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "收藏失敗，請再試一次。");
  return data;
}
