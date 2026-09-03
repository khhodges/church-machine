import importlib


app_module = importlib.import_module("server.app")


def test_m_bit_unlock_requires_exact_secret_and_never_persists(monkeypatch):
    monkeypatch.setenv("M_BIT_IDE_SECRET", "Exact-Secret")
    client = app_module.app.test_client()

    assert client.get("/api/m-bit-ide-access").get_json() == {"unlocked": False}
    wrong = client.post("/api/m-bit-ide-access", json={"secret": "exact-secret"})
    assert wrong.status_code == 403
    assert wrong.get_json()["unlocked"] is False

    correct = client.post("/api/m-bit-ide-access", json={"secret": "Exact-Secret"})
    assert correct.status_code == 200
    assert correct.get_json() == {"unlocked": True}
    assert "Set-Cookie" not in correct.headers
    assert client.get("/api/m-bit-ide-access").get_json() == {"unlocked": False}


def test_m_bit_unlock_stays_locked_after_secret_changes(monkeypatch):
    monkeypatch.setenv("M_BIT_IDE_SECRET", "first")
    client = app_module.app.test_client()
    assert client.post("/api/m-bit-ide-access", json={"secret": "first"}).status_code == 200

    monkeypatch.setenv("M_BIT_IDE_SECRET", "second")
    assert client.get("/api/m-bit-ide-access").get_json() == {"unlocked": False}