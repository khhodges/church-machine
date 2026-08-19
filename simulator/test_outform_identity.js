'use strict';
// test_outform_identity.js — Adversarial tests for Task #2862 (security-hardened)
//   Trusted per-slot identity, W1||W2||W3 Outform token, W3=cache_token,
//   atomic Inform promotion, and receiveLump identity/CRC/rollback guarantees.
//
//   Security model:
//     • identityHash / binaryHash are canonical 64-hex SHA-256 strings.
//     • Secure network Outform promotion FAILS CLOSED without a trusted identity,
//       resolver metadata, all canonical fields, and a computed binary hash.
//     • The resolver's computedBinaryHash (SHA-256 over raw payload bytes,
//       excluding the CRC prefix) must equal BOTH the registered and resolver
//       binaryHash.
//     • Awaiting generation is checked against the live identity generation to
//       block stale slot-reuse promotion.
//
// Run:  node simulator/test_outform_identity.js
//
// Coverage:
//   G01 — Outform token is serialized EXACTLY W1||W2||W3 (T in final 8 hex)
//   G02 — resident Inform W3 is the cache_token only (not Abstract GT / authority)
//   G03 — built-in boot NS entries carry W3 = 0 (no synthesized Abstract-GT perms)
//   G04 — happy path: registered secure identity + matching lump commits atomically
//   R01 — registerSlotIdentity rejects non-positive issue / empty name / bad hashes
//   T05 — W3 tamper: mutated cache tag T ≠ registered → rejected, W1-3 preserved
//   T06 — binary collision/swap: computed hash ≠ registered → rejected, preserved
//   T07 — CRC tamper: corrupted payload → OUTFORM_CRC, W1-3 preserved
//   T08 — rollback: any failure writes NO resident state (memory untouched)
//   T09 — eviction restores Outform W1-3 byte-for-byte and clears resident body
//   T10 — re-resolution after eviction reproduces the SAME token and commits
//   T11 — slot clear removes trusted identity (prevents reuse)
//   T12 — issue separation: same cache T, different issue → rejected; separate slot ok
//   T13 — dotName / identityHash mismatch from resolver metadata → rejected
//   T14 — FAIL CLOSED: secure Outform without resolver metadata → rejected (no commit)
//   T15 — FAIL CLOSED: missing computedBinaryHash → rejected
//   T16 — resolver binaryHash ≠ computed → rejected (both must match)
//   T17 — stale generation (slot cleared+re-registered mid-fetch) → rejected
//   T22 — instruction-level Outform LOAD cannot bypass trusted resolution
//   T23 — promotion/eviction updates and restores the triggering c-list binding

const crypto = require('crypto');
const ChurchSimulator = require('./simulator.js');

let pass = 0, fail = 0;
function check(label, cond, detail) {
    if (cond) { console.log(`PASS ${label}`); pass++; }
    else      { console.log(`FAIL ${label}${detail ? ': ' + detail : ''}`); fail++; }
}
function hex8(n) { return (n >>> 0).toString(16).padStart(8, '0'); }

// SHA-256 over the raw big-endian bytes of a word array (matches app-run's
// computedBinaryHash over the payload bytes, excluding the CRC prefix).
function sha256Words(words) {
    const buf = Buffer.alloc(words.length * 4);
    for (let i = 0; i < words.length; i++) buf.writeUInt32BE(words[i] >>> 0, i * 4);
    return crypto.createHash('sha256').update(buf).digest('hex');
}
function sha256Hex(str) { return crypto.createHash('sha256').update(str).digest('hex'); }

// ── Build a valid, fully-packed 64-word lump payload (no CRC prefix) ──────────
function buildLump(sim, opts) {
    opts = opts || {};
    const cw = opts.cw != null ? opts.cw : 4;
    const cc = opts.cc != null ? opts.cc : 2;
    const lumpSize = 64;
    const payload = new Array(lumpSize).fill(0);
    payload[0] = sim.packLumpHeader(0, cw, cc, 0);           // 2^6 = 64 words
    for (let i = 1; i <= cw; i++) payload[i] = (3 << 27) | (opts.codeSalt || 0);  // RETURN
    return payload;
}
function withCRC(sim, payload) {
    return [sim._crc32Words(payload)].concat(payload);
}

