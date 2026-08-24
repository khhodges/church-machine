"""Regression coverage for durable, proof-bound Bank recovery envelopes."""

import hashlib
import json
import uuid

import server.app as app_module


def _state(gt=0x4A001234, proof=(11, 22, 33, 44)):
    policy = json.dumps({
        "object": "Bank.Lockbox.9",
        "owner": True,
        "methods": ["DEPOSIT", "WITHDRAW", "INSPECT", "REVOKE", "OBTAINPASSKEY"],
    }, separators=(",", ":"))
    material = (
        f"ChurchMachine.BankCredential.v1|{gt}|"
        f"{','.join(str(word) for word in proof)}|{policy}"
    )
    return {
        "version": 1,
        "lockboxId": 9,
        "credential": {
            "gt": gt,
            "proofCommitment": hashlib.sha256(material.encode("utf-8")).hexdigest(),
            "policy": policy,
        },
        "cipher": {
            "algorithm": "CM-BANK-RECOVERY-SHA256-STREAM-v1",
            "nonce": "00" * 16,
            "ciphertext": "ab" * 32,
            "tag": "cd" * 32,
        },
    }


def _delete_row(vault_id):
    with app_module.app.app_context():
        app_module.db.session.execute(
            app_module._sa_text("DELETE FROM bank_custody WHERE vault_id = :vault_id"),
            {"vault_id": vault_id},
        )
        app_module.db.session.commit()


def test_bank_custody_vault_protects_and_revokes_recovery_state():
    app_module.app.config["TESTING"] = True
    vault_id = "bankrecovery_" + uuid.uuid4().hex
    state = _state()
    original_proof = [11, 22, 33, 44]
    try:
        with app_module.app.test_client() as client:
            save = client.post("/api/bank-custody", json={"vault_id": vault_id, "state": state})
            assert save.status_code == 200
            assert save.get_json()["revision"] == 1
            vault_id = save.get_json()["vault_id"]
            proof_smuggling = dict(state)
            proof_smuggling["unrecognised"] = {"proof": original_proof}
            rejected_smuggling = client.post("/api/bank-custody", json={
                "vault_id": "bankschema_" + uuid.uuid4().hex,
                "state": proof_smuggling,
            })
            assert rejected_smuggling.status_code == 400

            # Only authenticated server ciphertext reaches persistent storage;
            # the raw proof supplied to recovery is absent.
            with app_module.app.app_context():
                row = app_module.db.session.execute(app_module._sa_text(
                    "SELECT protected_state FROM bank_custody WHERE vault_id = :vault_id"
                ), {"vault_id": vault_id}).mappings().one()
            assert json.dumps(original_proof) not in row["protected_state"]
            assert json.dumps(state, sort_keys=True) not in row["protected_state"]

            wrong = client.post(f"/api/bank-custody/{vault_id}/recover", json={
                "gt": state["credential"]["gt"], "proof": [12, 22, 33, 44],
            })
            assert wrong.status_code == 403

            recovered = client.post(f"/api/bank-custody/{vault_id}/recover", json={
                "gt": state["credential"]["gt"], "proof": original_proof,
            })
            assert recovered.status_code == 200
            payload = recovered.get_json()
            assert payload["state"] == state
            assert isinstance(payload["recovery_grant"], str) and len(payload["recovery_grant"]) >= 16
            assert "proof" not in json.dumps(payload["state"]).lower().replace("proofcommitment", "")
            replay = client.post(f"/api/bank-custody/{vault_id}/recover", json={
                "gt": state["credential"]["gt"], "proof": original_proof,
            })
            assert replay.status_code == 409

            revoked = client.post(f"/api/bank-custody/{vault_id}/revoke", json={
                "gt": state["credential"]["gt"], "proof": original_proof,
            })
            assert revoked.status_code == 200
            assert revoked.get_json()["revoked"] is True

            rejected = client.post(f"/api/bank-custody/{vault_id}/recover", json={
                "gt": state["credential"]["gt"], "proof": original_proof,
            })
            assert rejected.status_code == 409
    finally:
        _delete_row(vault_id)


def test_corrupted_server_record_is_rejected_without_deleting_it():
    app_module.app.config["TESTING"] = True
    vault_id = "bankcorrupt_" + uuid.uuid4().hex
    state = _state(gt=0x4A005678, proof=(101, 202, 303, 404))
    try:
        with app_module.app.test_client() as client:
            saved = client.post("/api/bank-custody", json={"vault_id": vault_id, "state": state})
            assert saved.status_code == 200
            vault_id = saved.get_json()["vault_id"]
            with app_module.app.app_context():
                app_module.db.session.execute(app_module._sa_text("""
                    UPDATE bank_custody SET protected_state = 'not-an-authenticated-record'
                    WHERE vault_id = :vault_id
                """), {"vault_id": vault_id})
                app_module.db.session.commit()

            rejected = client.post(f"/api/bank-custody/{vault_id}/recover", json={
                "gt": state["credential"]["gt"], "proof": [101, 202, 303, 404],
            })
            assert rejected.status_code == 409
            with app_module.app.app_context():
                row = app_module.db.session.execute(app_module._sa_text(
                    "SELECT protected_state FROM bank_custody WHERE vault_id = :vault_id"
                ), {"vault_id": vault_id}).mappings().one()
            assert row["protected_state"] == "not-an-authenticated-record"
    finally:
        _delete_row(vault_id)