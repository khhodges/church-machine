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
 */

function lumpAudit(words, manifest, lineNums) {
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
    const cc       =  word0         & 0xFF;
    const lumpSize = 1 << (nMinus6 + 6);

    if (magic === 0x1F) {
        results.push({
            ruleId: 'R1',
            severity: 'pass',
            message: 'Format recognised \u2014 valid Church Machine file header \u2713',
            detail: `Header identifier 0x${magic.toString(16).toUpperCase()} matches the Church Machine format \u2713`,
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

    if (cw >= 1) {
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
        const fsStart = 1 + cw;
        const fsEnd   = lumpSize - cc;
        const fsCount = Math.max(0, fsEnd - fsStart);

        if (fsCount === 0) {
            results.push({
                ruleId: 'RFS',
                severity: 'pass',
                message: 'No padding \u2014 lump is fully packed \u2713',
                detail: 'No padding zone \u2014 lump is fully packed \u2713',
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
                    message: 'Padding is zeroed \u2713',
                    detail: `${fsCount} padding word${fsCount !== 1 ? 's' : ''} are all zero \u2713`,
                });
            } else {
                results.push({
                    ruleId: 'RFS',
                    severity: 'warn',
                    message: `Non-zero padding \u2014 ${dirtyWords} unexpected word${dirtyWords !== 1 ? 's' : ''} found in the padding area.`,
                    detail: `${dirtyWords} non-zero word${dirtyWords !== 1 ? 's' : ''} in the padding area (first at position ${firstDirtyIdx}: 0x${firstDirtyVal.toString(16).toUpperCase().padStart(8, '0')}).`,
                });
            }
        }
    } else {
        results.push({
            ruleId: 'RFS',
            severity: 'warn',
            message: 'Padding check skipped \u2014 fix size/bounds errors above first.',
            detail: 'Cannot check padding until the file size and layout errors above are resolved.',
        });
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
    //   BRANCH (opcode 17): sign-extended 15-bit offset must land in [0, cw-1].
    // Skipped when binary size or bounds checks have already failed.
    if (actualWords === lumpSize && contentWords <= lumpSize && cw >= 1) {
        const _rciChurchOps = new Set([0, 1, 8, 9]);
        const _rciOpName    = { 0: 'LOAD', 1: 'SAVE', 8: 'ELOADCALL', 9: 'XLOADLAMBDA' };
        const _rciBranchOp  = 17;
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
            // ELOADCALL imm15 = (methodIdx<<8)|clistSlot — slot is only bits[7:0].
            // All other Church ops (LOAD/SAVE/XLOADLAMBDA) use the full imm15 as slot.
            const slot   = op === 8 ? (ww & 0xFF) : (ww & 0x7FFF);
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
                    _rncViolations.push({ msg: _nullMsg, sourceLine: _nullSrcLine, slot });
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
                _rciViolations.push({ msg: _rciMsg, sourceLine: _rciSrcLine, slot });
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
        if (_rncViolations.length === 0) {
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
                detail: _rncViolations.map(v => v.msg).join(' '),
                violations: _rncViolations,
            });
        }
    } else {
        results.push({
            ruleId: 'RCI',
            severity: 'warn',
            message: 'Capability slot check skipped \u2014 fix size or bounds errors above first.',
            detail: 'Cannot check capability slot ranges until the file size and layout errors above are resolved.',
        });
    }

    // ── RPN — Pet Name Coverage ───────────────────────────────────────────────
    // Verify every c-list slot accessed by a Church instruction (LOAD/SAVE/
    // ELOADCALL/XLOADLAMBDA via CR6) has a pet name declared in the manifest.
    // Name sources: manifest.pet_names.CR (slot-index string → name) and/or
    // manifest.capabilities[] (array index = slot, .name = capability name).
    // Skipped when cc=0 (no c-list) or when binary size/bounds failed.
    if (actualWords === lumpSize && contentWords <= lumpSize && cw >= 1 && cc > 0 &&
            manifest && typeof manifest === 'object') {
        const _rpnHasPetCR = manifest.pet_names &&
                             typeof manifest.pet_names.CR === 'object' &&
                             manifest.pet_names.CR !== null;
        const _rpnHasCaps  = Array.isArray(manifest.capabilities) &&
                             manifest.capabilities.length > 0;

        if (!_rpnHasPetCR && !_rpnHasCaps) {
            results.push({
                ruleId: 'RPN',
                severity: 'warn',
                message: `Capability names not checked \u2014 this lump uses ${cc} capability slot${cc !== 1 ? 's' : ''} but the repository record doesn\u2019t say what they are. Add capability names to enable this check.`,
                detail: `${cc} capability slot${cc !== 1 ? 's' : ''} allocated but the repository record has no capability names. Add capability names to the record to enable this check.`,
            });
        } else {
            // Build slot → best name map from manifest sources.
            const _rpnSlotName = {};
            if (_rpnHasPetCR) {
                for (const [k, v] of Object.entries(manifest.pet_names.CR)) {
                    const s = parseInt(k, 10);
                    if (!isNaN(s) && s >= 0 && s < cc) _rpnSlotName[s] = String(v);
                }
            }
            if (_rpnHasCaps) {
                for (let i = 0; i < manifest.capabilities.length && i < cc; i++) {
                    const cap = manifest.capabilities[i];
                    if (!_rpnSlotName[i] && cap && cap.name) _rpnSlotName[i] = String(cap.name);
                }
            }
            // Also recognise pending GT sentinels embedded in the binary's c-list area.
            // A pending sentinel (bits[31:16] = 0xFEED) carries the pet name internally;
            // treat it as named so it is not flagged as an unexplained null.
            if (actualWords >= lumpSize && lumpSize > cc) {
                const _rpnClistBase = lumpSize - cc;
                for (let _si = 0; _si < cc; _si++) {
                    const _rpnGT = (words[_rpnClistBase + _si] >>> 0);
                    if ((_rpnGT >>> 16) === 0xFEED && !_rpnSlotName[_si]) {
                        const _rpnPendIdx = _rpnGT & 0xFFFF;
                        const _rpnPendName = (typeof ChurchSimulator !== 'undefined' &&
                            ChurchSimulator.PENDING_GT_NAMES &&
                            ChurchSimulator.PENDING_GT_NAMES[_rpnPendIdx])
                            ? ChurchSimulator.PENDING_GT_NAMES[_rpnPendIdx]
                            : ('pending#' + _rpnPendIdx);
                        _rpnSlotName[_si] = '\u29d6 ' + _rpnPendName + ' (pending)';
                    }
                }
            }

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

        const msgSpan = document.createElement('span');
        msgSpan.className = 'lump-audit-msg';
        msgSpan.textContent = r.message;

        const detailSpan = document.createElement('span');
        detailSpan.className = 'lump-audit-detail';
        detailSpan.textContent = r.detail;

        row.appendChild(ruleSpan);
        row.appendChild(msgSpan);
        row.appendChild(detailSpan);
        body.appendChild(row);

        if (r.ruleId === 'RCI' && r.severity === 'error' && Array.isArray(r.violations)) {
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
                if (ln != null) {
                    const jumpBtn = document.createElement('button');
                    jumpBtn.className = 'lump-audit-jump-btn';
                    jumpBtn.textContent = '\u2191 line ' + ln;
                    jumpBtn.title = 'Jump to line ' + ln + ' in the editor';
                    jumpBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (typeof _jumpToAsmLine === 'function') _jumpToAsmLine(ln);
                    });
                    vRow.appendChild(jumpBtn);
                }

                body.appendChild(vRow);
            }
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
    module.exports = { lumpAudit, lumpAuditHasErrors, lumpAuditHasWarnings };
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
        container.innerHTML = '';
        const results = lumpAudit(words, manifest);
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
