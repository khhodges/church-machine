"""Build trees from exact Git objects and frozen overlays, never working files."""
import hashlib
import io
import json
import posixpath
import re
import subprocess
import tarfile


def verified_source_archive(root, commit):
    if not re.fullmatch(r"[0-9a-f]{40,64}", commit):
        raise ValueError("An exact source commit is required")
    resolved = subprocess.check_output(
        ["git", "rev-parse", commit + "^{commit}"], cwd=root, text=True).strip()
    if resolved != commit:
        raise ValueError("Source commit identity changed")
    data = subprocess.check_output(
        ["git", "archive", "--format=tar", commit, "hardware", "scripts",
         "server", "shared", "pyproject.toml"], cwd=root)
    archive_commit = subprocess.check_output(
        ["git", "get-tar-commit-id"], input=data, cwd=root).decode().strip()
    if archive_commit != commit:
        raise ValueError("Source archive is not bound to the approved commit")
    return data


def _safe_name(name):
    if name.startswith("/") or posixpath.normpath(name).startswith("../") or name in ("", ".."):
        raise ValueError("Unsafe source archive path")
    return posixpath.normpath(name)


def staging_archive(source_bytes, overlay_bytes, commit, unavailable=()):
    """Retain safe source symlinks; never extract an overlay through a symlink."""
    result = io.BytesIO()
    hashes = {}
    links = {}
    with tarfile.open(fileobj=io.BytesIO(source_bytes)) as source, \
            tarfile.open(fileobj=io.BytesIO(overlay_bytes)) as overlay, \
            tarfile.open(fileobj=result, mode="w") as output:
        source_members = {_safe_name(member.name): member for member in source}
        overlays = {_safe_name(member.name): member for member in overlay}
        for name, member in source_members.items():
            if member.issym():
                target = member.linkname
                if target.startswith("/"):
                    raise ValueError("Source symlink escapes the isolated tree")
                _safe_name(posixpath.join(posixpath.dirname(name), target))
                links[name] = target
            elif not member.isfile() and not member.isdir():
                raise ValueError("Unsupported source archive member")
        for name, member in overlays.items():
            if not member.isfile():
                raise ValueError("Frozen overlays must be regular files")
            parent = posixpath.dirname(name)
            while parent:
                if parent in links:
                    raise ValueError("Frozen overlay parent is a symlink")
                parent = posixpath.dirname(parent)
        removed = set(unavailable)
        for name, member in source_members.items():
            if name in overlays or name in removed:
                links.pop(name, None)
                continue
            if member.isfile():
                data = source.extractfile(member).read()
                hashes[name] = hashlib.sha256(data).hexdigest()
                output.addfile(member, io.BytesIO(data))
            else:
                output.addfile(member)
        for name, member in overlays.items():
            data = overlay.extractfile(member).read()
            hashes[name] = hashlib.sha256(data).hexdigest()
            output.addfile(member, io.BytesIO(data))
        provenance = json.dumps({
            "source_commit": commit,
            "source_archive_sha256": hashlib.sha256(source_bytes).hexdigest(),
            "source_kind": "verified-git-archive",
            "approved_overlay_paths": sorted(overlays), "source_symlinks": links,
        }, sort_keys=True).encode()
        hashes[".source-provenance.json"] = hashlib.sha256(provenance).hexdigest()
        for name, data in (
            (".source-provenance.json", provenance),
            (".staged-inputs.sha256", "".join(
                f"{digest}  {name}\n" for name, digest in sorted(hashes.items())).encode()),
        ):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            output.addfile(info, io.BytesIO(data))
    return result.getvalue()