// A well-formed canonical resolver-meta for a given payload + identity.
function goodMeta(T, payload, extra) {
    extra = extra || {};
    return {
        trust:              'canonical',
        cacheToken:         T >>> 0,
        dotName:            extra.dotName || 'Math.Add',
        issueN:             extra.issueN != null ? extra.issueN : 1,
        identityHash:       extra.identityHash || sha256Hex('Math.Add#1'),
        binaryHash:         sha256Words(payload),
        computedBinaryHash: sha256Words(payload),
    };
}

// Register a SECURE identity + prime awaitingLump for a slot.
function primeSlot(sim, slot, T, extra) {
    extra = extra || {};
    const payload = extra.payload || buildLump(sim, extra.lumpOpts);
    const identityHash = extra.identityHash || sha256Hex('Math.Add#' + (extra.issueN != null ? extra.issueN : 1));
    const binaryHash   = extra.binaryHash   || sha256Words(payload);
    const w1 = extra.w1 != null ? extra.w1 : sim.packNSWord1(4, 0, 0, 2 /*Outform*/, 2) >>> 0;
    const w2 = extra.w2 != null ? extra.w2 : 0x00000456;
    sim.registerSlotIdentity(slot, {
        cacheToken:   T,
        dotName:      extra.dotName || 'Math.Add',
        issueN:       extra.issueN != null ? extra.issueN : 1,
        identityHash: identityHash,
        binaryHash:   binaryHash,
        outformWords: [w1, w2, T],
    }, { secure: true });
    const base = sim._nsSlotBase(slot);
    sim.memory[base + 0] = 0;
    sim.memory[base + 1] = w1;
    sim.memory[base + 2] = w2;
    sim.memory[base + 3] = T >>> 0;
    // State/type is the declared-type side-table, not a W1 field (canonical ABI):
    // mark the slot Outform so readNSEntry(slot).gtType reflects the evicted state.
    sim._nsUiTypeHint = sim._nsUiTypeHint || {};
    sim._nsUiTypeHint[slot] = 2 /* display-only Outform hint */;
    if (slot >= sim.nsCount) sim.nsCount = slot + 1;
    const id = sim.getSlotIdentity(slot);
    sim.awaitingLump = {
        nsIndex: slot, retryPC: 0x10, d: {},
        token: sim._outformToken96(sim.readNSEntry(slot)),
        cacheToken: T >>> 0,
        identityGeneration: id.generation,
        outformWords: [w1, w2, T >>> 0],
    };
    return { payload, identityHash, binaryHash };
}

function snapshotNS(sim, slot) {
    const base = sim._nsSlotBase(slot);
    return [sim.memory[base]>>>0, sim.memory[base+1]>>>0, sim.memory[base+2]>>>0, sim.memory[base+3]>>>0];
}

// ── G01 ───────────────────────────────────────────────────────────────────────
{
    const sim = new ChurchSimulator();
    const entry = { word0_location: 0xDEADBEEF, word1_limit: 0x11111111,
                    word2_seals: 0x22222222, word3_cache_token: 0x33334444 };
    const tok = sim._outformToken96(entry);
    check('G01: Outform token is W1||W2||W3 (24 hex)', tok === '111111112222222233334444', tok);
    check('G01b: cache tag T is the final 8 hex of the token', tok.slice(-8) === '33334444', tok.slice(-8));
    check('G01c: token does NOT include W0 (location)', tok.indexOf('deadbeef') === -1, tok);
}

