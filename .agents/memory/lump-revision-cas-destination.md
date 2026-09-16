---
name: LUMP revision CAS destination identity
description: How save reservations identify the active revision when candidate and destination tokens differ.
---

Revision compare-and-swap checks for a LUMP replacement must follow the active Namespace destination token. They must ignore archived manifest rows that share that token and must not switch to the newly compiled candidate's content-derived token.

**Why:** Stable system Golden Tokens can differ from a fresh compiler candidate token, and historical revisions intentionally share the stable token. Looking up either the candidate token or the first token match creates a permanent false revision conflict.

**How to apply:** At save-plan time, retain the active destination token and its filename/version. At commit time, resolve the non-archived row for that retained token and compare the same filename/version pair.