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
        el('tuple-evidence').textContent = 'Choose a tuple test to collect evidence.';
        refresh();
    }
    async function getBinaries(scenario) {
        if (scenario === 'ascending-actors') {
            const result = {};
            for (const actor of ['Alice', 'Mallory']) {
                const response = await fetch('examples/' + actor.toLowerCase() + '.cloomc', {cache:'no-store'});
                if (!response.ok) throw Error(actor + ' source unavailable: HTTP ' + response.status);
                const source = await response.text();
                const compiled = await fetch('/api/compile', {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({source, language:'assembly', tier:2}),
                });
                const data = await compiled.json();
                if (!compiled.ok || !data.ok || !Array.isArray(data.words))
                    throw Error(actor + ' compile failed: ' + JSON.stringify(data.errors || data.error || data));
                result['ide.' + actor] = data.words;
            }
            return result;
        }
        // Only exact pinned, validated saved artifacts (even if later archived):
        // never accept a replacement
        // by token or a browser-generated/mock binary.
        const response = await fetch('/api/lumps/list?include_archived=1', {cache: 'no-store'});
        if (!response.ok) throw new Error(`Saved LUMP catalogue: HTTP ${response.status}`);
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new Error('Invalid saved LUMP catalogue');
        const result = {};
        for (const name of ['ide.Alice', 'ide.Mallory']) {
            const pinned = AliceMalloryLab.savedFixtures[name];
            const matches = rows.filter(row => row.abstraction === name && row.filename === pinned);
            if (matches.length !== 1 || !matches[0].binary_valid ||
                !/^[a-f0-9]{8}$/i.test(matches[0].token) ||
                matches[0].binary_hash !== AliceMalloryThreadFixture.savedHashes[name])
                throw new Error(`Expected exact valid saved fixture ${pinned}`);
            const row = matches[0];
            const wordsResponse = await fetch('/api/lump/' + row.token +
                '/words?exact_filename=' + encodeURIComponent(row.filename), {cache: 'no-store'});
            if (!wordsResponse.ok) throw new Error(`${name} binary: HTTP ${wordsResponse.status}`);
            const record = await wordsResponse.json();
            if (!Array.isArray(record.words) || !record.words.length ||
                record.validation_errors?.length || record.binary_hash !== row.binary_hash)
                throw new Error(`${name} saved binary integrity mismatch`);
            const bytes = new ArrayBuffer(record.words.length * 4);
            const view = new DataView(bytes);
            record.words.forEach((word, index) => {
                if (!Number.isInteger(word) || word < 0 || word > 0xffffffff)
                    throw new Error(`${name} invalid saved word`);
                view.setUint32(index * 4, word, false);
            });
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            const hash = Array.from(new Uint8Array(digest),
                value => value.toString(16).padStart(2, '0')).join('');
            if (hash !== AliceMalloryThreadFixture.savedHashes[name])
                throw new Error(`${name} pinned binary integrity mismatch`);
            result[name] = record.words;
        }
        return result;
    }
    function refresh() {
        const has = !!state;
        const done = !has || state.attempts >= state.limit || !!state.passed;
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
        const asc = state.scenario === 'ascending-actors';
        const threadName = n => asc ? (n === 2 ? 'Boot.Thread' : n === 11 ? 'Thread.2' : n === 12 ? 'Thread.3' : `NS[${n}]`)
            : (n === 1 ? 'Boot.Thread' : n === 11 ? 'Thread.2' : 'Thread.3');
        const ascNames = asc ? {[state.manager.slot]: 'fixture manager', [state.alice.slot]: 'fixture Alice driver',
            [state.mallory.slot]: 'fixture Mallory driver'} : {};
        const role = roles.find(r => r.slot === slot);
        const label = asc ? (ascNames[slot] || (role ? `${role.name} (RAM fixture)` : `NS[${slot}]`))
            : slot === 32 ? 'fixture manager' : slot === 33 ? 'fixture Alice driver'
            : slot === 34 ? 'fixture Mallory driver'
            : (roles.find(role => role.slot === slot)
                ? `${roles.find(role => role.slot === slot).abstraction} (RAM fixture)` : `NS[${slot}]`);
        el('execution').textContent = `Executing Thread NS[${sim._currentThreadSlot}] (${threadName(sim._currentThreadSlot)})\n` +
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
        el('tuple-evidence').textContent = state.scenario.startsWith('tuple-')
            ? (state.tupleAddress === null ? 'Alice has not entered her Thread yet.' :
                `Alice heap tuple: ${ThreadHeapRecord.schema.words} words at ${hex(state.tupleAddress)}\n` +
                `Conditions word: ${sim.memory[state.tupleAddress + 5]}\n` +
                `Full-record unchanged since Alice returned: ${state.tupleBeforeAttack
                    ? state.tupleBeforeAttack.every((word, i) => word === sim.memory[state.tupleAddress + i])
                    : 'not yet measured'}\n` +
                (state.malloryTupleAddress !== null ?
                    `Mallory own heap tuple: ${hex(state.malloryTupleAddress)}; requested offset: ${state.offset}\n` +
                    `Attempted address: ${hex(state.targetAddress)}; DR4: ${hex(sim.dr[4])}\n` : '') +
                (state.firstFaultEvidence ?
                    `First fault: ${state.firstFaultEvidence.fault.type}; ${state.firstFaultEvidence.fault.message}\n` +
                    `Data registers unchanged: ${state.malloryRegistersBefore.every((word, i) => word === sim.dr[i])}\n` : '') +
                'Raw inspection is test-harness observation, not authority granted to Mallory.')
            : asc ? 'Isolated ascending-layout fixture (not the selected NewLayout image, admission or FPGA proof).\n' +
                `Thread slots: ${state.threadSlots.map(n => `NS[${n}] ${threadName(n)}`).join(', ')}\n` +
                `Actors: ${roles.map(r => `${r.name} NS[${r.slot}]`).join(', ')}\n` +
                `Alice returned: ${state.aliceReturned}; first fault: ${state.firstFaultEvidence
                    ? state.firstFaultEvidence.fault?.type : 'none yet'}\n` +
                `Alice data unchanged during attack: ${state.secretBeforeAttack ? state.secretBeforeAttack.every(
                    (w, i) => w === sim.memory[roles[0].base + i]) : 'not yet measured'}`
            : 'Choose a tuple test to collect evidence.';
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
            const binaries = await getBinaries(name);
            state = AliceMalloryLab.createScenario(name, binaries);
            el('thread').replaceChildren(...state.bodies.map((body, index) => {
                const option = document.createElement('option');
                option.value = body.slot;
                option.textContent = (index === 0 ? 'Boot.Thread' : `Thread.${index + 1}`) + ` (NS[${body.slot}])`;
                return option;
            }));
            setStatus(AliceMalloryLab.outcome(state) + (state.scenario === 'ascending-actors'
                ? ' Isolated ascending-layout fixture: preboot fixture provisions CR0 driver continuations and each actor E capability in its own CR1. ' +
                    'Current Alice/Mallory sources compiled without opcode patches; main CapabilityTest and saved Namespace untouched. Fault-restart retention is not yet verified. Not a saved NewLayout image/admission/FPGA proof.'
                : ' Canonical boot completed in isolation; suspended driver entry prepared. ' +
                'Pinned historical LOADs adapted only in newly minted RAM fixtures (no saved-file/editor/Namespace write).'));
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
        if (!state || state.attempts >= state.limit || state.passed) return;
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
        // Fixed scenario limit prevents executing recovery or unrelated code.
        while (state && state.attempts < state.limit && !state.passed && !el('status').classList.contains('error')) step();
    });
    el('reset').addEventListener('click', () => state ? load(state.scenario) : undefined);
    el('scenario').addEventListener('change', () => {
        clearState();
        setStatus('Selection changed. Load isolated test to begin.');
    });
    el('thread').addEventListener('change', refresh);
    const requested = typeof URLSearchParams === 'function'
        ? new URLSearchParams(globalThis.location?.search || '').get('scenario') : null;
    if (requested && Object.prototype.hasOwnProperty.call(AliceMalloryLab.scenarios, requested))
        el('scenario').value = requested;
})();