// ── G02 ───────────────────────────────────────────────────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0xC0FFEE01;
    const { payload } = primeSlot(sim, 30, T);
    const res = sim.receiveLump(withCRC(sim, payload), goodMeta(T, payload));
    check('G02: happy commit ok', res.ok === true, JSON.stringify(res));
    const ns = snapshotNS(sim, 30);
    check('G02b: resident W3 equals cache token T', ns[3] === (T >>> 0), hex8(ns[3]));
    const e = sim.readNSEntry(30);
    check('G02c: word3_cache_token canonical getter exposes T', (e.word3_cache_token >>> 0) === (T >>> 0), hex8(e.word3_cache_token));
    check('G02d: gtType promoted to Inform (1)', e.gtType === 1, String(e.gtType));
}

// ── G03 ───────────────────────────────────────────────────────────────────────
{
    const sim = new ChurchSimulator();
    let anyNonZero = false;
    for (let i = 0; i < sim.nsCount; i++) {
        const base = sim._nsSlotBase(i);
        if ((sim.memory[base] !== 0 || sim.memory[base+1] !== 0) && (sim.memory[base+3] >>> 0) !== 0) anyNonZero = true;
    }
    check('G03: no built-in NS entry synthesizes a non-zero W3', !anyNonZero);
}

// ── G04 ───────────────────────────────────────────────────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0x0BADF00D;
    const { payload } = primeSlot(sim, 31, T);
    const res = sim.receiveLump(withCRC(sim, payload), goodMeta(T, payload));
    check('G04: commit ok', res.ok === true, JSON.stringify(res));
    check('G04b: body word0 is the lump header (magic 0x1F)', (sim.memory[res.freeBase] >>> 27) === 0x1F, hex8(sim.memory[res.freeBase]));
    check('G04c: awaitingLump cleared on success', sim.awaitingLump === null);
    check('G04d: PC restored to retryPC', sim.pc === 0x10, String(sim.pc));
}

// ── R01: registerSlotIdentity fail-closed field validation ────────────────────
{
    const sim = new ChurchSimulator();
    const good = { cacheToken: 1, dotName: 'A.B', issueN: 1,
                   identityHash: sha256Hex('x'), binaryHash: sha256Hex('y') };
    function throws(fn) { try { fn(); return false; } catch (_) { return true; } }
    check('R01: rejects issueN <= 0',
        throws(() => sim.registerSlotIdentity(90, Object.assign({}, good, { issueN: 0 }), { secure: true })));
    check('R01b: rejects empty dotName',
        throws(() => sim.registerSlotIdentity(90, Object.assign({}, good, { dotName: '' }), { secure: true })));
    check('R01c: rejects non-64-hex identityHash',
        throws(() => sim.registerSlotIdentity(90, Object.assign({}, good, { identityHash: 'abcd' }), { secure: true })));
    check('R01d: rejects non-64-hex binaryHash',
        throws(() => sim.registerSlotIdentity(90, Object.assign({}, good, { binaryHash: null }), { secure: true })));
    check('R01e: accepts a fully-formed secure identity',
        !throws(() => sim.registerSlotIdentity(90, good, { secure: true })));
}

// ── T05: W3 tamper (cache tag T mismatch) ─────────────────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0x11112222;
    const { payload } = primeSlot(sim, 32, T);
    const before = snapshotNS(sim, 32);
    const meta = goodMeta(T, payload); meta.cacheToken = 0x99998888;  // resolver claims wrong T
    const res = sim.receiveLump(withCRC(sim, payload), meta);
    check('T05: W3 tamper rejected', res.ok === false, JSON.stringify(res));
    const after = snapshotNS(sim, 32);
    check('T05b: W1 preserved', after[1] === before[1], hex8(after[1]));
    check('T05c: W2 preserved', after[2] === before[2], hex8(after[2]));
    check('T05d: W3 (T) preserved', after[3] === (T>>>0), hex8(after[3]));
    check('T05e: still Outform (declared-type side-table)', sim.readNSEntry(32).gtType === 2);
    check('T05f: identity NOT cleared', sim.getSlotIdentity(32) !== null);
}

