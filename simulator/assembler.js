// =============================================================================
// assembler.js — Church Machine Assembly Language Encoder
// =============================================================================
//
// Implements the two-pass assembler for the Church Machine instruction set.
// Turns human-readable Church assembly mnemonics into 32-bit machine words
// that can be loaded into the simulator or serialised to a hardware binary.
//
// PRIMARY CLASS
//   ChurchAssembler
//     Instantiated once in app.js as `assembler`.
//     Entry point: assemble(sourceText) → { words[], errors[], listing[] }
//
// INSTRUCTION ENCODING  (32-bit word, big-endian field layout)
//
//   Standard instruction header (v2.0: Church opcodes 0–9, Turing opcodes 16–25, gaps 10–15 and 26–29 FAULT):
//     bits[31:27]  opcode   (5 bits; 0–9 Church; 16–25 Turing; 0x1E=WORD; 0x1F=lump header)
//     bits[26:23]  condition code (ARM-style: EQ/NE/CS/CC/MI/PL/VS/VC/
//                                              HI/LS/GE/LT/GT/LE/AL/NV)
//     bits[22:0]   operand fields  (vary by opcode — see cases in assemble())
//
//   WORD directive (opcode 0x1E) — inline data constant:
//     bits[31:27]  0x1E
//     bits[26:0]   27-bit data payload  (INVALID_OP if executed; read via DREAD CR14)
//
// OPCODES
//   0  LOAD       CR ← NS[idx]          Load abstraction GT into CR
//   1  SAVE       NS[idx] ← CR          Save CR back to NS slot
//   2  CALL       invoke CR             Enter abstraction, push call frame
//   3  RETURN     unwind call frame     Return to caller
//   4  CHANGE     DR ← imm / DR op DR  Integer / immediate data-register op
//   5  SWITCH     privileged CR install  PassKey-gated one-way install into CR13/CR15
//   6  TPERM      thread permission     Assert / revoke thread privilege
//   7  LAMBDA     create closure        Mint a new capability from template
//   8  ELOADCALL  c-list[n] → CALL      Load from c-list and call in one op
//   9  XLOADLAMBDA                      Extended load-lambda
//  (10–15 unassigned — FAULT if executed)
//  16  DREAD      read device register  MMIO read from I/O segment
//  17  DWRITE     write device register MMIO write to I/O segment
//  18  BFEXT      bit-field extract     Extract bits[hi:lo] from DR
//  19  BFINS      bit-field insert      Insert bits into DR at [hi:lo]
//  20  MCMP       memory compare        Compare two memory regions
//  21  IADD       integer add           DR ← DR + DR  (or DR + imm)
//  22  ISUB       integer subtract      DR ← DR − DR  (or DR − imm)
//  23  BRANCH     conditional branch    PC-relative jump
//  24  SHL        shift left            DR ← DR << n
//  25  SHR        shift right           DR ← DR >> n  (logical)
//  (26–29 unassigned — FAULT if executed)
// 0x1E WORD       inline data constant  bits[26:0] = 27-bit payload
// 0x1F             lump header magic    (not an instruction)
//
// CONDITION CODES  (ARM-compatible, bits[26:23])
//   0  EQ  Equal                     Z=1
//   1  NE  Not Equal                 Z=0
//   2  CS  Carry Set                 C=1
//   3  CC  Carry Clear               C=0
//   4  MI  Minus (negative)          N=1
//   5  PL  Plus (positive or zero)   N=0
//   6  VS  Overflow Set              V=1
//   7  VC  Overflow Clear            V=0
//   8  HI  Higher (unsigned)         C=1 & Z=0
//   9  LS  Lower or Same (unsigned)  C=0 | Z=1
//  10  GE  Greater or Equal (signed) N=V
//  11  LT  Less Than (signed)        N≠V
//  12  GT  Greater Than (signed)     Z=0 & N=V
//  13  LE  Less or Equal (signed)    Z=1 | N≠V
//  14  AL  Always                    (unconditional)
//  15  NV  Never                     (never executes)
//
// ASSEMBLY SYNTAX  (one instruction per line)
//   MNEMONIC  [.COND]  operand, operand, ...
//   ; lines beginning with semicolon are comments
//   ; B:N  marks a tutorial breakpoint (integer N)
//
// LABEL SUPPORT
//   Labels are defined with "name:" on their own line.
//   They serve two purposes:
//
//   1. BRANCH target (signed PC-relative offset)
//      BRANCH / BRANCHcond accept a label instead of a raw signed integer.
//      The assembler computes:  offset = label_word - branch_word  (signed).
//      Numeric offsets still work unchanged.  Forward references are resolved
//      in pass 1 before encoding, so labels may appear after the branch.
//      Example:
//          loop_top:
//              ISUB DR1, DR1, #1
//              BRANCHNE loop_top      ; equivalent to BRANCHNE -1
//
//   2. DREAD CR14 data-constant address (absolute word offset)
//      When reading an inline WORD constant from the current lump via CR14,
//      the imm operand may be a label name instead of a raw number.
//      The assembler substitutes the label's absolute word position.
//      Both  #label  and  label  (without #) are accepted.
//      Example:
//          DREAD  DR1, CR14, #V1   ; read inline constant labelled V1
//          DREAD  DR2, CR14, V2    ; same — # prefix is optional
//          RETURN
//          V1:  WORD 42
//          V2:  WORD 99
//
// NAMED ABSTRACTION SYMBOLS  (NS shorthand)
//   The assembler accepts registered abstraction names wherever a CR source
//   operand appears, in two complementary ways:
//
//   Two-operand LOAD/SAVE/ELOADCALL/XLOADLAMBDA shorthand:
//     LOAD  CRdst, Name          → LOAD  CRdst, CR6, slot
//     SAVE  CRdst, Name          → SAVE  CRdst, CR6, slot
//     ELOADCALL  CRdst, Name     → ELOADCALL  CRdst, CR6, slot
//     XLOADLAMBDA  CRdst, Name   → XLOADLAMBDA  CRdst, CR6, slot
//   CR6 is the c-list root by convention.  For LOAD and SAVE the assembler
//   also records  Name → CRdst  in an internal map so the loaded-CR resolution
//   kicks in immediately for subsequent instructions in the same program.
//
//   Loaded-CR resolution in any CR operand position:
//   After  LOAD CR11, SlideRule  is assembled, the name SlideRule is known to
//   be in CR11.  Any subsequent instruction that names SlideRule where a CR is
//   expected resolves to CR11 automatically:
//     CALL    SlideRule              → CALL    CR11
//     SWITCH  SlideRule              → SWITCH  CR11
//     LOAD    CR5, SlideRule, 3      → LOAD    CR5, CR11, 3
//     ELOADCALL CR0, SlideRule, 2   → ELOADCALL CR0, CR11, 2
//   Names are matched case-sensitively (SlideRule ≠ sliderule).
//   Unknown names produce an error listing all known abstraction and loaded names.
//
//   Named method selectors in CALL:
//   When the assembler is constructed with a methodConventions map (e.g.
//   METHOD_REGISTER_CONVENTIONS), the second operand of CALL may be a method
//   name instead of a raw integer.  Two equivalent syntaxes are accepted:
//     CALL SlideRule, Multiply       → imm=1  (Multiply index 0 → 1-based)
//     CALL SlideRule.Multiply        → imm=1  (dot-notation form, identical)
//     CALL SlideRule, Divide         → imm=2  (Divide index 1)
//     CALL SlideRule.Sqrt            → imm=3  (Sqrt index 2)
//   The abstraction name must have been previously bound via LOAD (loaded-CR resolution).
//   Numeric selectors use 1-based encoding (selector+1 stored in imm15):
//     CALL SlideRule, 0              → imm=1  (method 0, table slot 1)
//     CALL CR11, 0                   → imm=1  (method 0, table slot 1)
//     CALL CR11 (no selector)        → imm=0  (fast-path, NIA = lump word 1)
//   Supported range: 0–16383 (imm15 slots 1–16384).
//   If the method name is not found a clear error lists the known methods.
//
//   Method index in ELOADCALL:
//   ELOADCALL imm15 is a two-part field: bits[14:8] = method index (1-based,
//   0 = fast-path), bits[7:0] = c-list row.  An optional method name or
//   0-based integer may follow the abstraction name / slot operand:
//     ELOADCALL CR0, SlideRule           → imm = 0x0001  (row=1, method=0)
//     ELOADCALL CR0, SlideRule, Multiply → imm = 0x0101  (row=1, method=1)
//     ELOADCALL CR0, SlideRule, Divide   → imm = 0x0201  (row=1, method=2)
//     ELOADCALL CR0, CR6, #1, 0         → imm = 0x0101  (row=1, method=1 for 0-based idx 0)
//   Without a method operand the fast-path (method=0, NIA = lump word 1) is used.
//   Supported c-list row range: 0–255; method index range: 0–126 (0-based).
//
// POST-ASSEMBLY BRANCH BOUNDS CHECK
//   After encoding all words, the assembler verifies that every BRANCH
//   target falls within [0, total_code_words).  Out-of-range targets are
//   reported as assembly errors with the source line number and target address.
//
// PSEUDO-OPS / DIRECTIVES
//   .word  <hex>    — emit a raw 32-bit literal word
//   name:           — define a branch target label (on its own line)
//   ; any text      — comment, stripped before encoding
//   .pet <alias> DR<n>  — declare symbolic alias for data register DR<n>
//   .pet <alias> CR<n>  — declare symbolic alias for capability register CR<n>
//   .petname <n>    — register c-list slot n with PetNameMemory (PETNAME <n> also accepted)
//                     Expands to: LOAD CR11, CR6, 18  (ChurchHW cap from boot c-list)
//                                 IADD DR1, DR0, #n   (slot number)
//                                 DWRITE DR1, CR11, 0 (write slot n to ChurchHW)
//                     Clobbers: CR11, DR1.  Slot must be 0–63.
//
// PET DIRECTIVES  (.pet — register aliases)
//   Aliases allow human-readable names in place of DR<n> / CR<n> tokens.
//   They are collected in a pre-pass and produce no machine words.
//   Case-insensitive for the keyword (.PET); alias names are case-sensitive.
//   Redeclaring an alias to a different register emits a warning.
//   Redeclaring to the same register is silently accepted.
//   Example:
//       .pet result  DR1
//       .pet count   DR2
//       IADD  result, result, count   ; same as IADD DR1, DR1, DR2
//
// SHARED / INHERITED ALIASES  (ChurchAssembler.setSharedAliases)
//   Call  ChurchAssembler.setSharedAliases(drMap, crMap)  once at startup to
//   declare project-wide register conventions that all subsequently-created
//   assembler instances inherit automatically.  Local .pet declarations in
//   individual lumps take precedence over shared aliases.
//   Example:
//       ChurchAssembler.setSharedAliases(
//           { result: 1, count: 2 },   // DR aliases shared by all lumps
//           { heap: 5, logger: 10 }    // CR aliases shared by all lumps
//       );
//   This is the correct place to encode a project's calling convention so it
//   does not have to be duplicated with .pet in every abstraction source file.
//
// OUTPUT
//   assemble() returns:
//     words[]    — Uint32Array of encoded machine words
//     errors[]   — { line, message } for any parse failures
//     listing[]  — { addr, word, source } one entry per instruction
//
// HARDWARE CROSS-REFERENCE
//   hardware/call.py      — CALL/RETURN micro-op encoding must match bit[27:23]
//   simulator/simulator.js _bootStep() — hand-coded boot words verified here
//
// =============================================================================

class ChurchAssembler {
    constructor(methodConventions = {}) {
        // Merge class-level shared conventions first, then any caller-supplied
        // overrides.  This means all three instantiation sites (compile path,
        // test assembler in app-run.js, and decompileWords) automatically pick
        // up conventions registered via setSharedMethodConventions() without any
        // change at each call site.
        this.methodConventions = Object.assign(
            {}, ChurchAssembler._sharedMethodConventions || {}, methodConventions);
        this.opcodes = {
            'LOAD': 0, 'SAVE': 1, 'CALL': 2, 'RETURN': 3,
            'CHANGE': 4, 'SWITCH': 5, 'TPERM': 6, 'LAMBDA': 7,
            'ELOADCALL': 8, 'XLOADLAMBDA': 9,
            'DREAD': 16, 'DWRITE': 17,            // ★ v2.0: Turing opcodes start at 16
            'BFEXT': 18, 'BFINS': 19,
            'MCMP': 20, 'IADD': 21, 'ISUB': 22,
            'BRANCH': 23, 'SHL': 24, 'SHR': 25,
            'WORD': 0x1E,
        };
        this.conditions = {
            'EQ': 0, 'NE': 1, 'CS': 2, 'CC': 3,
            'MI': 4, 'PL': 5, 'VS': 6, 'VC': 7,
            'HI': 8, 'LS': 9, 'GE': 10, 'LT': 11,
            'GT': 12, 'LE': 13, 'AL': 14, 'NV': 15,
            'HS': 2, 'LO': 3,
        };
        this.tpermPresets = {
            'CLEAR': 0, 'R': 1, 'RW': 2, 'X': 3,
            'RX': 4, 'RWX': 5, 'L': 6, 'S': 7,
            'E': 8, 'LS': 9,
            'FRAME': 13,   // call-stack query: Z=1 if a real return frame exists (RETURN would not underflow)
            'EXACT': 14,   // 32-bit identity check: CRd.word0 === CRs.word0 → Z=1
            'B': 0x10, 'RB': 0x11, 'RWB': 0x12, 'XB': 0x13,
            'RXB': 0x14, 'RWXB': 0x15, 'LB': 0x16, 'SB': 0x17,
            'EB': 0x18, 'LSB': 0x19,
        };
        this.labels = {};
        this.errors = [];
        this.warnings = [];    // non-fatal diagnostics (e.g. .pet alias redefinition to different reg)
        // Start with shared (project-wide) aliases; local .pet declarations added later
        // by _parsePetDirectives will shadow / override these.
        this._drAliases = Object.assign({}, ChurchAssembler._sharedDrAliases || {});
        this._crAliases = Object.assign({}, ChurchAssembler._sharedCrAliases || {});
        // Inherit the class-level namespace so locally-created assembler instances
        // (e.g. inside tutorials, builder, CLOOMC) automatically get symbol resolution
        // without every call site needing to call setNamespace() individually.
        this.nsSymbols  = Object.assign({}, ChurchAssembler._sharedNsSymbols  || {});
        this.nsLoaded   = {};  // name → CR index (updated during assembly)
        // Null-GT row pet names: name → c-list slot index (e.g. {Mum: 5}).
        // Set via setClistSlots(); inherited class-wide like nsSymbols.
        this._clistSlots    = Object.assign({}, ChurchAssembler._sharedClistSlots || {});
        // Capabilities-block slots — rebuilt each assemble() call; always fresh.
        this._capBlockSlots = {};
    }

