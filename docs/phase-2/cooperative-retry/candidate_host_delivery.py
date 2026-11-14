"""Offline CRQ1 responder codec. No serial-device or board access.

Provision the same immutable ordered records and installed epoch on both ends.
The host supplies bytes only; it cannot change receiver selection or publish.
"""
import struct
from .amoeba_protocol import validate_records


class CandidateHostDelivery:
    def __init__(self, records, epoch):
        if type(epoch) is not int or not 0 < epoch < 2**32:
            raise ValueError("A nonzero installed epoch is required")
        self.epoch = epoch
        self.records = []
        identities = set()
        for i, r in enumerate(records):
            ns, target = r["namespace"], r["target"]
            if (type(ns) is not int or not 0 < ns < 2**96 or
                    type(target) is not int or not 0 < target < 2**32 or
                    target & 65535 != r["slot"] or (ns, target) in identities):
                raise ValueError("Invalid or duplicate qualified identity")
            identities.add((ns, target))
            self.records.append(dict(r, slot=i + 3, words=list(r["words"])))
        validate_records(self.records, staging_base=0x20000, staging_words=4096,
                         memory_profile="candidate128")
        self.buffer = bytearray()
        self.last_transaction = 0

    def feed(self, data):
        """Return response packets; reject complete stale/unknown requests.

        A newer magic before the current 16-byte frame ends denotes a truncated
        request after cancellation. No immutable record selector can equal that
        magic. A caller must preserve this object's replay counter across pauses.
        """
        self.buffer.extend(data)
        responses = []
        while True:
            start = self.buffer.find(b"CRQ1")
            if start < 0:
                self.buffer[:] = self.buffer[-3:]
                break
            del self.buffer[:start]
            if len(self.buffer) < 16:
                break
            selector, epoch, txn = struct.unpack(">III", self.buffer[4:16])
            valid = (epoch == self.epoch and self.last_transaction < txn <= 0xffffffff
                     and 3 <= selector < len(self.records) + 3)
            newer = self.buffer.find(b"CRQ1", 4)
            if not valid and newer >= 0:
                del self.buffer[:newer]
                continue
            del self.buffer[:16]
            if epoch != self.epoch or not self.last_transaction < txn <= 0xffffffff:
                raise ValueError("Stale or reused delivery epoch/transaction")
            if not 3 <= selector < len(self.records) + 3:
                raise ValueError("Request does not select a provisioned record")
            r = self.records[selector - 3]
            raw = struct.pack(f"<{len(r['words'])}I", *r["words"])
            def frame(op, length=0):
                return b"CLQ1" + struct.pack(">BBHIII", op, selector, 0, epoch, txn, length)
            self.last_transaction = txn
            responses.append(frame(1, len(raw)) + raw + frame(2))
        return responses
