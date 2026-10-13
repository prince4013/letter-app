import io
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def client(tmp_path, monkeypatch):
    for key in ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
        monkeypatch.delenv(key, raising=False)
    import app as app_module
    monkeypatch.setattr(app_module, "INSTANCE_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "DB_PATH", str(tmp_path / "letters.db"))
    monkeypatch.setattr(app_module, "LOCAL_STORAGE_DIR", str(tmp_path / "letters"))
    app_module.init_db()
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        c.app_module = app_module
        yield c


def send(client, **overrides):
    data = {
        "image": (io.BytesIO(PNG), "letter.png"),
        "sender_name": "Lucas",
        "paper": "cream",
        "envelope": "pink",
        "recipient_name": "晴子",
        "stamps": '[{"id": "cat", "x": 0.8, "y": 0.2, "r": -8, "s": 1.6}]',
    }
    data.update(overrides)
    return client.post("/api/letters", data=data, content_type="multipart/form-data")


def test_send_and_open(client):
    resp = send(client)
    assert resp.status_code == 201
    body = resp.get_json()
    token = body["token"]
    assert len(token) >= 20
    assert body["url"].endswith(f"/l/{token}")

    meta = client.get(f"/api/letters/{token}").get_json()
    assert meta["sender_name"] == "Lucas"
    assert meta["recipient_name"] == "晴子"
    assert meta["envelope"] == "pink"
    assert meta["stamps"] == [{"id": "cat", "x": 0.8, "y": 0.2, "r": -8.0, "s": 1.6}]

    img = client.get(meta["image_url"])
    assert img.status_code == 200
    assert img.mimetype == "image/png"
    assert img.data == PNG

    page = client.get(f"/l/{token}")
    assert page.status_code == 200
    assert page.headers["Referrer-Policy"] == "no-referrer"


def test_tokens_are_unique(client):
    tokens = {send(client).get_json()["token"] for _ in range(5)}
    assert len(tokens) == 5


@pytest.mark.parametrize("overrides, status", [
    ({"sender_name": "字" * 31}, 400),
    ({"paper": "rainbow"}, 400),
    ({"envelope": "box"}, 400),
    ({"stamps": '[{"id": "dragon", "x": 0.5, "y": 0.5}]'}, 400),
    ({"stamps": '[{"id": "sun", "x": 2, "y": 0.5}]'}, 400),
    ({"stamps": "not json"}, 400),
    ({"stamps": '[{"id": "sun", "x": 0.5, "y": 0.5, "s": 9}]'}, 400),
    ({"image": (io.BytesIO(b"GIF89a....."), "x.png")}, 400),
])
def test_rejects_bad_input(client, overrides, status):
    assert send(client, **overrides).status_code == status


def test_unknown_letter(client):
    assert client.get("/api/letters/nope").status_code == 404
    assert client.get("/api/letters/nope.png").status_code == 404


def test_expired_letter(client):
    token = send(client).get_json()["token"]
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    with client.app_module.app.app_context():
        client.app_module.query("UPDATE letters SET expires_at = ? WHERE token = ?", (past, token), commit=True)
    assert client.get(f"/api/letters/{token}").status_code == 410
    assert client.get(f"/api/letters/{token}.png").status_code == 410

    # 寄下一封時會清掉過期的信與圖片
    send(client)
    assert client.get(f"/api/letters/{token}").status_code == 404
    assert not os.path.exists(os.path.join(client.app_module.LOCAL_STORAGE_DIR, f"{token}.png"))


def test_sender_is_optional(client):
    token = send(client, sender_name="", stamps='[{"id": "baozi", "x": 0.5, "y": 0.5}]').get_json()["token"]
    meta = client.get(f"/api/letters/{token}").get_json()
    assert meta["sender_name"] == ""
    assert meta["stamps"][0]["id"] == "baozi"
