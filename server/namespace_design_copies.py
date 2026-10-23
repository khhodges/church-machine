"""Independent named copies of saved designs; never bind or activate."""
import copy
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import uuid

from server.namespace_design_v1 import DesignStore, digest


def copies_root(legacy):
    return Path(legacy).parent / "design-drafts" / "copies"


def catalog(legacy):
    root = copies_root(legacy)
    return sorted([json.loads(path.read_text()) for path in root.glob("*/metadata.json")
                   if re.fullmatch(r"[a-f0-9]{32}", path.parent.name)],
                  key=lambda item: item["name"].casefold())


def resolve_store(profile, identifier, lumps, legacy):
    if profile not in ("ascending", "phase1"):
        raise ValueError("Unknown Namespace design profile")
    if identifier:
        if not re.fullmatch(r"[a-f0-9]{32}", identifier):
            raise ValueError("Invalid Namespace copy identifier")
        folder = copies_root(legacy) / identifier
        metadata = json.loads((folder / "metadata.json").read_text())
        if metadata["profile"] != profile:
            raise ValueError("Namespace copy belongs to a different profile")
        path = folder / "design.json"
        if not path.is_file():
            raise ValueError("Saved Namespace copy is missing")
    else:
        path = Path(legacy).parent / "design-drafts" / (
            "phase1.json" if profile == "phase1" else "ascending-v1.json")
    return DesignStore(path, lumps, legacy, phase1=profile == "phase1")


def duplicate(payload, lumps, legacy):
    if not isinstance(payload, dict) or set(payload) != {
            "profile", "sourceId", "fingerprint", "name"}:
        raise ValueError("Expected source Namespace, saved fingerprint and new name")
    name = payload["name"]
    if (not isinstance(name, str) or not name.strip() or len(name.strip()) > 128
            or any(ord(c) < 32 for c in name)):
        raise ValueError("Enter a Namespace name of 1–128 characters without control characters")
    name = name.strip()
    if name.casefold() == "original":
        raise ValueError("Choose a name other than Original")
    source = resolve_store(payload["profile"], payload["sourceId"], lumps, legacy)
    if not source.path.is_file():
        raise ValueError("Save the source Namespace before duplicating it")
    root = copies_root(legacy)
    root.mkdir(parents=True, exist_ok=True)
    with open(root / ".lock", "a") as lock, open(str(source.path) + ".lock", "a") as source_lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        fcntl.flock(source_lock, fcntl.LOCK_EX)
        if any(item["name"].casefold() == name.casefold() for item in catalog(legacy)):
            raise ValueError("A Namespace with that name already exists")
        document = copy.deepcopy(source.read_document())
        if digest(document) != payload["fingerprint"]:
            raise ValueError("Source Namespace changed; reload it before duplicating")
        identifier = uuid.uuid4().hex
        metadata = dict(id=identifier, name=name, profile=payload["profile"],
                        sourceId=payload["sourceId"], sourceFingerprint=digest(document),
                        tested=False)
        temporary = Path(tempfile.mkdtemp(prefix=".copy-", dir=root))
        try:
            for filename, value in (("metadata.json", metadata), ("design.json", document)):
                with open(temporary / filename, "w") as out:
                    json.dump(value, out, indent=2)
                    out.flush()
                    os.fsync(out.fileno())
            os.rename(temporary, root / identifier)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
        return dict(ok=True, copy=metadata)
