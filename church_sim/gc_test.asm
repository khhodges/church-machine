; ============================================
; Church Machine GC Test (PP250)
; GC via safe Turing abstraction — CALL GC
; Run AFTER boot completes (6 steps)
; ============================================
;
; GC is a SAFE ABSTRACTION — an atomic Turing
; machine hidden behind a Church-callable entry.
; CALL triggers the hidden implementation which
; scans, sweeps, and flips polarity. No Turing
; instructions visible to the calling program.
;
; Permission gates (mLoad is the single guard):
;   R = DREAD, W = DWRITE, X = LAMBDA,
;   L = LOAD, S = SAVE (+ B=1), E = CALL
;
; Expected: 16 entries freed, 8 survive (+GC).
; ============================================

; --- Phase 1: Load subset into CRs (survivors) ---
; Each LOAD calls mLoad(L), toggling G to "live"
LOAD CR0, CR6, 2       ; CR0 = Lambda    (E)
LOAD CR1, CR6, 7       ; CR1 = SUCC      (XLE)
LOAD CR2, CR6, 6       ; CR2 = Stack     (E)
LOAD CR3, CR6, 9       ; CR3 = ADD       (XLE)
LOAD CR4, CR6, 5       ; CR4 = Constants (E)

; --- Phase 2: Verify permissions ---
TPERM CR0, E           ; Lambda has E? PASS
TPERM CR1, LE          ; SUCC has L+E? PASS
TPERM CR2, E           ; Stack has E? PASS
TPERM CR3, LE          ; ADD has L+E? PASS
TPERM CR4, E           ; Constants has E? PASS

; --- Phase 3: Exercise live capabilities ---
; LAMBDA checks X permission via mLoad
LAMBDA CR1             ; Church SUCC reduction (X)
LAMBDA CR3             ; Church ADD reduction (X)

; --- Phase 4: CALL GC safe abstraction ---
; CALL checks E permission via mLoad
LOAD CR5, CR6, 24      ; CR5 = GC abstraction (E)
TPERM CR5, E           ; Verify E permission
CALL CR5               ; Trigger GC — atomic Turing abstraction

; --- Phase 5: HALT ---
; GC has completed. Namespace Browser shows results.
; 16 entries swept, 8 entries survived.
; Polarity flipped for next cycle.
HALT
