"""Opt-in disposable browser harness: python tests/server/idx1_browser_server.py."""
import argparse
import json
import os
from pathlib import Path
import secrets
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from bootstrap_test_support import isolate_application


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5001)
    parser.add_argument("--seed-api-revisions", action="store_true")
    args = parser.parse_args()
    private = isolate_application()
    # Dedicated ephemeral keys belong only to this throwaway server.
    os.environ["COMPILER_SIGNING_SECRET"] = secrets.token_hex(32)
    os.environ["SESSION_SECRET"] = secrets.token_hex(32)
    import server.app as application
    if args.seed_api_revisions:
        from test_idx1_save_endpoint import candidate, save
        retained = []
        @application.app.get("/__test_idx1_revisions")
        def revisions():
            return application.jsonify(retained)
        with application.app.test_client() as client:
            for suffix in ("; exact first revision\n", "; exact second revision\n"):
                payload = candidate(client, suffix=suffix, tier=0)
                source = payload["metadata"]["submitted_source"]
                payload["metadata"].update(original_source=source, submitted_source=None,
                                           save_variants=True, source_required=True)
                saved, _ = save(client, payload)
                retained.append(dict(saved, source=source))
            manifest = json.loads((private / "lumps" / "manifest.json").read_text())
            archive = next(row for row in manifest if row.get("archived")
                           and row.get("abstraction") == "PrivateIDX1")
            retained[0]["filename"] = archive["filename"]
    print(f"Disposable IDX1 browser data: {private}", flush=True)
    print(f"Browser URL: http://127.0.0.1:{args.port}/", flush=True)
    application.app.run(host="0.0.0.0", port=args.port, debug=False,
                        use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()