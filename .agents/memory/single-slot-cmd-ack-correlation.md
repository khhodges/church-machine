---
name: Single-slot command ack correlation
description: Delivery acks for a one-deep command queue must be correlated by monotonic id, not command letter
---
Rule: when a one-slot command queue gains a delivery/ack lifecycle, correlate every stage (consume, write-ack, UI watcher, sentinel confirmation) by a server-generated monotonic command id — never by the command letter, and reject acks before consumption.

**Why:** matching by letter lets a late ack for a superseded same-letter command ('f' → consume → new 'f' → old ack) mark the new command as delivered; a pre-click sentinel grace window lets an old boot sentinel falsely confirm a reboot. Code review rejected exactly these races.

**How to apply:** any /hardware/wukong/command-style endpoint or similar fire-and-forget queue getting observability: id assigned on POST, echoed on GET dequeue, required in ack (id+cmd match AND consumed_ts set); end-to-end confirmations must compare against the matched command's write_ts, with no time-window heuristics.
