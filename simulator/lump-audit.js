/**
 * lump-audit.js — LUMP binary structural consistency checker
 *
 * lumpAudit(words, manifest?) → Array<{ruleId, severity, message, detail}>
 *
 *   words    — Array or Uint32Array of 32-bit unsigned integers (the LUMP binary)
 *   manifest — optional object with cw / cc / lump_size fields from sidecar / manifest JSON
 *
 * severity values: 'pass' | 'warn' | 'error'
 *
 * Rules checked
 *   R1  — bits[31:27] of word 0 must equal 0x1F
 *   R2  — word count of the binary matches the size encoded in the header exponent
 *   RB1 — cw >= 1 (at least one code word)
 *   RB2 — 1 + cw + cc <= lump_size (bounds)
 *   RFS — all words in the freespace zone are zero
 *   RMC — if a manifest is supplied, its cw / cc / lump_size agree with the binary header
 *   RSM — no stub methods (bare RETURN with no real code body — compiler error)
 */

function lumpAudit(words, manifest, lineNums, opts) {
    const results = [];

    if (!words || words.length === 0) {
        results.push({
            ruleId: 'R0',
            severity: 'error',
            message: 'Empty binary',
            detail: 'The word array is empty — nothing to audit.',
        });
        return results;
    }

    const word0 = (words[0] >>> 0);

    const magic    = (word0 >>> 27) & 0x1F;
    const nMinus6  = (word0 >>> 23) & 0xF;
    const cw       = (word0 >>> 10) & 0x1FFF;
    const typ      = (word0 >>>  8) & 0x3;   // LUMP object type: 00=lump, 01=data, 10=clist-only, 11=Outform
    const cc       =  word0         & 0xFF;
    const lumpSize = 1 << (nMinus6 + 6);

    // Human-readable name for each typ value (bits[9:8] of word 0).
    const _typNames = { 0: 'lump', 1: 'data', 2: 'clist-only', 3: 'Outform' };
    const _typName  = _typNames[typ] || 'unknown';
    const _typBits  = typ.toString(2).padStart(2, '0');

    if (magic === 0x1F) {
        results.push({
            ruleId: 'R1',
            severity: 'pass',
            message: `Format recognised \u2014 type: ${_typName} (${_typBits}) \u2713`,
            detail: `Header identifier 0x${magic.toString(16).toUpperCase()} matches the Church Machine format. ` +
                `Object type: ${_typName} (typ=${_typBits}); cw=${cw}, cc=${cc}, lumpSize=${lumpSize} \u2713`,
        });
    } else {
        results.push({
            ruleId: 'R1',
            severity: 'error',
            message: 'Unrecognised file \u2014 this doesn\u2019t look like a Church Machine lump. Try re-exporting from the editor.',
            detail: `Header identifier is 0x${magic.toString(16).toUpperCase()} but a Church Machine lump must start with 0x1F. The file may be corrupt or the wrong format.`,
        });
    }

    const actualWords = words.length;
    if (actualWords === lumpSize) {
        results.push({
            ruleId: 'R2',
            severity: 'pass',
            message: 'File size correct \u2713',
            detail: `File contains ${actualWords} words, matching the declared size \u2713`,
        });
    } else {
        results.push({
            ruleId: 'R2',
            severity: 'error',
            message: `File size wrong \u2014 expected ${lumpSize} words but found ${actualWords}. Re-export the lump.`,
            detail: `The file has ${actualWords} words but the header says it should be ${lumpSize} words. Re-export the lump from the editor.`,
        });
    }

    // RB1: Structure check — depends on typ.
    //
    // typ=00/11 (executable / Outform): cw must be >= 1.
    // typ=01 (data): cw and cc must both be 0; no code section or c-list.
    // typ=10, cw=0 (Namespace): Namespace LUMP — body is the NS Table (binary
    //   data, not code).  cc is the Locator-entry count.  No GT c-list at tail.
    //   (See CM_LUMP_SPECIFICATION.md Appendix B.)
    // typ=10, cw>0 (Thread): `cw` is reinterpreted as `sw` (stack words) and
    //   `cc` as `heapWords` (Appendix A).  Mint requires sw > 0, cc > 0, and
    //   header(1) + DR(16) + heapWords + sw + caps(12) ≤ lumpSize.
    if (typ === 1 /* data */) {
        // Spec requires both cw and cc to be zero for typ=01 data lumps.
        if (cw !== 0 || cc !== 0) {
            results.push({
                ruleId: 'RB1',
                severity: 'error',
                message: `Data lump (typ=01): cw=${cw}, cc=${cc} \u2014 both must be 0. Mint step 3 will reject this lump.`,
                detail: `Data lumps (typ=01) must have cw=0 and cc=0 (no code section, no c-list). ` +
                    `Found cw=${cw}, cc=${cc}. This is a malformed header.`,
            });
        } else {
            results.push({
                ruleId: 'RB1',
                severity: 'pass',
                message: 'Data lump (typ=01) \u2014 cw=0, cc=0 \u2713',
                detail: 'This is a data lump (typ=01). cw=0 and cc=0 — no executable code section or c-list.',
            });
        }
    } else if (typ === 2 && cw === 0) {
        // typ=10, cw=0: Thread LUMP with zero stack words.
        // This is produced when a Thread LUMP editor clamps cw to 0 because the
        // lump is over-capacity (heap ≤ 0).  Mint rejects Thread LUMPs with sw=0.
        // Spec: Thread LUMP (typ=10) requires cw ≥ 1 (cw field = stack words).
        results.push({
            ruleId: 'RB1',
            severity: 'error',
            message: `typ=10, cw=0 \u2014 zero stack words. Thread LUMP requires cw \u2265 1 (Mint step 5 will reject this lump).`,
            detail: 'Thread LUMP (typ=10) with cw=0 means sw (stack words) = 0. ' +
                'This is produced when the lump is over-capacity (heap \u2264 0) and the editor clamps cw to 0. ' +
                'Mint rejects Thread LUMPs with sw=0. Reduce stack depth or increase lump size. ' +
                'See CM_LUMP_SPECIFICATION.md Appendix A.',
        });
    } else if (typ === 2 /* Thread: cw>0 */) {
        // Thread LUMP (typ=10, cw>0): cw = sw (stack words), cc = heapWords.
        const sw = cw;            // cw field reinterpreted as stack words
        const hw = cc;            // cc field reinterpreted as heap words
        const CAPS_ZONE  = 12;   // architecture-fixed (CR0..CR11)
        const DR_ZONE    = 16;   // data registers DR0..DR15
        const HDR        = 1;    // header word
        const minFit = HDR + DR_ZONE + hw + sw + CAPS_ZONE;  // 29 + hw + sw
        if (hw === 0) {
            results.push({
                ruleId: 'RB1',
                severity: 'error',
                message: 'Thread lump: heapWords = 0 \u2014 Mint requires cc > 0.',
                detail: 'Thread lump (typ=10, cw>0) header has heapWords (cc field) = 0. ' +
                    'Mint validates cc > 0; a Thread with no heap zone is malformed.',
            });
        } else if (minFit > lumpSize) {
            results.push({
                ruleId: 'RB1',
                severity: 'error',
                message: `Thread lump: zones don\u2019t fit \u2014 header+DR+heap+stack+caps = ${minFit} > lumpSize (${lumpSize}).`,
                detail: `Thread lump (typ=10) geometry invalid: header(1) + DR(16) + heap(${hw}) + stack(${sw}) + caps(12) = ${minFit} words, ` +
                    `but lumpSize = ${lumpSize}. Mint requires 17 + sw + cc \u2264 lumpSize \u2212 12.`,
            });
        } else {
            results.push({
                ruleId: 'RB1',
                severity: 'pass',
                message: `Thread lump: sw=${sw}, heapWords=${hw} \u2014 geometry valid \u2713`,
                detail: `Thread lump (typ=10): header(1) + DR(16) + heap(${hw}) + stack(${sw}) + caps(12) = ${minFit} words, ` +
                    `fits within ${lumpSize}-word lump \u2713`,
            });
        }
    } else if (cw >= 1) {
        results.push({
            ruleId: 'RB1',
            severity: 'pass',
            message: `Has code \u2014 contains ${cw} code word${cw !== 1 ? 's' : ''} \u2713`,
            detail: `${cw} code word${cw !== 1 ? 's' : ''} found in the file \u2713`,
        });
    } else {
        results.push({
            ruleId: 'RB1',
            severity: 'error',
            message: 'No code found \u2014 a valid lump needs at least one code word.',
            detail: 'The code word count is zero. Every Church Machine lump must contain at least one instruction.',
        });
    }

    const contentWords = 1 + cw + cc;
    if (contentWords <= lumpSize) {
        results.push({
            ruleId: 'RB2',
            severity: 'pass',
            message: 'Layout fits \u2014 header + code + capability list all fit within the file \u2713',
            detail: `1 header + ${cw} code word${cw !== 1 ? 's' : ''} + ${cc} capability slot${cc !== 1 ? 's' : ''} = ${contentWords} words, within the ${lumpSize}-word file \u2713`,
        });
    } else {
        results.push({
            ruleId: 'RB2',
            severity: 'error',
            message: 'Layout too big \u2014 the declared sizes don\u2019t fit within the file. The lump may be corrupted.',
            detail: `1 header + ${cw} code word${cw !== 1 ? 's' : ''} + ${cc} capability slot${cc !== 1 ? 's' : ''} = ${contentWords} words, but the file is only ${lumpSize} words. Re-export the lump.`,
        });
    }

    if (actualWords === lumpSize && contentWords <= lumpSize) {
        // RFS: Freespace zero-fill check.
        //
        // Namespace lumps (typ=10, cw=0): the body IS the NS Table — binary
        // data, not freespace. Applying the generic freespace scan to an NS
        // body would falsely flag valid NS Table entries as dirty.  Skip RFS.
        //
        // Thread lumps (typ=10, cw>0): freespace is the collision zone
        // between heap (grows ↑ from word 17+heapWords) and stack
        // (grows ↓ from word lumpSize-12-sw).
        //
        // Standard lumps (typ=00/01/11): freespace = words cw+1 .. lumpSize-cc-1.
        const _isThread    = (typ === 2 && cw > 0);
        const _isNamespace = (typ === 2 && cw === 0);
        const _isData      = (typ === 1);

        if (_isNamespace || _isData) {
            // Namespace body is the NS Table — data, not freespace.  Skip RFS.
            // Data LUMP body is programmer-defined payload — also not freespace.
            // (No RFS result is emitted for either; the concept does not apply.)
        } else {
        let fsStart, fsEnd;
        if (_isThread) {
            const hw = cc;   // cc reinterpreted as heap words
            fsStart = 17 + hw;              // first word after heap zone
            fsEnd   = lumpSize - 12 - cw;  // first stack word (exclusive)
        } else {
            fsStart = 1 + cw;
            fsEnd   = lumpSize - cc;
        }
        const fsCount = Math.max(0, fsEnd - fsStart);

        if (fsCount === 0) {
            results.push({
                ruleId: 'RFS',
                severity: 'pass',
                message: 'No freespace \u2014 lump is fully packed \u2713',
                detail: typ === 2
                    ? 'Thread lump freespace zone is empty (heap and stack are adjacent) \u2713'
                    : 'No padding zone \u2014 lump is fully packed \u2713',
            });
        } else {
            let dirtyWords = 0;
            let firstDirtyIdx = -1;
            let firstDirtyVal = 0;
            for (let i = fsStart; i < fsEnd; i++) {
                if ((words[i] >>> 0) !== 0) {
                    if (firstDirtyIdx < 0) {
                        firstDirtyIdx = i;
                        firstDirtyVal = words[i] >>> 0;
                    }
                    dirtyWords++;
                }
            }
            if (dirtyWords === 0) {
                results.push({
                    ruleId: 'RFS',
                    severity: 'pass',
                    message: 'Freespace is zeroed \u2713',
                    detail: `${fsCount} freespace word${fsCount !== 1 ? 's' : ''} (words ${fsStart}\u2013${fsEnd - 1}) are all zero \u2713`,
                });
            } else {
                results.push({
                    ruleId: 'RFS',
                    severity: 'error',
                    message: `Non-zero freespace \u2014 ${dirtyWords} unexpected word${dirtyWords !== 1 ? 's' : ''} found in the freespace zone. Mint step 7 will reject this lump.`,
                    detail: `${dirtyWords} non-zero word${dirtyWords !== 1 ? 's' : ''} in the freespace zone (words ${fsStart}\u2013${fsEnd - 1}); first dirty word at position ${firstDirtyIdx}: 0x${firstDirtyVal.toString(16).toUpperCase().padStart(8, '0')}. All freespace words must be zero before Mint can load this lump.`,
                });
            }
        }
        }  // end of if (!_isNamespace) else block
    } else {
        results.push({
            ruleId: 'RFS',
            severity: 'warn',
            message: 'Freespace check skipped \u2014 fix size/bounds errors above first.',
            detail: 'Cannot check freespace until the file size and layout errors above are resolved.',
        });
    }

    // ── RGT — C-List GT Word 0 Format Check ──────────────────────────────────
    // Mint step 8 requires every c-list slot to be a well-formed GT Word 0.
    // Null GTs (all-zero) are always valid — they are the compile-time placeholder
    // for capabilities that the server injects at deployment time.
    //
    // GT Word 0 layout (CM_LUMP_SPECIFICATION.md §"Word 0 — The Golden Token"):
    //   [31]    B      (Bind flag)
    //   [30:28] perm3  (permissions: Turing {X,W,R} or Church {E,S,L} per dom)
    //   [27]    dom    (0=Turing, 1=Church)
    //   [26]    spare  (must be 0 — except in v2.0 Abstract GTs where bits[26:25]
    //                  encode gt_type=11; see note below)
    //   [25]    f_flag
    //   [24:23] typ    (GT class: 00=NULL, 01=Inform, 10=Outform, 11=Abstract)
    //   [22:16] gt_seq (revocation sequence number)
    //   [15:0]  object_id
    //
    // ── RGT — C-List GT Word 0 Format Check ──────────────────────────────────
    // GT Word 0 layout per CM_LUMP_SPECIFICATION.md v1.2 §"Word 0 — The Golden Token":
    //   [31]    B      Bind flag
    //   [30:28] perm3  Permissions (Turing {X,W,R} or Church {E,S,L} per dom)
    //   [27]    dom    Domain: 0=Turing, 1=Church
    //   [26]    spare  MUST be 0 (Mint step 8 rejects any non-zero value here)
    //   [25]    f_flag
    //   [24:23] typ    GT class: 00=NULL, 01=Inform, 10=Outform, 11=Abstract
    //   [22:16] gt_seq Revocation sequence number
    //   [15:0]  object_id
    //
    // Null GTs (all-zero) are always valid — they are the compile-time placeholder
    // for capabilities injected at deployment time.
    //
    // For Thread lumps (typ=10): the caps zone is architecture-fixed at 12 words
    // at lumpSize-12..lumpSize-1 (CR0..CR11), regardless of the cc (heapWords) field.
    // For standard lumps: the c-list is at lumpSize-cc..lumpSize-1.
    //
    // Namespace LUMPs (typ=10, cw=0): body is the NS Table — no GT c-list at tail.
    // Applying RGT to NS Table entries would scan binary NS data as GT Word 0s
    // and produce meaningless or false-positive errors.  Skip RGT for Namespace.
    //
    // Thread LUMPs (typ=10, cw>0): caps zone is architecture-fixed at 12 words
    // at lumpSize-12..lumpSize-1, regardless of cc (heapWords).
    //
    // Standard lumps (typ=00/01/11): c-list is at lumpSize-cc..lumpSize-1.
    //
    // Skipped when binary size or bounds checks have already failed.
    // For standard lumps: also skipped when cc=0.  Namespace lumps: always skipped.
    const _rgtIsThread    = (typ === 2 && cw > 0);
    const _rgtIsNamespace = (typ === 2 && cw === 0);
    const _rgtSlotCount = _rgtIsThread ? 12 : cc;
    const _rgtBaseIdx   = lumpSize - _rgtSlotCount;
    // Also skip RGT for data LUMPs (typ=01): body is programmer payload, not a c-list.
    const _rgtRun = !_rgtIsNamespace && typ !== 1 && actualWords === lumpSize && contentWords <= lumpSize && _rgtSlotCount > 0;
    if (_rgtIsNamespace) {
        // Namespace LUMPs (typ=10, cw=0) carry the NS Table in the body, not a GT c-list.
        // Scanning the NS Table words as GT Word 0 values would produce meaningless or
        // false-positive errors — RGT does not apply.
        results.push({
            ruleId: 'RGT',
            severity: 'pass',
            message: 'GT format check not applicable \u2014 clist-only (typ=10) LUMP has no GT c-list \u2713',
            detail: 'Namespace LUMPs (typ=10, cw=0) store an NS Table in the body rather than a GT c-list at the tail. RGT is skipped.',
        });
    } else if (_rgtRun) {
        const _rgtViolations = [];

        for (let si = 0; si < _rgtSlotCount; si++) {
            const gw = (words[_rgtBaseIdx + si] >>> 0);
            if (gw === 0) continue;  // NULL GT (all-zero) — always valid

            // Spec v1.2: bit 26 is the spare field and must be 0.
            const _spare = (gw >>> 26) & 0x1;
            if (_spare !== 0) {
                _rgtViolations.push(
                    `${_rgtIsThread ? 'Caps' : 'C-list'} slot [${si}] = 0x${gw.toString(16).toUpperCase().padStart(8, '0')}: ` +
                    `spare bit 26 = 1 (must be 0 per CM_LUMP_SPECIFICATION.md v1.2 §"Word 0"). ` +
                    `Mint step 8 will reject this lump.`
                );
            }
        }

        const slotLabel = _rgtIsThread ? 'cap' : 'c-list slot';
        if (_rgtViolations.length === 0) {
            results.push({
                ruleId: 'RGT',
                severity: 'pass',
                message: `GT format valid \u2014 all ${_rgtSlotCount} ${slotLabel}${_rgtSlotCount !== 1 ? 's' : ''} are well-formed \u2713`,
                detail: `All ${_rgtSlotCount} ${slotLabel}${_rgtSlotCount !== 1 ? 's' : ''} are either null (0x00000000) or structurally valid GT Word 0 values \u2713`,
            });
        } else {
            results.push({
                ruleId: 'RGT',
                severity: 'error',
                message: `Malformed GT \u2014 ${_rgtViolations.length} ${slotLabel}${_rgtViolations.length !== 1 ? 's' : ''} would be rejected by Mint.`,
                detail: _rgtViolations.join(' '),
            });
        }
    }

    if (manifest && typeof manifest === 'object') {
        const checks = [];
        let mCoherent = true;

        if (manifest.cw !== undefined && manifest.cw !== null) {
            const mCw = parseInt(manifest.cw);
            if (mCw === cw) {
                checks.push(`code words: ${cw} \u2713`);
            } else {
                checks.push(`code words: record says ${mCw} but file has ${cw}`);
                mCoherent = false;
            }
        }
        if (manifest.cc !== undefined && manifest.cc !== null) {
            const mCc = parseInt(manifest.cc);
            if (mCc === cc) {
                checks.push(`capability count: ${cc} \u2713`);
            } else {
                checks.push(`capability count: record says ${mCc} but file has ${cc}`);
                mCoherent = false;
            }
        }
        if (manifest.lump_size !== undefined && manifest.lump_size !== null) {
            const mSz = parseInt(manifest.lump_size);
            if (mSz === lumpSize) {
                checks.push(`file size: ${lumpSize} words \u2713`);
            } else {
                checks.push(`file size: record says ${mSz} words but file is ${lumpSize} words`);
                mCoherent = false;
            }
        }

        if (checks.length === 0) {
            results.push({
                ruleId: 'RMC',
                severity: 'pass',
                message: 'Repository record found (no size fields to compare).',
                detail: 'A repository record exists but contains no code word count, capability count, or file size to verify against.',
            });
        } else if (mCoherent) {
            results.push({
                ruleId: 'RMC',
                severity: 'pass',
                message: 'Repository record matches \u2713',
                detail: 'Code words, capability count, and file size all agree: ' + checks.join(', '),
            });
        } else {
            results.push({
                ruleId: 'RMC',
                severity: 'error',
                message: 'Repository record mismatch \u2014 re-compile the lump or update the record.',
                detail: checks.join(', ') + ' \u2014 update the repository record or re-assemble the lump.',
            });
        }
    }

    // ── RCI — Church Instruction Range Check ──────────────────────────────────
    // For each code word in words[1..cw]:
    //   LOAD/SAVE/ELOADCALL/XLOADLAMBDA (crSrc=6, c-list access): when the LUMP
    //   carries its own c-list (cc > 0) the slot must be in range 0..cc-1.
    //   When cc=0 the LUMP uses the ambient boot c-list at runtime, so no
    //   per-LUMP slot-bounds check is possible or meaningful — slots are exempt.
    //   BRANCH (opcode 23, v2.0 ISA): sign-extended 15-bit offset must land in [0, cw-1].
    //   Note: opcode 17 = DWRITE (device write) — not BRANCH — in v2.0.
    //
    // Skipped for Thread lumps (typ=10): words 1..sw are DR values (data registers),
    // not executable code; applying Church instruction checks to them is meaningless.
    // Skipped when binary size or bounds checks have already failed.
    if (actualWords === lumpSize && contentWords <= lumpSize && cw >= 1 && typ !== 2 && typ !== 1) {
        const _rciChurchOps = new Set([0, 1, 8, 9]);
        const _rciOpName    = { 0: 'LOAD', 1: 'SAVE', 8: 'ELOADCALL', 9: 'XLOADLAMBDA' };
        const _rciBranchOp  = 23;  // v2.0 ISA: BRANCH is opcode 23 (opcode 17 = DWRITE)
        const _rciViolations = [];
        const _rncViolations = [];  // RNC — NULL GT in a valid c-list slot (warning)

        // Build capability-name context for violation messages (e.g. "[0]='SlideRule'")
        const _rciPetNames = manifest && manifest.pet_names && manifest.pet_names.CR
            ? manifest.pet_names.CR : {};
        const _rciDefinedSlots = [];
        for (let _s = 0; _s < cc; _s++) {
            const _n = _rciPetNames[String(_s)];
            _rciDefinedSlots.push(_n ? `[${_s}]='${_n}'` : `[${_s}]`);
        }
        const _rciSlotHint = _rciDefinedSlots.length > 0
            ? `; defined: ${_rciDefinedSlots.join(', ')}`
            : '';

        for (let wi = 1; wi <= cw && wi < actualWords; wi++) {
            const ww     = words[wi] >>> 0;
            const op     = (ww >>> 27) & 0x1F;
            const crSrc  = (ww >>> 15) & 0xF;
            // ELOADCALL imm15 R-type split: imm[4:0] = c-list row (5-bit, matches hardware rs2);
            //           imm[11:5] = method index (7-bit 1-based, matches hardware funct7).
            // All other Church ops (LOAD/SAVE/XLOADLAMBDA) use the full imm15 as slot.
            const slot   = op === 8 ? (ww & 0x1F) : (ww & 0x7FFF);
            const codeIdx = wi - 1;   // 0-based index within the code section

            // Slot-bounds check only applies when the LUMP has its own c-list.
            // cc=0 means ambient-boot-c-list — slots are resolved at load time.
            if (_rciChurchOps.has(op) && crSrc === 6 && cc > 0 && slot < cc) {
                // Slot is within range — check whether the c-list word is NULL (0x00000000).
                // c-list occupies words[lumpSize - cc] through words[lumpSize - 1].
                const _clistWord = (words[lumpSize - cc + slot] >>> 0);
                if (_clistWord === 0) {
                    const _nullCapName = _rciPetNames[String(slot)] ||
                        (manifest && Array.isArray(manifest.capabilities) &&
                         manifest.capabilities[slot] && manifest.capabilities[slot].name) || null;
                    const _nullNameHint = _nullCapName ? ` ("${_nullCapName}")` : '';
                    const _nullMsg = `Instruction ${wi} (${_rciOpName[op]}) accesses capability slot ${slot}${_nullNameHint},` +
                        ` but that slot contains a NULL GT (0x00000000).` +
                        ` The ${_nullCapName || 'capability'} GT was not written into the c-list.`;
                    const _nullSrcLine = lineNums && lineNums[wi] != null ? lineNums[wi] : null;
                    _rncViolations.push({ msg: _nullMsg, sourceLine: _nullSrcLine, slot, wordIndex: codeIdx });
                }
            } else if (_rciChurchOps.has(op) && crSrc === 6 && cc > 0 && slot >= cc) {
                // Slot is beyond the declared c-list (slot >= cc) — always a structural error.
                // Accessing a slot index >= cc is invalid regardless of what physical memory
                // happens to contain at that address; the c-list header declares cc as the
                // authoritative bound and the runtime enforces it.
                const _capName = _rciPetNames[String(slot)] ||
                    (manifest && Array.isArray(manifest.capabilities) &&
                     manifest.capabilities[slot] && manifest.capabilities[slot].name) || null;
                const _slotNameHint = _capName
                    ? ` \u2014 "${_capName}" is referenced but not declared in this lump\u2019s c-list`
                    : '';
                const _fixHint = ` Increase cc to at least ${slot + 1} to add slot [${slot}].`;
                const _rciMsg = `Instruction ${wi} (${_rciOpName[op]}) tries to access capability slot ${slot}` +
                    `, but this lump only has ${cc} capability slot${cc !== 1 ? 's' : ''}${_slotNameHint}.${_fixHint}`;
                const _rciSrcLine = lineNums && lineNums[wi] != null ? lineNums[wi] : null;
                _rciViolations.push({ msg: _rciMsg, sourceLine: _rciSrcLine, slot, wordIndex: codeIdx });
            }

            if (op === _rciBranchOp) {
                let off = ww & 0x7FFF;
                if (off & 0x4000) off = off - 0x8000;   // sign-extend 15-bit
                const target = codeIdx + off;
                if (target < 0 || target >= cw) {
                    const _branchMsg = `Instruction ${wi} (BRANCH) jumps to position ${target}, ` +
                        `which is outside the code section (valid range: 0 to ${cw - 1}).`;
                    const _branchSrcLine = lineNums && lineNums[wi] != null ? lineNums[wi] : null;
                    _rciViolations.push({ msg: _branchMsg, sourceLine: _branchSrcLine });
                }
            }
        }

        if (_rciViolations.length === 0) {
            const _rciDetail = cc === 0
                ? `All ${cw} instruction${cw !== 1 ? 's' : ''} checked \u2014 no private capability list (ambient slots used at runtime) \u2713`
                : `All ${cw} instruction${cw !== 1 ? 's' : ''} checked \u2014 all capability slot accesses are in range \u2713`;
            results.push({
                ruleId: 'RCI',
                severity: 'pass',
                message: 'Capability slots in range \u2014 all accesses within allocated slots \u2713',
                detail: _rciDetail,
            });
        } else {
            const _badSlots = [...new Set(_rciViolations.filter(v => v.slot != null).map(v => v.slot))].sort((a, b) => a - b);
            const _hasBranchOnly = _badSlots.length === 0;
            let _rciErrMsg;
            if (_hasBranchOnly) {
                _rciErrMsg = `Instruction jump out of range \u2014 ${_rciViolations.length} jump${_rciViolations.length !== 1 ? 's' : ''} land${_rciViolations.length === 1 ? 's' : ''} outside the code section.`;
            } else {
                const _slotList = ` \u2014 slot${_badSlots.length !== 1 ? 's' : ''} [${_badSlots.join(', ')}] accessed but this lump only allocates ${cc} slot${cc !== 1 ? 's' : ''}`;
                _rciErrMsg = `Capability slot out of range${_slotList}.`;
            }
            results.push({
                ruleId: 'RCI',
                severity: 'error',
                message: _rciErrMsg,
                detail: _rciViolations.map(v => v.msg).join(' '),
                violations: _rciViolations,
            });
        }

        // ── RNC — NULL GT in c-list (warning) ────────────────────────────────
        // skipRnc is set when auditing a freshly compiled binary whose c-list is
        // intentionally all-zeros (GTs are injected at deployment time by the server).
        // In that context the warning is always a false positive — the Capabilities
        // panel above already shows the named slots from the manifest.
        if (opts && opts.skipRnc) {
            if (cc > 0) {
                results.push({
                    ruleId: 'RNC',
                    severity: 'pass',
                    message: 'C-list slots not checked \u2014 GTs populated at deployment \u2713',
                    detail: 'In a freshly compiled binary the c-list area is 0x00000000; the server injects capability GTs when the lump is saved to the namespace. Named slots are listed in the Capabilities panel above.',
                });
            }
        } else if (_rncViolations.length === 0) {
            if (cc > 0) {
                results.push({
                    ruleId: 'RNC',
                    severity: 'pass',
                    message: 'No NULL GTs \u2014 all accessed c-list slots contain non-zero GT values \u2713',
                    detail: `Every c-list slot accessed by code contains a non-null GT \u2713`,
                });
            }
        } else {
            const _nullSlots = [...new Set(_rncViolations.map(v => v.slot))].sort((a, b) => a - b);
            const _slotLabel = `slot${_nullSlots.length !== 1 ? 's' : ''} [${_nullSlots.join(', ')}]`;
            results.push({
                ruleId: 'RNC',
                severity: 'warn',
                message: `NULL GT in c-list \u2014 ${_slotLabel} contain${_nullSlots.length === 1 ? 's' : ''} a NULL GT (0x00000000).`,
                detail: _rncViolations.map(v => v.msg).join(' ') +
                    ' Note: c-list slots are always 0x00000000 in a freshly compiled binary \u2014 the runtime fills them at load time. This warning is expected for any lump that has not yet been deployed to the namespace.',
                violations: _rncViolations,
            });
        }
    } else if (typ !== 2 && typ !== 1 /* Thread/data lumps silently skip RCI; only warn for other failures */) {
        results.push({
            ruleId: 'RCI',
            severity: 'warn',
            message: 'Capability slot check skipped \u2014 fix size or bounds errors above first.',
            detail: 'Cannot check capability slot ranges until the file size and layout errors above are resolved.',
        });
    }

    // ── RPN — Pet Name Coverage ───────────────────────────────────────────────
    // Verify every c-list slot accessed by a Church instruction (LOAD/SAVE/
    // ELOADCALL/XLOADLAMBDA via CR6) has a resolvable pet name.
    // Name sources (tried in priority order, all always scanned):
    //   1. manifest.pet_names.CR   — slot-index string → name
    //   2. manifest.capabilities[] — array index = slot; .name or bare string
    //   3. Pending GT sentinels    — bits[31:16]=0xFEED in the binary c-list;
    //                                name carried inside the sentinel word itself
    // The "Capability names not checked" warning is only emitted when NO source
    // yields any name at all.  Previously it fired whenever the manifest lacked
    // both pet_names.CR and capabilities[], which caused false positives when the
    // assembler had already baked pet names into the binary as pending sentinels.
    // Skipped for Thread lumps (typ=10): cc=heapWords, not a c-list slot count.
    // Skipped when cc=0 (no c-list) or when binary size/bounds failed.
    if (actualWords === lumpSize && contentWords <= lumpSize && cw >= 1 && cc > 0 &&
            typ !== 2 && typ !== 1 && manifest && typeof manifest === 'object') {

        // ── Step 1: build slot → best name map from all available sources ─────
        const _rpnSlotName = {};

        // Source 1: manifest.pet_names.CR
        if (manifest.pet_names &&
                typeof manifest.pet_names.CR === 'object' &&
                manifest.pet_names.CR !== null) {
            for (const [k, v] of Object.entries(manifest.pet_names.CR)) {
                const s = parseInt(k, 10);
                if (!isNaN(s) && s >= 0 && s < cc) _rpnSlotName[s] = String(v);
            }
        }

        // Source 2: manifest.capabilities[] — supports both {name:…} objects and
        // bare strings (assembler output format may vary).
        if (Array.isArray(manifest.capabilities)) {
            for (let i = 0; i < manifest.capabilities.length && i < cc; i++) {
                if (_rpnSlotName[i]) continue;          // already named by source 1
                const cap = manifest.capabilities[i];
                if (cap && cap.name)               _rpnSlotName[i] = String(cap.name);
                else if (typeof cap === 'string' && cap) _rpnSlotName[i] = cap;
            }
        }

        // Source 3: pending GT sentinels in the binary's c-list area.
        // A pending sentinel (bits[31:16] = 0xFEED) carries the pet name index
        // internally.  This covers lumps whose assembler baked in pending GTs but
        // whose repository record predates capability-name storage.
        if (actualWords >= lumpSize && lumpSize > cc) {
            const _rpnClistBase = lumpSize - cc;
            for (let _si = 0; _si < cc; _si++) {
                if (_rpnSlotName[_si]) continue;        // already named
                const _rpnGT = (words[_rpnClistBase + _si] >>> 0);
                if ((_rpnGT >>> 16) === 0xFEED) {
                    const _rpnPendIdx  = _rpnGT & 0xFFFF;
                    const _rpnPendName = (typeof ChurchSimulator !== 'undefined' &&
                        ChurchSimulator.PENDING_GT_NAMES &&
                        ChurchSimulator.PENDING_GT_NAMES[_rpnPendIdx])
                        ? ChurchSimulator.PENDING_GT_NAMES[_rpnPendIdx]
                        : ('pending#' + _rpnPendIdx);
                    _rpnSlotName[_si] = '\u29d6 ' + _rpnPendName + ' (pending)';
                }
            }
        }

        // ── Step 2: decide what to report ─────────────────────────────────────
        const _rpnAnyNamed = Object.keys(_rpnSlotName).length > 0;

        if (!_rpnAnyNamed) {
            // Nothing resolved names from any source.
            results.push({
                ruleId: 'RPN',
                severity: 'warn',
                message: `Capability names not checked \u2014 this lump uses ${cc} capability slot${cc !== 1 ? 's' : ''} but the repository record doesn\u2019t say what they are. Add capability names to enable this check.`,
                detail: `${cc} capability slot${cc !== 1 ? 's' : ''} allocated but the repository record has no capability names. Add capability names to the record to enable this check.`,
            });
        } else {
            // Scan Church instructions for unnamed-slot references.
            const _rpnChurchOps = new Set([0, 1, 8, 9]);
            const _rpnUnnamedReferenced = new Set();
            for (let wi = 1; wi <= cw && wi < actualWords; wi++) {
                const ww    = words[wi] >>> 0;
                const op    = (ww >>> 27) & 0x1F;
                const crSrc = (ww >>> 15) & 0xF;
                const slot  =  ww         & 0x7FFF;
                if (!_rpnChurchOps.has(op) || crSrc !== 6 || slot >= cc) continue;
                if (!_rpnSlotName[slot]) _rpnUnnamedReferenced.add(slot);
            }

            // Check coverage of all allocated slots (even unreferenced ones).
            const _rpnUnnamedAny = [];
            for (let s = 0; s < cc; s++) {
                if (!_rpnSlotName[s]) _rpnUnnamedAny.push(s);
            }

            if (_rpnUnnamedReferenced.size > 0) {
                const refs = Array.from(_rpnUnnamedReferenced).sort((a, b) => a - b);
                results.push({
                    ruleId: 'RPN',
                    severity: 'warn',
                    message: `Unnamed capability slot${refs.length !== 1 ? 's' : ''} \u2014 slot${refs.length !== 1 ? 's' : ''} [${refs.join(', ')}] are used but not identified in the record.`,
                    detail: `Capability slot${refs.length !== 1 ? 's' : ''} [${refs.join(', ')}] ${refs.length !== 1 ? 'are' : 'is'} referenced by instructions but ha${refs.length !== 1 ? 've' : 's'} no name in the repository record. Add capability names to identify them.`,
                });
            } else if (_rpnUnnamedAny.length > 0) {
                results.push({
                    ruleId: 'RPN',
                    severity: 'warn',
                    message: `Unnamed capability slot${_rpnUnnamedAny.length !== 1 ? 's' : ''} \u2014 slot${_rpnUnnamedAny.length !== 1 ? 's' : ''} [${_rpnUnnamedAny.join(', ')}] ${_rpnUnnamedAny.length !== 1 ? 'are' : 'is'} allocated but not identified in the record.`,
                    detail: `Capability slot${_rpnUnnamedAny.length !== 1 ? 's' : ''} [${_rpnUnnamedAny.join(', ')}] ${_rpnUnnamedAny.length !== 1 ? 'are' : 'is'} allocated but unnamed in the repository record. Add capability names to identify them.`,
                });
            } else {
                const nameList = Array.from({ length: cc }, (_, i) =>
                    `[${i}]\u202F"${_rpnSlotName[i]}"`
                ).join(', ');
                results.push({
                    ruleId: 'RPN',
                    severity: 'pass',
                    message: `All capabilities named \u2713 \u2014 all ${cc} slot${cc !== 1 ? 's' : ''} identified.`,
                    detail: `All ${cc} capability slot${cc !== 1 ? 's' : ''} named: ${nameList} \u2713`,
                });
            }
        }
    }

    // ── RSM — Return Stub Method ──────────────────────────────────────────────
    // Detects methods whose entire body is a bare RETURN with no real code.
    // This is a compiler error: the method declaration was emitted but the body
    // is missing, producing a "RETURN followed by RETURN" pattern in the binary.
    //
    // Two detection modes:
    //   1. Manifest-guided  — uses manifest.methods[].offset to delineate ranges
    //   2. Binary-only      — scans for consecutive RETURNs (only zeros between)
    // Skipped for Thread lumps (typ=10): words 1..sw are DR state, not executable code;
    // scanning them for RETURN opcodes would produce false stub-method warnings.
    // Skipped for data lumps (typ=01): body is programmer payload, not instructions.
    if (actualWords === lumpSize && contentWords <= lumpSize && cw >= 1 && typ !== 2 && typ !== 1) {
        const _RETURN_OP = 3;
        const _rsmStubs = [];  // { name?, wordIndex }

        if (manifest && Array.isArray(manifest.methods) && manifest.methods.length > 0) {
            // Manifest-guided: use explicit method offsets to scan each method's range.
            const _rsmMethods = manifest.methods
                .filter(m => !m.aliasOf && typeof m.offset === 'number')
                .sort((a, b) => a.offset - b.offset);
            for (let _mi = 0; _mi < _rsmMethods.length; _mi++) {
                const _mStart = 1 + _rsmMethods[_mi].offset;  // word index in binary
                const _mEnd   = _mi + 1 < _rsmMethods.length
                    ? 1 + _rsmMethods[_mi + 1].offset
                    : 1 + cw;
                let _hasReal   = false;
                let _hasReturn = false;
                for (let _j = _mStart; _j < _mEnd && _j < actualWords; _j++) {
                    const _jw  = words[_j] >>> 0;
                    if (_jw === 0) continue;
                    const _jop = (_jw >>> 27) & 0x1F;
                    if (_jop === _RETURN_OP) { _hasReturn = true; continue; }
                    _hasReal = true;
                    break;
                }
                if (!_hasReal && _hasReturn) {
                    _rsmStubs.push({ name: _rsmMethods[_mi].name, wordIndex: _mStart });
                }
            }
        } else {
            // Binary-only: two RETURNs separated only by zero/padding words signal
            // an empty method body between them.
            let _lastReturnIdx = -1;
            for (let _wi = 1; _wi <= cw && _wi < actualWords; _wi++) {
                const _wv  = words[_wi] >>> 0;
                if (_wv === 0) continue;                          // padding — skip
                const _wop = (_wv >>> 27) & 0x1F;
                if (_wop === _RETURN_OP) {
                    if (_lastReturnIdx >= 0) {
                        // Previous RETURN seen and nothing real between them → stub
                        _rsmStubs.push({ wordIndex: _wi });
                    }
                    _lastReturnIdx = _wi;
                } else {
                    _lastReturnIdx = -1;  // real instruction resets the chain
                }
            }
        }

        if (_rsmStubs.length === 0) {
            results.push({
                ruleId: 'RSM',
                severity: 'pass',
                message: 'No stub methods \u2014 all methods contain real code \u2713',
                detail: 'All method bodies contain at least one instruction beyond RETURN \u2713',
            });
        } else {
            const _n = _rsmStubs.length;
            const _stubNames = _rsmStubs
                .map(s => s.name ? `\u201c${s.name}\u201d` : `word\u202f${s.wordIndex}`)
                .join(', ');
            results.push({
                ruleId: 'RSM',
                // Advisory only (see docs/lump-reference.md \u00a7 11) \u2014 a method whose
                // body is a single bare RETURN is ambiguous: it may be a genuinely
                // missing implementation, OR a legitimate trivial method that just
                // returns its own parameters unchanged (e.g. `return(a, b)` where a
                // and b already sit in the correct return registers, so the compiler
                // emits no instruction besides RETURN). The binary cannot distinguish
                // the two cases, so this must never block save/build \u2014 only warn.
                severity: 'warn',
                message: `Stub method${_n !== 1 ? 's' : ''} \u2014 ${_n} method${_n !== 1 ? 's' : ''} ha${_n !== 1 ? 've' : 's'} no code body (bare RETURN).`,
                detail: `${_stubNames} ${_n !== 1 ? 'are' : 'is a'} bare RETURN with no other instructions. This is expected for a method that only returns its own parameters unchanged; if that wasn't intended, re-compile the abstraction to fill in the missing implementation.`,
            });
        }
    }

    return results;
}

