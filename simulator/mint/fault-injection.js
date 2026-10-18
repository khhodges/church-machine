'use strict';

// Deterministic *negative* hardware/host fault injection, selected only by the
// trusted initializer. There is no callback, mutable-core export, or positive
// authorization shortcut. Every attack starts after real compiled execution.
const {requireThat: need} = require('./protected-policy');

function inject(s, st, point, executeOperation, ops) {
    const probe = st.plan.negativeProbe;
    if (!probe || st.probeFired || probe.at !== point) return;
    st.probeFired = true;
    const c = st.context;
    switch (probe.kind) {
    case 'overlap':
        s._execCall({crDst: 0, imm: 1, indexedSourceGT: st.plan.roles.mint.enter});
        break;
    case 'replay':
        executeOperation(s, st, ops.PREPARE);
        break;
    case 'activation':
        s._execChange({crDst: 0}, s.pc + 1);
        break;
    case 'switch':
        s._execSwitch({crDst: 15, crSrc: 6, imm: 1});
        break;
    case 'aba': {
        const address = c.slot * 4;
        const old = s.memory[address];
        s.memory[address] = old ^ 4;
        s.memory[address] = old;
        break;
    }
    case 'write-request':
        s.memory[st.plan.frozenRequest] ^= 1;
        break;
    case 'stale-registry':
        // Simulated loss of stable registry revision, not an ordinary update
        // API. Subsequent context validation must refuse the old evidence.
        st.registry.revision++;
        break;
    case 'corrupt-continuation':
        // Simulated RAM corruption is applied separately by the backing-store
        // fault injector. The next RETURN validates the actual protected word.
        st.corruptAddress = s.cr[12].word1 + st.continuation.frameAddress;
        break;
    case 'wrong-old-word':
        st.corruptAddress = c.slot * 4 + probe.word;
        break;
    case 'early-result':
    case 'duplicate-result':
    case 'wrong-result':
    case 'zero-result':
    case 'wrong-address':
    case 'alias-result': {
        // These directly exercise the single physical write gate. The address
        // is deliberately not inferred from a privileged source-slot number:
        // overlapping aliases must encounter exactly the same gate.
        let value = c?.result || 0x3200001c;
        if (probe.kind === 'wrong-result') value ^= 0x10000000;
        if (probe.kind === 'zero-result') value = 0;
        const address = st.plan.resultCell - (probe.kind === 'wrong-address' ? 1 : 0);
        s.memory[address] = value;
        if (probe.kind === 'alias-result') s.memory[address] = value;
        break;
    }
    default: need(false, 'MINT_PROBE');
    }
}
module.exports = {inject};
