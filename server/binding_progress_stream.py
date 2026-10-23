"""Request-local progress; the original save operation retains all its locks."""
import json
import logging
import queue
import threading

from flask import Response, copy_current_request_context


def stream_binding_save(operation):
    events = queue.Queue()

    def emit(event):
        # Serialize now: the linker continues mutating its report dictionaries.
        events.put(json.dumps(event) + "\n")

    @copy_current_request_context
    def work():
        try:
            emit(dict(type="result", result=operation(emit)))
        except (OSError, ValueError, TypeError, KeyError) as exc:
            emit(dict(type="error", error=str(exc)))
        except Exception:
            logging.exception("Streaming Namespace binding failed")
            emit(dict(type="error", error="Binding interrupted. Reload the saved design before retrying; save completion is unconfirmed."))
        finally:
            events.put(None)

    threading.Thread(target=work, daemon=True).start()

    def chunks():
        yield json.dumps(dict(type="started")) + "\n"
        while True:
            try:
                event = events.get(timeout=10)
            except queue.Empty:
                yield json.dumps(dict(type="waiting")) + "\n"
                continue
            if event is None:
                return
            yield event

    return Response(chunks(), mimetype="application/x-ndjson",
                    headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
