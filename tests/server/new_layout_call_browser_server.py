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
    import argparse
    import hashlib
    import json
    import subprocess
    import threading

    parser = argparse.ArgumentParser()
    parser.add_argument("--regression", action="store_true",
                        help="Run the Save/Bind/Run browser regression on an ephemeral private port")
    args = parser.parse_args()
    if args.regression:
        @app.get("/__save_bind_run_state")
        def regression_state():
            # Read-only evidence, available only on this disposable process.
            lumps = private / "lumps"
            paths = [lumps / "manifest.json", lumps / "approvals.json",
                     lumps / "ns-state.json", private / "boot-config.json",
                     private / "ide-hierarchy.json",
                     *lumps.glob("*.lump"), *lumps.glob("design-drafts/*.json")]
            return jsonify({str(p.relative_to(private)):
                            hashlib.sha256(p.read_bytes()).hexdigest()
                            for p in paths if p.is_file()})

    server = make_server("127.0.0.1", 0 if args.regression else 5127, app, threaded=True)
    print(f"Private CALL acceptance clone: {private}; port {server.server_port}", flush=True)
    try:
        if args.regression:
            root = Path(__file__).resolve().parents[2]

            def live_digest():
                paths = [root / "server/boot-config.json", root / "server/ide-hierarchy.json",
                         *sorted((root / "server/lumps").rglob("*"))]
                return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                        for p in paths if p.is_file()}

            before = live_digest()
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                result = subprocess.run(
                    ["node", "tests/server/save_bind_run_browser.cjs"],
                    input=json.dumps({"url": f"http://127.0.0.1:{server.server_port}"}),
                    text=True, cwd=root, timeout=240)
            finally:
                server.shutdown()
                thread.join(timeout=5)
                assert live_digest() == before, "Live Namespace/library/ownership files changed"
            sys.exit(result.returncode)
        else:
            server.serve_forever()
    finally:
        server.server_close()
