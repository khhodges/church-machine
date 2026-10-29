"""Public, hash-pinned downloads; never approves or installs hardware images."""
import hashlib
import io
import logging
from functools import lru_cache

from flask import Blueprint, jsonify, send_file

downloads = Blueprint("experimental_downloads", __name__)
FILES = {
    "candidate-EXPERIMENTAL.bit": (
        "bc4a3a6568a146a8c80c78eb0b8795f947e75f7630ab744fe8e402bae6a1cb3b", 3826002),
    "candidate-EXPERIMENTAL.mcs": (
        "14212d50b418caaf1d598d476dcb07c175e4eb7fde1625dbdbc5ac72f3ff5061", 10521876),
    "build-receipt.json": (
        "cd4c1e2aea1d8e521343cf0037a987037d7963b7a80df7498c8ab228a362b109", 1076),
    "candidate-EXPERIMENTAL.mcs.sha256": (
        "639c961bdee65785c1025a997eca9c41602f9ae73375448199fb2cde046e3db2", 93),
}


def object_key(name):
    digest, _ = FILES[name]
    return f"public/wukong/experimental/{digest}/{name}"


def _read_object(key):
    from replit.object_storage import Client
    return Client().download_as_bytes(key)


@lru_cache(maxsize=4)
def verified_bytes(name):
    expected_hash, expected_size = FILES[name]
    data = _read_object(object_key(name))
    if len(data) != expected_size or hashlib.sha256(data).hexdigest() != expected_hash:
        raise ValueError("Experimental download integrity mismatch")
    return data


@downloads.get("/dl/wukong-experimental/<name>")
def download_experimental(name):
    if name not in FILES:
        return jsonify(error="Unknown experimental download. No file was returned."), 404
    try:
        data = verified_bytes(name)
    except Exception:
        logging.exception("Experimental Wukong download unavailable: %s", name)
        return jsonify(error=(
            "The experimental download is unavailable or failed its integrity check. "
            "No image was installed. Ask the site operator to restore the verified "
            "download in App Storage, then retry.")), 503
    response = send_file(
        io.BytesIO(data), as_attachment=True, download_name=name,
        mimetype="application/octet-stream", etag=FILES[name][0], max_age=0)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Artifact-Status"] = "experimental-not-release-approved"
    return response