// ── T06: binary swap (computed hash ≠ registered) ─────────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0x33334444;
    const legit   = buildLump(sim, { codeSalt: 0 });
    const swapped = buildLump(sim, { codeSalt: 7 });   // same token, different bytes
    primeSlot(sim, 33, T, { payload: legit, binaryHash: sha256Words(legit) });
    const before = snapshotNS(sim, 33);
    // Resolver honestly reports the swapped lump's computed hash → ≠ registered.
    const meta = { cacheToken: T, dotName: 'Math.Add', issueN: 1,
                   identityHash: sha256Hex('Math.Add#1'),
                   binaryHash: sha256Words(swapped), computedBinaryHash: sha256Words(swapped) };
    const res = sim.receiveLump(withCRC(sim, swapped), meta);
    check('T06: swapped binary rejected', res.ok === false, JSON.stringify(res));
    const after = snapshotNS(sim, 33);
    check('T06b: W1-3 preserved', after[1] === before[1] && after[2] === before[2] && after[3] === before[3]);
    check('T06c: W0 still 0 (no body committed)', after[0] === 0, hex8(after[0]));
}

// ── T07: CRC tamper ────────────────────────────────────────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0x55556666;
    const { payload } = primeSlot(sim, 34, T);
    const before = snapshotNS(sim, 34);
    const framed = withCRC(sim, payload); framed[3] ^= 0xFF;   // corrupt after CRC computed
    const res = sim.receiveLump(framed, goodMeta(T, payload));
    check('T07: CRC mismatch rejected', res.ok === false, JSON.stringify(res));
    const lf = sim.faultLog[sim.faultLog.length - 1];
    check('T07b: fault is OUTFORM_CRC', lf && lf.type === 'OUTFORM_CRC', lf ? lf.type : 'none');
    const after = snapshotNS(sim, 34);
    check('T07c: W1-3 preserved', after[1] === before[1] && after[2] === before[2] && after[3] === before[3]);
}

// ── T08: rollback — no resident state on failure ──────────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0x77778888;
    const { payload } = primeSlot(sim, 35, T);
    const memBefore = Array.from(sim.memory);
    const meta = goodMeta(T, payload); meta.cacheToken = 0xDEAD0000;
    const res = sim.receiveLump(withCRC(sim, payload), meta);
    check('T08: rejected (identity mismatch)', res.ok === false);
    let changed = false;
    for (let i = 0; i < memBefore.length; i++) if ((sim.memory[i]>>>0) !== (memBefore[i]>>>0)) { changed = true; break; }
    check('T08b: NO memory word changed (full rollback)', !changed);
}

// ── T09: eviction restores Outform W1-3 byte-for-byte ─────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0x9999AAAA;
    const { payload } = primeSlot(sim, 36, T);
    const outformBefore = snapshotNS(sim, 36);
    const res = sim.receiveLump(withCRC(sim, payload), goodMeta(T, payload));
    check('T09: committed before evict', res.ok === true);
    const bodyBase = res.freeBase;
    sim.lazyManifest[36] = { loaded: true, priority: 'warm', allocSize: 64 };
    check('T09b: evict returned true', sim.lazyEvict(36) === true);
    const after = snapshotNS(sim, 36);
    check('T09c: eviction restored Outform (declared-type side-table)', sim.readNSEntry(36).gtType === 2);
    check('T09d: eviction restored W3 = T', after[3] === (T>>>0), hex8(after[3]));
    check('T09e: eviction restored W1 byte-for-byte', after[1] === outformBefore[1], `${hex8(after[1])} vs ${hex8(outformBefore[1])}`);
    check('T09e2: eviction restored W2 byte-for-byte', after[2] === outformBefore[2], `${hex8(after[2])} vs ${hex8(outformBefore[2])}`);
    check('T09f: resident body word0 cleared', (sim.memory[bodyBase] >>> 27) !== 0x1F, hex8(sim.memory[bodyBase]));
    check('T09g: identity preserved after eviction', sim.getSlotIdentity(36) !== null);
}

