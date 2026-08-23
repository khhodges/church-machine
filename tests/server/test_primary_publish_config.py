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


def test_root_publish_runs_ide_and_builds_introduction():
    config = tomllib.loads((ROOT / ".replit").read_text(encoding="utf-8"))
    deployment = config["deployment"]

    assert deployment["deploymentTarget"] == "autoscale"
    assert "server.app:app" in deployment["run"]

    build_text = " ".join(deployment["build"])
    assert "requirements.txt" in build_text
    assert "build:production" in build_text