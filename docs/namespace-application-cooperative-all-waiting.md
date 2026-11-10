# Cooperative Retry — All Waiting — Review

## What this application demonstrates

What should SYSTEM do when the only USER is waiting for code to arrive? This application keeps SYSTEM polling the receiver and performing real self-CHANGE operations until delivery is accepted. It does not repeatedly dispatch the waiting USER.

This Namespace is one complete application on one FPGA image. It is the alternative to the USER B scenario, not a second image that interacts with it.

## The application's components

- **Slot 1 — Boot.NS:** the enclosing Namespace.
- **Slot 2 — Boot.Thread:** the SYSTEM execution context.
- **Slot 3 — ide.CooperativeSystemWaiting:** the boot-entry code that polls the receiver and self-CHANGEs while waiting.
- **Slot 4 — ide.CooperativeUserAThread:** USER A's independent Thread.
- **Slot 5 — ide.CooperativeUserA:** calls the payload, then yields to SYSTEM after the call completes.
- **Slot 6 — ide.CooperativePayload:** a Lazy object, intentionally absent from resident memory until delivery.
- **Slot 7 — ide.CooperativeReceiver:** the diagnostic MMIO receiver, not a general IDE UART.

Slot 0 holds Namespace metadata. There is no USER B Thread or USER B code in this scenario. These are the review design's intended roles; this guide does not regenerate itself from edited rows.

## Execution story

- SYSTEM first dispatches USER A.
- USER A attempts to CALL the absent payload. The lazy-load retry path returns control to SYSTEM while A waits.
- SYSTEM polls the receiver. While delivery is pending, it executes CHANGE through CR12 to its own Thread, then polls again. There is no other eligible USER to dispatch.
- An accepted response supplies five words in the historical diagnostic transport. SYSTEM writes the payload body first and publishes its header last.
- Only after publication does SYSTEM resume USER A's pending CALL. It must continue that same call, not restart Run.
- The payload sets DR12 to 13 and returns. USER A yields to SYSTEM. SYSTEM then remains in an observation loop using self-CHANGE.
- A rejected response takes an explicit HARDFAULT path.

## What to look for

The distinguishing evidence is SYSTEM making successful self-CHANGE transitions while USER A remains waiting, followed by A's original CALL completing after accepted delivery. Unlike the USER B scenario, there is no second USER progress counter to observe.

The associated diagnostic hardware has a fixed, enabled one-second watchdog. Successful CHANGE operations renew it. SYSTEM is not exempt: there is no software kick or timer pause, and a stalled SYSTEM must not be concealed by automatic recovery.

## Review status and limits

The Namespace has real saved compiler-produced LUMP assignments, but it is a **review design, not a qualified runnable replacement for the diagnostic image**.

Normal compilation adds method tables and API metadata. The historical five-word receiver copy and fixed offsets are not a general loader for those compiled LUMPs. Thread entry/home provisioning, transport binding, and exact compiled-byte execution still need reconciliation before treating this as an executable build.

Inspect the assigned revisions in the Namespace rows. In Open File Catalog, search `cooperative_retry` for the SYSTEM waiting, USER A, and payload sources. If the design has been edited, compare those rows and sources with the roles above; this document describes the original review scenario, not live execution.

Opening this guide does not save, bind, prepare, run, or transfer the application.