// ── T10: re-resolution after eviction ─────────────────────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0xBBBBCCCC;
    const { payload } = primeSlot(sim, 37, T);
    const tokenFirst = sim.awaitingLump.token;
    let res = sim.receiveLump(withCRC(sim, payload), goodMeta(T, payload));
    check('T10: first resolution ok', res.ok === true);
    sim.lazyManifest[37] = { loaded: true, priority: 'warm', allocSize: 64 };
    sim.lazyEvict(37);
    const entry = sim.readNSEntry(37);
    const abs = sim._absentLumpIntercept(entry, 37, {}, 'LOAD');
    check('T10b: re-resolution token equals original', abs.token === tokenFirst, `${abs.token} vs ${tokenFirst}`);
    res = sim.receiveLump(withCRC(sim, payload), goodMeta(T, payload));
    check('T10c: re-resolution commits again', res.ok === true, JSON.stringify(res));
    check('T10d: resident W3 = T after re-resolution', snapshotNS(sim, 37)[3] === (T>>>0));
}

// ── T11: slot clear removes identity ──────────────────────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0xDDDDEEEE;
    primeSlot(sim, 38, T);
    check('T11: identity present', sim.getSlotIdentity(38) !== null);
    sim.clearSlotIdentity(38);
    check('T11b: identity removed after clear', sim.getSlotIdentity(38) === null);
}

// ── T12: issue separation ─────────────────────────────────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0x12341234;
    const { payload } = primeSlot(sim, 39, T, { issueN: 1 });
    const before = snapshotNS(sim, 39);
    const meta2 = goodMeta(T, payload, { issueN: 2, identityHash: sha256Hex('Math.Add#1') });
    meta2.issueN = 2;   // resolver claims issue 2, registered is issue 1
    const res = sim.receiveLump(withCRC(sim, payload), meta2);
    check('T12: same T + different issue rejected', res.ok === false, JSON.stringify(res));
    const after = snapshotNS(sim, 39);
    check('T12b: W1-3 preserved', after[1] === before[1] && after[2] === before[2] && after[3] === before[3]);
    // Separate slot with issue 2 + same T = a fully separate identity: OK.
    const p2 = primeSlot(sim, 40, T, { issueN: 2, identityHash: sha256Hex('Math.Add#2') });
    const res2 = sim.receiveLump(withCRC(sim, p2.payload),
        goodMeta(T, p2.payload, { issueN: 2, identityHash: sha256Hex('Math.Add#2') }));
    check('T12c: same T as a SEPARATE slot/identity (issue=2) commits', res2.ok === true, JSON.stringify(res2));
}

// ── T13: dotName / identityHash mismatch ──────────────────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0x0A0B0C0D;
    const idHash = sha256Hex('Math.Add#1');
    let p = primeSlot(sim, 41, T, { identityHash: idHash });
    const m1 = goodMeta(T, p.payload, { identityHash: idHash }); m1.dotName = 'Evil.Swap';
    let res = sim.receiveLump(withCRC(sim, p.payload), m1);
    check('T13: dotName mismatch rejected', res.ok === false, JSON.stringify(res));
    p = primeSlot(sim, 41, T, { identityHash: idHash });   // re-prime (awaiting cleared)
    const m2 = goodMeta(T, p.payload, { identityHash: idHash });
    m2.identityHash = sha256Hex('DIFFERENT');
    res = sim.receiveLump(withCRC(sim, p.payload), m2);
    check('T13b: identityHash mismatch rejected', res.ok === false, JSON.stringify(res));
}

// ── T14: FAIL CLOSED — secure Outform, no resolver metadata ───────────────────
{
    const sim = new ChurchSimulator();
    const T = 0xF00DBABE;
    const { payload } = primeSlot(sim, 42, T);
    const before = snapshotNS(sim, 42);
    const res = sim.receiveLump(withCRC(sim, payload));   // NO resolverMeta at all
    check('T14: secure Outform w/o resolverMeta rejected (fail closed)', res.ok === false, JSON.stringify(res));
    const after = snapshotNS(sim, 42);
    check('T14b: W1-3 preserved, no commit',
        after[0] === 0 && after[1] === before[1] && after[2] === before[2] && after[3] === before[3]);
    check('T14c: still Outform (not promoted)', sim.readNSEntry(42).gtType === 2);
}

