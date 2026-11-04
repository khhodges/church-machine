"""Regression checks for the primary Church Machine IDE publish target."""

from pathlib import Path
import json
import tomllib
import pytest


ROOT = Path(__file__).resolve().parents[2]


def test_root_publish_uses_matching_npm_lock_and_explicit_artifact_directory():
    """The root npm install must not be followed by an unrelated pnpm lock."""
    package = json.loads((ROOT / "package.json").read_text())
    locked = json.loads((ROOT / "package-lock.json").read_text())["packages"][""]
    for section in ("dependencies", "devDependencies", "optionalDependencies"):
        assert package.get(section, {}) == locked.get(section, {}), section
    deployment = tomllib.loads((ROOT / ".replit").read_text())["deployment"]
    build = " ".join(deployment["build"])
    assert "npm ci" in build
    assert "npm --prefix artifacts/church-machine-ide-introduction run build:production" in build
    assert "npm --prefix artifacts/development-image run build:production" in build
    assert "pnpm" not in build


@pytest.mark.parametrize("manifest_path", sorted(
    (ROOT / "artifacts").glob("*/.replit-artifact/artifact.toml")
))
def test_nested_artifact_cannot_replace_production_root(manifest_path):
    """The deck is built by the root publish and served by Flask.

    Giving the nested artifact its own production service makes Replit enter
    static artifact mode and mount the deck at ``/``, replacing the IDE.
    """
    manifest = tomllib.loads(manifest_path.read_text(encoding="utf-8"))

    for service in manifest.get("services", []):
        assert "production" not in service, (
            f"{manifest_path} must remain development-only. "
            "Build it from the root deployment so the Flask IDE owns '/'."
        )


def test_development_image_production_build_has_explicit_base_and_port():
    package = json.loads((ROOT / "artifacts/development-image/package.json").read_text())
    build = package["scripts"]["build:production"]
    assert "BASE_PATH=/development-image/" in build
    assert "PORT=22382" in build
    assert "vite build" in build


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