'use strict';

// This is an explicitly selected simulator-only encoding profile. The ordinary
// assembler/decoder still reject opcode 11. Opcode 10 belongs to IDX1.
const Assembler = require('../assembler');
const crypto = require('node:crypto');
const PROFILE = 'mint-protected-sim-v1';
const OPS = Object.freeze({
    BEGIN: 1, VERIFY_CONTEXT: 2, VERIFIED: 3, READ: 4, PREPARE: 5,
    COMMIT: 6, CLEAN: 7, FINISH: 8, FAIL: 9, CHECK_LIVE_USE: 10,
});
function digest(words) {
    const bytes = Buffer.alloc(words.length * 4);
    words.forEach((word, i) => bytes.writeUInt32BE(word >>> 0, i * 4));
    return crypto.createHash('sha256').update(bytes).digest('hex');
}
function compile(source) {
    if (/^\s*WORD\b/m.test(source)) throw new Error('Raw WORD is not accepted in protected service source');
    const operations = [];
    const emitted = [];
    const entries = [];
    const placeholder = word => `WORD ${emitted.push(word >>> 0) - 1}`;
    // The legacy simulator already implements Mode 2 (imm15=0x7fff), but its
    // assembler only accepts preset TPERM. Lower the explicit register form in
    // this compiler alone; do not change legacy assembly or ISA semantics.
    const tableSource = source.replace(/^\s*ENTRY\s+(\w+)\s*$/gm, (_, label) => {
        entries.push({index: emitted.length, label});
        return placeholder(0);
    });
    const attenuated = tableSource.replace(
        /^\s*TPERM\s+CR([0-9]|1[01])\s*,\s*CR([0-9]|1[01])\s*,\s*#32767\s*$/gm,
        (_, dst, src) => placeholder((6 << 27) | (14 << 23) |
            (Number(dst) << 19) | (Number(src) << 15) | 0x7fff));
    const lowered = attenuated.replace(/^\s*MINT\s+(\w+)\s*$/gm, (_, name) => {
        if (!OPS[name]) throw new Error(`Unknown protected Mint operation ${name}`);
        operations.push(name);
        // Explicit WORD emission here is profile lowering, not HARDFAULT or a
        // permissive change to the global assembler.
        return placeholder((11 << 27) | (14 << 23) | OPS[name]);
    });
    const assembler = new Assembler();
    const result = assembler.assemble(lowered);
    if (assembler.errors.length) throw new Error(JSON.stringify(assembler.errors));
    for (const {index, label} of entries) {
        if (!Object.hasOwn(assembler.labels, label))
            throw new Error(`Unknown dispatch label ${label}`);
        emitted[index] = assembler.labels[label] + 1;
    }
    // WORD is a tagged 23-bit inline constant in this assembler, not a raw
    // 32-bit directive. Replace only our reserved placeholders after assembly.
    const words = Array.from(result.words, w => {
        if ((w >>> 27) === 30) return emitted[w & 0x7fffff];
        // Master ISA: CHANGE has fixed destination CR12, A=0, source in B.
        // Adapt the legacy assembler's repeated-register form only here.
        if ((w >>> 27) === 4) return (w & ~(15 << 19)) >>> 0;
        return w >>> 0;
    });
    return Object.freeze({profile: PROFILE, source, words: Object.freeze(words),
        hash: digest(words), labels: Object.freeze({...assembler.labels}), operations});
}
function programs(consumer = false) {
    if (typeof consumer !== 'boolean') throw new Error('Invalid protected consumer profile');
    // Rows are a typed capability ABI, not the scalar DR argument ABI.
    // The optional evidence driver CALLs an ordinary, initializer-provisioned
    // consumer only AFTER Mint has returned CR1 and released admission. It
    // cannot supply service code, verifier success or a protected continuation.
    const use = consumer ? `
LOAD CR0, CR6, #14
CALL CR0, #0
HALT
` : `
IADD DR2, DR0, #73
DWRITE DR2, CR1, #0
DREAD DR3, CR1, #0
MCMP DR2, DR3
BRANCHNE denied
LOAD CR2, CR6, #2
LOAD CR3, CR6, #3
LOAD CR4, CR6, #4
LOAD CR8, CR6, #5
LOAD CR0, CR6, #1
CALL CR0, #0
IADD DR2, DR0, #73
DWRITE DR2, CR1, #0
DREAD DR3, CR1, #0
MCMP DR2, DR3
BRANCHNE denied
HALT
`;
    const mint = compile(`
ENTRY create
ENTRY reject_method
ENTRY reject_method
ENTRY reject_method
ENTRY reject_method
caller:
LOAD CR2, CR6, #2
LOAD CR3, CR6, #3
LOAD CR4, CR6, #4
LOAD CR8, CR6, #5
LOAD CR0, CR6, #1
${consumer ? 'LOAD CR11, CR6, #14' : ''}
CALL CR0, #0
${use}
create:
MINT BEGIN
LOAD CR9, CR6, #7
LAMBDA CR9
LOAD CR2, CR6, #2
LOAD CR3, CR6, #11
LOAD CR4, CR6, #12
LOAD CR7, CR6, #13
LOAD CR0, CR6, #6
CALL CR0, #0
MINT CHECK_LIVE_USE
MINT PREPARE
LOAD CR9, CR6, #7
LAMBDA CR9
LOAD CR8, CR6, #9
LOAD CR1, CR8, #1
MINT CLEAN
MINT FINISH
RETURN #2
denied:
MINT FAIL
reject_method:
MINT BEGIN
MINT FAIL
dispatcher:
LOAD CR10, CR6, #8
MINT READ
RETURN
commit:
LOAD CR10, CR6, #8
MINT COMMIT
LOAD CR11, CR6, #10
DWRITE DR2, CR11, #0
RETURN
${[2, 3, 4, 5].map(method => `
caller_method_${method}:
LOAD CR2, CR6, #2
LOAD CR3, CR6, #3
LOAD CR4, CR6, #4
LOAD CR8, CR6, #5
LOAD CR0, CR6, #1
CALL CR0, #${method - 1}
HALT`).join('\n')}
`);
    // The ISA has no XOR/OR instruction. Lower the exact expression
    // diff |= actual[i] ^ expected[i] bitwise using ordinary Turing operations.
    // (a-b)&1 = XOR for one-bit a/b; (a+b+1)>>1 = OR for one-bit a/b.
    // All four word pairs and all 128 bits execute before the sole decision.
    const compare = ['ENTRY verify', 'verify:', 'MINT VERIFY_CONTEXT',
        'LOAD CR3, CR6, #1', 'LOAD CR4, CR6, #2', 'IADD DR7, DR0, #0'];
    for (let word = 0; word < 4; word++) {
        compare.push(`DREAD DR2, CR3, #${word}`, `DREAD DR3, CR4, #${word}`);
        for (let bit = 0; bit < 32; bit++) {
            compare.push(`BFEXT DR8, DR2, #${bit}, #1`,
                `BFEXT DR9, DR3, #${bit}, #1`, 'ISUB DR8, DR8, DR9',
                'BFEXT DR8, DR8, #0, #1', `BFEXT DR9, DR7, #${bit}, #1`,
                'IADD DR8, DR8, DR9', 'IADD DR8, DR8, #1',
                'SHR DR8, DR8, #1', `BFINS DR7, DR8, #${bit}, #1`);
        }
    }
    compare.push('MCMP DR7, DR0', 'BRANCHNE invalid', 'MINT VERIFIED',
        'RETURN', 'invalid:', 'MINT FAIL');
    return Object.freeze({mint, verifier: compile(compare.join('\n'))});
}
module.exports = {PROFILE, OPS, compile, digest, programs};