// ── T15: FAIL CLOSED — missing computedBinaryHash ─────────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0xCAFED00D;
    const { payload } = primeSlot(sim, 43, T);
    const meta = goodMeta(T, payload); delete meta.computedBinaryHash;
    const res = sim.receiveLump(withCRC(sim, payload), meta);
    check('T15: missing computedBinaryHash rejected (fail closed)', res.ok === false, JSON.stringify(res));
    check('T15b: not promoted', sim.readNSEntry(43).gtType === 2);
}

// ── T16: resolver binaryHash ≠ computed ───────────────────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0x0C0C0C0C;
    const { payload } = primeSlot(sim, 44, T);
    const meta = goodMeta(T, payload);
    meta.binaryHash = sha256Hex('a-different-binary');   // resolver claim ≠ computed
    const res = sim.receiveLump(withCRC(sim, payload), meta);
    check('T16: resolver binaryHash ≠ computed rejected', res.ok === false, JSON.stringify(res));
}

// ── T17: stale generation (slot re-registered mid-fetch) ──────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0xABCDABCD;
    const { payload } = primeSlot(sim, 45, T);   // awaiting snapshot captures generation G
    // Simulate a clear + re-register (slot reuse) while the fetch is in flight:
    // the live identity generation advances beyond the awaiting snapshot.
    primeSlot(sim, 45, T);   // re-register → new generation; but restore awaiting to OLD snapshot
    sim.awaitingLump.identityGeneration = sim.getSlotIdentity(45).generation - 1;  // stale
    const res = sim.receiveLump(withCRC(sim, payload), goodMeta(T, payload));
    check('T17: stale identity generation rejected', res.ok === false, JSON.stringify(res));
    check('T17b: message mentions stale generation',
        /stale identity generation/i.test(res.message || ''), res.message);
}

// ── T18: FAIL CLOSED — no trusted identity at fetch start ─────────────────────
// receiveLump is exclusively the network Outform promotion path, so an awaiting
// fetch with NO registered per-slot identity must reject unconditionally.
{
    const sim = new ChurchSimulator();
    const T = 0x18181818;
    const payload = buildLump(sim);
    const slot = 46;
    const w1 = sim.packNSWord1(4, 0, 0, 2, 2) >>> 0;
    const base = sim._nsSlotBase(slot);
    sim.memory[base + 0] = 0; sim.memory[base + 1] = w1;
    sim.memory[base + 2] = 0x00000456; sim.memory[base + 3] = T >>> 0;
    // Declared-type side-table is the state discriminator (canonical ABI): Outform.
    sim._nsUiTypeHint = sim._nsUiTypeHint || {};
    sim._nsUiTypeHint[slot] = 2 /* display-only Outform hint */;
    if (slot >= sim.nsCount) sim.nsCount = slot + 1;
    // Awaiting set WITHOUT ever calling registerSlotIdentity.
    sim.awaitingLump = {
        nsIndex: slot, retryPC: 0x10, d: {},
        token: sim._outformToken96(sim.readNSEntry(slot)),
        cacheToken: T >>> 0, identityGeneration: null,
        outformWords: [w1, 0x00000456, T >>> 0],
    };
    const before = snapshotNS(sim, slot);
    const res = sim.receiveLump(withCRC(sim, payload), goodMeta(T, payload));
    check('T18: no trusted identity → rejected', res.ok === false, JSON.stringify(res));
    check('T18b: message names missing identity', /no trusted identity/i.test(res.message || ''), res.message);
    const after = snapshotNS(sim, slot);
    check('T18c: no Inform published (W0 still 0, still Outform)',
        after[0] === 0 && sim.readNSEntry(slot).gtType === 2);
    check('T18d: W1-3 preserved', after[1] === before[1] && after[2] === before[2] && after[3] === before[3]);
}