    // setClistSlots(nameToSlot) — register null-GT row pet names so the assembler
    // can resolve them to their c-list slot indices.
    // nameToSlot: plain object  { 'Mum': 5, 'Dad': 6, ... }  (name → slot index).
    // Persisted class-wide (like setNamespace) so future instances inherit it.
    setClistSlots(nameToSlot) {
        ChurchAssembler._sharedClistSlots = Object.assign({}, nameToSlot || {});
        this._clistSlots = Object.assign({}, ChurchAssembler._sharedClistSlots);
    }

    // setSharedMethodConventions(map) — register bare-call method conventions
    // class-wide so all subsequent new ChurchAssembler() instances (compile,
    // test, decompile paths) inherit them automatically without a page reload.
    //
    // map format mirrors the constructor argument:
    //   { 'AbsName': { 'MethodName': { index: N, input: 'CR2=arg', output: 'DR1' } } }
    //
    // Merges into any existing shared conventions (does not replace wholesale),
    // so callers can register abstraction groups incrementally at startup.
    // Also updates this.methodConventions on the instance that calls it so the
    // conventions are available immediately (matching setNamespace() behaviour).
    static setSharedMethodConventions(map) {
        ChurchAssembler._sharedMethodConventions = Object.assign(
            {}, ChurchAssembler._sharedMethodConventions || {}, map || {});
    }

    setSharedMethodConventions(map) {
        ChurchAssembler.setSharedMethodConventions(map);
        Object.assign(this.methodConventions, map || {});
    }

    // ── Live snippet history ─────────────────────────────────────────────────
    // Per-method compile history: newest entry first, capped at 20.
    // localStorage key: cm_snippet_<absName>_<methodName>
    // Value: JSON array [{ ts: number, source: string }, …]
    //
    // pushLiveSnippet(absName, methodName, sourceText)
    //   Prepends { ts: Date.now(), source: sourceText } to the stack.
    //   Persists to localStorage (pruned to 20 entries).
    //
    // getLiveSnippets(absName, methodName)
    //   Returns the stack array (newest first), or null if none exist.
    //   Lazily loads from localStorage on first call for the session.

    // localStorage key helper — used for both push and lazy-load
    static _lsKey(absName, methodName) {
        return `cm_snippet_${absName}_${methodName}`;
    }

    // _liveSnippets shape: { absName: { methodName: [{ ts, source }, …] } }
    // Matches the design spec; access is always via pushLiveSnippet/getLiveSnippets.
    static pushLiveSnippet(absName, methodName, sourceText) {
        const lsKey = ChurchAssembler._lsKey(absName, methodName);
        if (!ChurchAssembler._liveSnippets[absName]) {
            ChurchAssembler._liveSnippets[absName] = {};
        }
        let stack = ChurchAssembler._liveSnippets[absName][methodName];
        if (!stack) {
            try { stack = JSON.parse(localStorage.getItem(lsKey) || 'null') || []; }
            catch (_) { stack = []; }
        }
        stack.unshift({ ts: Date.now(), source: sourceText });
        if (stack.length > 20) stack.length = 20;
        ChurchAssembler._liveSnippets[absName][methodName] = stack;
        try { localStorage.setItem(lsKey, JSON.stringify(stack)); } catch (_) {}
    }

    static getLiveSnippets(absName, methodName) {
        const cached = ChurchAssembler._liveSnippets[absName];
        if (!cached || !cached[methodName]) {
            try {
                const stored = JSON.parse(localStorage.getItem(ChurchAssembler._lsKey(absName, methodName)) || 'null');
                if (stored && stored.length > 0) {
                    if (!ChurchAssembler._liveSnippets[absName]) ChurchAssembler._liveSnippets[absName] = {};
                    ChurchAssembler._liveSnippets[absName][methodName] = stored;
                } else {
                    return null;
                }
            } catch (_) { return null; }
        }
        const stack = ChurchAssembler._liveSnippets[absName][methodName];
        return (stack && stack.length > 0) ? stack : null;
    }

    setNamespace(map) {
        // Persist as a class-level default so any future ChurchAssembler() instance
        // created anywhere in the app inherits the same namespace automatically.
        ChurchAssembler._sharedNsSymbols = Object.assign({}, map);
        this.nsSymbols = Object.assign({}, ChurchAssembler._sharedNsSymbols);
        this.nsLoaded  = {};   // clear stale CR assignments
    }

    // ── Shared register alias conventions (inherited by all future instances) ──
    //
    // Call once at project startup to establish project-wide DR/CR naming
    // conventions.  Every ChurchAssembler constructed afterwards inherits these
    // as default aliases; local .pet directives inside individual lumps override
    // them for that lump only.
    //
    //   drMap — { aliasName: drIndex, … }   e.g. { result: 1, count: 2 }
    //   crMap — { aliasName: crIndex, … }   e.g. { heap: 5, logger: 10 }
    //
    // Call with empty objects to clear previously-set shared aliases.
    static setSharedAliases(drMap = {}, crMap = {}) {
        ChurchAssembler._sharedDrAliases = Object.assign({}, drMap);
        ChurchAssembler._sharedCrAliases = Object.assign({}, crMap);
    }

    // _resolveNSNameBracket(nameToken, idxToken)
    // Tries _resolveNSName(nameToken) first; if that fails:
    //   • idxToken is a bare decimal  → tries the bracket form "NAME[N]"
    //     (handles the tokenizer splitting "LED[0]" into "LED" "0")
    //   • idxToken is a plain word    → tries the two-word form "NAME WORD"
    //     (handles the tokenizer splitting "LED flash" into "LED" "flash")
    // Returns { slot, key, consumed } on success, or null on failure.
    _resolveNSNameBracket(nameToken, idxToken) {
        const name = (nameToken || '').replace(/,/g, '').trim();
        const idx  = (idxToken  || '').replace(/,/g, '').trim();

        // 1. Single-token lookup (idxToken not needed).
        const slot = this._resolveNSName(nameToken);
        if (slot !== null) return { slot, key: name, consumed: false };

        // 2. Bracket form: tokenizer split "LED[0]" → "LED" + "0".
        if (idx && /^\d+$/.test(idx)) {
            const combined = name + '[' + idx + ']';
            const slotBr = this._resolveNSName(combined);
            if (slotBr !== null) return { slot: slotBr, key: combined, consumed: true };
        }

        // 3. Two-word abstraction name: tokenizer split "LED flash" → "LED" + "flash".
        //    Only when idxToken is a plain identifier (not a number, not empty).
        if (idx && /^[A-Za-z_]\w*$/.test(idx)) {
            const combined2 = name + ' ' + idx;
            const slot2 = this._resolveNSName(combined2);
            if (slot2 !== null) return { slot: slot2, key: combined2, consumed: true };
        }

        return null;
    }

    // _checkCapDeclared(name, lineNum)
    // When a capabilities { } block is present in the source (_hasCapBlock is true),
    // every named abstraction used in LOAD / ELOADCALL / CALL dot-notation must appear
    // in that block.  If it is absent, emit a clear error pointing to the missing entry.
    // No-op when no capabilities block was declared (backward-compatible with programs
    // that rely entirely on the DEMO_CLIST or namespace auto-resolution).
    _checkCapDeclared(name, lineNum) {
        if (!this._hasCapBlock) return;
        const cleanName = (name || '').replace(/,/g, '').trim();
        if (!cleanName) return;
        if (this._capBlockSlots[cleanName] === undefined) {
            // For hardware device shorthands (UART/BTN/SlideRule/Timer/Display/LED*),
            // accept a case-insensitive match — `capabilities { uart }` + `LOAD CR5, UART`
            // must not produce a "not declared" error.
            if (ChurchAssembler._isHardwareCapName(cleanName)) {
                const cleanUC = cleanName.toUpperCase();
                const found = Object.keys(this._capBlockSlots).some(
                    k => k.toUpperCase() === cleanUC
                );
                if (found) return;
            }
            this.errors.push({
                line: lineNum,
                ...this._tokenCols(this._currentLineText, cleanName),
                message: `"${cleanName}" is used but not declared in the capabilities block. Add it with a permission letter:\n  capabilities { ${cleanName} E }`
            });
        }
    }

    _resolveNSName(token) {
        if (!token) return null;
        const name = token.replace(/,/g, '').trim();

        // 1. Currently loaded into a CR (e.g. after  LOAD CR6, LED)
        if (this.nsLoaded[name] !== undefined) return this.nsLoaded[name];

        // 1.5. Capabilities-block pre-pass — every capability declared in this
        //      assembly's  capabilities { }  block gets its 0-based position as its
        //      c-list offset.  This covers LED devices, NS-based abstractions, and
        //      null-GT rows alike.  A program with a capabilities block defines its
        //      OWN c-list layout; the DEMO_CLIST slots (paths 2–3) must not override.
        //      For programs without a capabilities block, _capBlockSlots is {}.
        if (this._capBlockSlots && this._capBlockSlots[name] !== undefined)
            return this._capBlockSlots[name];

        // 2. Namespace Table (populated via setNamespace from the abstraction slot map)
        if (this.nsSymbols[name] !== undefined) return this.nsSymbols[name];

        // 2.5. Null-GT row pet names (setClistSlots) — user-named c-list slots that
        //      hold no NS entry (e.g. "Mum" at slot 5).  These map directly to the
        //      c-list offset used in  LOAD  CRd, CR6[0x0005].
        if (this._clistSlots && this._clistSlots[name] !== undefined)
            return this._clistSlots[name];

        // 3. LED<N> Abstract GT shorthand — LED0–LED5 are boot-loaded AGTs at
        //    c-list slots 8–13.  LOAD CR3, LED0  →  LOAD CR3, CR6, #8
        //    Legacy bracket form LED[N] is still accepted for back-compat.
        const ledMatch = name.match(/^LED(\d)$/i) || name.match(/^LED\[(\d)\]$/i);
        if (ledMatch) {
            const n = parseInt(ledMatch[1], 10);
            if (n >= 0 && n <= 5) return 8 + n;
        }

        // 3.2. Hardware device shorthands — fixed boot c-list slots 14–17.
        //      These are checked AFTER nsSymbols so that an explicit namespace table
        //      (set via setNamespace) takes priority when the abstraction is mounted
        //      in the Namespace Table for method dispatch (ELOADCALL).  When no
        //      namespace entry is present — e.g. in bare LOAD instructions without a
        //      capabilities block — the name falls through to here and resolves to the
        //      fixed boot c-list slot for that hardware device.
        //
        //      UART→14, BTN→15, SlideRule→16, Timer→17  (case-insensitive)
        //
        //      Note: if the shared namespace happens to carry a stale Timer or UART
        //      entry from a different test context, callers (BC97–BC100) should clear
        //      ChurchAssembler._sharedNsSymbols before assembling to avoid shadowing.
        {
            const nameUC = name.toUpperCase();
            if (nameUC === 'UART')      return 14;
            if (nameUC === 'BTN')       return 15;
            if (nameUC === 'SLIDERULE') return 16;
            if (nameUC === 'TIMER')     return 17;
        }

        // 3.5. Boot-image fixed capability names — always present in the boot c-list
        //      regardless of which abstractions are installed.
        //      Boot.Nucs  — Nucleus/Turing-domain X-GT  (slot 7, dom=0, perm=X)
        //      Boot.Abstr — Abstraction E-GT             (slot 3, dom=1, perm=E)
        if (name === 'Boot.Nucs')  return 7;
        if (name === 'Boot.Abstr') return 3;

        // 4. Abstract registry (last resort — returns the abstraction's own index)
        const reg = ChurchAssembler._sharedRegistry;
        if (reg) {
            const abs = reg.getByName(name);
            if (abs !== null) return abs.index;
        }

        return null;
    }

    static setRegistry(registry) {
        ChurchAssembler._sharedRegistry = registry;
    }