function lumpAuditHasErrors(results) {
    return Array.isArray(results) && results.some(r => r.severity === 'error');
}

function lumpAuditHasWarnings(results) {
    return Array.isArray(results) && results.some(r => r.severity === 'warn');
}

/**
 * Build and inject the audit result panel DOM into `container`.
 * Returns { hasErrors, hasWarnings }.
 *
 * container  — DOM element to append the panel into
 * results    — output from lumpAudit()
 * opts       — optional { collapsible: bool (default true), startOpen: bool (default false for pass, true for failures) }
 */
function lumpAuditRenderPanel(container, results, opts) {
    const hasErrors   = lumpAuditHasErrors(results);
    const hasWarnings = lumpAuditHasWarnings(results);
    const allPass     = !hasErrors && !hasWarnings;

    const o = opts || {};
    const collapsible = (o.collapsible !== false);
    const startOpen   = (o.startOpen !== undefined) ? o.startOpen : (!allPass);

    const panel = document.createElement('div');
    panel.className = 'lump-audit-panel' +
        (hasErrors   ? ' lump-audit-panel-error' :
         hasWarnings ? ' lump-audit-panel-warn'  :
                       ' lump-audit-panel-pass');

    const header = document.createElement('div');
    header.className = 'lump-audit-header';

    const icon = hasErrors ? '\u2717' : hasWarnings ? '\u26a0' : '\u2713';
    const summary = hasErrors
        ? `${results.filter(r => r.severity === 'error').length} check${results.filter(r => r.severity === 'error').length !== 1 ? 's' : ''} failed`
        : hasWarnings
        ? `All checks passed with ${results.filter(r => r.severity === 'warn').length} warning${results.filter(r => r.severity === 'warn').length !== 1 ? 's' : ''}`
        : 'All checks passed';

    header.innerHTML = `<span class="lump-audit-icon">${icon}</span>` +
        `<span class="lump-audit-summary">${summary}</span>`;

    if (collapsible) {
        header.title = 'Click to expand/collapse';
        header.style.cursor = 'pointer';
    }

    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'lump-audit-body';
    if (collapsible && !startOpen) body.style.display = 'none';

    for (const r of results) {
        const row = document.createElement('div');
        row.className = 'lump-audit-row lump-audit-row-' + r.severity;

        const ruleSpan = document.createElement('span');
        ruleSpan.className = 'lump-audit-rule-id';
        ruleSpan.textContent = r.ruleId;
        ruleSpan.style.fontSize = '0.72em';
        ruleSpan.style.opacity = '0.4';

        const content = document.createElement('div');
        content.className = 'lump-audit-content';

        const msgSpan = document.createElement('span');
        msgSpan.className = 'lump-audit-msg';
        msgSpan.textContent = r.message;

        const detailSpan = document.createElement('span');
        detailSpan.className = 'lump-audit-detail';
        detailSpan.textContent = r.detail;

        content.appendChild(msgSpan);
        content.appendChild(detailSpan);
        row.appendChild(ruleSpan);
        row.appendChild(content);
        body.appendChild(row);

        // Any warning/failure row that carries per-violation location data gets a
        // precise "↑ line N" jump button (RCI errors, RNC warnings, and any future
        // rule that pushes a `violations` array). Rows with no per-instruction
        // location (RFS, RMC, RPN, RSM) instead get a single row-level
        // "Open in editor" affordance so the control is never a dead end.
        const _isActionable = (r.severity === 'error' || r.severity === 'warn');
        if (_isActionable && Array.isArray(r.violations) && r.violations.length > 0) {
            for (const v of r.violations) {
                const vRow = document.createElement('div');
                vRow.className = 'lump-audit-row lump-audit-violation-row';

                const bullet = document.createElement('span');
                bullet.className = 'lump-audit-violation-bullet';
                bullet.textContent = '\u2022 ';

                const vMsg = document.createElement('span');
                vMsg.className = 'lump-audit-violation-msg';
                vMsg.textContent = v.msg;

                vRow.appendChild(bullet);
                vRow.appendChild(vMsg);

                const ln = v.sourceLine != null ? (v.sourceLine | 0) : null;
                const wi = v.wordIndex != null ? (v.wordIndex | 0) : null;
                if (ln != null || wi != null || o.token) {
                    const jumpBtn = document.createElement('button');
                    jumpBtn.className = 'lump-audit-jump-btn';
                    jumpBtn.textContent = ln != null ? ('\u2191 line ' + ln) : 'Open in editor';
                    jumpBtn.title = ln != null
                        ? 'Jump to line ' + ln + ' in the editor'
                        : 'Open this lump in the editor near the offending instruction';
                    jumpBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (typeof _lumpAuditJump === 'function') {
                            _lumpAuditJump(o.token || null, ln, wi);
                        } else if (typeof _jumpToAsmLine === 'function' && ln != null) {
                            _jumpToAsmLine(ln);
                        }
                    });
                    vRow.appendChild(jumpBtn);
                }

                body.appendChild(vRow);
            }
        } else if (_isActionable && o.token) {
            // No per-violation data (RFS / RMC / RPN / RSM) — still give the user
            // an active affordance, but keep it visually distinct from a precise
            // line jump so it never implies more precision than it has.
            const openRow = document.createElement('div');
            openRow.className = 'lump-audit-row lump-audit-violation-row';

            const openBtn = document.createElement('button');
            openBtn.className = 'lump-audit-jump-btn lump-audit-open-btn';
            openBtn.textContent = 'Open in editor';
            openBtn.title = 'Open this lump in the editor to investigate';
            openBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (typeof _lumpAuditJump === 'function') _lumpAuditJump(o.token, null, null);
            });
            openRow.appendChild(openBtn);
            body.appendChild(openRow);
        }
    }

    panel.appendChild(body);

    if (collapsible) {
        let open = startOpen;
        header.addEventListener('click', () => {
            open = !open;
            body.style.display = open ? '' : 'none';
        });
    }

    container.appendChild(panel);
    return { hasErrors, hasWarnings };
}