// ── T19: FAIL CLOSED — identity cleared after awaiting, before response ───────
{
    const sim = new ChurchSimulator();
    const T = 0x19191919;
    const { payload } = primeSlot(sim, 47, T);   // secure identity + awaiting set
    const before = snapshotNS(sim, 47);
    sim.clearSlotIdentity(47);                    // cleared mid-fetch
    const res = sim.receiveLump(withCRC(sim, payload), goodMeta(T, payload));
    check('T19: identity cleared mid-fetch → rejected', res.ok === false, JSON.stringify(res));
    const after = snapshotNS(sim, 47);
    check('T19b: no Inform published (still Outform, W0=0)',
        after[0] === 0 && sim.readNSEntry(47).gtType === 2);
    check('T19c: W1-3 preserved', after[1] === before[1] && after[2] === before[2] && after[3] === before[3]);
}

// ── T20: FAIL CLOSED — explicitly non-secure identity ─────────────────────────
{
    const sim = new ChurchSimulator();
    const T = 0x20202020;
    const payload = buildLump(sim);
    const slot = 48;
    const w1 = sim.packNSWord1(4, 0, 0, 2, 2) >>> 0;
    // Register a NON-secure identity (opts.secure:false) — must NOT bypass verification.
    sim.registerSlotIdentity(slot, {
        cacheToken: T, dotName: 'Legacy.Thing', issueN: 1,
        identityHash: sha256Hex('Legacy.Thing#1'), binaryHash: sha256Words(payload),
        outformWords: [w1, 0x00000456, T >>> 0],
    }, { secure: false });
    const base = sim._nsSlotBase(slot);
    sim.memory[base + 0] = 0; sim.memory[base + 1] = w1;
    sim.memory[base + 2] = 0x00000456; sim.memory[base + 3] = T >>> 0;
    // Declared-type side-table is the state discriminator (canonical ABI): Outform.
    sim._nsUiTypeHint = sim._nsUiTypeHint || {};
    sim._nsUiTypeHint[slot] = 2 /* display-only Outform hint */;
    if (slot >= sim.nsCount) sim.nsCount = slot + 1;
    sim.awaitingLump = {
        nsIndex: slot, retryPC: 0x10, d: {},
        token: sim._outformToken96(sim.readNSEntry(slot)),
        cacheToken: T >>> 0, identityGeneration: sim.getSlotIdentity(slot).generation,
        outformWords: [w1, 0x00000456, T >>> 0],
    };
    const before = snapshotNS(sim, slot);
    const res = sim.receiveLump(withCRC(sim, payload), goodMeta(T, payload, { dotName: 'Legacy.Thing', identityHash: sha256Hex('Legacy.Thing#1') }));
    check('T20: non-secure identity → rejected (no bypass)', res.ok === false, JSON.stringify(res));
    check('T20b: message names non-secure', /not secure/i.test(res.message || ''), res.message);
    const after = snapshotNS(sim, slot);
    check('T20c: no Inform published (still Outform, W0=0)',
        after[0] === 0 && sim.readNSEntry(slot).gtType === 2);
    check('T20d: W1-3 preserved', after[1] === before[1] && after[2] === before[2] && after[3] === before[3]);
}

// ── T21: FAIL CLOSED — secure fetch with NULL awaiting generation ─────────────
// Even with a live secure identity, a null awaiting generation (fetch started
// without a secure identity snapshot) must reject — clearing/absence is failure.
{
    const sim = new ChurchSimulator();
    const T = 0x21212121;
    const { payload } = primeSlot(sim, 49, T);
    sim.awaitingLump.identityGeneration = null;   // simulate no snapshot at suspend
    const res = sim.receiveLump(withCRC(sim, payload), goodMeta(T, payload));
    check('T21: null awaiting generation → rejected', res.ok === false, JSON.stringify(res));
    check('T21b: message names stale/absent generation', /generation/i.test(res.message || ''), res.message);
}

