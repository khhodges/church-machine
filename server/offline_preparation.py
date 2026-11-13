"""Trusted offline preparation without live-server initialization.

Use ``with offline_backend() as backend: build_saved_design(backend, id)``.
The compiler and source verification are the same implementations as HTTP;
only startup and writable paths differ. No alternate signing key is supplied.
"""
from contextlib import contextmanager
import hashlib
import importlib.util
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
import uuid


def _inventory(root):
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in root.rglob("*") if path.is_file()}


@contextmanager
def offline_backend(lumps_directory=None):
    """Yield a private backend; reject inputs changed while preparing.

    All writes (including lock files and any recovery) stay in disposable
    storage. Callers must use results only after this context exits cleanly.
    """
    server = Path(__file__).resolve().parent
    source = Path(lumps_directory) if lumps_directory is not None else server / "lumps"
    before = _inventory(source)
    with TemporaryDirectory(prefix="church-offline-") as temporary:
        root = Path(temporary)
        private = root / "lumps"
        shutil.copytree(source, private)
        if _inventory(private) != before or _inventory(source) != before:
            raise ValueError("Preparation inputs changed while copying; retry.")
        name = "server._offline_backend_" + uuid.uuid4().hex
        spec = importlib.util.spec_from_file_location(name, server / "app.py")
        module = importlib.util.module_from_spec(spec)
        module._OFFLINE_PREPARATION = True
        sys.modules[name] = module
        try:
            spec.loader.exec_module(module)
            module.LUMPS_DIR = str(private)
            module.LUMPS_MANIFEST_PATH = str(private / "manifest.json")
            module.NS_STATE_PATH = str(private / "ns-state.json")
            module.BOOT_IMAGE_PATH = str(private / "boot-image.bin")
            module.BOOT_IMAGE_PROVENANCE_PATH = str(private / "boot-image.provenance.json")
            module.BOOT_CONFIG_PATH = str(root / "boot-config.json")
            module._BUILD_SNAPSHOTS_DIR = str(root / "build-snapshots")
            # Offline work must never recover an interrupted live transaction.
            # The copied saved documents, not a recovery proposal, are authority.
            module._namespace_commit_guard = _no_recovery
            yield module
            if _inventory(source) != before:
                raise ValueError("Preparation inputs changed; discard the result and retry.")
        finally:
            sys.modules.pop(name, None)


@contextmanager
def _no_recovery():
    yield


def prepare_saved_design(identifier, *, lumps_directory=None):
    """Prepare a saved design offline; return only after input stability checks."""
    from server.development_image_prepare import build_saved_design
    with offline_backend(lumps_directory) as backend:
        result = build_saved_design(backend, identifier)
    return result
