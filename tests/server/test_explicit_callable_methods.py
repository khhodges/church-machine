from test_idx1_save_endpoint import client, isolated_lumps, save
import pytest
import struct
from server.symbolic_binding import embedded_api


@pytest.mark.parametrize("language", ["assembly", "javascript"])
def test_declared_methods_survive_signed_save(client, isolated_lumps, language):
    source = """abstraction test.Declared {
capabilities { SELF E }
method Stash() {
IADD DR1, DR0, #999
RETURN
}
method Reveal() {
RETURN
}
}"""
    response = client.post("/api/compile", json={"source": source, "language": language, "tier": 2})
    compiled = response.get_json()
    assert response.status_code == 200 and compiled["ok"], compiled
    assert [m["name"] for m in compiled["methods"]] == ["Stash", "Reveal"]
    saved, _ = save(client, {"binary": compiled["words"], "metadata": {
        "abstraction": "test.Declared", "language": compiled["language"],
        "content_type": "code", "artifact_only": True,
        "capabilities": compiled["capabilities"],
        "original_source": source, "submitted_source": source,
    }})
    raw = (isolated_lumps / saved["filename"]).read_bytes()
    words = list(struct.unpack(f">{len(raw)//4}I", raw))
    assert {m["name"]: m["index"] for m in embedded_api(words)["methods"]} == {"Stash": 0, "Reveal": 1}


def test_raw_callable_rejected_at_compile(client, isolated_lumps):
    result = client.post("/api/compile", json={"language": "assembly", "source":
        "; Abstraction: test.Raw\ncapabilities {\nSELF E\n}\nBRANCH stash\nstash:\nRETURN"}).get_json()
    assert not result["ok"], result
    assert "explicit method declarations" in str(result)
