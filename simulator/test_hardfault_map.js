'use strict';
const assert = require('node:assert/strict');
const { webcrypto, createHash } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const maps = require('./hardfault-map.js');
const clone = o => JSON.parse(JSON.stringify(o));
const hash = ws => createHash('sha256').update(maps.wordBytes(ws)).digest('hex');

(async () => {
    const keys = await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const jwk = await webcrypto.subtle.exportKey('jwk', keys.publicKey);
    const verify = maps.createVerifier(webcrypto.subtle, { compiler: jwk });
    const words = [0xf8001000, 0xf7000000, 0xf7000000, 0xf7000000, 0xaf104002, 123];
    const code = words.slice(0, 5);
    const map = { version: 1, encoding: 0xf7000000, binaryHash: hash(words),
        codeHash: hash(code), sites: [
            { offset: 1, reason: 'PASSKEY_MISMATCH', method: 'Example.Check', sourceLine: 17,
                explanation: 'The supplied passkey does not match.' },
            { offset: 3, reason: 'BAD_TYPE', method: 'Example.Read', sourceLine: 29,
                explanation: 'The object type is not supported.' }
        ] };
    async function sign(m) {
        return { keyId: 'compiler', map: clone(m), signature: Buffer.from(
            await webcrypto.subtle.sign('Ed25519', keys.privateKey, maps.signingBytes(m))).toString('hex') };
    }
    const input = { envelope: await sign(map), artifactWords: words,
        capturedCodeWords: code, capturedIdentity: { secure: true, binaryHash: hash(words) },
        offset: 1, capturedOffset: 1, rawWord: 0xf7000000, faultType: 'INVALID_OP',
        occurrence: 'attempt:1' };
    assert.deepEqual(await verify(input), map.sites[0]);
    assert.deepEqual(await verify({ ...input, offset: 3, capturedOffset: 3 }), map.sites[1]);
    assert.equal(await verify({ ...input, offset: 2, capturedOffset: 2 }), null,
        'accidental identical WORD must remain unclassified');
    assert.equal(await maps.verify(input), null, 'production pins are empty');
    assert.equal(maps.emissionEnabled, false);
    const reject = async (label, mutate) => {
        const bad = clone(input);
        mutate(bad);
        assert.equal(await verify(bad), null, label);
    };
    await reject('missing map', b => delete b.envelope);
    await reject('unsigned map', b => delete b.envelope.signature);
    await reject('untrusted signer', b => b.envelope.keyId = 'other');
    await reject('bad signature', b => b.envelope.signature = '00'.repeat(64));
    await reject('tampered reason', b => b.envelope.map.sites[0].reason = 'FORGED');
    await reject('tampered method', b => b.envelope.map.sites[0].method = 'Wrong.Method');
    await reject('tampered line', b => b.envelope.map.sites[0].sourceLine++);
    await reject('tampered explanation', b => b.envelope.map.sites[0].explanation = 'Wrong');
    await reject('retargeted identical WORD', b => b.envelope.map.sites[0].offset = 2);
    await reject('different identity', b => b.capturedIdentity.binaryHash = 'a'.repeat(64));
    await reject('missing identity', b => delete b.capturedIdentity);
    await reject('insecure identity', b => b.capturedIdentity.secure = false);
    await reject('changed surrounding code', b => b.capturedCodeWords[4]++);
    await reject('partial code', b => b.capturedCodeWords.pop());
    await reject('changed non-code body', b => b.artifactWords[5]++);
    await reject('wrong raw word', b => b.rawWord = 0xf0000000);
    await reject('wrong fault type', b => b.faultType = 'BOUNDS');
    await reject('missing occurrence', b => delete b.occurrence);
    await reject('wrong offset', b => b.offset = 3);
    await reject('no origin offset', b => delete b.capturedOffset);
    await reject('byte NIA not word offset', b => b.offset = b.capturedOffset = 12);
    await reject('negative word coercion', b => b.artifactWords[1] = -150994944);
    await reject('extra private field', b => b.envelope.map.sites[0].proof = 'secret');
    await reject('extra map authority', b => b.envelope.map.crSnapshot = []);
    await reject('extra envelope authority', b => b.envelope.privateKey = 'secret');
    await reject('duplicate sites', b => b.envelope.map.sites.push(b.envelope.map.sites[0]));
    await reject('unsorted sites', b => b.envelope.map.sites.reverse());
    await reject('invalid source line', b => b.envelope.map.sites[0].sourceLine = 0);
    await reject('control text', b => b.envelope.map.sites[0].explanation = 'bad\ntext');
    await reject('header offset', b => b.envelope.map.sites[0].offset = 0);
    const signedBadCode = clone(input);
    signedBadCode.envelope.map.codeHash = 'b'.repeat(64);
    signedBadCode.envelope = await sign(signedBadCode.envelope.map);
    assert.equal(await verify(signedBadCode), null, 'even signed code hash must match');
    const nonSite = clone(input);
    nonSite.envelope.map.sites[1].offset = 4;
    nonSite.envelope = await sign(nonSite.envelope.map);
    assert.equal(await verify(nonSite), null, 'every signed site must be a candidate word');
    const pending = clone(input);
    const result = verify(pending);
    pending.envelope.map.sites[0].reason = 'RACE';
    pending.artifactWords[1] = 0;
    assert.deepEqual(await result, map.sites[0], 'verification snapshots async inputs');

    // Exercise the real UI helper with signed evidence; disassembly's existing
    // synthetic-hash tests alone cannot test map authentication.
    const source = fs.readFileSync('simulator/app-lumps.js', 'utf8');
    const start = source.indexOf('function _revealFaultInstruction(');
    const end = source.indexOf('// Keep the last exact binary', start);
    let status = '', latest;
    const binary = { token: 'test', words, binaryHash: hash(words),
        hardfaultMap: input.envelope, filename: 'exact.lump' };
    const ctx = vm.createContext({
        window: { _faultNavigationBinary: binary },
        document: {
            getElementById: id => id === 'asmEditor' ? null : { appendChild() {} },
            createElement: () => ({ style: {}, setAttribute() {}, scrollIntoView() {} })
        },
        assembler: { disassemble: () => 'WORD 0x7000000' },
        switchCodeTab() {}, _setDisassemblyPresentationStatus: s => { status = s; },
        ChurchHardfaultMap: { verify: data => { latest = verify(data); return latest; } }
    });
    vm.runInContext(source.slice(start, end), ctx);
    const evidence = { artifact: { identity: input.capturedIdentity }, codeWords: code,
        occurrence: input.occurrence, capturedOffset: 1, faultType: 'INVALID_OP' };
    assert.equal(ctx._revealFaultInstruction('test', 1, input.rawWord, evidence), true);
    await latest;
    assert.match(status, /Intentional HARDFAULT: PASSKEY_MISMATCH/);
    assert.match(status, /0xf7000000/);
    assert.equal(ctx._revealFaultInstruction('test', 2, input.rawWord,
        { ...evidence, capturedOffset: 2 }), true);
    await latest;
    assert.doesNotMatch(status, /Intentional HARDFAULT/);
    ctx._revealFaultInstruction('test', 1, input.rawWord, evidence);
    const staleRequest = latest;
    ctx._revealFaultInstruction('test', 1, input.rawWord, null);
    const failedStatus = status;
    await staleRequest;
    assert.equal(status, failedStatus, 'later rejected navigation wins');
    ctx._revealFaultInstruction('test', 1, input.rawWord, evidence);
    ctx.window._faultNavigationBinary = { ...binary };
    const navigationStatus = status;
    await latest;
    assert.equal(status, navigationStatus, 'new artifact wins pending attribution');

    // Classic browser export in actual manifest order, not a CommonJS shim.
    const html = fs.readFileSync('simulator/index.html', 'utf8');
    const scriptNames = [...html.matchAll(/<script src="([^"?]+)/g)].map(m => m[1]);
    assert(scriptNames.indexOf('hardfault-map.js') < scriptNames.indexOf('app-lumps.js'));
    assert(scriptNames.indexOf('hardfault-map.js') < scriptNames.indexOf('app-run.js'));
    const browser = vm.createContext({ crypto: webcrypto, TextEncoder });
    vm.runInContext(fs.readFileSync('simulator/hardfault-map.js', 'utf8'), browser);
    assert.equal(browser.ChurchHardfaultMap.createVerifier, undefined);
    assert.equal(await browser.ChurchHardfaultMap.verify(input), null);
    const Assembler = require('./assembler.js');
    const asm = new Assembler();
    assert.match(asm.assemble('HARDFAULT PASSKEY_MISMATCH').errors[0].message,
        /emission is disabled/);
    assert.equal(asm._assembleLine('WORD 0x07000000', 1, 0), 0xf7000000);
    console.log('HARDFAULT maps: authenticated sites, rejection paths, async UI, browser gate PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