/**
 * Run an audit against a token's binary fetched from the server API,
 * then render results into `container`.  Returns a Promise<{hasErrors, hasWarnings}>.
 *
 * token    — lump token string (hex)
 * manifest — optional { cw, cc, lump_size } object
 * container — DOM element to render into (existing children are cleared first)
 * opts      — forwarded to lumpAuditRenderPanel
 */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { lumpAudit, lumpAuditHasErrors, lumpAuditHasWarnings, lumpAuditRenderPanel };
}

async function lumpAuditFromServer(token, manifest, container, opts) {
    container.innerHTML = '';
    const loadingEl = document.createElement('div');
    loadingEl.className = 'lump-audit-loading';
    loadingEl.textContent = 'Running audit\u2026';
    container.appendChild(loadingEl);

    try {
        const resp = await fetch(`/api/lump/${token}/words`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const words = data.words || [];
        if (!words.length) throw new Error('Empty binary returned from server');

        // Best-effort: reassemble the lump's saved source (if any) so violation
        // messages carry a real sourceLine instead of falling back to a
        // word-index-based "Open in editor" affordance. This mirrors how
        // app-compile.js builds lineNums right after a compile — here we do it
        // lazily for lumps viewed from the Repository panel, whose source may
        // not be the one currently open in the editor at all.
        let lineNums = null;
        try {
            const cw = (manifest && manifest.cw != null) ? parseInt(manifest.cw) : null;
            if (typeof ChurchAssembler !== 'undefined' && typeof fetch === 'function') {
                // Route through the shared de-duped cache (app-lumps.js) when available
                // so this best-effort lookup never fires a second GET for a token whose
                // detail is already being fetched by the Source tab render in parallel.
                const srcData = (typeof window !== 'undefined' && typeof window._fetchLumpDetailCached === 'function')
                    ? await window._fetchLumpDetailCached(token).catch(() => null)
                    : await (async () => {
                        const srcResp = await fetch(`/api/lumps/${token}/detail`, { cache: 'no-store' });
                        return srcResp.ok ? srcResp.json() : null;
                    })();
                if (srcData && typeof srcData.source === 'string' && srcData.source.trim().length > 0) {
                    const asm = new ChurchAssembler();
                    const asmResult = asm.assemble(srcData.source);
                    // Only trust the mapping when the reassembled word count matches
                    // the audited binary's code-word count — otherwise the source has
                    // drifted from the binary and per-word indices would be wrong.
                    if (asmResult && Array.isArray(asmResult.lineNums) &&
                        (cw == null || asmResult.words.length === cw)) {
                        lineNums = [null, ...asmResult.lineNums];
                    }
                }
            }
        } catch (_srcErr) {
            // Reassembly is best-effort only — fall through with lineNums = null,
            // the renderer's wordIndex fallback still makes every row clickable.
        }

        container.innerHTML = '';
        const results = lumpAudit(words, manifest, lineNums);
        return lumpAuditRenderPanel(container, results, opts);
    } catch (err) {
        container.innerHTML = '';
        const errEl = document.createElement('div');
        errEl.className = 'lump-audit-panel lump-audit-panel-error';
        errEl.innerHTML = `<div class="lump-audit-header"><span class="lump-audit-icon">\u2717</span>` +
            `<span class="lump-audit-summary">Audit failed: ${_escHtml ? _escHtml(err.message) : err.message}</span></div>`;
        container.appendChild(errEl);
        return { hasErrors: true, hasWarnings: false };
    }
}
