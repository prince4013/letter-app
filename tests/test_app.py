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
        "seal": "silver",
        "recipient_name": "晴子",
        "stamps": '[{"id": "cat", "x": 0.8, "y": 0.2, "r": -120, "s": 1.6}]',
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
    assert meta["seal"] == "silver"
    assert meta["stamps"] == [{"id": "cat", "x": 0.8, "y": 0.2, "r": -120.0, "s": 1.6}]

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
    ({"seal": "gold"}, 400),
    ({"stamps": '[{"id": "dragon", "x": 0.5, "y": 0.5}]'}, 400),
    ({"stamps": '[{"id": "sun", "x": 2, "y": 0.5}]'}, 400),
    ({"stamps": "not json"}, 400),
    ({"stamps": '[{"id": "sun", "x": 0.5, "y": 0.5, "r": 200}]'}, 400),
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


# ---------- 抽屜與信箱 ----------

def new_box(client, kind):
    resp = client.post("/api/boxes", json={"kind": kind})
    assert resp.status_code == 201
    return resp.get_json()["key"]


def test_send_with_drawer_keeps_letter_forever(client):
    drawer = new_box(client, "drawer")
    token = send(client, drawer_key=drawer).get_json()["token"]
    box = client.get(f"/api/boxes/{drawer}").get_json()
    assert box["kind"] == "drawer"
    assert [l["token"] for l in box["letters"]] == [token]
    assert box["letters"][0]["mine"] is True
    assert client.get(f"/api/letters/{token}").get_json()["expires_at"].startswith("9999")


def test_mailbox_needs_permission_from_sender(client):
    drawer = new_box(client, "drawer")
    mailbox = new_box(client, "mailbox")
    token = send(client, drawer_key=drawer).get_json()["token"]
    url = f"http://localhost/l/{token}"
    assert client.post(f"/api/boxes/{mailbox}/letters", json={"token": url}).status_code == 403
    # 收信者不能自己打開開關
    assert client.post(f"/api/boxes/{mailbox}/letters/{token}/collectible", json={"allow": True}).status_code == 403
    assert client.post(f"/api/boxes/{drawer}/letters/{token}/collectible", json={"allow": True}).status_code == 200
    assert client.post(f"/api/boxes/{mailbox}/letters", json={"token": url}).status_code == 200
    box = client.get(f"/api/boxes/{mailbox}").get_json()
    assert box["letters"][0]["read"] is False
    client.post(f"/api/boxes/{mailbox}/letters/{token}/read")
    assert client.get(f"/api/boxes/{mailbox}").get_json()["letters"][0]["read"] is True


def test_collectible_at_send_time(client):
    mailbox = new_box(client, "mailbox")
    token = send(client, collectible="1").get_json()["token"]
    assert client.get(f"/api/letters/{token}").get_json()["collectible"] is True
    assert client.post(f"/api/boxes/{mailbox}/letters", json={"token": token}).status_code == 200


def test_old_letter_claimed_by_first_drawer(client):
    token = send(client).get_json()["token"]  # 抽屜功能上線前寄的信
    mine = new_box(client, "drawer")
    other = new_box(client, "drawer")
    assert client.post(f"/api/boxes/{mine}/letters", json={"token": token}).status_code == 200
    assert client.post(f"/api/boxes/{other}/letters", json={"token": token}).status_code == 403
    assert client.post(f"/api/boxes/{mine}/letters/{token}/collectible", json={"allow": True}).status_code == 200


def test_box_errors(client):
    assert client.get("/api/boxes/nope").status_code == 404
    assert client.post("/api/boxes", json={"kind": "safe"}).status_code == 400
    mailbox = new_box(client, "mailbox")
    assert client.post(f"/api/boxes/{mailbox}/letters", json={"token": "missing"}).status_code == 404
