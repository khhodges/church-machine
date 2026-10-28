"""Disposable clone for the New-layout CALL browser acceptance journey.

Run directly from the repository root. Never serves or writes live storage.
Hardware endpoints are disabled even for reads.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from bootstrap_test_support import isolate_application

private = isolate_application()
from flask import jsonify, request
from werkzeug.serving import make_server
from server.app import app


@app.before_request
def prohibit_hardware():
    if any(part in request.path.lower() for part in
           ("wukong", "hardware", "fpga", "serial", "flash")):
        return jsonify(error="Hardware disabled in disposable CALL acceptance clone"), 403


if __name__ == "__main__":
    server = make_server("0.0.0.0", 5127, app, threaded=True)
    print(f"Private CALL acceptance clone: {private}; port 5127", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
