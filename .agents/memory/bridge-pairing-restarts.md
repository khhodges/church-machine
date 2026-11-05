---
name: Bridge pairing restart boundary
description: Persistence and operational safety constraints for paired hardware bridges.
---
Pairing persistence is local to one IDE installation, not a portable credential backup. Keep private grant state out of source control and deployment packages; do not renew expiry on restart.

**Why:** Operators need server restarts to preserve an already-running bridge without copying the server authority secret to the bridge or extending its authorization indefinitely.

**How to apply:** Test restarts with isolated stores and fresh processes. Never issue board commands for pairing tests. Notify the user before restarting an active paired IDE; an initial upgrade from memory-only grants cannot recover those existing credentials.

Support restoring access to an already-running paired bridge from the IDE,
without making the operator stop PowerShell and copy a new command.
**Why:** The user explicitly requested repair after the first persistence upgrade
lost the prior in-memory authorization. Repeated manual reconnection prevented
their actual goal of loading a development image.
**How to apply:** Reconnection must use durable, verifiable authority
automatically. Never auto-authorize by UID, and never substitute a human approval
of an unknown credential for proof of its authority. Keep credentials out of UI,
logs, and source control; restoring access sends no hardware commands and does
not prove execution or installed image identity.

The user rejected the manual reconnect-approval design: “Security check should
be invisible to the user ... It MUST exist by default!”
**Why:** Security enforcement is an architectural responsibility of the Church
Machine, not an optional operator decision. A convenient approval button still
delegates that responsibility incorrectly.
**How to apply:** Distinguish choosing an operation from granting its security
authority. Preserve automatic authentication across lifecycle events; unknown
authority remains rejected. The existing manual recovery implementation is not
the approved product behavior.

Bridge process restarts and downloaded-script upgrades must preserve pairing,
not only IDE server restarts.
**Why:** The user again rejected manual reconnection after an update instructed
them to stop a bridge whose credential existed only in process memory. Reusing
a consumed pairing code cannot restore that lost credential.
**How to apply:** Before recommending a bridge restart, verify durable,
OS-protected client credential storage and reuse for the exact IDE/device.
Do not claim server-side grant persistence solves client-side credential loss;
never recover by trusting a UID or reviving a consumed pairing code.
