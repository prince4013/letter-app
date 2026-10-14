import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

import requests
from flask import Flask, Response, abort, g, jsonify, render_template, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INSTANCE_DIR = os.path.join(BASE_DIR, "instance")
DB_PATH = os.path.join(INSTANCE_DIR, "letters.db")
LOCAL_STORAGE_DIR = os.path.join(INSTANCE_DIR, "letters")

# 有設定 DATABASE_URL（Supabase Postgres）就用 Postgres，
# 沒有的話退回本機 SQLite，方便在自己電腦上開發。
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
USE_POSTGRES = bool(DATABASE_URL)

if USE_POSTGRES:
    import psycopg2
    import psycopg2.extras

# Supabase Storage：信件圖片要永久保存，不能放在 Render 本機磁碟（重新部署會不見）。
# 從 Supabase 後台複製時常會帶到 /rest/v1，這裡一併去掉
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/").removesuffix("/rest/v1")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
SUPABASE_STORAGE_BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "letters").strip()
SUPABASE_STORAGE_ENABLED = bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)

LETTER_TTL_DAYS = int(os.environ.get("LETTER_TTL_DAYS", "14"))
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

# 與前端 static/js/paper.js 的樣式代號一致
PAPERS = {"cream", "blush", "night"}
ENVELOPES = {"blue", "pink", "cream", "peach", "yellow", "green"}
SEALS = {"red", "bronze", "silver"}
STAMPS = {"heart", "sun", "cat", "book", "meatball", "rabbit", "baozi", "marshmallow"}
MAX_STAMPS = 12
SENDER_MAX_LEN = 30

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES + 64 * 1024


# ---------- 資料庫 ----------

SCHEMA = """
CREATE TABLE IF NOT EXISTS letters (
    token TEXT PRIMARY KEY,
    sender_name TEXT NOT NULL,
    paper TEXT NOT NULL,
    envelope TEXT NOT NULL,
    image_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
)
"""

# 後來新增的欄位（舊資料庫啟動時自動補上）
NEW_COLUMNS = {
    "recipient_name": "TEXT NOT NULL DEFAULT ''",
    "stamps": "TEXT NOT NULL DEFAULT '[]'",
    "seal": "TEXT NOT NULL DEFAULT 'red'",
    "collectible": "INTEGER NOT NULL DEFAULT 0",   # 寄信者允許對方收進信箱
    "owner_key": "TEXT NOT NULL DEFAULT ''",       # 寄信者的抽屜鑰匙
}

# 抽屜（寄信者）與信箱（收信者）：不登入，靠不可猜的鑰匙網址 /box/<key>
BOX_SCHEMAS = [
    """CREATE TABLE IF NOT EXISTS boxes (
        key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS box_letters (
        box_key TEXT NOT NULL,
        token TEXT NOT NULL,
        added_at TEXT NOT NULL,
        read_at TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (box_key, token)
    )""",
]
BOX_KINDS = {"drawer", "mailbox"}
# 收藏的信永久保存
KEEP_FOREVER = "9999-12-31T00:00:00+00:00"


def get_db():
    if "db" not in g:
        if USE_POSTGRES:
            g.db = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
        else:
            os.makedirs(INSTANCE_DIR, exist_ok=True)
            g.db = sqlite3.connect(DB_PATH)
            g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def query(sql, params=(), one=False, commit=False):
    """SQL 一律用 ? 當佔位符號，Postgres 時自動換成 %s。"""
    if USE_POSTGRES:
        sql = sql.replace("?", "%s")
    db = get_db()
    cur = db.cursor()
    cur.execute(sql, params)
    rows = cur.fetchall() if cur.description else []
    if commit:
        db.commit()
    rows = [dict(r) for r in rows]
    return (rows[0] if rows else None) if one else rows


def init_db():
    with app.app_context():
        query(SCHEMA, commit=True)
        for sql in BOX_SCHEMAS:
            query(sql, commit=True)
        for col, decl in NEW_COLUMNS.items():
            try:
                query(f"ALTER TABLE letters ADD COLUMN {col} {decl}", commit=True)
            except Exception:
                get_db().rollback()  # 欄位已存在


