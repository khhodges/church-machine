"""Read-only exact saved-artifact metadata; the old release setting is retired."""
from flask import jsonify, request


def install(app, resolve, guard, same_origin):
    @app.route("/api/saved-artifact-metadata", methods=["GET"])
    def saved_artifact_metadata():
        if not same_origin():
            return jsonify(error="Same-origin browser session required"), 403
        try:
            with guard():
                identity = resolve(request.args)
            response = jsonify(identity=identity)
            response.headers["Cache-Control"] = "no-store"
            return response
        except ValueError as exc:
            return jsonify(error=str(exc)), 409
        except OSError:
            app.logger.exception("Saved artifact metadata unavailable")
            return jsonify(error="Saved artifact metadata unavailable; reopen the artifact to retry."), 503
