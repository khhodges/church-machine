"""Opt-in disposable browser harness: python tests/server/idx1_browser_server.py."""
import argparse
import os
from pathlib import Path
import secrets
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from bootstrap_test_support import isolate_application


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5001)
    args = parser.parse_args()
    private = isolate_application()
    # Dedicated ephemeral keys belong only to this throwaway server.
    os.environ["COMPILER_SIGNING_SECRET"] = secrets.token_hex(32)
    os.environ["SESSION_SECRET"] = secrets.token_hex(32)
    import server.app as application
    print(f"Disposable IDX1 browser data: {private}", flush=True)
    print(f"Browser URL: http://127.0.0.1:{args.port}/", flush=True)
    application.app.run(host="0.0.0.0", port=args.port, debug=False,
                        use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()