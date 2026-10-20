// Read-only breakpoint inspector. Captures an immutable snapshot of the paused
// machine (legacy simulator or private NewLayout design simulation). It never
// steps, resumes, performs CALL, writes registers, or touches saved programs,
// Namespace configuration or hardware. Closing leaves execution paused.
(function(root) {
    'use strict';
    const hex = (v, n) => '0x' + ((v >>> 0).toString(16).toUpperCase().padStart(n || 8, '0'));
    const esc = value => String(value).replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function deepFreeze(value) {
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            Object.freeze(value);
            for (const key of Object.keys(value)) deepFreeze(value[key]);
        }
        return value;
    }
    let lastKey = null, openSnapshot = null, returnFocus = null;

    // Pet name only from the admitted preparedRows (exact slot/seq/location) or,
    // for legacy machines without a configuration, the machine's own NS labels.
    function petNameFor(machine, index) {
        const cr = machine.cr && machine.cr[index];
        if (!cr || typeof machine.parseGT !== 'function') return {name:null, reason:'register unavailable'};
        let gt;
        try { gt = machine.parseGT(cr.word0 >>> 0); } catch (_) { return {name:null, reason:'undecodable GT'}; }
        if (!gt || gt.type === 0) return {name:null, reason:'NULL capability'};
        const configuration = machine.simulationConfiguration;
        if (configuration) {
            const rows = Array.isArray(configuration.preparedRows) ? configuration.preparedRows : [];
            const matches = rows.filter(row => row.slot === gt.index && row.seq === gt.gt_seq &&
                Number(row.location) === (cr.word1 >>> 0));
            return matches.length === 1 ? {name:String(matches[0].name), slot:gt.index}
                : {name:null, slot:gt.index, reason:'no unique admitted row for slot ' + gt.index};
        }
        const label = machine.nsLabels && machine.nsLabels[gt.index];
        return label ? {name:String(label), slot:gt.index}
            : {name:null, slot:gt.index, reason:'no Namespace label for slot ' + gt.index};
    }

    // Mirrors simulator dispatch: crSrc===6 is indexed (row=imm[4:0],
    // selector=imm[11:5], GT read from CR6 c-list); otherwise direct CR crDst
    // with selector imm[14:0]. Read-only: no load gate, no CALL, no promotion.
    function targetIdentity(machine, gtWord, location) {
        let gt;
        try { gt = machine.parseGT(gtWord >>> 0); } catch (_) { return {name:null, reason:'undecodable GT'}; }
        if (!gt || gt.type === 0) return {name:null, reason:'NULL capability'};
        if (gt.type === 3) return {name:null, reason:'Abstract GT (Abstract Manager dispatch)'};
        let entry = null;
        try { entry = typeof machine.readNSEntry === 'function' ? machine.readNSEntry(gt.index) : null; } catch (_) {}
        const current = entry && Number.isInteger(entry.word0_location) ? entry.word0_location >>> 0 : null;
        const configuration = machine.simulationConfiguration;
        if (configuration) {
            const rows = Array.isArray(configuration.preparedRows) ? configuration.preparedRows : [];
            const matches = rows.filter(row => row.slot === gt.index && row.seq === gt.gt_seq &&
                (location === null || Number(row.location) === location) &&
                current !== null && Number(row.location) === current);
            return matches.length === 1 ? {name:String(matches[0].name), slot:gt.index, bound:true}
                : {name:null, slot:gt.index, reason:'no unique admitted row matching slot ' + gt.index + ' and its current descriptor'};
        }
        const label = machine.nsLabels && machine.nsLabels[gt.index];
        return label ? {name:String(label), slot:gt.index, bound:true}
            : {name:null, slot:gt.index, reason:'no Namespace label for slot ' + gt.index};
    }
    function resolveCall(machine, d, parts) {
        const base = {fromCode:parts.Code || 'unavailable', fromAbstraction:parts.Abstraction || 'unavailable',
            form:null, targetLabel:null, selector:null, targetName:null, targetMethod:null, targetReason:null};
        const imm = Number.isInteger(d.imm) ? d.imm >>> 0 : null;
        if (imm === null) return Object.assign(base, {targetReason:'unsupported CALL form (no immediate)'});
        if (d.crSrc === 6) {
            const row = imm & 0x1F, selector = (imm >>> 5) & 0x7F;
            Object.assign(base, {form:'indexed', targetLabel:'CR6[' + row + ']', selector});
            const cr6 = machine.cr[6];
            let count = 0;
            try { count = typeof machine._clistCountForCR === 'function' ? machine._clistCountForCR(6) : 0; } catch (_) {}
            if (!cr6 || !cr6.word0) return Object.assign(base, {targetReason:'CR6 C-List is NULL'});
            if (!Number.isInteger(count) || row >= count) return Object.assign(base, {targetReason:'row ' + row + ' outside active c-list (' + count + ' rows)'});
            const addr = ((cr6.word1 >>> 0) + row) >>> 0;
            if (!machine.memory || addr >= machine.memory.length) return Object.assign(base, {targetReason:'c-list row address out of memory'});
            const word = machine.memory[addr] >>> 0;
            if (!word) return Object.assign(base, {targetReason:'c-list row is empty'});
            return finish(machine, base, targetIdentity(machine, word, null), selector);
        }
        if (!Number.isInteger(d.crDst) || d.crDst < 0 || d.crDst > 15) return Object.assign(base, {targetReason:'unsupported CALL form'});
        const selector = imm & 0x7FFF, cr = machine.cr[d.crDst];
        Object.assign(base, {form:'direct', targetLabel:'CR' + d.crDst, selector});
        if (!cr) return Object.assign(base, {targetReason:'register unavailable'});
        return finish(machine, base, targetIdentity(machine, cr.word0, cr.word1 >>> 0), selector);
    }
    function finish(machine, base, id, selector) {
        base.targetName = id.name;
        base.targetReason = id.name ? null : id.reason;
        if (id.bound && typeof machine._methodNameForSelector === 'function') {
            try { base.targetMethod = machine._methodNameForSelector(id.slot, selector) || null; } catch (_) {}
        }
        return base;
    }

    function capture(machine, info) {
        if (!machine || !Array.isArray(machine.cr)) return null;
        const detail = info || {};
        const regs = [];
        for (let i = 0; i < 16; i++) {
            const cr = machine.cr[i] || {};
            let formatted = null;
            try { formatted = typeof machine.getFormattedCR === 'function' ? machine.getFormattedCR(i) : null; } catch (_) {}
            const pet = petNameFor(machine, i);
            regs.push({index:i, word0:cr.word0 >>> 0, word1:cr.word1 >>> 0, word2:cr.word2 >>> 0,
                word3:cr.word3 >>> 0, m:cr.m ? 1 : 0,
                type:formatted ? String(formatted.gtTypeName || formatted.gtType || '') : '',
                perms:formatted ? String(formatted.perms || '') : '',
                validation:formatted ? String(formatted.validationMessage || formatted.validationStatus || '') : '',
                petName:pet.name, petReason:pet.reason || null});
        }
        const dr = [];
        for (let i = 0; i < 16; i++) dr.push(machine.dr ? (machine.dr[i] >>> 0) : 0);
        const f = machine.flags || {};
        let context = 'Code: unavailable · Abstraction: unavailable · Thread: unavailable · Namespace: unavailable';
        if (typeof root._cr14CodeContextHeading === 'function') {
            try { context = root._cr14CodeContextHeading(machine); } catch (_) {}
        }
        const parts = {};
        for (const piece of context.split(' · ')) {
            const at = piece.indexOf(': ');
            if (at > 0) parts[piece.slice(0, at)] = piece.slice(at + 2);
        }
        let physical = null;
        try { physical = typeof machine._nextPhysicalAddr === 'function' ? machine._nextPhysicalAddr() : null; } catch (_) {}
        if (!Number.isInteger(physical) || physical < 0) physical = Number.isInteger(detail.address) ? detail.address : null;
        const raw = physical !== null && machine.memory ? (machine.memory[physical] >>> 0) : null;
        let mnemonic = null, decoded = null;
        if (raw !== null) {
            try { decoded = typeof machine.decodeInstruction === 'function' ? machine.decodeInstruction(raw) : null; } catch (_) {}
            const asm = root.assembler || (typeof assembler !== 'undefined' ? assembler : null);
            try { mnemonic = raw === 0 ? 'HALT' : asm && typeof asm.disassemble === 'function' ? asm.disassemble(raw) : null; } catch (_) {}
        }
        const opcode = decoded && Number.isInteger(decoded.opcode) ? decoded.opcode : (raw === null ? null : (raw >>> 27) & 0x1F);
        const call = opcode === 2 && decoded ? resolveCall(machine, decoded, parts) : null;
        return deepFreeze({
            kind:detail.kind || 'instruction', source:machine.simulationConfiguration ? 'private' : 'legacy',
            profile:machine.simulationConfiguration && machine.simulationConfiguration.designProfile || null,
            address:Number.isInteger(detail.address) ? detail.address >>> 0 : null,
            pc:Number.isInteger(machine.pc) ? machine.pc : null, physicalPC:physical, raw, mnemonic, opcode,
            context, code:parts.Code || 'unavailable', abstraction:parts.Abstraction || 'unavailable',
            thread:parts.Thread || 'unavailable', namespace:parts.Namespace || 'unavailable',
            flags:{N:!!f.N, Z:!!f.Z, C:!!f.C, V:!!f.V}, cr:regs, dr, call,
            bootStep:machine.bootComplete ? null : machine.bootStep,
        });
    }

    function row(label, value) {
        return '<div class="bpi-kv"><span>' + esc(label) + '</span><code>' + esc(value) + '</code></div>';
    }
    function render(s) {
        const where = s.kind === 'boot' ? 'B:00 — LOAD CR15' : s.address !== null ? hex(s.address, 4) : 'unknown address';
        let html = '<div class="bpi-head"><div><div class="bpi-title">Breakpoint paused · ' + esc(where) + '</div>' +
            '<div class="bpi-sub">' + esc(s.source === 'private' ? 'Private ' + (s.profile === 'ascending' ? 'NewLayout' : (s.profile || 'design')) + ' simulation' : 'Simulator') +
            ' · read-only snapshot · execution remains paused</div></div>' +
            '<button type="button" class="bpi-close" data-bpi-close aria-label="Close inspector (execution stays paused)">Close</button></div>';
        html += '<div class="bpi-context">' + row('Code method', s.code) + row('Abstraction', s.abstraction) +
            row('Thread', s.thread) + row('Namespace', s.namespace) + '</div>';
        html += '<details class="bpi-sec" open><summary>Current instruction</summary>' +
            row('NIA (physical)', s.physicalPC === null ? 'unavailable' : hex(s.physicalPC, 4)) +
            row('PC', s.pc === null ? 'unavailable' : String(s.pc)) +
            row('Word', s.raw === null ? 'unavailable' : hex(s.raw)) +
            row('Disassembly', s.mnemonic || 'unavailable') +
            (s.bootStep !== null ? row('Boot step', String(s.bootStep)) : '') + '</details>';
        if (s.call) {
            html += '<details class="bpi-sec" open><summary>Pending CALL (not performed)</summary>' +
                row('From', s.call.fromCode + ' in ' + s.call.fromAbstraction) +
                row('Form', s.call.form || 'unsupported') +
                row('To', (s.call.targetLabel ? s.call.targetLabel + ' · ' : '') + (s.call.targetName || 'unresolved (' + s.call.targetReason + ')')) +
                row('Selector', s.call.selector === null ? 'unavailable' : String(s.call.selector)) +
                row('Target method', s.call.targetMethod || 'unresolved') +
                '</details>';
        }
        html += '<details class="bpi-sec" open><summary>Flags</summary><div class="bpi-flags">' +
            ['N','Z','C','V'].map(k => '<span class="bpi-flag' + (s.flags[k] ? ' on' : '') + '">' + k + '=' + (s.flags[k] ? 1 : 0) + '</span>').join('') +
            '</div></details>';
        html += '<details class="bpi-sec" open><summary>Capability registers CR0–CR15</summary><div class="bpi-grid">' +
            s.cr.map(r => '<details class="bpi-reg"><summary><b>CR' + r.index + '</b> <code>' + esc(hex(r.word0)) + '</code> <span>' +
                esc(r.petName || (r.type === 'NULL' ? 'NULL' : 'unnamed')) + '</span></summary>' +
                row('Type', r.type || 'unknown') + row('Perms', r.perms || '-') + row('Word1 location', hex(r.word1)) +
                row('Word2 limit', hex(r.word2)) + row('Word3 seals', hex(r.word3)) + row('M bit', String(r.m)) +
                row('Pet name', r.petName || 'unresolved (' + (r.petReason || 'unknown') + ')') +
                (r.validation ? row('Validation', r.validation) : '') + '</details>').join('') + '</div></details>';
        html += '<details class="bpi-sec" open><summary>Data registers DR0–DR15</summary><div class="bpi-grid">' +
            s.dr.map((v, i) => '<details class="bpi-reg"><summary><b>DR' + i + '</b> <code>' + esc(hex(v)) + '</code></summary>' +
                row('Unsigned', String(v)) + row('Signed', String(v | 0)) + row('Hex', hex(v)) + '</details>').join('') +
            '</div></details>';
        return html;
    }

    function close() {
        openSnapshot = null;
        if (typeof document === 'undefined') return;
        document.removeEventListener('keydown', onKey, true);
        const overlay = document.getElementById('breakpointInspector');
        if (overlay) overlay.remove();
        const target = returnFocus; returnFocus = null;
        if (target && typeof target.focus === 'function' && document.contains && document.contains(target)) target.focus();
    }
    function onKey(event) {
        const overlay = document.getElementById('breakpointInspector');
        if (!overlay) { document.removeEventListener('keydown', onKey, true); return; }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.key !== 'Tab') return;
        const items = Array.from(overlay.querySelectorAll('button, summary, [tabindex]:not([tabindex="-1"])'));
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1], active = document.activeElement;
        if (event.shiftKey && (active === first || !overlay.contains(active))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (active === last || !overlay.contains(active))) { event.preventDefault(); first.focus(); }
    }
    function open(machine, info) {
        const snapshot = capture(machine, info);
        if (!snapshot) return null;
        const key = [snapshot.kind, snapshot.address, snapshot.physicalPC, snapshot.bootStep].join('|');
        if (openSnapshot && lastKey === key) return openSnapshot; // both hooks fire for one pause
        lastKey = key; openSnapshot = snapshot;
        if (typeof document === 'undefined' || !document.body) return snapshot;
        const replacing = !!document.getElementById('breakpointInspector');
        const previous = replacing ? returnFocus : document.activeElement;
        returnFocus = null; close(); openSnapshot = snapshot;
        returnFocus = previous && previous !== document.body ? previous : null;
        const overlay = document.createElement('div');
        overlay.id = 'breakpointInspector';
        overlay.className = 'bpi-overlay';
        overlay.innerHTML = '<div class="bpi-modal" role="dialog" aria-modal="true" aria-label="Breakpoint inspector">' + render(snapshot) + '</div>';
        overlay.addEventListener('click', event => {
            if (event.target === overlay || (event.target.closest && event.target.closest('[data-bpi-close]'))) close();
        });
        document.body.appendChild(overlay);
        document.addEventListener('keydown', onKey, true);
        const button = overlay.querySelector('[data-bpi-close]');
        if (button && button.focus) button.focus();
        return snapshot;
    }
    root.BreakpointInspector = {capture, open, close, render, current:() => openSnapshot,
        _resetForTest:() => { lastKey = null; openSnapshot = null; }};
})(typeof window !== 'undefined' ? window : globalThis);