def parse_stamps(raw):
    """印章：[{id, x, y, r, s}]，x/y 為信封上的相對位置（0~1），r 為旋轉角度（-180~180），s 為大小倍率。不合法回傳 None。"""
    try:
        items = json.loads(raw or "[]")
    except ValueError:
        return None
    if not isinstance(items, list) or len(items) > MAX_STAMPS:
        return None
    clean = []
    for it in items:
        if not isinstance(it, dict) or it.get("id") not in STAMPS:
            return None
        try:
            x, y, r = float(it.get("x")), float(it.get("y")), float(it.get("r", 0))
            size = float(it.get("s", 1))
        except (TypeError, ValueError):
            return None
        if not (0 <= x <= 1 and 0 <= y <= 1 and -180 <= r <= 180 and 0.5 <= size <= 2.5):
            return None
        clean.append({"id": it["id"], "x": round(x, 4), "y": round(y, 4), "r": round(r, 1), "s": round(size, 2)})
    return clean


# ---------- 圖片儲存 ----------

def _storage_headers(content_type=None):
    headers = {"apikey": SUPABASE_SERVICE_KEY}
    # 舊版 service_role key 是 JWT，要放在 Authorization；新版 sb_secret_ key 只能放 apikey
    if SUPABASE_SERVICE_KEY.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_KEY}"
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def save_image(path, data):
    if SUPABASE_STORAGE_ENABLED:
        url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_STORAGE_BUCKET}/{path}"
        resp = requests.post(url, headers=_storage_headers("image/png"), data=data, timeout=30)
        if not resp.ok:
            app.logger.error("Supabase Storage 回應 %s：%s", resp.status_code, resp.text[:500])
        resp.raise_for_status()
    else:
        full = os.path.join(LOCAL_STORAGE_DIR, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as f:
            f.write(data)


def load_image(path):
    if SUPABASE_STORAGE_ENABLED:
        url = f"{SUPABASE_URL}/storage/v1/object/authenticated/{SUPABASE_STORAGE_BUCKET}/{path}"
        resp = requests.get(url, headers=_storage_headers(), timeout=30)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.content
    full = os.path.join(LOCAL_STORAGE_DIR, path)
    if not os.path.exists(full):
        return None
    with open(full, "rb") as f:
        return f.read()


def delete_images(paths):
    if not paths:
        return
    if SUPABASE_STORAGE_ENABLED:
        url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_STORAGE_BUCKET}"
        requests.delete(url, headers=_storage_headers("application/json"),
                        json={"prefixes": paths}, timeout=30)
    else:
        for p in paths:
            full = os.path.join(LOCAL_STORAGE_DIR, p)
            if os.path.exists(full):
                os.remove(full)


# ---------- 信件 ----------

def now_utc():
    return datetime.now(timezone.utc)


