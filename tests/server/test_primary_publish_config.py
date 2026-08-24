"""Regression checks for the primary Church Machine IDE publish target."""

from pathlib import Path
import tomllib


ROOT = Path(__file__).resolve().parents[2]


def test_introduction_artifact_cannot_replace_production_root():
    """The deck is built by the root publish and served by Flask.

    Giving the nested artifact its own production service makes Replit enter
    static artifact mode and mount the deck at ``/``, replacing the IDE.
    """
    manifest_path = (
        ROOT
        / "artifacts"
        / "church-machine-ide-introduction"
        / ".replit-artifact"
        / "artifact.toml"
    )
    manifest = tomllib.loads(manifest_path.read_text(encoding="utf-8"))

    for service in manifest.get("services", []):
        assert "production" not in service, (
            "The Introduction artifact must remain development-only. "
            "Build it from the root deployment so the Flask IDE owns '/'."
        )


def test_root_publish_uses_an_always_on_vm_for_stateful_wukong_relay():
    """Prevent process-local Wukong incident state from being republished on Autoscale.

    The relay intentionally keeps its command queue, bridge timeline, fault
    correlation records, and Last Accepted Fault in process memory. Autoscale
    instances neither share that state nor guarantee a continuously live
    process, so changing this target back would make fault recovery unsafe.
    """
    config = tomllib.loads((ROOT / ".replit").read_text(encoding="utf-8"))
    deployment = config["deployment"]

    assert deployment["deploymentTarget"] == "vm", (
        "The process-local Wukong relay requires a single always-on VM. "
        "Implement shared durable coordination before using Autoscale."
    )
    assert "server.app:app" in deployment["run"]

    build_text = " ".join(deployment["build"])
    assert "requirements.txt" in build_text
    assert "build:production" in build_text