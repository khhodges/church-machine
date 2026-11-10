# Cooperative Retry — USER B — Review

## What this application demonstrates

One USER is waiting for code to arrive, but another USER can still do useful work. SYSTEM cooperatively schedules USER B while USER A's CALL waits for a Lazy payload. Once delivery is accepted, SYSTEM resumes USER A.

This Namespace is one complete application on one FPGA image. It does not communicate with the All Waiting Namespace; that is a separate comparison scenario.

## The application's components

- **Slot 1 — Boot.NS:** the enclosing Namespace.
- **Slot 2 — Boot.Thread:** the SYSTEM execution context.
- **Slot 3 — ide.CooperativeSystemUserB:** the boot-entry code that polls the receiver, schedules the USERs, and publishes the diagnostic payload.
- **Slot 4 — ide.CooperativeUserAThread:** USER A's independent Thread.
- **Slot 5 — ide.CooperativeUserA:** calls the payload, then yields to SYSTEM after the call completes.
- **Slot 6 — ide.CooperativePayload:** a Lazy object, intentionally absent from resident memory until delivery.
- **Slot 7 — ide.CooperativeReceiver:** the diagnostic MMIO receiver, not a general IDE UART.
- **Slot 8 — ide.CooperativeUserBThread:** USER B's independent Thread.
- **Slot 9 — ide.CooperativeUserB:** increments its DR11 progress counter and voluntarily yields to SYSTEM.

Slot 0 holds Namespace metadata. These are the review design's intended roles; this guide does not regenerate itself from edited rows.

## Execution story

- SYSTEM first dispatches USER A.
- USER A attempts to CALL the absent payload. The lazy-load retry path returns control to SYSTEM while A waits.
- SYSTEM polls the receiver. While delivery is pending, it dispatches USER B, not waiting USER A.
- USER B increments DR11 once per dispatch and yields. SYSTEM reloads B's Thread capability from its C-list before dispatch rather than trusting scratch-register contents across retry handling.
- An accepted response supplies five words in the historical diagnostic transport. SYSTEM writes the payload body first and publishes its header last, then resumes USER A's pending CALL rather than restarting Run.
- The payload sets DR12 to 13 and returns. USER A yields to SYSTEM. SYSTEM then remains in an observation loop using self-CHANGE.
- A rejected response takes an explicit HARDFAULT path.

## What to look for

The distinguishing evidence is USER B making progress while USER A waits, followed by A's original CALL completing after accepted delivery. Merely seeing a saved Namespace or resolved addresses does not establish either result.

The associated diagnostic hardware has a fixed, enabled one-second watchdog. Successful CHANGE operations renew it; this application has no software kick, timer pause, or SYSTEM exemption.

## Review status and limits

The Namespace has real saved compiler-produced LUMP assignments, but it is a **review design, not a qualified runnable replacement for the diagnostic image**.

Normal compilation adds method tables and API metadata. The historical five-word receiver copy and fixed offsets are not a general loader for those compiled LUMPs. Thread entry/home provisioning, transport binding, and exact compiled-byte execution still need reconciliation before treating this as an executable build.

Inspect the assigned revisions in the Namespace rows. In Open File Catalog, search `cooperative_retry` for the SYSTEM, USER A, USER B, and payload sources. If the design has been edited, compare those rows and sources with the roles above; this document describes the original review scenario, not live execution.

Opening this guide does not save, bind, prepare, run, or transfer the application.