def parse_time(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(value)


def purge_expired():
    """順手清掉過期的信（寄新信時呼叫，失敗也不影響寄信）。"""
    try:
        expired = query("SELECT token, image_path FROM letters WHERE expires_at < ?",
                        (now_utc().isoformat(),))
        if not expired:
            return
        delete_images([r["image_path"] for r in expired])
        for r in expired:
            query("DELETE FROM letters WHERE token = ?", (r["token"],), commit=True)
    except Exception:
        app.logger.exception("清除過期信件失敗")


def find_letter(token):
    """回傳 (letter, status)。status 為 ok / missing / expired。"""
    if not token or len(token) > 64:
        return None, "missing"
    letter = query("SELECT * FROM letters WHERE token = ?", (token,), one=True)
    if letter is None:
        return None, "missing"
    if parse_time(letter["expires_at"]) < now_utc():
        return letter, "expired"
    return letter, "ok"


# ---------- 頁面 ----------

@app.route("/")
def compose():
    return render_template("compose.html", ttl_days=LETTER_TTL_DAYS)


@app.route("/l/<token>")
def open_letter(token):
    # 頁面本身不查資料庫，盡快回應；信件內容由前端在「信件準備中」畫面時再抓。
    return render_template("open.html", token=token)


@app.route("/healthz")
def healthz():
    return "ok"


# ---------- API ----------

@app.route("/api/letters", methods=["POST"])
def create_letter():
    image = request.files.get("image")
    sender = (request.form.get("sender_name") or "").strip()
    recipient = (request.form.get("recipient_name") or "").strip()
    stamps = parse_stamps(request.form.get("stamps"))
    paper = request.form.get("paper", "")
    envelope = request.form.get("envelope", "")
    seal = request.form.get("seal") or "red"
    collectible = 1 if request.form.get("collectible") in ("1", "true", "on") else 0
    drawer = find_box(request.form.get("drawer_key"), "drawer")

    if image is None:
        return jsonify(error="缺少信件圖片"), 400
    if len(sender) > SENDER_MAX_LEN:
        return jsonify(error=f"署名最多 {SENDER_MAX_LEN} 個字"), 400
    if len(recipient) > SENDER_MAX_LEN:
        return jsonify(error=f"收件人最多 {SENDER_MAX_LEN} 個字"), 400
    if stamps is None:
        return jsonify(error="印章資料不正確"), 400
    if paper not in PAPERS or envelope not in ENVELOPES or seal not in SEALS:
        return jsonify(error="信紙或信封樣式不正確"), 400

    data = image.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        return jsonify(error="圖片太大了"), 413
    if not data.startswith(PNG_SIGNATURE):
        return jsonify(error="信件圖片必須是 PNG"), 400

    purge_expired()

    token = secrets.token_urlsafe(16)
    image_path = f"{token}.png"
    created = now_utc()
    expires = created + timedelta(days=LETTER_TTL_DAYS)

    try:
        save_image(image_path, data)
    except Exception:
        app.logger.exception("儲存信件圖片失敗")
        return jsonify(error="信件存檔失敗，請稍後再試"), 502

    query(
        "INSERT INTO letters (token, sender_name, recipient_name, stamps, paper, envelope, seal, image_path,"
        " created_at, expires_at, collectible, owner_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (token, sender, recipient, json.dumps(stamps), paper, envelope, seal, image_path,
         created.isoformat(), expires.isoformat(), collectible, drawer["key"] if drawer else ""),
        commit=True,
    )
    if drawer:
        add_to_box(drawer["key"], token)
    return jsonify(token=token, url=request.host_url.rstrip("/") + f"/l/{token}",
                   expires_at=expires.isoformat()), 201


@app.route("/api/letters/<token>")
def get_letter(token):
    letter, status = find_letter(token)
    if status == "missing":
        return jsonify(error="找不到這封信"), 404
    if status == "expired":
        return jsonify(error="這封信已超過保存期限"), 410
    return jsonify(
        sender_name=letter["sender_name"],
        recipient_name=letter.get("recipient_name") or "",
        stamps=json.loads(letter.get("stamps") or "[]"),
        paper=letter["paper"],
        envelope=letter["envelope"],
        seal=letter.get("seal") or "red",
        collectible=bool(letter.get("collectible")),
        created_at=parse_time(letter["created_at"]).isoformat(),
        expires_at=parse_time(letter["expires_at"]).isoformat(),
        image_url=f"/api/letters/{token}.png",
    )


@app.route("/api/letters/<token>.png")
def get_letter_image(token):
    letter, status = find_letter(token)
    if status != "ok":
        abort(404 if status == "missing" else 410)
    data = load_image(letter["image_path"])
    if data is None:
        abort(404)
    resp = Response(data, mimetype="image/png")
    resp.headers["Cache-Control"] = "private, max-age=86400"
    return resp


# ---------- 抽屜與信箱 ----------

def find_box(key, kind=None):
    if not key or len(key) > 64:
        return None
    box = query("SELECT * FROM boxes WHERE key = ?", (key,), one=True)
    if box is None or (kind and box["kind"] != kind):
        return None
    return box


def add_to_box(box_key, token):
    """把信放進抽屜或信箱；收藏的信改為永久保存。"""
    exists = query("SELECT 1 AS x FROM box_letters WHERE box_key = ? AND token = ?",
                   (box_key, token), one=True)
    if not exists:
        query("INSERT INTO box_letters (box_key, token, added_at) VALUES (?, ?, ?)",
              (box_key, token, now_utc().isoformat()), commit=True)
    query("UPDATE letters SET expires_at = ? WHERE token = ?", (KEEP_FOREVER, token), commit=True)


