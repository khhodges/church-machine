import signal

bind = "0.0.0.0:5000"
worker_class = "gthread"
workers = 1
threads = 8
timeout = 120
max_requests = 1000
max_requests_jitter = 50
loglevel = "info"
accesslog = "-"
errorlog = "-"

# Load the Flask app in the master process BEFORE binding the port so that
# the very first health-check arrives after the app is fully initialised.
# Without this, gunicorn announces "Listening at …" while workers are still
# importing server.app (running DB migrations, GitHub PAT check, APScheduler
# startup, etc.) and every health-check times out, failing the deployment.
preload_app = True


def when_ready(server):
    signal.signal(signal.SIGWINCH, signal.SIG_IGN)


def post_fork(server, worker):
    """Run in each worker process immediately after the fork.

    With preload_app=True the master imports server.app before forking.
    Two things break across the fork boundary and must be fixed here:

    1. SQLAlchemy connection pool — file descriptors are shared; calling
       db.engine.dispose() makes the worker open its own fresh connections.

    2. APScheduler background thread — OS threads do NOT survive fork.
       The scheduler object exists (running=True) but its thread is dead.
       We shut it down and restart it so scheduled jobs actually fire.
    """
    signal.signal(signal.SIGWINCH, signal.SIG_IGN)

    # 1 — reset SQLAlchemy connection pool
    try:
        from server.app import db
        db.engine.dispose()
    except Exception as _e:
        import logging
        logging.getLogger("gunicorn.error").warning(
            "post_fork: db.engine.dispose() failed: %s", _e
        )

    # 2 — restart APScheduler
    try:
        import server.app as _sapp
        _sched = getattr(_sapp, '_scheduler', None)
        if _sched is not None:
            try:
                _sched.shutdown(wait=False)
            except Exception:
                pass
            _sched.start()
    except Exception as _e:
        import logging
        logging.getLogger("gunicorn.error").warning(
            "post_fork: APScheduler restart failed: %s", _e
        )

    # 3 — restart Wukong UDP listener
    # The listener's background thread does not survive fork().  The socket FD
    # was inherited, so restart_after_fork() reuses it and only recreates the
    # thread — no port-rebind required and no 'address already in use' risk.
    # This ensures callhome events received in the worker process update the
    # same _callhome_log / _latest_callhome_data that Flask handlers see.
    try:
        import server.app as _sapp2
        _wl = getattr(_sapp2, '_wukong_listener', None)
        if _wl is not None:
            _wl.restart_after_fork()
    except Exception as _e:
        import logging
        logging.getLogger("gunicorn.error").warning(
            "post_fork: Wukong UDP listener restart failed: %s", _e
        )
