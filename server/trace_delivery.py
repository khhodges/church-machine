"""Idempotent ordinary trace delivery; never cache an authorization decision."""
from collections import OrderedDict
from functools import wraps
import hashlib
import json
import threading

from flask import jsonify, make_response, request


def reliable_trace(authenticate, capacity=8192):
    receipts = OrderedDict()
    lock = threading.Lock()

    def decorate(handler):
        @wraps(handler)
        def receive(*args, **kwargs):
            ok, error = authenticate()
            if not ok:
                return error
            data = request.get_json(silent=True) or {}
            identity = data.get("delivery_id")
            if not identity:
                return handler(*args, **kwargs)
            if not isinstance(identity, str) or len(identity) > 128:
                return jsonify(ok=False, error="Invalid trace delivery ID"), 400
            session = str(data.get("bridge_session", ""))
            key = (session, identity)
            digest = hashlib.sha256(json.dumps(
                data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            # Serialize duplicate acceptance, including requests whose HTTP
            # acknowledgement timed out after their event was committed.
            with lock:
                previous = receipts.get(key)
                if previous:
                    if previous[0] != digest:
                        return jsonify(ok=False, error="Trace delivery ID reused"), 409
                    return jsonify(previous[1])
                response = make_response(handler(*args, **kwargs))
                body = response.get_json(silent=True) or {}
                if response.status_code == 200 and body.get("accepted"):
                    receipts[key] = (digest, body)
                    while len(receipts) > capacity:
                        receipts.popitem(last=False)
                return response
        return receive
    return decorate
