"""Append-only, content-addressed deliverables, separate from editable projections."""
import hashlib
import json
import os
import re
import shutil
import tempfile


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


class RevisionStore:
    def __init__(self, root):
        self.root = root

    def _path(self, kind, revision):
        if kind not in ("namespace", "bitstream"):
            raise ValueError("Unknown artifact kind")
        if not re.fullmatch(r"[0-9a-f]{64}", revision):
            raise ValueError("Invalid revision identity")
        return os.path.join(self.root, kind, revision)

    def publish(self, kind, metadata, files):
        """Publish a complete directory atomically; never replace existing bytes."""
        payload = {"schema_version": 1, "kind": kind, "metadata": metadata,
                   "files": {name: digest(data) for name, data in files.items()}}
        revision = digest(canonical(payload))
        destination = self._path(kind, revision)
        for name in files:
            if not name or os.path.basename(name) != name or name in (".", "..", "revision.json"):
                raise ValueError("Invalid artifact filename")
        parent = os.path.dirname(destination)
        os.makedirs(parent, exist_ok=True)
        stage = tempfile.mkdtemp(prefix=".publishing-", dir=parent)
        try:
            for name, data in dict(files, **{"revision.json": canonical(payload)}).items():
                with open(os.path.join(stage, name), "xb") as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
            try:
                os.rename(stage, destination)
            except OSError:
                if not os.path.isdir(destination):
                    raise
                self.read(kind, revision)
            directory = os.open(parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if os.path.isdir(stage):
                shutil.rmtree(stage)
        return revision

    def read(self, kind, revision):
        path = self._path(kind, revision)
        if os.path.islink(path):
            raise ValueError("Artifact revision must not be a symlink")
        with open(os.path.join(path, "revision.json"), "rb") as stream:
            payload = json.load(stream)
        if digest(canonical(payload)) != revision:
            raise ValueError("Artifact revision metadata integrity failure")
        for name, expected in payload["files"].items():
            if os.path.basename(name) != name:
                raise ValueError("Invalid artifact filename")
            selected = os.path.join(path, name)
            if os.path.islink(selected):
                raise ValueError("Artifact bytes must not be a symlink")
            with open(selected, "rb") as stream:
                if digest(stream.read()) != expected:
                    raise ValueError("Artifact revision bytes integrity failure")
        return dict(payload, revision_id=revision)

    def file_path(self, kind, revision, name):
        record = self.read(kind, revision)
        if name not in record["files"]:
            raise ValueError("Artifact file not found")
        return os.path.join(self._path(kind, revision), name)

    def history(self, kind):
        self._path(kind, "0" * 64)
        parent = os.path.join(self.root, kind)
        if not os.path.isdir(parent):
            return []
        return [self.read(kind, name) for name in sorted(os.listdir(parent))
                if re.fullmatch(r"[0-9a-f]{64}", name)]