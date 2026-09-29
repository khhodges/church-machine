'use strict';
(function () {
    const el = id => document.getElementById(id);
    let state = null;
    const hex = value => `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
    const setStatus = (text, error = false) => {
        el('status').textContent = text;
        el('status').className = error ? 'error' : '';
    };
    function clearState() {
        state = null;
        el('thread').replaceChildren();
        el('execution').textContent = 'No test loaded.';
        el('registers').textContent = 'No test loaded.';
        el('trace').textContent = 'No instructions attempted.';
        refresh();
    }
    async function getBinaries() {
        // Only exact active, validated saved artifacts: never accept a replacement
        // by token or a browser-generated/mock binary.
        const response = await fetch('/api/lumps/list', {cache: 'no-store'});
        if (!response.ok) throw new Error(`Saved LUMP catalogue: HTTP ${response.status}`);
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new Error('Invalid saved LUMP catalogue');
        const result = {};
        for (const name of ['ide.Alice', 'ide.Mallory']) {
            const matches = rows.filter(row => row.abstraction === name && !row.archived);
            if (matches.length !== 1 || !matches[0].binary_valid ||
                !/^[a-f0-9]{8}$/i.test(matches[0].token) || !matches[0].filename)
                throw new Error(`Expected exactly one valid active ${name} saved binary`);
            const row = matches[0];
            const wordsResponse = await fetch('/api/lump/' + row.token +
                '/words?exact_filename=' + encodeURIComponent(row.filename), {cache: 'no-store'});
            if (!wordsResponse.ok) throw new Error(`${name} binary: HTTP ${wordsResponse.status}`);
            const record = await wordsResponse.json();
            if (!Array.isArray(record.words) || !record.words.length ||
                record.validation_errors?.length || record.binary_hash !== row.binary_hash)
                throw new Error(`${name} saved binary integrity mismatch`);
            result[name] = record.words;
        }
        return result;
    }
    function refresh() {
        const has = !!state;
        const done = !has || state.attempts >= state.limit;
        el('step').disabled = done;
        el('run').disabled = done;
        el('reset').disabled = !has;
        el('thread').disabled = !has;
        if (!has) return;
        const {sim, bodies, roles} = state;
        const slot = sim.parseGT(sim.cr[14].word0).index;
        const entry = sim.readNSEntry(slot);
        const address = entry ? entry.word0_location + 1 + sim.pc : null;
        const next = !done && address !== null && address < sim.memory.length
            ? sim.decodeInstruction(sim.memory[address]) : null;
        const label = slot === 32 ? 'fixture manager' : slot === 33 ? 'fixture Alice driver'
            : slot === 34 ? 'fixture Mallory driver'
            : roles.find(role => role.slot === slot)?.abstraction || `NS[${slot}]`;
        el('execution').textContent = `Executing Thread NS[${sim._currentThreadSlot}] (${sim._currentThreadSlot === 1 ? 'Boot.Thread' : sim._currentThreadSlot === 11 ? 'Thread.2' : 'Thread.3'})\n` +
            `Executable ${label} NS[${slot}]; PC ${sim.pc}; attempted ${state.attempts}/${state.limit}\n` +
            (next ? `Next @${hex(address)}: ${hex(next.raw)} opcode=${next.opcode} condition=${next.cond} CRdst=${next.crDst} CRsrc=${next.crSrc} imm=${next.imm}`
                : 'At bounded test boundary — no further instructions will execute.');
        const selected = Number(el('thread').value);
        const body = bodies.find(item => item.slot === selected) || bodies[0];
        const live = sim._currentThreadSlot === body.slot && sim._liveThreadOwned;
        const capCount = body.layout.capsWords;
        const cap = i => live ? hex(sim.cr[i].word0)
            : i < capCount ? hex(sim.memory[body.base + body.layout.capsStart + i])
                : 'not stored (runtime/system CR)';
        const data = i => live ? sim.dr[i] : sim.memory[body.base + body.layout.drStart + i];
        el('registers').textContent = `Thread NS[${body.slot}] — ${live ? 'LIVE CPU banks' : 'saved private homes (dormant)'}\n` +
            Array.from({length: 16}, (_, i) => `CR${i} ${cap(i)}    DR${i} ${hex(data(i))}`).join('\n') +
            `\nAlice private resident word: ${hex(sim.memory[roles[0].base + 9])}`;
        const evidence = sim.lastStepEvidence;
        el('trace').textContent = state.retired.map((r, i) =>
            `${i + 1}. Thread NS[${r.owner}] PC ${r.pc} @${hex(r.physicalPC)} opcode ${r.opcode}: ${r.outcome}`).join('\n') +
            (evidence?.outcome === 'fault' ? `\nFAULT: ${evidence.fault?.type} Thread NS[${evidence.pre?.threadSlot ?? sim._currentThreadSlot}] ` +
                `@${hex(evidence.instruction?.physicalPC || 0)} opcode ${evidence.instruction?.decoded?.opcode}; ` +
                `${sim.faultLog.at(-1)?.rawDiagnosticReason || sim.faultLog.at(-1)?.message || ''}` : '') ||
            'No instructions attempted (setup only).';
    }
    async function load(name = el('scenario').value) {
        el('load').disabled = true;
        el('scenario').disabled = true;
        clearState();
        setStatus('Loading saved binaries and preparing isolated RAM…');
        try {
            const binaries = await getBinaries();
            state = AliceMalloryLab.createScenario(name, binaries);
            el('thread').replaceChildren(...state.bodies.map((body, index) => {
                const option = document.createElement('option');
                option.value = body.slot;
                option.textContent = index === 0 ? 'Boot.Thread' : `Thread.${index + 1}`;
                return option;
            }));
            setStatus(AliceMalloryLab.outcome(state) +
                ' Canonical boot completed in isolation; driver entry prepared (no editor/Namespace write).');
        } catch (err) {
            clearState();
            setStatus(`Load failed: ${err.message}`, true);
        } finally {
            el('scenario').disabled = false;
            el('load').disabled = false;
            refresh();
        }
    }
    function step() {
        if (!state || state.attempts >= state.limit) return;
        try {
            setStatus(AliceMalloryLab.step(state));
        } catch (err) {
            state.attempts = state.limit;
            setStatus(`FAIL: ${err.message}`, true);
        }
        refresh();
    }
    el('load').addEventListener('click', () => load());
    el('step').addEventListener('click', step);
    el('run').addEventListener('click', () => {
        if (!state) return;
        // Fixed scenario limit prevents executing recovery, DREAD or unrelated code.
        while (state && state.attempts < state.limit && !el('status').classList.contains('error')) step();
    });
    el('reset').addEventListener('click', () => state ? load(state.scenario) : undefined);
    el('scenario').addEventListener('change', () => {
        clearState();
        setStatus('Selection changed. Load isolated test to begin.');
    });
    el('thread').addEventListener('change', refresh);
})();