def token_from(value):
    """接受完整網址或 token 本身。"""
    value = (value or "").strip().rstrip("/")
    if "/l/" in value:
        value = value.rsplit("/l/", 1)[1]
    return value.split("?")[0].split("#")[0]


@app.route("/box/<key>")
def box_page(key):
    return render_template("box.html", key=key)


@app.route("/api/boxes", methods=["POST"])
def create_box():
    kind = (request.get_json(silent=True) or {}).get("kind")
    if kind not in BOX_KINDS:
        return jsonify(error="種類不正確"), 400
    key = secrets.token_urlsafe(16)
    query("INSERT INTO boxes (key, kind, created_at) VALUES (?, ?, ?)",
          (key, kind, now_utc().isoformat()), commit=True)
    return jsonify(key=key, kind=kind, url=request.host_url.rstrip("/") + f"/box/{key}"), 201


@app.route("/api/boxes/<key>")
def get_box(key):
    box = find_box(key)
    if box is None:
        return jsonify(error="找不到這個抽屜或信箱"), 404
    rows = query(
        "SELECT l.token, l.recipient_name, l.envelope, l.seal, l.stamps, l.created_at, l.collectible,"
        " l.owner_key, b.added_at, b.read_at FROM box_letters b JOIN letters l ON l.token = b.token"
        " WHERE b.box_key = ? ORDER BY l.created_at DESC", (key,))
    letters = [{
        "token": r["token"],
        "recipient_name": r["recipient_name"] or "",
        "envelope": r["envelope"],
        "seal": r["seal"] or "red",
        "stamps": json.loads(r["stamps"] or "[]"),
        "created_at": parse_time(r["created_at"]).isoformat(),
        "collectible": bool(r["collectible"]),
        "mine": r["owner_key"] == key,
        "read": bool(r["read_at"]),
    } for r in rows]
    return jsonify(kind=box["kind"], letters=letters,
                   url=request.host_url.rstrip("/") + f"/box/{key}")


@app.route("/api/boxes/<key>/letters", methods=["POST"])
def add_box_letter(key):
    box = find_box(key)
    if box is None:
        return jsonify(error="找不到這個抽屜或信箱"), 404
    token = token_from((request.get_json(silent=True) or {}).get("token"))
    letter, status = find_letter(token)
    if status == "missing":
        return jsonify(error="找不到這封信，請確認網址"), 404
    if status == "expired":
        return jsonify(error="這封信已超過保存期限"), 410
    if box["kind"] == "drawer":
        # 舊信沒有主人時，第一個收進抽屜的人就是寄信者
        if letter.get("owner_key") and letter["owner_key"] != key:
            return jsonify(error="這封信不是從你的抽屜寄出的"), 403
        if not letter.get("owner_key"):
            query("UPDATE letters SET owner_key = ? WHERE token = ?", (key, token), commit=True)
    elif not letter.get("collectible"):
        return jsonify(error="寄信的人沒有開放這封信收進信箱"), 403
    add_to_box(key, token)
    return jsonify(ok=True, token=token)


@app.route("/api/boxes/<key>/letters/<token>/read", methods=["POST"])
def mark_read(key, token):
    query("UPDATE box_letters SET read_at = ? WHERE box_key = ? AND token = ? AND read_at = ''",
          (now_utc().isoformat(), key, token), commit=True)
    return jsonify(ok=True)


@app.route("/api/boxes/<key>/letters/<token>/collectible", methods=["POST"])
def set_collectible(key, token):
    letter, status = find_letter(token)
    if status == "missing" or find_box(key, "drawer") is None or letter.get("owner_key") != key:
        return jsonify(error="只有寄信的人可以修改"), 403
    allow = 1 if (request.get_json(silent=True) or {}).get("allow") else 0
    query("UPDATE letters SET collectible = ? WHERE token = ?", (allow, token), commit=True)
    return jsonify(ok=True, collectible=bool(allow))


@app.after_request
def security_headers(resp):
    # 信件網址就是鑰匙，不要讓它經由 Referer 外流，也不要被搜尋引擎收錄。
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault("X-Robots-Tag", "noindex, nofollow")
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    return resp


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5051")), debug=True)