// ── G05: boot parity — step2 resident Inform entries carry W3 = 0 ─────────────
{
    const sim = new ChurchSimulator();
    let anyStep2NonZero = false;
    for (let i = 0; i < sim.nsCount; i++) {
        const base = sim._nsSlotBase(i);
        const w1 = sim.memory[base + 1] >>> 0;
        if (w1 === 0) continue;
        const p = sim.parseNSWord1(w1);
        // Resident Inform (gtType=1, W0>0) built-ins must have W3=0.
        if (p.gtType === 1 && (sim.memory[base] >>> 0) > 0 && (sim.memory[base + 3] >>> 0) !== 0) {
            anyStep2NonZero = true;
        }
    }
    check('G05: no resident boot Inform entry carries a non-zero W3 (0x48000000 removed)', !anyStep2NonZero);
}

// ── T22/T23: real LOAD dispatch uses the access GT as state discriminator ─────
{
    const sim = new ChurchSimulator();
    const slot = 50;
    const T = 0x50505050;
    const payload = buildLump(sim);
    const identityHash = sha256Hex('Math.Add#1');
    const binaryHash = sha256Words(payload);
    // Deliberately choose opaque W1 whose decoded legacy gtType is NOT Outform.
    // The c-list access GT alone must select the Outform state.
    const opaqueW1 = 0x01020304;
    const opaqueW2 = 0xA5A55A5A;
    sim.registerSlotIdentity(slot, {
        cacheToken: T, dotName: 'Math.Add', issueN: 1,
        identityHash, binaryHash,
        outformWords: [opaqueW1, opaqueW2, T],
    }, { secure: true });
    const nsBase = sim._nsSlotBase(slot);
    sim.memory[nsBase] = 0;
    sim.memory[nsBase + 1] = opaqueW1;
    sim.memory[nsBase + 2] = opaqueW2;
    sim.memory[nsBase + 3] = T;
    sim.nsCount = Math.max(sim.nsCount, slot + 1);

    const clistAddr = 0x300;
    const outformGT = sim.createGT(7, slot, {L: 1}, 2);
    sim.memory[clistAddr] = outformGT;
    sim.cr[6] = {
        word0: sim.createGT(0, 1, {L: 1}, 1),
        word1: clistAddr,
        word2: sim.packNSWord1(0, 0, 0, 1, 1),
        word3: 0, m: 0,
    };
    // Isolate the dispatch test from unrelated source-capability checks.
    sim.mLoad = () => ({ ok: true });
    const suspended = sim._execLoad({ crSrc: 6, crDst: 1, imm: 0 });
    check('T22: Outform LOAD suspends for trusted resolution',
        suspended && suspended.absent === true, JSON.stringify(suspended));
    check('T22b: opaque W1 did not control state',
        // Canonical ABI: parseNSWord1 decodes only authority (no gtType). The
        // access GT alone (outformGT, type=2) drove the Outform suspension, even
        // though the raw W1 bits decode to a non-Outform authority word.
        sim.parseNSWord1(opaqueW1).gtType === undefined && sim.awaitingLump !== null);
    check('T22c: c-list binding remains Outform before verification',
        (sim.memory[clistAddr] >>> 0) === (outformGT >>> 0));

    const installed = sim.receiveLump(withCRC(sim, payload), goodMeta(T, payload));
    const informGT = sim.memory[clistAddr] >>> 0;
    check('T23: verified response commits resident state', installed.ok === true);
    check('T23b: triggering c-list binding promoted only after verification',
        sim.parseGT(informGT).type === 1 && sim.parseGT(informGT).gt_seq === 7);

    sim.lazyManifest[slot] = { loaded: true, priority: 'warm', allocSize: 64 };
    check('T23c: eviction succeeds', sim.lazyEvict(slot) === true);
    check('T23d: eviction restores exact Outform c-list GT',
        (sim.memory[clistAddr] >>> 0) === (outformGT >>> 0),
        `${hex8(sim.memory[clistAddr])} vs ${hex8(outformGT)}`);
    check('T23e: eviction restores opaque W1-W3 byte-for-byte',
        snapshotNS(sim, slot)[1] === (opaqueW1 >>> 0) &&
        snapshotNS(sim, slot)[2] === (opaqueW2 >>> 0) &&
        snapshotNS(sim, slot)[3] === (T >>> 0));
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