    // ── Pre-pass: collect .pet alias declarations ──────────────────────────────
    // Scans all source lines for .pet directives and populates _drAliases and
    // _crAliases before the main encode loop runs.  Produces no machine words.
    // Syntax: .pet <alias> DR<n>  or  .pet <alias> CR<n>
    //   alias — any identifier matching /^[A-Za-z_][A-Za-z0-9_]*$/
    //           Built-in register names DR0..DR15 / CR0..CR15 are not permitted
    //           as aliases (they shadow the canonical syntax unambiguously and
    //           would make programs confusing).
    //   n     — 0–15 (out-of-range emits an error, alias is not stored)
    // Redeclaring the same alias to the same register is silently accepted.
    // Redeclaring to a different register emits a non-fatal warning (this.warnings).
    _parsePetDirectives(lines) {
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            let line = lines[lineNum].trim();
            // Strip inline comments — normalised to match Pass-1 comment handling (;, --, //)
            const ci = line.indexOf(';');
            if (ci >= 0) line = line.substring(0, ci).trim();
            const di = line.indexOf('--');
            if (di >= 0) line = line.substring(0, di).trim();
            const sli = line.indexOf('//');
            if (sli >= 0) line = line.substring(0, sli).trim();
            const rawLine = (this._rawLines && this._rawLines[lineNum]) || line;
            const m = line.match(/^\.pet\s+([A-Za-z_][A-Za-z0-9_]*)\s+(DR|CR)(\d+)\s*$/i);
            if (!m) {
                // Line starts with .pet but doesn't match the valid form — report a syntax error
                if (/^\.pet\b/i.test(line)) {
                    const petIdx = rawLine.search(/\.pet\b/i);
                    this.errors.push({ line: lineNum + 1, colStart: petIdx >= 0 ? petIdx : 0, colEnd: rawLine.length, message: `invalid .pet syntax — expected: .pet <alias> DR<n>  or  .pet <alias> CR<n>` });
                }
                continue;
            }
            const alias   = m[1];               // preserve original case
            const regType = m[2].toUpperCase(); // 'DR' or 'CR'
            const regIdx  = parseInt(m[3], 10);
            // Built-in register names DR0..DR15 and CR0..CR15 cannot be used as aliases.
            if (/^(DR|CR)(1[0-5]|[0-9])$/i.test(alias)) {
                const aliasIdx = rawLine.indexOf(alias);
                this.errors.push({ line: lineNum + 1, colStart: aliasIdx >= 0 ? aliasIdx : 0, colEnd: aliasIdx >= 0 ? aliasIdx + alias.length : rawLine.length, message: `'${alias}' is a built-in register name and cannot be used as a .pet alias` });
                continue;
            }
            if (regIdx > 15) {
                const regTokStr = regType + m[3];
                const regTokIdx = rawLine.indexOf(regTokStr);
                this.errors.push({ line: lineNum + 1, colStart: regTokIdx >= 0 ? regTokIdx : 0, colEnd: regTokIdx >= 0 ? regTokIdx + regTokStr.length : rawLine.length, message: `${regType}${regIdx} out of range — ${regType} aliases must be ${regType}0–${regType}15` });
                continue;
            }
            if (regType === 'DR') {
                if (this._drAliases[alias] !== undefined && this._drAliases[alias] !== regIdx) {
                    // Non-fatal: warn but allow the redefinition
                    const aliasIdx = rawLine.indexOf(alias);
                    this.warnings.push({ line: lineNum + 1, colStart: aliasIdx >= 0 ? aliasIdx : 0, colEnd: aliasIdx >= 0 ? aliasIdx + alias.length : rawLine.length, message: `'.pet ${alias}' already declared as DR${this._drAliases[alias]}; redefining to DR${regIdx}` });
                }
                if (this._crAliases[alias] !== undefined) {
                    // Cross-type: alias was previously a CR alias, now declared as DR
                    const aliasIdx = rawLine.indexOf(alias);
                    this.warnings.push({ line: lineNum + 1, colStart: aliasIdx >= 0 ? aliasIdx : 0, colEnd: aliasIdx >= 0 ? aliasIdx + alias.length : rawLine.length, message: `'.pet ${alias}' was previously declared as a CR alias; redefining as DR${regIdx}` });
                    delete this._crAliases[alias];
                }
                this._drAliases[alias] = regIdx;
            } else {
                if (this._crAliases[alias] !== undefined && this._crAliases[alias] !== regIdx) {
                    const aliasIdx = rawLine.indexOf(alias);
                    this.warnings.push({ line: lineNum + 1, colStart: aliasIdx >= 0 ? aliasIdx : 0, colEnd: aliasIdx >= 0 ? aliasIdx + alias.length : rawLine.length, message: `'.pet ${alias}' already declared as CR${this._crAliases[alias]}; redefining to CR${regIdx}` });
                }
                if (this._drAliases[alias] !== undefined) {
                    // Cross-type: alias was previously a DR alias, now declared as CR
                    const aliasIdx = rawLine.indexOf(alias);
                    this.warnings.push({ line: lineNum + 1, colStart: aliasIdx >= 0 ? aliasIdx : 0, colEnd: aliasIdx >= 0 ? aliasIdx + alias.length : rawLine.length, message: `'.pet ${alias}' was previously declared as a DR alias; redefining as CR${regIdx}` });
                    delete this._drAliases[alias];
                }
                this._crAliases[alias] = regIdx;
            }
        }
    }

    // Returns the current alias maps (useful for callers that want to inspect
    // which names are in scope after assembly).
    getAliases() {
        return { dr: Object.assign({}, this._drAliases), cr: Object.assign({}, this._crAliases) };
    }

    // _parseCapBlockSlots(lines) — pre-pass over source lines to assign c-list
    // slot indices to non-NS capabilities declared in the  capabilities { }  block.
    //
    // NS-based abstractions (e.g. Tunnel at NS slot 31) already have a fixed slot
    // via nsSymbols and are skipped.  Hardware-device shorthand (LED0–LED5, UART,
    // BTN, SlideRule, Timer) are also skipped — their slots are fixed.
    //
    // Every other capability is a null-GT row: it occupies a free c-list slot
    // (1, 2, 3, …) assigned in declaration order, matching the runtime layout
    // produced by _applyPendingSimLoad.  The GT at that slot may be null at
    // runtime — that is a runtime concern, not a compile-time concern.
    //
    // Returns { name → slot } for all non-NS, non-device capabilities.
    _parseCapBlockSlots(lines) {
        const slots = {};
        let inCapBlock = false;
        const capNames = [];

        for (const rawLine of lines) {
            let line = rawLine.trim();
            const ci = line.indexOf(';'); if (ci >= 0) line = line.substring(0, ci).trim();
            const di = line.indexOf('--'); if (di >= 0) line = line.substring(0, di).trim();
            const si = line.indexOf('//'); if (si >= 0) line = line.substring(0, si).trim();
            if (!line) continue;

            if (!inCapBlock && /^capabilities\s*\{/i.test(line)) {
                const inline = line.match(/^capabilities\s*\{\s*(.*?)\s*\}\s*$/i);
                if (inline) {
                    for (const item of inline[1].split(',')) {
                        const cap = ChurchAssembler._parseCapItem(item);
                        if (cap) capNames.push(cap.name);
                    }
                } else {
                    inCapBlock = true;
                    const tail = line.replace(/^capabilities\s*\{/i, '').trim();
                    if (tail) for (const item of tail.split(',')) {
                        const cap = ChurchAssembler._parseCapItem(item);
                        if (cap) capNames.push(cap.name);
                    }
                }
                continue;
            }
            if (inCapBlock) {
                if (line.includes('}')) { inCapBlock = false; }
                else for (const item of line.split(',')) {
                    const cap = ChurchAssembler._parseCapItem(item);
                    if (cap) capNames.push(cap.name);
                }
                continue;
            }
        }

        // Fixed hardware-device slot names — already resolved by other paths.
        const _deviceRE = /^(UART|BTN|SlideRule|Timer|Display)$/i;

        // Every capability declared in the block — LED devices, NS-based abstractions,
        // and null-GT rows alike — gets its 0-based position as its c-list offset.
        // The program's LUMP c-list is sized to the capabilities block, so offset 0
        // is the first entry regardless of its type.
        for (let i = 0; i < capNames.length; i++) {
            const name = capNames[i];
            if (slots[name] === undefined)   // first declaration wins on duplicates
                slots[name] = i;
        }
        return slots;
    }

    assemble(source) {
        this.labels = {};
        this.errors = [];
        this.warnings = [];
        this.capabilities = [];   // names declared in capabilities { } header (if present)
        this._hasCapBlock = false; // true when any capabilities { } block is present in source
        const _seenCapNames = new Set(); // duplicate-name guard for capabilities { } block
        // Reset to shared conventions — local .pet directives for this lump are
        // re-collected by _parsePetDirectives below and shadow these.
        this._drAliases = Object.assign({}, ChurchAssembler._sharedDrAliases || {});
        this._crAliases = Object.assign({}, ChurchAssembler._sharedCrAliases || {});
        this.nsLoaded = {};   // reset per-assembly loaded-CR tracking
        this._currentLineText = '';   // set before every error-producing context for _tokenCols
        const lines = source.split('\n');
        this._rawLines = lines.slice();  // original untrimmed lines — used by _tokenCols for accurate col positions
        this._parsePetDirectives(lines);               // pre-pass: .pet aliases
        this._capBlockSlots = this._parseCapBlockSlots(lines); // pre-pass: capabilities {} → slot map
        const instructions = [];

        // ── Pass 1: scan lines, record label offsets, collect instruction stubs ──
        let _inCapBlock   = false;  // inside a multi-line  capabilities { } block
        let _inConstBlock = false;  // inside a multi-line  constants     { } block
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            let line = lines[lineNum].trim();
            const commentIdx = line.indexOf(';');
            if (commentIdx >= 0) line = line.substring(0, commentIdx).trim();
            const dashComment = line.indexOf('--');
            if (dashComment >= 0) line = line.substring(0, dashComment).trim();
            const slashComment = line.indexOf('//');
            if (slashComment >= 0) line = line.substring(0, slashComment).trim();
            if (!line) continue;
            this._currentLineText = this._rawLines[lineNum];

            // ── capabilities { } block ─────────────────────────────────────────
            // CLOOMC-format header section listing the CRs this lump needs.
            // Produces no machine words; capability names are collected for callers.
            // Accepts single-line  capabilities { LED0, SlideRule }
            // or multi-line        capabilities {\n  LED0\n  SlideRule\n}
            if (!_inCapBlock && !_inConstBlock && /^capabilities\s*\{/i.test(line)) {
                this._hasCapBlock = true;
                const inline = line.match(/^capabilities\s*\{\s*(.*?)\s*\}\s*$/i);
                if (inline) {
                    for (const item of inline[1].split(',')) {
                        const cap = ChurchAssembler._parseCapItem(item);
                        if (cap) {
                            if (cap.rights.length === 0 && !ChurchAssembler._isHardwareCapName(cap.name)) {
                                this.errors.push({ line: lineNum + 1, ...this._tokenCols(this._currentLineText, cap.name),
                                    message: `Capability "${cap.name}" has no permission letters — add at least one of E, R, W, X after the name.\n  Example: capabilities { ${cap.name} E }` });
                            }
                            if (_seenCapNames.has(cap.name)) {
                                this.warnings.push({ line: lineNum + 1, ...this._tokenCols(this._currentLineText, cap.name),
                                    message: `Duplicate capability name "${cap.name}" in capabilities block — remove the second declaration.` });
                            } else {
                                _seenCapNames.add(cap.name);
                            }
                            this.capabilities.push(cap);
                        }
                    }
                } else {
                    _inCapBlock = true;
                    const tail = line.replace(/^capabilities\s*\{/i, '').trim();
                    if (tail) {
                        for (const item of tail.split(',')) {
                            const cap = ChurchAssembler._parseCapItem(item);
                            if (cap) {
                                if (cap.rights.length === 0 && !ChurchAssembler._isHardwareCapName(cap.name)) {
                                    this.errors.push({ line: lineNum + 1, ...this._tokenCols(this._currentLineText, cap.name),
                                        message: `Capability "${cap.name}" has no permission letters — add at least one of E, R, W, X after the name.\n  Example: capabilities { ${cap.name} E }` });
                                }
                                if (_seenCapNames.has(cap.name)) {
                                    this.warnings.push({ line: lineNum + 1, ...this._tokenCols(this._currentLineText, cap.name),
                                        message: `Duplicate capability name "${cap.name}" in capabilities block — remove the second declaration.` });
                                } else {
                                    _seenCapNames.add(cap.name);
                                }
                                this.capabilities.push(cap);
                            }
                        }
                    }
                }
                continue;
            }
            if (_inCapBlock) {
                if (line.includes('}')) { _inCapBlock = false; }
                else {
                    for (const item of line.split(',')) {
                        const cap = ChurchAssembler._parseCapItem(item);
                        if (cap) {
                            if (cap.rights.length === 0 && !ChurchAssembler._isHardwareCapName(cap.name)) {
                                this.errors.push({ line: lineNum + 1, ...this._tokenCols(this._currentLineText, cap.name),
                                    message: `Capability "${cap.name}" has no permission letters — add at least one of E, R, W, X after the name.\n  Example: capabilities { ${cap.name} E }` });
                            }
                            if (_seenCapNames.has(cap.name)) {
                                this.warnings.push({ line: lineNum + 1, ...this._tokenCols(this._currentLineText, cap.name),
                                    message: `Duplicate capability name "${cap.name}" in capabilities block — remove the second declaration.` });
                            } else {
                                _seenCapNames.add(cap.name);
                            }
                            this.capabilities.push(cap);
                        }
                    }
                }
                continue;
            }

            // ── constants { } block ───────────────────────────────────────────
            // CLOOMC-format named-constant declarations; not used in raw assembly.
            // Skip silently — produces no machine words.
            if (!_inCapBlock && !_inConstBlock && /^constants\s*\{/i.test(line)) {
                if (!line.includes('}')) _inConstBlock = true;
                continue;
            }
            if (_inConstBlock) {
                if (line.includes('}')) _inConstBlock = false;
                continue;
            }

            if (line.endsWith(':')) {
                // Label definition — store word offset (= current instruction count)
                const labelName = line.slice(0, -1).trim();
                if (this.labels[labelName] !== undefined) {
                    this.errors.push({ line: lineNum + 1, ...this._tokenCols(this._currentLineText, labelName), message: `Label "${labelName}" is defined more than once. Each label must be unique within a code lump.` });
                }
                this.labels[labelName] = instructions.length;
                continue;
            }

            if (line.startsWith('.org ') || line.startsWith('.ORG ')) {
                const target = parseInt(line.substring(5).trim());
                if (!isNaN(target) && target >= instructions.length) {
                    while (instructions.length < target) {
                        instructions.push({ line: 'NOP', lineNum: lineNum + 1, ispad: true });
                    }
                }
                continue;
            }

            if (line.startsWith('.word ') || line.startsWith('.WORD ')) {
                const val = parseInt(line.substring(6).trim());
                instructions.push({ line: null, lineNum: lineNum + 1, rawWord: (isNaN(val) ? 0 : val) >>> 0 });
                continue;
            }

            // The disassembler emits ".header ..." for lump header words.
            // Skip these in both passes — they are documentation artifacts, not
            // code instructions, and must not shift label word offsets.
            if (/^\.header\b/i.test(line)) {
                continue;
            }

            // .pet directives are pre-pass-only; skip them here so they produce
            // no machine words and do not shift label or word offsets.
            if (/^\.pet\b/i.test(line)) {
                continue;
            }

            // ── .petname / PETNAME pseudo-instruction ──────────────────────────
            // Syntax:  .petname <n>   or   PETNAME <n>   (n = c-list slot, 0–63)
            //
            // Registers c-list slot n with PetNameMemory so that a subsequent
            // NULL-GT access fires Scheduler.IRQ(LAZY_RESOLVE) instead of a hard
            // NULL_CAP fault.  This enables demand-loading patterns where the
            // abstraction is fetched asynchronously via the Tunnel/Loader.
            //
            // Expands to three instructions (3 machine words):
            //   LOAD  CR11, CR6, 18   ; ChurchHW cap from boot c-list slot 18 → CR11
            //   IADD  DR1, DR0, #n    ; slot number n into DR1
            //   DWRITE DR1, CR11, 0   ; write slot n through ChurchHW → PetNameMemory
            //
            // ChurchHW (boot c-list slot 18) is the hardware-control Abstract GT
            // added in Task #1542.  DWRITE through it calls _dispatchAbstractDwrite
            // with DEVICE_CLASS_CHURCHHW, which records the slot in _petNamedSlots.
            //
            // Clobbers: CR11 (ChurchHW capability), DR1 (slot number).
            // Slot n must be in range 0–63.  The keyword is case-insensitive;
            // the leading dot is optional (both .petname and PETNAME are valid).
            if (/^\.petname\b/i.test(line) || /^PETNAME\b/i.test(line)) {
                const pnMatch = line.match(/^(?:\.petname|PETNAME)\s+#?(\d+)\s*$/i);
                if (!pnMatch) {
                    const kwLen = (line.match(/^(?:\.petname|PETNAME)/i) || [''])[0].length;
                    this.errors.push({ line: lineNum + 1, colStart: 0, colEnd: kwLen,
                        message: `.petname requires a single slot number 0–63, e.g. ".petname 5" or "PETNAME 5"` });
                    continue;
                }
                const pnSlot = parseInt(pnMatch[1], 10);
                if (pnSlot < 0 || pnSlot > 63) {
                    this.errors.push({ line: lineNum + 1, colStart: 0, colEnd: line.length,
                        message: `.petname slot must be in range 0–63 (got ${pnSlot})` });
                    continue;
                }
                instructions.push({ line: 'LOAD CR11, CR6, 18', lineNum: lineNum + 1,
                    comment: `petname: load ChurchHW cap (boot c-list slot 18) → CR11` });
                instructions.push({ line: `IADD DR1, DR0, #${pnSlot}`, lineNum: lineNum + 1,
                    comment: `petname: slot ${pnSlot} → DR1` });
                instructions.push({ line: 'DWRITE DR1, CR11, 0', lineNum: lineNum + 1,
                    comment: `petname: mark c-list slot ${pnSlot} as named (PetNameMemory)` });
                continue;
            }

            // ── Bare-call sugar: Abs.Method(args) ─────────────────────────────
            // "Tunnel.Connect(Mum)" expands to:
            //   LOAD   CR2, Mum             ; per method convention input spec
            //   ELOADCALL CR0, Tunnel, Connect
            //
            // Rules:
            //   · CR arguments: resolved from namespace by name (LOAD CRn, Name).
            //     If the user supplies an explicit CRn, the LOAD is skipped.
            //   · DR arguments: data values — must be pre-loaded before the call.
            //     The sugar emits a clear error pointing to IADD/ISUB pre-loading.
            //   · Extra arguments (beyond the method's input spec) are ignored.
            //   · Unknown abstraction or method → targeted error, no fall-through.
            //   · ELOADCALL always uses CR0 as the scratch destination.
            {
                const bcMatch = line.match(/^([A-Za-z]\w*)\.([A-Za-z]\w*)\s*\(([^)]*)\)$/);
                if (bcMatch) {
                    const absName    = bcMatch[1];
                    const methodName = bcMatch[2];
                    const argsStr    = bcMatch[3].trim();
                    const conv       = this.methodConventions[absName];
                    if (!conv) {
                        this.errors.push({ line: lineNum + 1, ...this._tokenCols(line, absName), message:
                            `"${absName}" is not a known abstraction in the bare-call form "${absName}.${methodName}(...)". ` +
                            `Use LOAD to bind it first or check the method conventions.` });
                        continue;
                    }
                    if (!conv[methodName]) {
                        const known = Object.keys(conv).join(', ');
                        this.errors.push({ line: lineNum + 1, ...this._tokenCols(line, methodName), message:
                            `"${methodName}" is not a known method of ${absName}. Known methods: ${known}.` });
                        continue;
                    }
                    const methodEntry = conv[methodName];
                    const inputSpec   = methodEntry.input || '';
                    // Extract ordered register slots from input spec: CR2=..., DR1=...
                    const regOrder = [];
                    const regRe = /\b(CR|DR)(\d+)=/g;
                    let rm;
                    while ((rm = regRe.exec(inputSpec)) !== null) {
                        regOrder.push({ type: rm[1], n: parseInt(rm[2]) });
                    }
                    const args = argsStr ? argsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
                    for (let ai = 0; ai < args.length; ai++) {
                        const arg = args[ai];
                        const reg = regOrder[ai];
                        if (!reg) continue; // extra arg — no register mapping, silently skipped
                        if (reg.type === 'CR') {
                            if (/^CR\d+$/i.test(arg)) {
                                // Explicit CRn supplied — caller pre-loaded it; no LOAD needed.
                            } else if (this._resolveNSName(arg) !== null) {
                                // Known namespace abstraction or LED shorthand — two-operand shorthand applies.
                                instructions.push({ line: `LOAD CR${reg.n}, ${arg}`, lineNum: lineNum + 1,
                                    comment: `${absName}.${methodName}(${argsStr}) \u2190 LOAD ${arg}` });
                            } else {
                                // Runtime GT / c-list entry not in the namespace — emit a targeted
                                // error immediately rather than generating a broken LOAD that fails
                                // later with a confusing "Expected a capability register" message.
                                // Hint: if the name is a known null-GT pet name, show the exact slot.
                                const _knownSlot = (this._clistSlots && this._clistSlots[arg] !== undefined)
                                    ? this._clistSlots[arg] : null;
                                const _slotHint = _knownSlot !== null
                                    ? `CR6[0x${_knownSlot.toString(16).toUpperCase().padStart(4,'0')}]`
                                    : `CR6[0x…]   ; find "${arg}"'s slot in the C-List viewer`;
                                this.errors.push({ line: lineNum + 1, ...this._tokenCols(this._currentLineText, arg), message:
                                    `Argument ${ai + 1} of ${absName}.${methodName}() maps to CR${reg.n}, which holds a capability GT. ` +
                                    `"${arg}" is not declared as a capability — add it to your capabilities block:\n` +
                                    `  capabilities { ${arg} }\n` +
                                    `Then ${absName}.${methodName}(${arg}) will compile directly.\n` +
                                    `Alternatively, if "${arg}" is already named in the C-List viewer, load it first:\n` +
                                    `  LOAD  CR${reg.n}, ${_slotHint}\n` +
                                    `  ${absName}.${methodName}(CR${reg.n})` });
                            }
                        } else {
                            // DR argument — data value, cannot be auto-loaded from a name.
                            const isNumericLiteral = /^-?\d+$/.test(arg) || /^0x[0-9a-fA-F]+$/i.test(arg);
                            const isCharLiteral    = /^'.'$/.test(arg);
                            if (isNumericLiteral || isCharLiteral) {
                                // Literal value passed directly — give a targeted DWRITE hint.
                                const rawValue = isCharLiteral ? arg.charCodeAt(1) : arg;
                                const specDesc = (inputSpec.match(new RegExp(`\\bDR${reg.n}=(\\w+)`)) || [])[1] || 'val';
                                this.errors.push({ line: lineNum + 1, ...this._tokenCols(this._currentLineText, arg), message:
                                    `${absName}.${methodName} uses DR${reg.n} for the ${specDesc} — ` +
                                    `pre-load it with DWRITE DR${reg.n}, #${rawValue} before calling ${absName}.${methodName}()\n` +
                                    `  DWRITE DR${reg.n}, #${rawValue}\n` +
                                    `  ${absName}.${methodName}()` });
                            } else {
                                this.errors.push({ line: lineNum + 1, ...this._tokenCols(this._currentLineText, arg), message:
                                    `Argument ${ai + 1} of ${absName}.${methodName}() maps to DR${reg.n}, which holds a data value. ` +
                                    `"${arg}" cannot be auto-loaded into a DR — pre-load it before the call:\n` +
                                    `  IADD  DR${reg.n}, DR${reg.n}, #${arg}   ; small literal (fits in 14 bits)\n` +
                                    `  ; — or — load a full 32-bit constant via a DREAD from an embedded constant` });
                            }
                        }
                    }
                    instructions.push({ line: `ELOADCALL CR0, ${absName}, ${methodName}`, lineNum: lineNum + 1,
                        comment: `API: ${absName}.${methodName}(${argsStr})` });
                    continue;
                }
            }

            // ── MVN pseudo-instruction ─────────────────────────────────────────
            // MVN DRd, DRs  →  ~DRs  (ARM-style move-bitwise-NOT)
            // The Church Machine ISA has no native bitwise complement opcode, so
            // MVN expands in-place using two's complement identities.
            //
            // Normal case (DRd ≠ DRs) — 3 instructions:
            //   ISUB DRd, DRs, DRs  ; DRd = 0
            //   ISUB DRd, DRd, DRs  ; DRd = 0 - DRs  = -DRs
            //   IADD DRd, DRd, #-1  ; DRd = -DRs - 1 = ~DRs
            //
            // Same-register case (DRd == DRs == DRx) — 4 instructions via a
            // scratch register DRt (DR0 unless DRx is DR0, then DR1).
            // DRx is never read after it is written, so all reads of
            // DRx_orig happen before any write to DRx:
            //   ISUB[cc] DRt, DRx, DRx  ; DRt = 0              (DRx unchanged)
            //   ISUB[cc] DRt, DRt, DRx  ; DRt = -DRx_orig      (DRx unchanged)
            //   IADD[cc] DRt, DRt, #-1  ; DRt = ~DRx_orig      (DRx unchanged)
            //   IADD[cc] DRx, DRt, #0   ; DRx = ~DRx_orig  ✓  (copy DRt → DRx)
            // DRt is a declared scratch register; its value after MVN is
            // architecturally undefined (callers must not rely on it).
            // Conditional variants (MVNEQ, MVNNE, MVNMI, etc.) are supported;
            // the condition suffix is propagated to all expanded instructions.
            {
                const mvnMatch = line.match(/^MVN([A-Z]{2})?\b/i);
                if (mvnMatch) {
                    const cc = (mvnMatch[1] || '').toUpperCase();
                    const mvnParts = line.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
                    const drDst = (mvnParts[1] || 'DR0').replace(/,/g, '').trim();
                    const drSrc = (mvnParts[2] || 'DR0').replace(/,/g, '').trim();
                    // Check for same-register aliasing (DR0..DR15 exact form only;
                    // aliases are accepted and resolved later — trust the programmer).
                    const dstMatch = drDst.match(/^DR(\d+)$/i);
                    const srcMatch = drSrc.match(/^DR(\d+)$/i);
                    if (dstMatch && srcMatch && parseInt(dstMatch[1]) === parseInt(srcMatch[1])) {
                        // Same-register case: compute result in scratch, then copy.
                        const drx = drDst.toUpperCase();
                        const scratchNum = parseInt(dstMatch[1]) === 0 ? 1 : 0;
                        const drt = `DR${scratchNum}`;
                        instructions.push({ line: `ISUB${cc} ${drt}, ${drx}, ${drx}`, lineNum: lineNum + 1 });
                        instructions.push({ line: `ISUB${cc} ${drt}, ${drt}, ${drx}`, lineNum: lineNum + 1 });
                        instructions.push({ line: `IADD${cc} ${drt}, ${drt}, #-1`,    lineNum: lineNum + 1 });
                        instructions.push({ line: `IADD${cc} ${drx}, ${drt}, #0`,     lineNum: lineNum + 1 });
                    } else {
                        instructions.push({ line: `ISUB${cc} ${drDst}, ${drSrc}, ${drSrc}`, lineNum: lineNum + 1 });
                        instructions.push({ line: `ISUB${cc} ${drDst}, ${drDst}, ${drSrc}`, lineNum: lineNum + 1 });
                        instructions.push({ line: `IADD${cc} ${drDst}, ${drDst}, #-1`,      lineNum: lineNum + 1 });
                    }
                    continue;
                }
            }

            instructions.push({ line, lineNum: lineNum + 1 });
        }

        // ── Pass 2: encode instructions ───────────────────────────────────────────
        // lineNums[i] tracks the source line that produced words[i], used by the
        // bounds-check pass to report accurate error locations.
        const words = [];
        const lineNums = [];
        const wordComments = {};  // word_offset → comment string (from sugar expansion)
        for (let i = 0; i < instructions.length; i++) {
            const inst = instructions[i];
            if (inst.rawWord !== undefined) {
                words.push(inst.rawWord);
                lineNums.push(inst.lineNum);
                continue;
            }
            if (inst.ispad) {
                words.push(0);
                lineNums.push(inst.lineNum);
                continue;
            }
            // addr = i = word offset of this instruction (matches label offsets stored in pass 1)
            const word = this._assembleLine(inst.line, inst.lineNum, i);
            if (word !== null) {
                if (inst.comment) wordComments[words.length] = inst.comment;
                words.push(word);
                lineNums.push(inst.lineNum);
            }
        }

        // ── Pass 3: branch bounds check ───────────────────────────────────────────
        // Every BRANCH target must fall within [0, words.length).
        const totalWords = words.length;
        const _condNames = ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','','NV'];
        for (let i = 0; i < words.length; i++) {
            const w = words[i] >>> 0;
            if (((w >>> 27) & 0x1F) !== 23) continue;   // not a BRANCH instruction (v2.0: opcode 23)
            const rawImm = w & 0x7FFF;
            const signedOffset = (rawImm & 0x4000) ? (rawImm | 0xFFFF8000) : rawImm;
            const target = i + signedOffset;
            if (target < 0 || target > totalWords) {
                const condCode = (w >>> 23) & 0xF;
                const mnemonic = 'BRANCH' + _condNames[condCode];
                const _rawBranchLine = this._rawLines && this._rawLines[lineNums[i] - 1];
                this.errors.push({
                    line: lineNums[i],
                    ...(_rawBranchLine ? this._tokenCols(_rawBranchLine, mnemonic) : {}),
                    message: `${mnemonic} at word ${i} → target ${target} is outside the code lump [0, ${totalWords})`
                });
            }
        }

        this._lastLineNums = lineNums.slice();
        // namedSlots (Task #1531): slot indices (0-based) of every capability declared in
        // the capabilities { } block.  All named capabilities are candidates for LAZY_RESOLVE
        // rather than NULL_CAP hard fault; the simulator's petNameMemory is seeded from this
        // list via markNamedSlots() when the program loads.  Slot index = position in block.
        const namedSlots = this.capabilities.map((_, i) => i);
        return { words, errors: this.errors, warnings: this.warnings, labels: this.labels,
                 capabilities: this.capabilities.slice(), namedSlots,
                 wordComments, lineNums: lineNums.slice() };
    }

    getLastLineNums() {
        return this._lastLineNums || [];
    }

    _assembleLine(line, lineNum, addr) {
        this._currentLineText = (this._rawLines && this._rawLines[lineNum - 1]) || line;
        const parts = line.replace(/,/g, ' ').replace(/\[/g, ' ').replace(/\]/g, ' ').split(/\s+/).filter(Boolean);
        if (parts.length === 0) return null;

        let mnemonic = parts[0].toUpperCase();
        let opcode = null;
        let cond = 14;

        for (const [name, code] of Object.entries(this.opcodes)) {
            if (mnemonic === name) {
                opcode = code;
                break;
            }
            if (mnemonic.startsWith(name)) {
                const suffix = mnemonic.substring(name.length);
                if (this.conditions[suffix] !== undefined) {
                    opcode = code;
                    cond = this.conditions[suffix];
                    break;
                }
            }
        }

        if (opcode === null) {
            if (mnemonic === 'HALT' || mnemonic === 'NOP') {
                return 0;
            }
            // MVN/MVNcc is intercepted in pass 1 and never reaches here; listed as a hint
            // for completeness so the suggestion is accurate if this path is ever hit.
            const pseudoHint = ' Pseudo-instructions (handled before encoding): NOP, HALT, MVN, MVNcc (e.g. MVNEQ, MVNNE).';
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, parts[0]), message: `Oops! I don't recognise the instruction "${mnemonic}". Check your spelling — every letter matters!${pseudoHint}` });
            return null;
        }

        let crDst = 0, crSrc = 0, imm = 0;

        switch (opcode) {
            case 0: {
                crDst = this._parseCR(parts[1], lineNum);
                this._checkPrivCR(crDst, 'LOAD', lineNum);
                const res0 = this._resolveNSNameBracket(parts[2], parts[3]);
                if (res0 !== null && (!parts[3] || res0.consumed)) {
                    this._checkCapDeclared(res0.key, lineNum);
                    crSrc = 6;   // CR6 = c-list root by convention
                    imm   = res0.slot;
                    this.nsLoaded[res0.key] = crDst;
                } else {
                    crSrc = this._parseCR(parts[2], lineNum);
                    this._checkPrivCR(crSrc, 'LOAD', lineNum);
                    imm   = this._parseImm(parts[3], lineNum);
                }
                break;
            }
            case 1: {
                crDst = this._parseCR(parts[1], lineNum);
                this._checkPrivCR(crDst, 'SAVE', lineNum);
                const res1 = this._resolveNSNameBracket(parts[2], parts[3]);
                if (res1 !== null && (!parts[3] || res1.consumed)) {
                    crSrc = 6;
                    imm   = res1.slot;
                    this.nsLoaded[res1.key] = crDst;
                } else {
                    crSrc = this._parseCR(parts[2], lineNum);
                    this._checkPrivCR(crSrc, 'SAVE', lineNum);
                    imm   = this._parseImm(parts[3], lineNum);
                }
                break;
            }
            case 2: {
                // Dot-notation: CALL SlideRule.Multiply (single token, no parts[2])
                const rawDotTok = (parts[1] || '').replace(/,/g, '').trim();
                // Early-catch: user wrote "CALL Abs.Method, ExtraArg" — the comma
                // shows they expected function-call syntax.  CALL does not take
                // operand arguments; pass arguments in DR/CR registers before the CALL.
                if (parts[2] && rawDotTok.includes('.')) {
                    const _dotParts = rawDotTok.split('.');
                    const _dAbs = _dotParts[0], _dMeth = _dotParts[1] || '';
                    const _extra = (parts[2] || '').replace(/,/g, '').trim();
                    this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _extra), message:
                        `Dot-notation CALL does not take a second operand — remove ", ${_extra}". ` +
                        `Pass arguments in DR/CR registers before the CALL:\n` +
                        `  LOAD  CR2, ${_extra}          ; load the remote GT into CR2\n` +
                        `  CALL  ${_dAbs}.${_dMeth}   ; encodes as CALL CR<n>, ${(_dMeth ? _dMeth + '-index' : 'method')}` });
                    break;
                }
                if (!parts[2] && rawDotTok.includes('.')) {
                    const dotIdx = rawDotTok.indexOf('.');
                    const dotAbsName = rawDotTok.slice(0, dotIdx);
                    const dotMethodRaw = rawDotTok.slice(dotIdx + 1);
                    // Detect function-call style: "CALL Tunnel.Connect(Mum)" — parens are not
                    // valid CLOOMC syntax.  Strip the suffix, identify the bare method name,
                    // and emit a targeted error rather than falling through to _parseCR.
                    const parenIdx = dotMethodRaw.indexOf('(');
                    if (parenIdx !== -1) {
                        const bareMethod = dotMethodRaw.slice(0, parenIdx);
                        const argStr    = dotMethodRaw.slice(parenIdx + 1).replace(/\).*$/, '');
                        let suggestion = `  LOAD  CR2, ${argStr || '<GT>'}   ; load argument into a register\n  CALL  ${dotAbsName}.${bareMethod}`;
                        // Check if the bare method name is actually known, to give sharper advice.
                        if (this.methodConventions[dotAbsName] && this.methodConventions[dotAbsName][bareMethod]) {
                            const conv = this.methodConventions[dotAbsName][bareMethod];
                            if (conv.input) suggestion += `   ; ${conv.input}`;
                        }
                        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, dotAbsName + '.' + bareMethod + '(' + argStr + ')') , message:
                            `CLOOMC does not support function-call syntax — remove the "(${argStr})" from "${dotAbsName}.${bareMethod}(${argStr})". ` +
                            `Load arguments into DR/CR registers before the CALL:\n${suggestion}` });
                        break;
                    }
                    const dotMethodName = dotMethodRaw;
                    this._checkCapDeclared(dotAbsName, lineNum);
                    const crSlot = this.nsLoaded[dotAbsName];
                    if (crSlot !== undefined) {
                        crDst = crSlot;
                        if (this.methodConventions[dotAbsName]) {
                            const methodEntry = this.methodConventions[dotAbsName][dotMethodName];
                            if (methodEntry !== undefined) {
                                const idx = methodEntry.index;
                                if (idx >= 0 && idx <= 16383) {
                                    imm = idx + 1;  // 1-based: imm=0 reserved for fast-path
                                } else {
                                    this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, dotMethodName), message: `Method "${dotMethodName}" of ${dotAbsName} has index ${idx} which is out of range — method selectors must be 0–16383.` });
                                }
                            } else {
                                const known = Object.keys(this.methodConventions[dotAbsName]).join(', ');
                                this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, dotMethodName), message: `"${dotMethodName}" is not a known method of ${dotAbsName}. Known methods: ${known}.` });
                            }
                        } else {
                            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, dotAbsName), message: `No method conventions registered for "${dotAbsName}".` });
                        }
                    } else {
                        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, dotAbsName), message: `"${dotAbsName}" has not been loaded. Use LOAD to bind it first.` });
                    }
                    break;
                }
                // Namespace-slot bare-call: CALL Scheduler, pause
                // When parts[1] names an abstraction that lives in the namespace
                // symbol table but has NOT been explicitly LOAD-ed into a CR, and
                // parts[2] is a known method name, emit ELOADCALL (opcode 8) with
                // the correct row/method encoding instead of a plain CALL.
                // If the abstraction IS already in nsLoaded (loaded into a CR) the
                // existing CALL path handles it correctly — do not intercept.
                if (parts[2] && !rawDotTok.includes('.')) {
                    const _nsSlot = (this.nsLoaded[rawDotTok] === undefined &&
                                     this.nsSymbols[rawDotTok] !== undefined)
                                    ? this.nsSymbols[rawDotTok] : null;
                    if (_nsSlot !== null && this.methodConventions[rawDotTok]) {
                        this._checkCapDeclared(rawDotTok, lineNum);
                        const _methName = (parts[2] || '').replace(/,/g, '').trim();
                        const _methEntry = this.methodConventions[rawDotTok][_methName];
                        if (_methEntry !== undefined) {
                            opcode = 8;
                            crDst  = 0;
                            crSrc  = 6;
                            const _methIdx = typeof _methEntry === 'object' ? _methEntry.index : _methEntry;
                            if (_methIdx < 0 || _methIdx > 126) {
                                this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _methName), message: `Method "${_methName}" of ${rawDotTok} has index ${_methIdx} which is out of range (0–126 allowed for ELOADCALL).` });
                            } else {
                                imm = ((_methIdx + 1) << 8) | (_nsSlot & 0xFF);
                            }
                        } else {
                            const _known = Object.keys(this.methodConventions[rawDotTok]).join(', ');
                            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _methName), message: `"${_methName}" is not a known method of ${rawDotTok}. Known methods: ${_known}.` });
                        }
                        break;
                    }
                }
                crDst = this._parseCR(parts[1], lineNum);
                this._checkPrivCR(crDst, 'CALL', lineNum);
                if (parts[2]) {
                    const tok2upper = parts[2].toUpperCase().replace(/,/g, '').trim();
                    const tok2raw   = (parts[2] || '').replace(/,/g, '').trim();
                    const isNumericSelector = /^CR\d+$/.test(tok2upper) || /^0X[0-9A-F]+$/.test(tok2upper) || /^\d+$/.test(tok2upper)
                        || this._crAliases[tok2raw] !== undefined;
                    if (!isNumericSelector) {
                        const rawTok1 = (parts[1] || '').replace(/,/g, '').trim();
                        const rawTok2 = (parts[2] || '').replace(/,/g, '').trim();
                        let absName = this.nsLoaded[rawTok1] !== undefined ? rawTok1 : null;
                        if (!absName) {
                            for (const [name, idx] of Object.entries(this.nsLoaded)) {
                                if (idx === crDst) { absName = name; break; }
                            }
                        }
                        if (!absName) {
                            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, 'CR' + crDst), message: `CR${crDst} has no known abstraction binding — use a numeric selector (0–15) or load an abstraction into CR${crDst} with LOAD first.` });
                        } else if (!this.methodConventions[absName]) {
                            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawTok2), message: `No method conventions registered for "${absName}" (bound to CR${crDst}). Cannot resolve method name "${rawTok2}".` });
                        } else {
                            const methodEntry = this.methodConventions[absName][rawTok2];
                            if (methodEntry !== undefined) {
                                const idx = methodEntry.index;
                                if (idx >= 0 && idx <= 16383) {
                                    imm = idx + 1;  // 1-based: imm=0 reserved for fast-path
                                } else {
                                    this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawTok2), message: `Method "${rawTok2}" of ${absName} has index ${idx} which is out of range — method selectors must be 0–16383.` });
                                }
                            } else {
                                const known = Object.keys(this.methodConventions[absName]).join(', ');
                                this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawTok2), message: `"${rawTok2}" is not a known method of ${absName} (bound to CR${crDst}). Known methods: ${known}.` });
                            }
                        }
                    } else {
                        // Numeric method selector: encode as imm = value + 1 (1-based).
                        // Accepts CRn (→ n), decimal integer, or 0x... hex. Range: 0–16383.
                        const tok2 = (parts[2] || '').replace(/,/g, '').trim();
                        const tok2u = tok2.toUpperCase();
                        const crM2 = tok2u.match(/^CR(\d+)$/);
                        const hexM2 = tok2u.match(/^0X([0-9A-F]+)$/);
                        const decM2 = tok2.match(/^(\d+)$/);
                        let numIdx = 0;
                        if (crM2) {
                            numIdx = parseInt(crM2[1]);
                        } else if (hexM2) {
                            numIdx = parseInt(hexM2[1], 16);
                        } else if (decM2) {
                            numIdx = parseInt(decM2[1]);
                        } else if (this._crAliases[tok2] !== undefined) {
                            numIdx = this._crAliases[tok2];
                        } else {
                            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, tok2), message: `Expected a method selector (0–16383, CRn, or hex 0x...), but got "${tok2}".` });
                        }
                        if (numIdx < 0 || numIdx > 16383) {
                            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, tok2), message: `Method selector ${numIdx} is out of range — must be 0–16383.` });
                            numIdx = 0;
                        }
                        imm = (numIdx + 1) & 0x7FFF;
                    }
                }
                break;
            }
            case 3: {
                if (parts.length > 1) {
                    imm = this._parseImm(parts[1], lineNum) & 0xFFF;
                }
                if (imm !== 0) {
                    const setBits = [];
                    for (let b = 0; b < 12; b++) {
                        if (imm & (1 << b)) setBits.push(b);
                    }
                    const maskTok = parts.length > 1 ? parts[1] : parts[0];
                    this.warnings.push({
                        line: lineNum,
                        ...this._tokenCols(this._currentLineText, maskTok),
                        message: `Warning: RETURN mask bits [${setBits.join(', ')}] set — mask field is not implemented; bits are ignored.`
                    });
                }
                break;
            }
            case 4: {
                // CHANGE is the microcode thread-switch instruction.
                // It exclusively operates on CR12 (thread stack) — both the
                // destination and source must be CR12, so CR12 is exempted from
                // the normal privilege-zone block.  All other privilege-zone
                // registers (CR13, CR14, CR15) remain blocked.
                // 1-arg form: CHANGE CRx → CHANGE CRx, CRx, 0  (src defaults to dst)
                crDst = this._parseCR(parts[1], lineNum);
                if (crDst !== 12) this._checkPrivCR(crDst, 'CHANGE', lineNum);
                if (parts[2] !== undefined) {
                    crSrc = this._parseCR(parts[2], lineNum);
                    if (crSrc !== 12) this._checkPrivCR(crSrc, 'CHANGE', lineNum);
                } else {
                    crSrc = crDst;
                }
                imm = this._parseImm(parts[3], lineNum);
                break;
            }
            case 5: {
                crSrc = this._parseCR(parts[1], lineNum);
                this._checkPrivCR(crSrc, 'SWITCH', lineNum);
                // Hardware crSrc is a 3-bit field — CR8–CR11 would silently truncate
                // (CR8→CR0, CR9→CR1, CR10→CR2, CR11→CR3). CR12–CR15 are already
                // rejected by _checkPrivCR above.
                if (crSrc > 7 && crSrc < 12) {
                    this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, 'CR' + crSrc), message: `SWITCH: CR${crSrc} is out of range — source must be CR0–CR7 (hardware uses a 3-bit crSrc field; CR8–CR11 silently truncate to CR0–CR3)` });
                }
                // Accept "CRn" as shorthand for "n" in the target-index field so
                // "SWITCH CR0, CR1" is equivalent to "SWITCH CR0, 1".
                const _swTgt = /^CR(\d+)$/i.test(parts[2] || '')
                    ? (parts[2] || '').replace(/^CR/i, '')
                    : parts[2];
                imm = this._parseImm(_swTgt, lineNum) & 0x7;
                break;
            }
            case 6: {
                crDst = this._parseCR(parts[1], lineNum);
                this._checkPrivCR(crDst, 'TPERM', lineNum);
                const presetName = (parts[2] || 'CLEAR').toUpperCase();
                if (this.tpermPresets[presetName] !== undefined) {
                    imm = this.tpermPresets[presetName];
                } else {
                    imm = this._parseImm(parts[2], lineNum) & 0x1F;
                }
                // Guard: presets 10 (RSV3), 11 (RSV4), 12 (RSV5), 15 (RSV1) and their
                // B-modifier variants (26, 27, 28, 31) are hardware-reserved.  Assembling
                // them would produce a TPERM_RSV fault at runtime with no diagnostic.
                const _RSV_NAMES = { 10: 'RSV3', 11: 'RSV4', 12: 'RSV5', 15: 'RSV1' };
                const _baseCode = imm & 0xF;
                if (_RSV_NAMES[_baseCode] !== undefined) {
                    this.errors.push({ line: lineNum,
                        ...this._tokenCols(this._currentLineText, parts[2] || '0'),
                        message: `TPERM preset ${_RSV_NAMES[_baseCode]} (code ${_baseCode}) is reserved — using it causes a TPERM_RSV fault on hardware. Valid presets are CLEAR..LS (0-9), FRAME (13), EXACT (14), and their B-modifier variants.` });
                }
                // TPERM EXACT (preset 14): optional third CR operand — the reference GT.
                // Syntax: TPERM CRd, EXACT, CRs  (compares CRd.word0 vs CRs.word0 → Z)
                // If CRs is omitted, crSrc stays 0 (CR0); explicit CRd self-compare is fine.
                if ((imm & 0xF) === 14 && parts[3]) {
                    crSrc = this._parseCR(parts[3], lineNum);
                }
                break;
            }
            case 7: {
                crDst = this._parseCR(parts[1], lineNum);
                this._checkPrivCR(crDst, 'LAMBDA', lineNum);
                break;
            }
            case 8: {
                crDst = this._parseCR(parts[1], lineNum);
                this._checkPrivCR(crDst, 'ELOADCALL', lineNum);
                const res8 = this._resolveNSNameBracket(parts[2], parts[3]);
                if (res8 !== null && (!parts[3] || res8.consumed)) {
                    // Two-operand shorthand: ELOADCALL CRdst, Name  (or ELOADCALL CRdst, LED[N])
                    // imm15[7:0] = c-list row; imm15[14:8] = 0 (fast-path, NIA = lump word 1)
                    this._checkCapDeclared(res8.key, lineNum);
                    crSrc = 6;
                    if (res8.slot < 0 || res8.slot > 255) {
                        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, res8.key), message: `ELOADCALL c-list row ${res8.slot} is out of range (0–255 allowed).` });
                    }
                    imm   = res8.slot & 0xFF;
                } else if (res8 !== null && parts[3] && !res8.consumed) {
                    // Method index in ELOADCALL: ELOADCALL CRdst, Name, MethodName  or  ELOADCALL CRdst, Name, 0
                    // imm15[14:8] = method index (1-based, 1–127); imm15[7:0] = c-list row
                    this._checkCapDeclared(res8.key, lineNum);
                    crSrc = 6;
                    const rawSlot8v = res8.slot;
                    if (rawSlot8v < 0 || rawSlot8v > 255) {
                        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, res8.key), message: `ELOADCALL c-list row ${rawSlot8v} is out of range (0–255 allowed).` });
                    }
                    const clistRow8 = rawSlot8v & 0xFF;
                    const rawMeth8  = (parts[3] || '').replace(/,/g, '').trim();
                    let methodIdx8  = 0;
                    // Resolve conventions key: try exact case first (e.g. 'SlideRule'),
                    // fall back to uppercase (e.g. 'SLIDERULE') to match app-shell registration.
                    const absKey8 = this.methodConventions[res8.key] !== undefined
                        ? res8.key
                        : res8.key.toUpperCase();
                    if (/^\d+$/.test(rawMeth8)) {
                        // Numeric 0-based index (valid range: 0–126)
                        const m8 = parseInt(rawMeth8);
                        if (m8 < 0 || m8 > 126) {
                            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawMeth8), message: `ELOADCALL method index ${m8} is out of range (0–126 allowed).` });
                        } else {
                            methodIdx8 = m8 + 1;  // store 1-based in bits[14:8]
                        }
                    } else if (this.methodConventions[absKey8] && this.methodConventions[absKey8][rawMeth8] !== undefined) {
                        const mEntry8 = this.methodConventions[absKey8][rawMeth8];
                        const mIdx8   = typeof mEntry8 === 'object' ? (mEntry8.index || 0) : mEntry8;
                        if (mIdx8 < 0 || mIdx8 > 126) {
                            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawMeth8), message: `ELOADCALL method "${rawMeth8}" has index ${mIdx8} out of range (0–126 allowed).` });
                        } else {
                            methodIdx8 = mIdx8 + 1;  // store 1-based in bits[14:8]
                        }
                    } else if (this.methodConventions[absKey8]) {
                        const known8 = Object.keys(this.methodConventions[absKey8]).join(', ');
                        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawMeth8), message: `"${rawMeth8}" is not a known method of ${res8.key}. Known methods: ${known8}.` });
                    } else {
                        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawMeth8), message: `No method conventions for "${res8.key}"; cannot resolve method "${rawMeth8}". Use a numeric 0-based index instead.` });
                    }
                    imm = (methodIdx8 << 8) | clistRow8;
                } else {
                    // Explicit form: ELOADCALL CRdst, CRsrc, #slot [, methodIdx]
                    // imm15[7:0] = c-list row; imm15[14:8] = method index (1-based, 0 = fast-path)
                    crSrc = this._parseCR(parts[2], lineNum);
                    this._checkPrivCR(crSrc, 'ELOADCALL', lineNum);
                    const rawSlot8v  = this._parseImm(parts[3], lineNum);
                    if (rawSlot8v < 0 || rawSlot8v > 255) {
                        const _slotTok = (parts[3] || '').replace(/,/g, '').trim();
                        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _slotTok), message: `ELOADCALL c-list row ${rawSlot8v} is out of range (0–255 allowed).` });
                    }
                    const rawSlot8   = rawSlot8v & 0xFF;
                    let methodIdx8e  = 0;
                    if (parts[4]) {
                        const rawMeth8e = (parts[4] || '').replace(/,/g, '').trim();
                        if (/^\d+$/.test(rawMeth8e)) {
                            const m8e = parseInt(rawMeth8e);
                            if (m8e < 0 || m8e > 126) {
                                this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawMeth8e), message: `ELOADCALL method index ${m8e} is out of range (0–126 allowed).` });
                            } else {
                                methodIdx8e = m8e + 1;  // store 1-based in bits[14:8]
                            }
                        } else {
                            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawMeth8e), message: `ELOADCALL: expected a 0-based numeric method index as 4th operand, got "${rawMeth8e}".` });
                        }
                    }
                    imm = (methodIdx8e << 8) | rawSlot8;
                }
                break;
            }
            case 9: {
                crDst = this._parseCR(parts[1], lineNum);
                this._checkPrivCR(crDst, 'XLOADLAMBDA', lineNum);
                const res9 = this._resolveNSNameBracket(parts[2], parts[3]);
                if (res9 !== null && (!parts[3] || res9.consumed)) {
                    crSrc = 6;
                    imm   = res9.slot;
                } else {
                    crSrc = this._parseCR(parts[2], lineNum);
                    this._checkPrivCR(crSrc, 'XLOADLAMBDA', lineNum);
                    imm   = this._parseImm(parts[3], lineNum);
                }
                break;
            }
            case 16: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseCR(parts[2], lineNum);
                // CR14 (Current-Lump) is RX — user code may DREAD it to read
                // embedded data constants.  All other privilege-zone registers
                // (CR12, CR13, CR15) remain blocked.
                if (crSrc !== 14) this._checkPrivCR(crSrc, 'DREAD', lineNum);
                // 4-operand indexed form: DREAD DRd, CRs, #base, DRx
                // bit14=0: imm = (base & 0x3FF) << 4 | (DRx & 0xF)
                // 3-operand immediate form: DREAD DRd, CRs, #offset
                // bit14=1: imm = 0x4000 | (offset & 0x3FFF)
                const dreadDRxTok = (parts[4] || '').replace(/,/g, '').trim();
                if (dreadDRxTok && /^DR\d+$/i.test(dreadDRxTok)) {
                    const dreadBase = this._parseImm(parts[3], lineNum);
                    if (dreadBase > 1023) {
                        const _btok = (parts[3] || '').replace(/,/g, '').trim();
                        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _btok), message: `DREAD indexed: base offset must be 0–1023 (got ${dreadBase})` });
                    }
                    const dreadDRx = this._parseDR(parts[4], lineNum);
                    imm = ((dreadBase & 0x3FF) << 4) | (dreadDRx & 0xF);
                } else {
                    const dreadOff = this._parseImm(parts[3], lineNum);
                    if (dreadOff > 16383) {
                        const _otok = (parts[3] || '').replace(/,/g, '').trim();
                        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _otok), message: `DREAD: immediate offset must be 0–16383 (got ${dreadOff})` });
                    }
                    imm = 0x4000 | (dreadOff & 0x3FFF);
                }
                break;
            }
            case 17: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseCR(parts[2], lineNum);
                this._checkPrivCR(crSrc, 'DWRITE', lineNum);
                // 4-operand indexed form: DWRITE DRd, CRs, #base, DRx
                // bit14=0: imm = (base & 0x3FF) << 4 | (DRx & 0xF)
                // 3-operand immediate form: DWRITE DRd, CRs, #offset
                // bit14=1: imm = 0x4000 | (offset & 0x3FFF)
                const dwriteDRxTok = (parts[4] || '').replace(/,/g, '').trim();
                if (dwriteDRxTok && /^DR\d+$/i.test(dwriteDRxTok)) {
                    const dwriteBase = this._parseImm(parts[3], lineNum);
                    if (dwriteBase > 1023) {
                        const _btok = (parts[3] || '').replace(/,/g, '').trim();
                        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _btok), message: `DWRITE indexed: base offset must be 0–1023 (got ${dwriteBase})` });
                    }
                    const dwriteDRx = this._parseDR(parts[4], lineNum);
                    imm = ((dwriteBase & 0x3FF) << 4) | (dwriteDRx & 0xF);
                } else {
                    const dwriteOff = this._parseImm(parts[3], lineNum);
                    if (dwriteOff > 16383) {
                        const _otok = (parts[3] || '').replace(/,/g, '').trim();
                        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _otok), message: `DWRITE: immediate offset must be 0–16383 (got ${dwriteOff})` });
                    }
                    imm = 0x4000 | (dwriteOff & 0x3FFF);
                }
                break;
            }
            case 18: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseDR(parts[2], lineNum);
                const rawWid12 = this._parseImm(parts[4], lineNum);
                const pos12 = this._parseImm(parts[3], lineNum) & 0x1F;
                const wid12 = rawWid12 & 0x1F;
                if (wid12 === 0) {
                    const _widTok12 = (parts[4] || '').replace(/,/g, '').trim();
                    this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _widTok12), message: `BFEXT: width must be ≥ 1 (got ${rawWid12})` });
                } else if (pos12 + wid12 > 32) {
                    const _posTok12 = (parts[3] || '').replace(/,/g, '').trim();
                    this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _posTok12), message: `BFEXT: pos+width must be ≤ 32 (pos=${pos12}, width=${wid12}, sum=${pos12 + wid12})` });
                }
                imm = (pos12 << 5) | wid12;
                break;
            }
            case 19: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseDR(parts[2], lineNum);
                const rawWid13 = this._parseImm(parts[4], lineNum);
                const pos13 = this._parseImm(parts[3], lineNum) & 0x1F;
                const wid13 = rawWid13 & 0x1F;
                if (wid13 === 0) {
                    const _widTok13 = (parts[4] || '').replace(/,/g, '').trim();
                    this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _widTok13), message: `BFINS: width must be ≥ 1 (got ${rawWid13})` });
                } else if (pos13 + wid13 > 32) {
                    const _posTok13 = (parts[3] || '').replace(/,/g, '').trim();
                    this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _posTok13), message: `BFINS: pos+width must be ≤ 32 (pos=${pos13}, width=${wid13}, sum=${pos13 + wid13})` });
                }
                imm = (pos13 << 5) | wid13;
                break;
            }
            case 20: {
                const _drDst14 = this._parseDR(parts[1], lineNum);
                const _p2_14 = (parts[2] || '').replace(/,/g, '').trim();
                const _p2isImm14 = parts[3] === undefined && _p2_14 !== '' && (
                    _p2_14.startsWith('#') ||
                    /^-?\d+$/.test(_p2_14) ||
                    /^0[xX][0-9a-fA-F]+$/.test(_p2_14) ||
                    /^0[bB][01]+$/.test(_p2_14)
                );
                if (_p2isImm14) {
                    opcode = 22; // MCMP immediate → encoded as ISUB (v2.0: opcode 22)
                    crDst = 15;
                    crSrc = _drDst14;
                    const _immStr14 = _p2_14.startsWith('#') ? _p2_14.substring(1) : _p2_14;
                    let _immVal14;
                    if (_immStr14.startsWith('0x') || _immStr14.startsWith('0X')) _immVal14 = parseInt(_immStr14, 16);
                    else if (_immStr14.startsWith('0b') || _immStr14.startsWith('0B')) _immVal14 = parseInt(_immStr14.substring(2), 2);
                    else _immVal14 = parseInt(_immStr14, 10);
                    imm = 0x4000 | ((isNaN(_immVal14) ? 0 : _immVal14) & 0x3FFF);
                } else {
                    crDst = _drDst14;
                    crSrc = this._parseDR(parts[2], lineNum);
                }
                break;
            }
            case 21: {
                crDst = this._parseDR(parts[1], lineNum);
                {
                    const _p2 = (parts[2] || '').replace(/,/g, '').trim();
                    const _p2isImm = parts[3] === undefined && _p2 !== '' && (
                        _p2.startsWith('#') ||
                        /^-?\d+$/.test(_p2) ||
                        /^0[xX][0-9a-fA-F]+$/.test(_p2) ||
                        /^0[bB][01]+$/.test(_p2)
                    );
                    if (_p2isImm) {
                        crSrc = crDst;
                        const _immStr = _p2.startsWith('#') ? _p2.substring(1) : _p2;
                        let _immVal;
                        if (_immStr.startsWith('0x') || _immStr.startsWith('0X')) _immVal = parseInt(_immStr, 16);
                        else if (_immStr.startsWith('0b') || _immStr.startsWith('0B')) _immVal = parseInt(_immStr.substring(2), 2);
                        else _immVal = parseInt(_immStr, 10);
                        imm = 0x4000 | ((isNaN(_immVal) ? 0 : _immVal) & 0x3FFF);
                    } else {
                        crSrc = this._parseDR(parts[2], lineNum);
                        const p3 = (parts[3] || '').replace(/,/g, '').trim();
                        if (p3.startsWith('#')) {
                            const immVal = parseInt(p3.substring(1), 10);
                            imm = 0x4000 | ((isNaN(immVal) ? 0 : immVal) & 0x3FFF);
                        } else {
                            imm = this._parseDR(parts[3], lineNum);
                        }
                    }
                }
                break;
            }
            case 22: {
                crDst = this._parseDR(parts[1], lineNum);
                {
                    const _p2 = (parts[2] || '').replace(/,/g, '').trim();
                    const _p2isImm = parts[3] === undefined && _p2 !== '' && (
                        _p2.startsWith('#') ||
                        /^-?\d+$/.test(_p2) ||
                        /^0[xX][0-9a-fA-F]+$/.test(_p2) ||
                        /^0[bB][01]+$/.test(_p2)
                    );
                    if (_p2isImm) {
                        crSrc = crDst;
                        const _immStr = _p2.startsWith('#') ? _p2.substring(1) : _p2;
                        let _immVal;
                        if (_immStr.startsWith('0x') || _immStr.startsWith('0X')) _immVal = parseInt(_immStr, 16);
                        else if (_immStr.startsWith('0b') || _immStr.startsWith('0B')) _immVal = parseInt(_immStr.substring(2), 2);
                        else _immVal = parseInt(_immStr, 10);
                        imm = 0x4000 | ((isNaN(_immVal) ? 0 : _immVal) & 0x3FFF);
                    } else {
                        crSrc = this._parseDR(parts[2], lineNum);
                        const p3 = (parts[3] || '').replace(/,/g, '').trim();
                        if (p3.startsWith('#')) {
                            const immVal = parseInt(p3.substring(1), 10);
                            imm = 0x4000 | ((isNaN(immVal) ? 0 : immVal) & 0x3FFF);
                        } else {
                            imm = this._parseDR(parts[3], lineNum);
                        }
                    }
                }
                break;
            }
            case 23: {
                // BRANCH supports three operand forms:
                //   BRANCH label        — unconditional jump to label
                //   BRANCH offset       — unconditional jump by signed integer offset
                //   BRANCH CC, label    — conditional jump (space-separated condition code)
                //                         e.g. BRANCH EQ, done — same as BRANCHEQ done
                //                         Single-token form BRANCH EQ (no target) → offset 0
                let branchTarget = (parts[1] || '').replace(/,/g, '').trim();
                if (branchTarget && this.conditions[branchTarget.toUpperCase()] !== undefined) {
                    cond = this.conditions[branchTarget.toUpperCase()];
                    branchTarget = (parts[2] || '').replace(/,/g, '').trim();
                }
                if (!branchTarget) {
                    imm = 0;
                } else if (/^[a-zA-Z_]/.test(branchTarget)) {
                    // Identifier-like token → treat as label name
                    if (this.labels[branchTarget] !== undefined) {
                        imm = this.labels[branchTarget] - addr;   // signed relative offset
                    } else {
                        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, branchTarget), message: `Label "${branchTarget}" is not defined. Define it with "${branchTarget}:" on its own line before the target instruction.` });
                        imm = 0;
                    }
                } else {
                    // Numeric literal (decimal, hex, binary, or signed integer)
                    imm = this._parseImm(branchTarget, lineNum);
                }
                break;
            }
            case 24: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseDR(parts[2], lineNum);
                imm = this._parseImm(parts[3], lineNum) & 0x1F;
                break;
            }
            case 25: {
                crDst = this._parseDR(parts[1], lineNum);
                crSrc = this._parseDR(parts[2], lineNum);
                let shamt = this._parseImm(parts[3], lineNum) & 0x1F;
                let arith = 0;
                if (parts.length > 4 && parts[4].toUpperCase() === 'ASR') {
                    arith = 1;
                }
                imm = (arith << 5) | shamt;
                break;
            }
            case 0x1E: {
                // WORD value — inline 27-bit data constant embedded in the code lump.
                // bits[31:27] = 0x1E; bits[26:0] = payload.  No condition, no CR fields.
                // Read back with: DREAD DR, CR14, #offset (hardware raises INVALID_OP if executed).
                // Uses a direct 27-bit parse rather than _parseImm which caps at 16 bits.
                let rawTok = (parts[1] || '').replace(/,/g, '').trim();
                if (rawTok.startsWith('#')) rawTok = rawTok.substring(1);
                let wordVal = 0;
                if (rawTok.startsWith('0x') || rawTok.startsWith('0X')) {
                    wordVal = parseInt(rawTok, 16);
                } else if (rawTok.startsWith('0b') || rawTok.startsWith('0B')) {
                    wordVal = parseInt(rawTok.substring(2), 2);
                } else {
                    wordVal = parseInt(rawTok, 10);
                }
                if (isNaN(wordVal)) {
                    this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawTok), message: `WORD expects a numeric value (decimal, 0x hex, or 0b binary) but got "${rawTok}".` });
                    wordVal = 0;
                }
                return ((0x1E << 27) | (wordVal >>> 0 & 0x7FFFFFF)) >>> 0;
            }
        }

        return (
            ((opcode & 0x1F) << 27) |
            ((cond & 0xF) << 23) |
            ((crDst & 0xF) << 19) |
            ((crSrc & 0xF) << 15) |
            (imm & 0x7FFF)
        ) >>> 0;
    }

    // Emit an error if idx refers to CR12–CR15 (the Privilege Zone).
    // Called after _parseCR() for any instruction that writes to crDst.
    // Returns true if an error was pushed (callers may abort further checks).
    _tokenCols(lineText, token) {
        if (!lineText || !token) return {};
        let idx = lineText.indexOf(token);
        if (idx < 0) idx = lineText.toUpperCase().indexOf(token.toUpperCase());
        if (idx < 0) return {};
        return { colStart: idx, colEnd: idx + token.length };
    }

    _checkPrivCR(idx, mnemonic, lineNum) {
        if (idx >= 12 && idx <= 15) {
            const names = { 12: 'Thread', 13: 'Nucleus', 14: 'Current-Lump', 15: 'Namespace' };
            const crTok = 'CR' + idx;
            this.errors.push({
                line: lineNum,
                ...this._tokenCols(this._currentLineText, crTok),
                message: `CR${idx} (${names[idx] || 'Privilege Zone'}) is in the Privilege Zone \u2014 CR12\u2013CR15 are reserved for microcode tasks and cannot be referenced in ${mnemonic}. Use CR0\u2013CR11 instead.`,
            });
            return true;
        }
        return false;
    }

    _parseCR(token, lineNum) {
        if (!token) {
            const _mnTok = (this._currentLineText || '').trim().split(/[\s,]+/)[0] || '';
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _mnTok), message: 'A capability register (like CR0, CR6, CR11, 6, or hex 0x0\u20130xF) is needed here, but nothing was given.' });
            return 0;
        }
        // Preserve original-case token for loaded-CR resolution and error messages.
        const rawTok = token.replace(/,/g, '').trim();

        // Explicit register syntax takes priority over any alias.
        const uToken = token.toUpperCase().replace(/,/g, '');
        const m = uToken.match(/^CR(\d+)$/);
        if (m) {
            const idx = parseInt(m[1]);
            if (idx >= 0 && idx <= 15) return idx;
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawTok), message: `CR${idx} is too big! Capability registers go from CR0 to CR15 (that's 16 registers).` });
            return 0;
        }
        const hexMatch = uToken.match(/^0X([0-9A-F]+)$/);
        if (hexMatch) {
            const idx = parseInt(hexMatch[1], 16);
            if (idx >= 0 && idx <= 15) return idx;
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawTok), message: `0x${hexMatch[1]} (=${idx}) is out of range for a capability register — must be 0x0–0xF (CR0–CR15).` });
            return 0;
        }
        const bareMatch = uToken.match(/^(\d+)$/);
        if (bareMatch) {
            const idx = parseInt(bareMatch[1]);
            if (idx >= 0 && idx <= 15) return idx;
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawTok), message: `${idx} is out of range for a capability register — must be 0–15 (CR0–CR15).` });
            return 0;
        }

        // Loaded-CR resolution: check if this token is an abstraction name already loaded into a CR.
        if (this.nsLoaded[rawTok] !== undefined) return this.nsLoaded[rawTok];

        // .pet alias lookup — check CR aliases first, then give a helpful
        // cross-type error if the name is a DR alias used in a CR position.
        if (this._crAliases[rawTok] !== undefined) return this._crAliases[rawTok];
        if (this._drAliases[rawTok] !== undefined) {
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawTok), message: `'${rawTok}' is a DR alias — expected a CR here` });
            return 0;
        }

        let hint = '';
        const knownNames  = Object.keys(this.nsSymbols);
        const loadedNames = Object.keys(this.nsLoaded);
        if (knownNames.length) {
            const shown = knownNames.slice(0, 6).join(', ');
            hint += ` Known abstractions: ${shown}${knownNames.length > 6 ? '…' : ''}.`;
        }
        if (loadedNames.length) hint += ` Loaded in CRs: ${loadedNames.join(', ')}.`;
        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawTok), message: `Expected a capability register like CR0, CR6, 6, or hex 0x6, but got "${rawTok}".${hint}` });
        return 0;
    }

    _parseCRorBare(token, lineNum) {
        if (!token) return 0;
        const rawAlias = token.replace(/,/g, '').trim();  // preserve case for alias lookup
        token = token.toUpperCase().replace(/,/g, '');
        const crMatch = token.match(/^CR(\d+)$/);
        if (crMatch) {
            const idx = parseInt(crMatch[1]);
            if (idx >= 0 && idx <= 15) return idx;
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawAlias), message: `CR${idx} is too big! Capability registers go from CR0 to CR15.` });
            return 0;
        }
        const hexMatch = token.match(/^0X([0-9A-F]+)$/);
        if (hexMatch) {
            const idx = parseInt(hexMatch[1], 16);
            if (idx >= 0 && idx <= 15) return idx;
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawAlias), message: `Method selector 0x${hexMatch[1]} (=${idx}) is too big — must be 0–15 (0x0–0xF).` });
            return 0;
        }
        const bareMatch = token.match(/^(\d+)$/);
        if (bareMatch) {
            const idx = parseInt(bareMatch[1]);
            if (idx >= 0 && idx <= 15) return idx;
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawAlias), message: `Method selector ${idx} is too big — must be 0–15.` });
            return 0;
        }
        // .pet CR alias — allows a named capability register as a method selector
        if (this._crAliases[rawAlias] !== undefined) return this._crAliases[rawAlias];
        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawAlias), message: `Expected a method selector (0–15, 0x0–0xF, or CR0–CR15), but got "${rawAlias}".` });
        return 0;
    }

    _parseDR(token, lineNum) {
        if (!token) {
            const _mnTok = (this._currentLineText || '').trim().split(/[\s,]+/)[0] || '';
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, _mnTok), message: 'A data register (like DR0, DR1, 1, or hex 0x0–0xF) is needed here, but nothing was given.' });
            return 0;
        }
        const rawAlias = token.replace(/,/g, '').trim();  // preserve case for alias lookup
        token = token.toUpperCase().replace(/,/g, '');
        const m = token.match(/^DR(\d+)$/);
        if (m) {
            const idx = parseInt(m[1]);
            if (idx >= 0 && idx <= 15) return idx;
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawAlias), message: `DR${idx} is too big! Data registers go from DR0 to DR15 (that's 16 registers).` });
            return 0;
        }
        const hexMatch = token.match(/^0X([0-9A-F]+)$/);
        if (hexMatch) {
            const idx = parseInt(hexMatch[1], 16);
            if (idx >= 0 && idx <= 15) return idx;
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawAlias), message: `0x${hexMatch[1]} (=${idx}) is out of range for a data register — must be 0x0–0xF (DR0–DR15).` });
            return 0;
        }
        const bareMatch = token.match(/^(\d+)$/);
        if (bareMatch) {
            const idx = parseInt(bareMatch[1]);
            if (idx >= 0 && idx <= 15) return idx;
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawAlias), message: `${idx} is out of range for a data register — must be 0–15 (DR0–DR15).` });
            return 0;
        }
        // .pet alias lookup — check DR aliases first, then give a helpful
        // cross-type error if the name is a CR alias used in a DR position.
        if (this._drAliases[rawAlias] !== undefined) return this._drAliases[rawAlias];
        if (this._crAliases[rawAlias] !== undefined) {
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawAlias), message: `'${rawAlias}' is a CR alias — expected a DR here` });
            return 0;
        }
        this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, rawAlias), message: `Expected a data register like DR0, DR1, 1, or hex 0x1, but got "${rawAlias}". Data registers are DR0–DR15 (or 0–15, or 0x0–0xF).` });
        return 0;
    }

    _parseImm(token, lineNum) {
        if (!token) return 0;
        token = token.replace(/,/g, '').trim();

        if (token.startsWith('#')) token = token.substring(1);
        if (token.startsWith('+')) token = token.substring(1);

        if (this.labels[token] !== undefined) {
            return this.labels[token] & 0xFFFF;
        }

        const nsSlotImm = this._resolveNSName(token);
        if (nsSlotImm !== null) return nsSlotImm & 0xFFFF;

        let val = 0;
        if (token.startsWith('0x') || token.startsWith('0X')) {
            val = parseInt(token, 16);
        } else if (token.startsWith('0b') || token.startsWith('0B')) {
            val = parseInt(token.substring(2), 2);
        } else {
            val = parseInt(token, 10);
        }

        if (isNaN(val)) {
            this.errors.push({ line: lineNum, ...this._tokenCols(this._currentLineText, token), message: `"${token}" isn't a number I understand. Try a decimal number like 42, hex like 0xFF, or binary like 0b1010.` });
            return 0;
        }
        return val & 0xFFFF;
    }

    // ── Static helper: decompile an array of raw words to assembly lines ──────
    //
    // Reproduces the label-emission logic used by editCRCodeInEditor() in
    // app-cr-display.js so the same code path is reachable from tests and from
    // other call sites without coupling to the DOM or a running simulator.
    //
    // Input:  trimmedWords — array of uint32 instruction words (trailing zeroes
    //                        already stripped by the caller if desired).
    // Output: lines[] — one string per output line, ready for join('\n').
    //   • Label definitions ("L0:", "L1:", …) are inserted before the word
    //     they name whenever a BRANCH within the array targets that word.
    //   • BRANCH mnemonics use the label name instead of a raw signed offset
    //     when the target is within the array and has a label.
    //   • Out-of-range BRANCH targets (not covered by a label) fall back to
    //     the numeric offset form produced by disassemble().
    //   • Word 0x00000000 is emitted as "NOP".

    // _isHardwareCapName(name)
    // Returns true for hardware-fixed capability names whose permissions are defined
    // by the boot image and do not need to be spelled out in the source.
    // These names are exempt from the bare-name (no rights letters) validation.
    static _isHardwareCapName(name) {
        return /^LED[0-5]$/i.test(name) ||
               /^(UART|BTN|SlideRule|Timer|Display|Boot\.Nucs|Boot\.Abstr)$/i.test(name);
    }

    // Parse a single "NAME [RIGHTS]" capability item from a capabilities { } block.
    // Examples: "LED0 RW" → {name:'LED0', rights:['R','W']}
    //           "SlideRule E" → {name:'SlideRule', rights:['E']}
    //           "LED0" → {name:'LED0', rights:[]}
    //           "Boot.Nucs E" → {name:'Boot.Nucs', rights:['E']}
    // Dotted names (e.g. Boot.Nucs, Boot.Abstr) are accepted; each segment must
    // start with a letter and contain only letters, digits, and underscores.
    // Rights tokens contain ONLY letters from the set {R, W, X, E} (no digits/underscores).
    static _parseCapItem(itemStr) {
        const tokens = itemStr.trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) return null;
        const name = tokens[0];
        if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/.test(name)) return null;
        const rights = [];
        for (const t of tokens.slice(1)) {
            if (/^[RWXErwxe]+$/.test(t)) {
                for (const c of t.toUpperCase()) {
                    if (!rights.includes(c)) rights.push(c);
                }
            }
        }
        return { name, rights };
    }

    // Build a slot-number → capability-name map suitable for passing to disassemble().
    // Always includes the hardware-fixed DEMO_CLIST positions (LED0–LED5 at 8–13,
    // UART at 14, BTN at 15, SlideRule at 16, Timer at 17).
    // caps: array of {name} objects or strings from an assembled program's capability list.
    // nsLabels: sim.nsLabels — maps NS slot index → label string; used to resolve
    //   non-device abstractions (e.g. Tunnel at slot 31).
    static buildSlotNames(caps, nsLabels) {
        const slotNames = {
            8: 'LED0', 9: 'LED1', 10: 'LED2', 11: 'LED3', 12: 'LED4', 13: 'LED5',
            14: 'UART', 15: 'BTN', 16: 'SlideRule', 17: 'Timer',
        };
        if (caps && nsLabels) {
            for (const cap of caps) {
                const name = typeof cap === 'string' ? cap : (cap.name || '');
                if (!name) continue;
                for (const [idx, lbl] of Object.entries(nsLabels)) {
                    if (lbl && lbl.toUpperCase() === name.toUpperCase()) {
                        slotNames[parseInt(idx)] = name;
                        break;
                    }
                }
            }
        }
        return slotNames;
    }

    static decompileWords(trimmedWords, slotNames) {
        const _condNames = ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','','NV'];
        const asm = new ChurchAssembler();

        const branchTargetSet = new Set();
        for (let i = 0; i < trimmedWords.length; i++) {
            const w = trimmedWords[i] >>> 0;
            if (((w >>> 27) & 0x1F) !== 17) continue;
            const rawImm = w & 0x7FFF;
            const soff = (rawImm & 0x4000) ? (rawImm | 0xFFFF8000) : rawImm;
            const target = i + soff;
            if (target >= 0 && target < trimmedWords.length) {
                branchTargetSet.add(target);
            }
        }

        const sortedTargets = Array.from(branchTargetSet).sort((a, b) => a - b);
        const labelMap = new Map();
        sortedTargets.forEach((idx, n) => labelMap.set(idx, `L${n}`));

        const lines = [];
        for (let i = 0; i < trimmedWords.length; i++) {
            const word = trimmedWords[i] >>> 0;
            if (labelMap.has(i)) {
                lines.push(labelMap.get(i) + ':');
            }
            if (((word >>> 27) & 0x1F) === 23) {  // BRANCH = opcode 23 in v2.0
                const rawImm = word & 0x7FFF;
                const soff = (rawImm & 0x4000) ? (rawImm | 0xFFFF8000) : rawImm;
                const target = i + soff;
                const condCode = (word >>> 23) & 0xF;
                const mnemonic = 'BRANCH' + _condNames[condCode];
                const labelName = labelMap.get(target);
                if (labelName !== undefined) {
                    lines.push(`${mnemonic}  ${labelName}`);
                } else {
                    lines.push(asm.disassemble(word, slotNames));
                }
            } else {
                lines.push(word === 0 ? 'NOP' : asm.disassemble(word, slotNames));
            }
        }
        return lines;
    }

    // Optional slotNames: plain object mapping c-list slot number → capability name.
    // When provided, LOAD/SAVE/ELOADCALL CR, CR6[N] instructions with a matching
    // entry are shown in named form (e.g. "LOAD  CR3, LED0") instead of the raw
    // hex-offset form ("LOAD  CR3, CR6[0x0008]").  Callers build this from the
    // standard DEMO_CLIST mapping plus any user-declared capabilities.
    disassemble(word, slotNames) {
        word = word >>> 0;
        if (word === 0) return 'HALT';

        const opcode = (word >>> 27) & 0x1F;
        const cond   = (word >>> 23) & 0xF;
        const crDst  = (word >>> 19) & 0xF;
        const crSrc  = (word >>> 15) & 0xF;
        const imm    = word & 0x7FFF;

        // v2.0: Church 0–9, unassigned 10–15, Turing 16–25 (sparse — use an object not an array)
        const opNames   = {
            0:'LOAD', 1:'SAVE', 2:'CALL', 3:'RETURN', 4:'CHANGE', 5:'SWITCH',
            6:'TPERM', 7:'LAMBDA', 8:'ELOADCALL', 9:'XLOADLAMBDA',
            16:'DREAD', 17:'DWRITE', 18:'BFEXT', 19:'BFINS', 20:'MCMP',
            21:'IADD', 22:'ISUB', 23:'BRANCH', 24:'SHL', 25:'SHR',
        };
        const condNames = ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','','NV'];

        // WORD inline data constant — 27-bit payload in bits[26:0]
        if (opcode === 0x1E) {
            const data = word & 0x7FFFFFF;
            return `WORD 0x${data.toString(16).toUpperCase().padStart(7, '0')}`;
        }

        // Lump header: magic=0x1F in top 5 bits — format: magic(5)|n_minus_6(4)|cw(13)|typ(2)|cc(8)
        // typ: 00=abstraction, 01=namespace, 10=thread, 11=undefined (Outform is a GT/NS-slot state, not a LUMP type)
        if (opcode === 0x1F) {
            const n_minus_6 = (word >>> 23) & 0xF;
            const cw        = (word >>> 10) & 0x1FFF;
            const typ       = (word >>>  8) & 0x3;
            const cc        = word & 0xFF;
            const lumpSize  = 1 << (n_minus_6 + 6);
            const typNames  = ['lump', 'namespace', 'thread', '?'];
            return `.header ${typNames[typ]||'?'} n-6=${n_minus_6}\u2192${lumpSize}w cw=${cw} cc=${cc}`;
        }

        // v2.0: opcodes 10–15 and 26–29 are unassigned; anything else not in opNames is unknown
        if (!opNames[opcode]) return `??? 0x${word.toString(16).padStart(8, '0')}`;

        const op       = opNames[opcode];
        const condStr  = cond === 14 ? '' : condNames[cond];
        const mnemonic = op + condStr;

        // Format a 15-bit offset as a zero-padded hex string with bracket notation
        const hexOff = n => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;

        // Format a c-list slot access as CR6[0x…] — CR6 holds the c-list base pointer.
        const cdOff = n => `CR6[${hexOff(n)}]`;

        switch (opcode) {
            // LOAD CRd, CR6[offset]  — load GT from c-list (always numeric)
            case 0: {
                if (crSrc === 6) return `${mnemonic}  CR${crDst}, ${cdOff(imm)}`;
                return `${mnemonic}  CR${crDst}, CR${crSrc}[${hexOff(imm)}]`;
            }
            // SAVE CRd, CR6[offset]  — save GT to c-list (always numeric)
            case 1: {
                if (crSrc === 6) return `${mnemonic}  CR${crDst}, ${cdOff(imm)}`;
                return `${mnemonic}  CR${crDst}, CR${crSrc}[${hexOff(imm)}]`;
            }
            // CALL CRd[, MethodName]  — invoke capability via method-table dispatch
            case 2: {
                if (imm & 0x4000) return `${mnemonic}  CR${crDst}`;
                // imm=0: fast-path (backward-compat, no table dispatch).
                // imm>0: 1-based; method index = imm-1 (0-based) used for name resolution.
                if (imm === 0) return `${mnemonic}  CR${crDst}`;
                const sel = imm - 1;
                // Try to resolve method name: invert nsLoaded (name→crIdx) to find
                // what abstraction is bound to crDst, then look up the method name
                // for the selector index in methodConventions.
                let resolvedMethod = null;
                for (const [name, crIdx] of Object.entries(this.nsLoaded || {})) {
                    if (crIdx === crDst) {
                        const conv = this.methodConventions[name];
                        if (conv) {
                            for (const [mName, mData] of Object.entries(conv)) {
                                if (mData.index === sel) { resolvedMethod = mName; break; }
                            }
                        }
                        break;
                    }
                }
                if (resolvedMethod !== null) return `${mnemonic}  CR${crDst}, ${resolvedMethod}`;
                return `${mnemonic}  CR${crDst}, sel=${sel}`;
            }
            // RETURN [mask]  — unwind call frame, optional register scrub
            case 3: {
                const retMask = imm & 0xFFF;
                return retMask ? `${mnemonic}  0b${retMask.toString(2).padStart(12, '0')}` : mnemonic;
            }
            // CHANGE CRd, CR6[idx] / CRs[idx]
            case 4: {
                if (crSrc === 6) return `${mnemonic}  CR${crDst}, ${cdOff(imm)}`;
                return `${mnemonic}  CR${crDst}, CR${crSrc}[${hexOff(imm)}]`;
            }
            // SWITCH CRs, #tgt  — PassKey-gated one-way install of CRs into CR13 (tgt=5) or CR15 (tgt=7)
            case 5: return `${mnemonic}  CR${crSrc}, CR${imm & 0x7}`;
            // TPERM CRd, preset[B]  — assert/attenuate permission
            case 6: {
                const presetNames = ['CLEAR','R','RW','X','RX','RWX','L','S','E','LS','RSV3','RSV4','RSV5','FRAME','EXACT','RSV1'];
                const bFlag    = (imm >>> 4) & 1;
                const baseCode = imm & 0xF;
                const baseName = presetNames[baseCode] || 'RSV';
                if (baseCode === 14) {
                    // EXACT mode: display reference CR (crSrc field)
                    return `${mnemonic}  CR${crDst}, EXACT, CR${crSrc}`;
                }
                return `${mnemonic}  CR${crDst}, ${baseName}${bFlag ? 'B' : ''}`;
            }
            // LAMBDA CRd  — create closure from template
            case 7: return `${mnemonic}  CR${crDst}`;
            // ELOADCALL CRd, CR6[row], method  — fused load + method-table call (always numeric)
            // imm15[7:0] = c-list row; imm15[14:8] = method index (1-based, 0=fast-path)
            // Disassembler prints method as 0-based so output is directly re-assemblable.
            case 8: {
                const ec8Row    = imm & 0xFF;
                const ec8Method = (imm >>> 8) & 0x7F;
                const ec8Src    = crSrc === 6 ? cdOff(ec8Row) : `CR${crSrc}[${hexOff(ec8Row)}]`;
                if (ec8Method > 0) return `${mnemonic}  CR${crDst}, ${ec8Src}, ${ec8Method - 1}`;
                return `${mnemonic}  CR${crDst}, ${ec8Src}`;
            }
            // XLOADLAMBDA CRd, CR6[offset] / CRs[offset]  — fused load + lambda
            case 9: {
                if (crSrc === 6) return `${mnemonic}  CR${crDst}, ${cdOff(imm)}`;
                return `${mnemonic}  CR${crDst}, CR${crSrc}[${hexOff(imm)}]`;
            }
            // DREAD DRd, CRs, #offset  (bit14=1, immediate) or DRd, CRs, #base, DRx (bit14=0, indexed)
            case 16:
                if (imm & 0x4000) return `${mnemonic}  DR${crDst}, CR${crSrc}, #${imm & 0x3FFF}`;
                return `${mnemonic}  DR${crDst}, CR${crSrc}, #${(imm >> 4) & 0x3FF}, DR${imm & 0xF}`;
            // DWRITE DRd, CRs, #offset  (bit14=1, immediate) or DRd, CRs, #base, DRx (bit14=0, indexed)
            case 17:
                if (imm & 0x4000) return `${mnemonic}  DR${crDst}, CR${crSrc}, #${imm & 0x3FFF}`;
                return `${mnemonic}  DR${crDst}, CR${crSrc}, #${(imm >> 4) & 0x3FF}, DR${imm & 0xF}`;
            // BFEXT DRd, DRs, pos, w  — bit-field extract
            case 18: {
                const pos   = (imm >>> 5) & 0x1F;
                const width = imm & 0x1F;
                return `${mnemonic}  DR${crDst}, DR${crSrc}, pos=${pos}, w=${width}`;
            }
            // BFINS DRd, DRs, pos, w  — bit-field insert
            case 19: {
                const pos   = (imm >>> 5) & 0x1F;
                const width = imm & 0x1F;
                return `${mnemonic}  DR${crDst}, DR${crSrc}, pos=${pos}, w=${width}`;
            }
            // MCMP DRd, DRs  — compare, update condition flags
            case 20: return `${mnemonic}  DR${crDst}, DR${crSrc}`;
            // IADD DRd, DRs, DRm | #imm
            case 21: return (imm & 0x4000) ? `${mnemonic}  DR${crDst}, DR${crSrc}, #${imm & 0x3FFF}` : `${mnemonic}  DR${crDst}, DR${crSrc}, DR${imm & 0xF}`;
            // ISUB DRd, DRs, DRm | #imm
            case 22: return (imm & 0x4000) ? `${mnemonic}  DR${crDst}, DR${crSrc}, #${imm & 0x3FFF}` : `${mnemonic}  DR${crDst}, DR${crSrc}, DR${imm & 0xF}`;
            // BRANCH soff  — PC-relative conditional jump
            case 23: {
                const soff = (imm & 0x4000) ? (imm | 0xFFFF8000) : imm;
                return `${mnemonic}  ${soff >= 0 ? '+' : ''}${soff}`;
            }
            // SHL DRd, DRs, shamt
            case 24: return `${mnemonic}  DR${crDst}, DR${crSrc}, ${imm & 0x1F}`;
            // SHR DRd, DRs, shamt [ASR]
            case 25: {
                const arith = (imm >>> 5) & 1;
                const shamt = imm & 0x1F;
                return `${mnemonic}  DR${crDst}, DR${crSrc}, ${shamt}${arith ? ' ASR' : ''}`;
            }
            default: return `??? 0x${word.toString(16).padStart(8, '0')}`;
        }
    }
}

ChurchAssembler._liveSnippets = {};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChurchAssembler;
}
