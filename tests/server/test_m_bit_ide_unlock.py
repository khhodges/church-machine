import importlib


app_module = importlib.import_module("server.app")


def test_m_bit_unlock_requires_exact_secret_and_persists(monkeypatch):
    monkeypatch.setenv("M_BIT_IDE_SECRET", "Exact-Secret")
    client = app_module.app.test_client()

    assert client.get("/api/m-bit-ide-access").get_json() == {"unlocked": False}
    wrong = client.post("/api/m-bit-ide-access", json={"secret": "exact-secret"})
    assert wrong.status_code == 403
    assert wrong.get_json()["unlocked"] is False

    correct = client.post("/api/m-bit-ide-access", json={"secret": "Exact-Secret"})
    assert correct.status_code == 200
    assert correct.get_json() == {"unlocked": True}
    assert "HttpOnly" in correct.headers["Set-Cookie"]
    assert "SameSite=Strict" in correct.headers["Set-Cookie"]
    assert client.get("/api/m-bit-ide-access").get_json() == {"unlocked": True}


def test_m_bit_unlock_cookie_is_revoked_when_secret_changes(monkeypatch):
    monkeypatch.setenv("M_BIT_IDE_SECRET", "first")
    client = app_module.app.test_client()
    assert client.post("/api/m-bit-ide-access", json={"secret": "first"}).status_code == 200

    monkeypatch.setenv("M_BIT_IDE_SECRET", "second")
    assert client.get("/api/m-bit-ide-access").get_json() == {"unlocked": False}