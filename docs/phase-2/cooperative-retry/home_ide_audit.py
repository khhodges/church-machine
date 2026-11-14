"""Durable receipt boundary for local Home-IDE audit qualification.

No connection to a physical board or production database. A caller may send
the returned receipt only after this method succeeds. Transport authentication
and a fresh session identity are responsibilities of the eventual relay.
"""
import json
import sqlite3


class HomeIDEAudit:
    def __init__(self, path, *, session, image_sha256):
        if not isinstance(session, str) or not session or len(session) > 128:
            raise ValueError("An explicit audit session is required")
        if len(image_sha256) != 64 or any(c not in "0123456789abcdef" for c in image_sha256):
            raise ValueError("An exact candidate image hash is required")
        self.session, self.image_sha256 = session, image_sha256
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS audit_intents (
            session TEXT NOT NULL, sequence INTEGER NOT NULL, record TEXT NOT NULL,
            PRIMARY KEY (session, sequence))""")
        self.db.commit()

    def receive(self, *, sequence, namespace, thread, execution):
        for value, bits in ((sequence, 32), (namespace, 96), (thread, 32), (execution, 32)):
            if type(value) is not int or not 0 <= value < 1 << bits:
                raise ValueError("Malformed audit report")
        if sequence == 0:
            raise ValueError("Audit sequence zero is not a request")
        record = json.dumps(dict(image=self.image_sha256, namespace=namespace,
                                 thread=thread, execution=execution,
                                 operation="namespace-switch-completed"), sort_keys=True)
        with self.db:
            previous = self.db.execute(
                "SELECT record FROM audit_intents WHERE session=? AND sequence=?",
                (self.session, sequence)).fetchone()
            if previous is not None:
                if previous[0] != record:
                    raise ValueError("Audit sequence replay names a different intent")
            else:
                self.db.execute("INSERT INTO audit_intents VALUES (?,?,?)",
                                (self.session, sequence, record))
        return sequence  # only after durable commit, including an exact duplicate

    def close(self):
        self.db.close()
