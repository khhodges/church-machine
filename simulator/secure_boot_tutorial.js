class SecureBootTutorial {
    constructor() {
        this.steps = this._buildSteps();
        this.currentStep = -1;
    }

    _buildSteps() {
        return [
            {
                title: 'Secure Boot \u2014 Overview',
                type: 'intro',
                content: `<p>The Church Machine boots in five hardware-defined steps. Each step advances the machine from a blank slate into a fully capability-protected execution environment. The CLOOMC listing in this tutorial is the <strong>canonical reference</strong> for how boot code uses its capabilities, validates Golden Token seals, and hands off control to the first user abstraction.</p>
<div class="sr-key-concept"><div class="sr-concept-title">Five Boot Steps (B:00 \u2013 B:04)</div>
<table class="sr-table">
<tr><th>Step</th><th>Name</th><th>Hardware action</th></tr>
<tr><td>B:00</td><td>FAULT_RST</td><td>Assert reset; clear all registers; set PC\u202f=\u202f0</td></tr>
<tr><td>B:01</td><td>LOAD_NS</td><td>mLoad NS Slot\u202f0 into CR15 (Namespace register)</td></tr>
<tr><td>B:02</td><td>INIT_THRD</td><td>Load Thread NS entry (Slot\u202f1) into CR13 (Thread register)</td></tr>
<tr><td>B:03</td><td>INIT_ABSTR</td><td>Load boot C-List entries; LAMBDA into boot code lump (Slot\u202f4) with seal validation</td></tr>
<tr><td>B:04</td><td>LOAD_NUC</td><td>Derive CR14 (code GT) and CR6 (c-list GT) from user abstraction NS metadata; CALL with seal validation; set PC\u202f=\u202f0</td></tr>
</table>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">GT Word\u202f0 Format (current)</div>
<p>Every Golden Token is a 32-bit word with this layout (LSB\u202f=\u202f0):</p>
<table class="sr-table">
<tr><th>Bits</th><th>Field</th><th>Notes</th></tr>
<tr><td>[15:0]</td><td>slot_id</td><td>16-bit namespace slot index</td></tr>
<tr><td>[22:16]</td><td>gt_seq</td><td>7-bit revocation counter (must match NS entry word2[31:25])</td></tr>
<tr><td>[24:23]</td><td>gt_type</td><td>00\u202f=\u202fNULL &middot; 01\u202f=\u202fInform &middot; 10\u202f=\u202fOutform &middot; 11\u202f=\u202fAbstract</td></tr>
<tr><td>[30:25]</td><td>perms</td><td>R\u202fW\u202fX\u202fL\u202fS\u202fE (1\u202fbit each)</td></tr>
<tr><td>[31]</td><td>b_flag</td><td>Bindable override (set by IDE, not by program)</td></tr>
</table>
<p>The CRC-16 <strong>seal</strong> lives in the <em>NS entry</em> word2[15:0], not in the GT word itself. The hardware recomputes it from the live NS entry on every CALL, RETURN, and mLoad.</p>
</div>
<p>Click <strong>Next</strong> to walk through the full secure startup CLOOMC listing step by step.</p>`
            },
            {
                title: 'B:01 \u2014 LOAD_NS: Validate the Namespace Root',
                type: 'load_ns',
                content: `<p>The very first boot step loads the Namespace Root (NS Slot\u202f0) into <strong>CR15</strong>. This gives every subsequent instruction the physical memory map and the count of live NS entries.</p>
<pre class="sr-code sr-code-asm">; ============================================================
; BOOT LISTING \u2014 Step B:01  LOAD_NS
; Listing reference: secure_boot_tutorial.js \u00a7B:01
; hardware/boot_rom.py cross-ref: BOOT_PROGRAM[0] (CHANGE),
;   implicit hardware init of CR15 before first user word
; ============================================================

; The hardware performs mLoad of a zero-perm GT for NS Slot 0
; and writes the result directly into CR15 (the Namespace reg).
; No CLOOMC instruction is needed \u2014 this is hardware-only.
;
; After B:01 the following is guaranteed:
;   CR15.word0  = make_gt(GT_TYPE_INFORM, perms=0, slot_id=0, gt_seq=0)
;   CR15.word1  = word0_location = 0x0000      ; physical base
;   CR15.word2  = word1_packed   = 0xFFFF      ; limit = 65535
;   CR15.word3  = word2_seals    = (gt_seq &lt;&lt; 25) | CRC-16
;
; The CRC-16/CCITT seal over (GT[24:0], location, word1_w2)
; is recomputed by the hardware on every mLoad that touches CR15.
; A SEAL_MISMATCH fault fires if the NS table has been tampered with.

LOAD_NS:                          ; hardware boot step B:01 \u2014 no user instruction emitted</pre>
<div class="sr-key-concept"><div class="sr-concept-title">Why CR15 Has Zero Permissions</div>
<p>CR15 carries the Namespace Root GT with <em>all permission bits clear</em>. It is a structural identity token, not a data capability. Any instruction that tries to use CR15 as an R, W, or X operand receives a PERM fault immediately. The seal still applies \u2014 the hardware re-checks it on every mLoad that reads through CR15.</p>
</div>`
            },
            {
                title: 'B:02 \u2014 INIT_THRD: Establish the Thread Lump',
                type: 'init_thrd',
                content: `<pre class="sr-code sr-code-asm">; ============================================================
; BOOT LISTING \u2014 Step B:02  INIT_THRD
; Listing reference: secure_boot_tutorial.js \u00a7B:02
; hardware/boot_rom.py cross-ref: BOOT_PROGRAM[0] CHANGE instr
; ============================================================

; The hardware loads NS Slot 1 (Thread Abstraction) into CR13.
; CR13 is the Thread register \u2014 it gives the running thread
; its own lump base (Slot 1 \u00d7 0x100 = 0x0100) and limit.
;
; NS Slot 1 layout (set by _initNamespaceTable in simulator.js):
;   word0_location = 0x0100         ; Slot 1 lump base
;   word1_packed   = (gt_seq &lt;&lt; 21) | (alloc_size - 1)
;   word2_seals    = (gt_seq &lt;&lt; 25) | CRC-16
;
; After B:02:
;   CR13 holds the Thread GT with RWX perms and gt_seq = 0
;   The thread stack (LIFO) begins at lump base + 12 words
;   DR0\u2013DR15 are still zero from the reset

; First CLOOMC user instruction \u2014 emitted by boot ROM:
;   CHANGE AL, CR12, CR12, #1
; This switches to thread mode and records the thread lump in CR12.
; (ENABLE_CHANGE_SWITCH = True in hw_types.py)

INIT_THRD:  CHANGE  AL, CR12, CR12, #1   ; B:02 \u2014 switch to thread context</pre>
<div class="sr-key-concept"><div class="sr-concept-title">Thread Lump Memory Map (Slot\u202f1)</div>
<table class="sr-table">
<tr><th>Offset (words)</th><th>Zone</th><th>Description</th></tr>
<tr><td>0</td><td>Lump Header</td><td><code>0xF900_020C</code> \u2014 never executed; encodes lump shape</td></tr>
<tr><td>+1 \u2026 +16</td><td>\u2464 Data Registers</td><td>DR0\u2013DR15 shadow; fixed at the head, just after the header</td></tr>
<tr><td>+17 \u2026 +80</td><td>\u2463 Heap</td><td>Fixed 64-word heap; objects allocated from heap base upward</td></tr>
<tr><td>+81 \u2026 +211</td><td>\u2462 Freespace</td><td>Dynamic gap between heap top \u2191 and stack bottom \u2193</td></tr>
<tr><td>+212 \u2026 +243</td><td>\u2461 LIFO Stack</td><td>CALL/RETURN frames; STO initial\u202f=\u202f212 (empty), grows downward</td></tr>
<tr><td>+244 \u2026 +255</td><td>\u2460 Capabilities</td><td>GT Word\u202f0 \u00d7 12 (CR0\u2013CR11); c-list tail; saved/restored by mLoad</td></tr>
</table>
</div>`
            },
            {
                title: 'B:03 \u2014 INIT_ABSTR: Validate the Boot Abstraction GT Seal',
                type: 'init_abstr',
                content: `<pre class="sr-code sr-code-asm">; ============================================================
; BOOT LISTING \u2014 Step B:03  INIT_ABSTR
; Listing reference: secure_boot_tutorial.js \u00a7B:03
; hardware/boot_rom.py cross-ref: BOOT_PROGRAM[1..4]
; ============================================================

; The hardware loads boot C-List entries and validates
; the boot code lump\u2019s identity via LAMBDA before
; CR14/CR6 are derived for user code in B:04.
;
; CLOOMC listing (from BOOT_PROGRAM in boot_rom.py):

INIT_ABSTR:
    ; Load C-List entry 0 into CR1 \u2014 code/constants GT (R|X, Slot 3, gt_seq=0)
    LOAD    AL, CR1, CR6[0]    ; CR1 = make_gt(GT_TYPE_INFORM, R|X, slot_id=3, gt_seq=0)
    ;   GT word0 fields:
    ;     slot_id = 3          (code/constants lump at 0x0300)
    ;     gt_seq  = 0          (no revocations yet)
    ;     gt_type = GT_TYPE_INFORM (01)
    ;     perms   = R | X      (bits 0,2 set)

    ; Load C-List entry 1 into CR2 \u2014 boot code GT (X, Slot 4, gt_seq=0)
    LOAD    AL, CR2, CR6[1]    ; CR2 = make_gt(GT_TYPE_INFORM, X, slot_id=4, gt_seq=0)
    ;   GT word0 fields:
    ;     slot_id = 4          (Boot code lump \u2014 0x0400)
    ;     gt_seq  = 0
    ;     gt_type = GT_TYPE_INFORM
    ;     perms   = X only     (bit 2 set)

    ; Restrict CR2 to X permission only (TPERM clears any other perm bits)
    TPERM   AL, CR2, #X        ; ensure CR2 carries only Execute perm

    ; Create a LAMBDA frame using CR2 as the code GT
    ; SECURITY CHECKPOINT 1: hardware re-validates CRC-16 seal of NS Slot 4 here
    LAMBDA  AL, CR2            ; push 1-word LAMBDA frame; PC \u21d2 first instr of Slot 4</pre>
<div class="sr-key-concept"><div class="sr-concept-title">LAMBDA vs CALL \u2014 Why LAMBDA Here?</div>
<p>CALL pushes a 2-word frame and re-derives both CR6 (c-list) and CR14 (code). LAMBDA pushes a 1-word frame using the GT in CRd as the <em>code</em> pointer only, without touching CR6. Boot uses LAMBDA here because it needs to enter the boot code lump (Slot\u202f4) while keeping the existing CR6 (the boot c-list) intact for the initial c-list setup that follows.</p>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">Seal Validation at B:03</div>
<p>When LAMBDA fires with CR2, the hardware recomputes the CRC-16 seal over <code>(GT[24:0], word0_location, word1_w2)</code> from the live NS Slot\u202f4 entry. GT[24:0] contains gt_type, gt_seq, and slot_id (bits 24\u2013\u200b0) \u2014 permission bits (bits 30:25) are <em>not</em> part of the sealed input. A mismatch means the boot code lump\u2019s NS entry has been modified since the seal was written \u2014 the machine halts with <code>SEAL_MISMATCH</code>. This is the <strong>first security checkpoint</strong> of the boot sequence.</p>
</div>`
            },
            {
                title: 'B:04 \u2014 LOAD_NUC: Derive CR14 and CR6, Enter User Code',
                type: 'load_nuc',
                content: `<pre class="sr-code sr-code-asm">; ============================================================
; BOOT LISTING \u2014 Step B:04  LOAD_NUC
; Listing reference: secure_boot_tutorial.js \u00a7B:04
; hardware/boot_rom.py cross-ref: BOOT_PROGRAM[5..10]
; ============================================================

; At this point PC = 0 inside the boot code lump (Slot 4).
; The boot ROM now sets up the initial thread C-List and
; performs the first CALL into user code via an E-GT.

LOAD_NUC:
    ; Load C-List entry 6 into CR0 \u2014 the first user abstraction E-GT
    LOAD    AL, CR0, CR6[6]    ; CR0 = make_gt(GT_TYPE_INFORM, E, slot_id=4, gt_seq=0)
    ;   GT word0 fields:
    ;     slot_id = 4          (first programmer-uploaded abstraction, Slot 3+)
    ;     gt_seq  = 0          (no revocations)
    ;     gt_type = GT_TYPE_INFORM
    ;     perms   = E only     (bit 5 set)

    ; Restrict CR0 to E permission only before the CALL
    ; (note: TPERM does not check the seal; the seal is checked by CALL below)
    TPERM   AL, CR0, #E        ; ensure CR0 carries only Execute perm

    ; CALL into the first user abstraction
    ; Hardware steps on CALL:
    ;   1. Check E=1 in CR0
    ;   2. Recompute CRC-16 from NS Slot 4 entry; compare to seal stored in NS word2[15:0] \u2014
    ;      a SEAL_MISMATCH fault fires if mismatched (second security checkpoint)
    ;   3. Derive CR14 from NS Slot 4:
    ;        CR14.base  = word0_location  (= 4 \u00d7 0x100 = 0x0400)
    ;        CR14.limit = word1[16:0]     (= alloc_size - 1)
    ;        CR14.perm  = XR              (IDE-set; enables read-only constants in code region)
    ;   4. Derive CR6 from NS Slot 4:
    ;        CR6.base   = lump_base + clistStart   (c-list packed at top of lump)
    ;        CR6.limit  = clistCount - 1
    ;        CR6.perm   = L only
    ;   5. Push 2-word frame [caller E-GT | frame_word] onto thread LIFO stack
    ;   6. Advance STO by 2
    ;   7. Set PC = 0 \u2014 user abstraction begins executing
    CALL    AL, CR0, CR0       ; enter first user abstraction \u2014 B:04 complete

    ; --- execution transfers to the user abstraction ---

    ; Boot ROM epilogue (reached after user RETURN):
    LOAD    AL, CR7, CR6[1]    ; reload boot code GT (Slot 4) into CR7
    TPERM   AL, CR7, #X        ; strip to X only
    LAMBDA  AL, CR7            ; re-enter boot finalisation code

    ; Final RETURN with capability mask 0b100000 (mask CR5)
    RETURN  AL, CR5            ; clear CR5 on exit; boot sequence complete

    ; Preserve the thread GT in C-List slot 2 for runtime use
    SAVE    AL, CR6, CR1, #2   ; write CR1 (Thread GT) into c-list[2]</pre>
<div class="sr-key-concept"><div class="sr-concept-title">CR14 Derivation from NS Slot Metadata</div>
<table class="sr-table">
<tr><th>CR14 field</th><th>Source</th><th>Value (example, Slot\u202f4)</th></tr>
<tr><td>base</td><td>NS Slot word0_location</td><td>0x0400 (= 4 \u00d7 256 words)</td></tr>
<tr><td>limit</td><td>NS Slot word1[16:0] = alloc_size\u202f\u2212\u202f1</td><td>0x00FF (255, for a 256-word lump)</td></tr>
<tr><td>perm</td><td>IDE-controlled flag in NS entry</td><td>XR (execute + read)</td></tr>
</table>
<p>The limit encodes the total lump size, not just the code region. A BOUNDS fault fires if PC exceeds limit during execution.</p>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">CR6 Derivation \u2014 C-List GT</div>
<table class="sr-table">
<tr><th>CR6 field</th><th>Derivation</th></tr>
<tr><td>base</td><td>word0_location\u202f+\u202f(alloc_size\u202f\u2212\u202fclistCount) = lump_base + clistStart</td></tr>
<tr><td>limit</td><td>clistCount\u202f\u2212\u202f1 (from NS word1[25:17])</td></tr>
<tr><td>perm</td><td>L only (capability load; no R/W/X/S/E)</td></tr>
</table>
</div>`
            },
            {
                title: 'Full Secure Boot CLOOMC Listing',
                type: 'full_listing',
                content: `<p>Below is the <strong>complete annotated secure boot listing</strong> \u2014 the canonical example of a capability-safe startup sequence on the Church Machine. This listing corresponds to <code>BOOT_PROGRAM</code> in <code>hardware/boot_rom.py</code>.</p>
<pre class="sr-code sr-code-asm">; ============================================================
; Church Machine \u2014 Secure Boot CLOOMC Assembly Listing
; Listing reference: simulator/secure_boot_tutorial.js
; Hardware cross-ref: hardware/boot_rom.py BOOT_PROGRAM
;
; GT Word 0 format (current):
;   [15:0]  slot_id   \u2014 16-bit NS slot index
;   [22:16] gt_seq    \u2014 7-bit revocation counter
;   [24:23] gt_type   \u2014 00=NULL 01=Inform 10=Outform 11=Abstract
;   [30:25] perms     \u2014 R W X L S E (1 bit each, LSB=R)
;   [31]    b_flag    \u2014 bindable override (IDE-set)
;
; Seal (CRC-16/CCITT, poly=0x1021, init=0xFFFF):
;   Computed over GT[24:0] + word0_location + word1_w2
;   Stored in NS entry word2[15:0]
;   Re-verified by hardware on every CALL, RETURN, mLoad
; ============================================================

; ---- B:00 FAULT_RST -------------------------------------
; Hardware only: assert reset, clear registers, PC = 0

; ---- B:01 LOAD_NS ---------------------------------------
; Hardware only: mLoad NS Slot 0 \u2192 CR15
;   CR15 = make_gt(GT_TYPE_INFORM, perms=0, slot_id=0, gt_seq=0)
;   CR15.word1 = location = 0x0000
;   CR15.word2 = word1_packed (limit=0xFFFF, clistCount=N)
;   CR15.word3 = word2_seals  (gt_seq=0, CRC-16 seal)

; ---- B:02 INIT_THRD -------------------------------------
; First user instruction emitted by boot ROM:
    CHANGE  AL, CR12, CR12, #1   ; switch to thread context (ENABLE_CHANGE_SWITCH)

; ---- B:03 INIT_ABSTR ------------------------------------
; Load boot C-List entries and establish boot code identity
    LOAD    AL, CR1, CR6[0]    ; CR1 = code/constants GT (Inform, R|X, Slot 3, gt_seq=0)
    LOAD    AL, CR2, CR6[1]    ; CR2 = boot code GT     (Inform, X,   Slot 4, gt_seq=0)
    TPERM   AL, CR2, #X        ; restrict to X only (TPERM does not check seal)
    LAMBDA  AL, CR2            ; enter boot code via 1-word LAMBDA frame
                               ; \u21d2 SEAL_MISMATCH fault if NS Slot 4 tampered

; ---- B:04 LOAD_NUC --------------------------------------
; Load the first user abstraction E-GT and CALL into it
    LOAD    AL, CR0, CR6[6]    ; CR0 = User E-GT (Inform, E, Slot 4, gt_seq=0)
    TPERM   AL, CR0, #E        ; restrict to E \u2014 prepare for CALL
    CALL    AL, CR0, CR0       ; \u21d2 hardware validates seal of NS Slot 4
                               ;    derives CR14 (code GT, base=0x0400, limit=0xFF, perm=XR)
                               ;    derives CR6  (c-list GT, base=clistStart, limit=clistCount-1, perm=L)
                               ;    pushes 2-word CALL frame onto thread LIFO stack (STO += 2)
                               ;    sets PC = 0 \u2014 first user abstraction begins

; ---- Boot epilogue (after user RETURN) ------------------
    LOAD    AL, CR7, CR6[1]    ; reload boot code GT (Slot 4)
    TPERM   AL, CR7, #X        ; restrict to X
    LAMBDA  AL, CR7            ; re-enter boot finalisation (seal re-checked here)

    RETURN  AL, CR5            ; clear CR5 (capability mask 0b100000); boot complete

    SAVE    AL, CR6, CR1, #2   ; persist Thread GT at c-list[2] for runtime use

; ---- C-List contents at boot (DEMO_CLIST in boot_rom.py) --
; Index  GT                                       Role
;   0    make_gt(Inform, R|X, slot_id=3, gt_seq=0) Code/constants read+exec
;   1    make_gt(Inform, X,   slot_id=4, gt_seq=0) Boot code exec-only
;   2    make_gt(NULL,   0,   0,         0)         Empty (filled by SAVE above)
;   3    make_gt(Inform, E,   slot_id=2, gt_seq=0) Boot.Abstr E-GT
;   4    make_gt(Inform, E,   slot_id=5, gt_seq=0) Secondary abstraction E-GT
;   5    make_gt(Inform, L,   slot_id=6, gt_seq=0) C-List L-GT (for BIND)
;   6    make_gt(Inform, E,   slot_id=4, gt_seq=0) First user abstraction E-GT
;   7    make_gt(NULL,   0,   0,         0)         Reserved</pre>
<div class="sr-key-concept"><div class="sr-concept-title">Two Security Checkpoints</div>
<ol style="margin:4px 0 0 0;padding-left:1.2em;line-height:1.9;">
<li><strong>LAMBDA AL, CR2</strong> (B:03) \u2014 validates the CRC-16 seal of NS Slot\u202f4 (boot code lump). Any in-flight modification of the boot code\u2019s NS entry causes an immediate <code>SEAL_MISMATCH</code> fault before a single user instruction executes.</li>
<li><strong>CALL AL, CR0</strong> (B:04) \u2014 validates the CRC-16 seal of the first user abstraction\u2019s NS slot (also Slot\u202f4 in the demo c-list). A tampered or forged E-GT pointing to wrong memory fails here. No user code runs until both seals pass.</li>
</ol>
</div>`
            },
            {
                title: 'GT Seal Verification \u2014 Deep Dive',
                type: 'seal',
                content: `<p>The CRC-16 seal is the mechanism that makes every GT unforgeable. This slide shows exactly what the hardware checks, and how the boot listing relies on it at each checkpoint.</p>
<div class="sr-key-concept"><div class="sr-concept-title">Seal Computation (CRC-16/CCITT)</div>
<pre class="sr-code sr-code-asm">; Input to CRC-16/CCITT (poly=0x1021, init=0xFFFF):
;
;   Part 1: GT[24:0] (25 bits, MSB first)
;     = gt_type[1:0] | gt_seq[6:0] | slot_id[15:0]
;     (perms at bits [30:25] are NOT part of the sealed input)
;   Part 2: word0_location  (32 bits) \u2014 lump base address
;   Part 3: word1_w2        (32 bits) \u2014 (gt_seq &lt;&lt; 21) | (alloc_size - 1)
;
; Total input: 89 bits
; Output: 16-bit CRC stored in NS entry word2[15:0]
;
; The hardware recomputes this CRC from the LIVE NS entry on every:
;   \u2022 LAMBDA / CALL (entering any abstraction)
;   \u2022 RETURN (re-validating caller\u2019s E-GT from the frame)
;   \u2022 mLoad  (loading any GT through CR15)
;
; If computed CRC \u2260 stored seal \u21d2 SEAL_MISMATCH fault
; If GT gt_seq \u2260 NS entry gt_seq[31:25] \u21d2 VERSION fault (revoked)</pre>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">Boot Seal Timeline</div>
<table class="sr-table">
<tr><th>Boot point</th><th>GT checked</th><th>NS slot read</th><th>Fault if fail</th></tr>
<tr><td>B:01 LOAD_NS</td><td>zero-perm GT for Slot\u202f0</td><td>Slot\u202f0 (NS root)</td><td>SEAL_MISMATCH</td></tr>
<tr><td>B:03 LAMBDA CR2</td><td>X-perm GT, Slot\u202f4</td><td>Slot\u202f4 (boot code)</td><td>SEAL_MISMATCH</td></tr>
<tr><td>B:04 CALL CR0</td><td>E-perm GT, Slot\u202f4</td><td>Slot\u202f4 (user abstr)</td><td>SEAL_MISMATCH</td></tr>
</table>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">Why the Seal Uses GT[24:0] (not GT[31:0])</div>
<p>The CRC input uses only bits [24:0] of the GT word: <strong>gt_type</strong> (bits 24:23), <strong>gt_seq</strong> (bits 22:16), and <strong>slot_id</strong> (bits 15:0). The <strong>perms</strong> field (bits 30:25) and the <strong>b_flag</strong> (bit 31) are <em>excluded</em> from the seal. This means the IDE can modify permission bits or the bindable flag without invalidating existing tokens. Identity and revocation (slot_id, gt_seq, gt_type) are sealed; authority (perms) is enforced separately by the hardware permission-check gate on every access.</p>
</div>`
            },
            {
                title: 'Initial Thread C-List Wiring',
                type: 'clist_wire',
                content: `<p>After boot, the first user abstraction inherits a pre-wired C-List built by the boot ROM. Understanding this wiring is essential for writing the first CLOOMC method correctly.</p>
<pre class="sr-code sr-code-asm">; ============================================================
; Initial C-List wiring after B:04 CALL
; (user abstraction is at NS Slot 4, c-list at top of lump)
;
; The user abstraction\u2019s c-list is populated by the IDE at
; upload time (Navana.Abstraction.Add). At first call, CR6
; points here:
;
; idx  Contents                              Role
;  0   make_gt(Inform, E, slot_id=2, gt_seq=0) Boot.Abstr E-GT (return channel)
;  1   make_gt(Inform, L, slot_id=6, gt_seq=0) NS C-List L-GT (for later BIND)
;  2   (filled by boot SAVE: Thread GT)        Thread lump capability (R|W)
;  3   make_gt(Inform, E, slot_id=5, gt_seq=0) Navana system abstraction E-GT
;  ...  (programmer-declared capabilities follow)
;
; CR14 after CALL:
;   base  = 0x0400  (Slot 4 lump base)
;   limit = 0x00FF  (alloc_size - 1 = 255 for 256-word lump)
;   perm  = XR      (execute + read-only constants in code region)
;
; CR6 after CALL:
;   base  = 0x0400 + (256 - clistCount)  ; packed at top of lump
;   limit = clistCount - 1
;   perm  = L only

; First instruction in the user abstraction:
USER_ENTRY:
    ; Verify we have a valid Thread GT in C-List[2]
    LOAD    AL, CR3, CR6[2]    ; CR3 = Thread GT (Inform, R|W, Slot 1, gt_seq=0)
    ;   Seal re-checked here: CRC-16 of (GT[24:0], 0x0100, word1_packed)
    ;   VERSION fault if the Thread slot has been revoked since boot

    ; Use the Thread GT to read thread-local data
    DREAD   DR1, CR3, #0       ; read thread lump word 0 (e.g. a stored argument)

    ; Continue with application logic ...
    ; RETURN to boot epilogue when done
    RETURN  AL, CR0            ; clear CR0 on exit</pre>
<div class="sr-key-concept"><div class="sr-concept-title">Capability-Safe Handoff Guarantee</div>
<p>By the time the user abstraction\u2019s first instruction executes:</p>
<ul style="margin:4px 0 0 0;padding-left:1.2em;line-height:1.9;">
<li>CR15 holds the authenticated Namespace Root (seal verified at B:01).</li>
<li>CR13 holds the Thread Abstraction GT (seal verified at B:02).</li>
<li>CR14 bounds execution to the user\u2019s own lump (BOUNDS fault if PC escapes).</li>
<li>CR6 bounds capability access to the user\u2019s own C-List (PERM fault if overrun).</li>
<li>Both boot seals have passed \u2014 no NS entry in the chain has been tampered with.</li>
</ul>
<p>The user abstraction inherits <em>only</em> the authority encoded in its C-List. It cannot forge a GT, cannot escape its lump, and cannot access any capability it was not explicitly given.</p>
</div>`
            },
            {
                title: 'Boot ROM Cross-Reference (hardware/boot_rom.py)',
                type: 'boot_rom',
                content: `<p>The Amaranth HDL boot ROM (<code>hardware/boot_rom.py</code>) encodes the same sequence in 32-bit machine words. This slide maps each BOOT_PROGRAM word to the CLOOMC listing above.</p>
<table class="sr-table">
<tr><th>BOOT_PROGRAM index</th><th>Encoded instruction</th><th>Listing step</th></tr>
<tr><td>[0]</td><td><code>CHANGE AL, CR12, CR12, #1</code></td><td>B:02 INIT_THRD \u2014 thread context switch</td></tr>
<tr><td>[1]</td><td><code>LOAD AL, CR1, CR6[0]</code></td><td>B:03 \u2014 load code/constants GT (R|X, Slot 3) into CR1</td></tr>
<tr><td>[2]</td><td><code>LOAD AL, CR2, CR6[1]</code></td><td>B:03 \u2014 load boot code GT (X, Slot 4) into CR2</td></tr>
<tr><td>[3]</td><td><code>TPERM AL, CR2, #X</code></td><td>B:03 \u2014 restrict CR2 to X only (no seal check)</td></tr>
<tr><td>[4]</td><td><code>LAMBDA AL, CR2</code></td><td>B:03 INIT_ABSTR \u2014 enter boot code (Slot 4) via LAMBDA; 1st seal checkpoint</td></tr>
<tr><td>[5]</td><td><code>LOAD AL, CR0, CR6[6]</code></td><td>B:04 \u2014 load first user E-GT into CR0</td></tr>
<tr><td>[6]</td><td><code>TPERM AL, CR0, #E</code></td><td>B:04 \u2014 restrict to E perm</td></tr>
<tr><td>[7]</td><td><code>CALL AL, CR0, CR0</code></td><td>B:04 LOAD_NUC \u2014 enter user abstraction</td></tr>
<tr><td>[8]</td><td><code>LOAD AL, CR7, CR6[1]</code></td><td>Epilogue \u2014 reload boot code GT</td></tr>
<tr><td>[9]</td><td><code>TPERM AL, CR7, #X</code></td><td>Epilogue \u2014 restrict to X</td></tr>
<tr><td>[10]</td><td><code>LAMBDA AL, CR7</code></td><td>Epilogue \u2014 re-enter boot finalisation</td></tr>
<tr><td>[11]</td><td><code>RETURN AL, CR5</code></td><td>Epilogue \u2014 boot complete; mask CR5</td></tr>
<tr><td>[12]</td><td><code>SAVE AL, CR6, CR1, #2</code></td><td>Epilogue \u2014 persist Thread GT to c-list[2]</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">DEMO_CLIST and DEMO_NAMESPACE</div>
<p>The boot ROM also defines <code>DEMO_NAMESPACE</code> (16 NS entries with stub metadata) and <code>DEMO_CLIST</code> (8 GTs). These are the C-List contents that CR6 points to when boot execution begins. The seven Inform-type GTs at indices 0\u202f\u2013\u202f6 correspond to the c-list[idx] references in the listing above. See <code>hardware/boot_rom.py</code> lines 102\u2013114.</p>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">make_gt() and _make_ns_entry() Helper Functions</div>
<p><code>make_gt(gt_type, perms, slot_id, gt_seq)</code> encodes the 32-bit GT word: <code>(perms &lt;&lt; 25) | (gt_type &lt;&lt; 23) | (gt_seq &lt;&lt; 16) | slot_id</code>. <code>_make_ns_entry()</code> builds the full 4-word NS table entry including the CRC-16 seal over <code>(GT[24:0], location, word1_w2)</code>. Both functions use the current field names \u2014 <code>slot_id</code>, <code>gt_seq</code>, Inform/Abstract type codes \u2014 matching the GT Word\u202f0 format shown on the overview slide.</p>
</div>`
            },
            {
                title: 'Secure Boot \u2014 Summary',
                type: 'summary',
                content: `<p>The secure boot sequence provides a hardware-verified chain of trust from power-on to the first user instruction. No software configuration file, no privilege escalation, no bypass path exists:</p>
<div class="sr-security-list">
<div class="sr-sec-item"><span class="sr-sec-num">1</span><strong>B:00 FAULT_RST.</strong> Hardware reset. All registers zeroed. No capability exists yet.</div>
<div class="sr-sec-item"><span class="sr-sec-num">2</span><strong>B:01 LOAD_NS.</strong> Hardware loads NS Slot\u202f0 into CR15. CRC-16 seal verified. Physical memory map authenticated.</div>
<div class="sr-sec-item"><span class="sr-sec-num">3</span><strong>B:02 INIT_THRD.</strong> CHANGE instruction establishes thread context. Thread lump (Slot\u202f1) is now the execution home for the boot thread.</div>
<div class="sr-sec-item"><span class="sr-sec-num">4</span><strong>B:03 INIT_ABSTR.</strong> LOAD\u202f+\u202fTPERM\u202f+\u202fLAMBDA sequence loads boot code GT (Slot\u202f4) and validates its seal via LAMBDA. Boot code cannot run if the boot code lump\u2019s NS entry has been tampered with.</div>
<div class="sr-sec-item"><span class="sr-sec-num">5</span><strong>B:04 LOAD_NUC.</strong> LOAD\u202f+\u202fTPERM\u202f+\u202fCALL sequence loads the first user E-GT (Slot\u202f4), validates its seal, derives CR14 and CR6 from NS metadata, pushes the CALL frame, and hands off at PC\u202f=\u202f0. The user abstraction inherits only the capabilities in its own C-List.</div>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">Properties Guaranteed at Handoff</div>
<table class="sr-table">
<tr><th>Register</th><th>Contents</th><th>Guarantees</th></tr>
<tr><td>CR15</td><td>NS Root GT (zero perms)</td><td>Physical address space authenticated</td></tr>
<tr><td>CR13</td><td>Thread GT (R|W, Slot\u202f1)</td><td>Thread lump bounds established</td></tr>
<tr><td>CR14</td><td>Code GT (XR or X, Slot\u202f4)</td><td>PC cannot escape user lump</td></tr>
<tr><td>CR6</td><td>C-List GT (L, user lump top)</td><td>Only declared capabilities accessible</td></tr>
</table>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">Further Reading</div>
<ul style="margin:4px 0 0 0;padding-left:1.2em;line-height:1.9;">
<li><strong>simulator/secure_boot_tutorial.js</strong> \u2014 this listing (full source)</li>
<li><strong>hardware/boot_rom.py</strong> \u2014 Amaranth HDL boot ROM with BOOT_PROGRAM, DEMO_CLIST, DEMO_NAMESPACE</li>
<li><strong>Tutorial: Namespace Abstraction</strong> \u2014 NS Slot\u202f0 root, word1 metadata, CRC-16 seal, CR15</li>
<li><strong>Tutorial: Programmed Abstractions</strong> \u2014 CR14, CR6, CALL/RETURN frame, E-GT, C-List</li>
</ul>
</div>`
            }
        ];
    }

    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let html = '<div class="sr-wrapper">';
        html += '<div class="sr-header">';
        html += '<h2>Secure Boot \u2014 CLOOMC Assembly Listing</h2>';
        html += '<p class="sr-tagline">LOAD_NS \u00b7 GT Seal Validation \u00b7 C-List Wiring \u00b7 CALL into User Code</p>';
        html += '<div class="sr-controls">';
        html += `<button class="btn btn-tutorial" onclick="secureBootTutorial.stepBack()" ${this.currentStep <= 0 ? 'disabled' : ''}>&laquo; Back</button>`;
        html += `<span class="tutorial-progress">${Math.max(0, this.currentStep + 1)} / ${this.steps.length}</span>`;
        html += `<button class="btn btn-tutorial" onclick="secureBootTutorial.stepForward()">${this.currentStep >= this.steps.length - 1 ? 'Reset' : 'Next &raquo;'}</button>`;
        html += '</div>';
        html += '</div>';

        html += '<div class="sr-body">';
        if (this.currentStep >= 0 && this.currentStep < this.steps.length) {
            const step = this.steps[this.currentStep];
            html += `<div class="sr-step-container sr-type-${step.type}">`;
            html += `<div class="sr-step-title">${step.title}</div>`;
            if (step.subtitle) html += `<div class="sr-step-subtitle">${step.subtitle}</div>`;
            html += `<div class="sr-step-content">${step.content}</div>`;
            html += '</div>';
        } else {
            html += '<div class="sr-step-container sr-type-intro">';
            html += '<div class="sr-step-title">Secure Boot \u2014 CLOOMC Assembly Listing</div>';
            html += '<div class="sr-step-content">';
            html += '<p>This tutorial presents the canonical CLOOMC assembly listing for secure startup on the Church Machine. It covers LOAD_NS, GT seal validation, C-List wiring, and the first CALL into user code \u2014 using the current GT Word\u202f0 format (slot_id, gt_seq, CRC-16 seal, Inform/Abstract type codes).</p>';
            html += '<p>Click <strong>Next</strong> to begin.</p>';
            html += '</div></div>';
        }
        html += '</div>';
        html += '</div>';

        container.innerHTML = html;
    }

    stepForward() {
        if (this.currentStep >= this.steps.length - 1) { this.reset(); return; }
        this.currentStep++;
        this.render('tutorialView');
    }

    stepBack() {
        if (this.currentStep <= 0) return;
        this.currentStep--;
        this.render('tutorialView');
    }

    reset() {
        this.currentStep = -1;
        this.render('tutorialView');
    }
}
