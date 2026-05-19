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
            message: 'Magic OK',
            detail: `bits[31:27] = 0x${magic.toString(16).toUpperCase()} \u2713`,
        });
    } else {
        results.push({
            ruleId: 'R1',
            severity: 'error',
            message: 'Bad magic',
            detail: `bits[31:27] = 0x${magic.toString(16).toUpperCase()}, expected 0x1F — repack the binary with a correct header word.`,
        });
    }

    const actualWords = words.length;
    if (actualWords === lumpSize) {
        results.push({
            ruleId: 'R2',
            severity: 'pass',
            message: 'Size match',
            detail: `${actualWords} words == declared lump_size ${lumpSize} \u2713`,
        });
    } else {
        results.push({
            ruleId: 'R2',
            severity: 'error',
            message: 'Size mismatch',
            detail: `Binary has ${actualWords} words but header declares lump_size=${lumpSize} (n_m6=${nMinus6} \u2192 2^${nMinus6 + 6}).`,
        });
    }

    if (cw >= 1) {
        results.push({
            ruleId: 'RB1',
            severity: 'pass',
            message: 'cw \u2265 1',
            detail: `cw=${cw} — at least one code word \u2713`,
        });
    } else {
        results.push({
            ruleId: 'RB1',
            severity: 'error',
            message: 'cw = 0',
            detail: 'cw must be \u2265 1 — the lump must contain at least one code word.',
        });
    }

    const contentWords = 1 + cw + cc;
    if (contentWords <= lumpSize) {
        results.push({
            ruleId: 'RB2',
            severity: 'pass',
            message: 'Bounds OK',
            detail: `1 + cw(${cw}) + cc(${cc}) = ${contentWords} \u2264 lump_size=${lumpSize} \u2713`,
        });
    } else {
        results.push({
            ruleId: 'RB2',
            severity: 'error',
            message: 'Header bounds overflow',
            detail: `1 + cw(${cw}) + cc(${cc}) = ${contentWords} exceeds lump_size=${lumpSize} — cw or cc is too large for this lump size.`,
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
                message: 'Freespace (none)',
                detail: 'No freespace zone — lump is fully packed \u2713',
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
                    message: 'Freespace clean',
                    detail: `${fsCount} freespace word${fsCount !== 1 ? 's' : ''} (words[${fsStart}\u2013${fsEnd - 1}]) are all zero \u2713`,
                });
            } else {
                results.push({
                    ruleId: 'RFS',
                    severity: 'warn',
                    message: 'Dirty freespace',
                    detail: `${dirtyWords} non-zero word${dirtyWords !== 1 ? 's' : ''} in freespace zone (first at word[${firstDirtyIdx}] = 0x${firstDirtyVal.toString(16).toUpperCase().padStart(8, '0')}).`,
                });
            }
        }
    } else {
        results.push({
            ruleId: 'RFS',
            severity: 'warn',
            message: 'Freespace skipped',
            detail: 'Freespace check skipped — fix size/bounds errors above first.',
        });
    }

    if (manifest && typeof manifest === 'object') {
        const checks = [];
        let mCoherent = true;

        if (manifest.cw !== undefined && manifest.cw !== null) {
            const mCw = parseInt(manifest.cw);
            if (mCw === cw) {
                checks.push(`cw: ${cw} \u2713`);
            } else {
                checks.push(`cw: manifest=${mCw} \u2260 binary=${cw}`);
                mCoherent = false;
            }
        }
        if (manifest.cc !== undefined && manifest.cc !== null) {
            const mCc = parseInt(manifest.cc);
            if (mCc === cc) {
                checks.push(`cc: ${cc} \u2713`);
            } else {
                checks.push(`cc: manifest=${mCc} \u2260 binary=${cc}`);
                mCoherent = false;
            }
        }
        if (manifest.lump_size !== undefined && manifest.lump_size !== null) {
            const mSz = parseInt(manifest.lump_size);
            if (mSz === lumpSize) {
                checks.push(`lump_size: ${lumpSize} \u2713`);
            } else {
                checks.push(`lump_size: manifest=${mSz} \u2260 binary=${lumpSize}`);
                mCoherent = false;
            }
        }

        if (checks.length === 0) {
            results.push({
                ruleId: 'RMC',
                severity: 'pass',
                message: 'Manifest present',
                detail: 'Manifest has no cw/cc/lump_size fields to compare.',
            });
        } else if (mCoherent) {
            results.push({
                ruleId: 'RMC',
                severity: 'pass',
                message: 'Manifest coherent',
                detail: checks.join(', '),
            });
        } else {
            results.push({
                ruleId: 'RMC',
                severity: 'error',
                message: 'Manifest mismatch',
                detail: checks.join(', ') + ' — update the manifest or re-assemble.',
            });
        }
    }

    // ── RCI — Church Instruction Range Check ──────────────────────────────────
    // For each code word in words[1..cw]:
    //   LOAD/SAVE/ELOADCALL/XLOADLAMBDA (crSrc=6, c-list access): when the LUMP
    //   carries its own c-list (cc > 0) the slot must be < cc.
    //   When cc=0 the LUMP uses the ambient boot c-list at runtime, so no
    //   per-LUMP slot-bounds check is possible or meaningful — slots are exempt.
    //   BRANCH (opcode 17): sign-extended 15-bit offset must land in [0, cw-1].
    // Skipped when binary size or bounds checks have already failed.
    if (actualWords === lumpSize && contentWords <= lumpSize && cw >= 1) {
        const _rciChurchOps = new Set([0, 1, 8, 9]);
        const _rciOpName    = { 0: 'LOAD', 1: 'SAVE', 8: 'ELOADCALL', 9: 'XLOADLAMBDA' };
        const _rciBranchOp  = 17;
        const _rciViolations = [];

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
            if (_rciChurchOps.has(op) && crSrc === 6 && cc > 0 && slot >= cc) {
                const _rciMsg = `word[${wi}] ${_rciOpName[op]}: c-list slot ${slot} out of range` +
                    ` (cc=${cc}${_rciSlotHint})`;
                const _rciSrcLine = lineNums && lineNums[wi] != null ? lineNums[wi] : null;
                _rciViolations.push({ msg: _rciMsg, sourceLine: _rciSrcLine });
            }

            if (op === _rciBranchOp) {
                let off = ww & 0x7FFF;
                if (off & 0x4000) off = off - 0x8000;   // sign-extend 15-bit
                const target = codeIdx + off;
                if (target < 0 || target >= cw) {
                    const _branchMsg = `word[${wi}] BRANCH: offset ${off} \u2192 target code[${target}] ` +
                        `out of range [0\u2013${cw - 1}]`;
                    const _branchSrcLine = lineNums && lineNums[wi] != null ? lineNums[wi] : null;
                    _rciViolations.push({ msg: _branchMsg, sourceLine: _branchSrcLine });
                }
            }
        }

        if (_rciViolations.length === 0) {
            const _rciDetail = cc === 0
                ? `All ${cw} code word${cw !== 1 ? 's' : ''} checked \u2014 cc=0 (ambient c-list; slot bounds not enforced) \u2713`
                : `All ${cw} code word${cw !== 1 ? 's' : ''} checked \u2014 no range violations \u2713`;
            results.push({
                ruleId: 'RCI',
                severity: 'pass',
                message: 'Church instructions in range',
                detail: _rciDetail,
            });
        } else {
            results.push({
                ruleId: 'RCI',
                severity: 'error',
                message: `${_rciViolations.length} range violation${_rciViolations.length !== 1 ? 's' : ''}`,
                detail: _rciViolations.map(v => v.msg).join('; '),
                violations: _rciViolations,
            });
        }
    } else {
        results.push({
            ruleId: 'RCI',
            severity: 'warn',
            message: 'Church instruction check skipped',
            detail: 'Fix size or bounds errors above first.',
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
                message: 'Pet names not verifiable',
                detail: `cc=${cc} but no pet_names or capabilities in manifest \u2014 ` +
                        'pass the full sidecar to verify pet name coverage.',
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
                    message: `${refs.length} unnamed slot${refs.length !== 1 ? 's' : ''} in Church instructions`,
                    detail: `Slot${refs.length !== 1 ? 's' : ''} [${refs.join(', ')}] used by Church ` +
                            'instructions have no pet name \u2014 add .pet declarations for these capabilities.',
                });
            } else if (_rpnUnnamedAny.length > 0) {
                results.push({
                    ruleId: 'RPN',
                    severity: 'warn',
                    message: `${_rpnUnnamedAny.length} unnamed c-list slot${_rpnUnnamedAny.length !== 1 ? 's' : ''}`,
                    detail: `Slot${_rpnUnnamedAny.length !== 1 ? 's' : ''} [${_rpnUnnamedAny.join(', ')}] ` +
                            'allocated but unnamed \u2014 add .pet declarations.',
                });
            } else {
                const nameList = Array.from({ length: cc }, (_, i) =>
                    `[${i}]\u202F"${_rpnSlotName[i]}"`
                ).join(', ');
                results.push({
                    ruleId: 'RPN',
                    severity: 'pass',
                    message: 'Pet names complete',
                    detail: `All ${cc} slot${cc !== 1 ? 's' : ''} named: ${nameList} \u2713`,
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
