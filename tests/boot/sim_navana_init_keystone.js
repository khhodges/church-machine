// Harness used by test_keystone_ns32.py::test_keystone_slot0_wiring_survives_boot_image_round_trip.
//
// Reads a JSON envelope from stdin:
//   { "imageBase64": "<base64-encoded 32-bit LE boot image>", "config": {...} }
//
// Performs the full boot-image round-trip for Keystone c-list slot 0 wiring:
//
//   1. Instantiates ChurchSimulator with a real AbstractionRegistry and
//      SystemAbstractions — the same stack the browser IDE uses.
//   2. Loads the boot image via loadBootImage().
//   3. Drives _bootStep() until bootComplete (mirrors how the IDE boots).
//   4. Calls sim.abstractionRegistry.dispatchMethod(5, 'Init', sim, {})
//      — i.e. Navana.Init — which internally calls Keystone.Init (NS[32]) to
//      wire the Tunnel E-GT into Keystone c-list slot 0.
//   5. Reads sim.memory at the Keystone c-list slot 0 address by calling
//      sim.readNSEntry(32) and sim.parseLumpHeader() (same path as the
//      production code).
//   6. Emits a single JSON line on stdout:
//        { ok, slot0, tunnelNS, eBitSet, bootComplete, faultCount, message }
//
// Failure here means slot 0 wiring that works in isolation (tested by
// test_keystone_init_wires_tunnel_gt_into_clist_slot0) breaks when combined
// with the full NS table layout produced by generate_boot_image().

'use strict';

const KEYSTONE_NS = 23;
const TUNNEL_NS   = 22;

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
    let env;
    try {
        env = JSON.parse(raw);
    } catch (e) {
        process.stdout.write(JSON.stringify({ ok: false, message: `stdin parse error: ${e.message}` }) + '\n');
        process.exit(1);
    }

    const cfg    = env.config  || {};
    const imgBuf = Buffer.from(env.imageBase64 || '', 'base64');

    global.window = { bootConfig: cfg };

    const AbstractionRegistry = require('../../simulator/abstractions.js');
    const SystemAbstractions  = require('../../simulator/system_abstractions.js');
    const ChurchSimulator     = require('../../simulator/simulator.js');

    const registry = new AbstractionRegistry();
    new SystemAbstractions(registry);

    const sim = new ChurchSimulator();
    sim.initAbstractions(registry, null, null);

    sim.memory.fill(0);
    const ab = imgBuf.buffer.slice(imgBuf.byteOffset, imgBuf.byteOffset + imgBuf.byteLength);
    const loaded = sim.loadBootImage(ab);

    const MAX_BOOT_STEPS = 64;
    let iters = 0;
    while (iters < MAX_BOOT_STEPS && !sim.bootComplete && !sim.halted) {
        const advanced = sim._bootStep();
        iters++;
        if (!advanced) break;
    }

    const bootComplete = sim.bootComplete === true;
    const faultCount   = (sim.faultLog || []).length;

    const navanaResult = sim.abstractionRegistry.dispatchMethod(5, 'Init', sim, {});

    const entry = sim.readNSEntry(KEYSTONE_NS);
    if (!entry) {
        process.stdout.write(JSON.stringify({
            ok: false,
            message: `readNSEntry(${KEYSTONE_NS}) returned null — Keystone not in NS table`
        }) + '\n');
        process.exit(1);
    }

    const hdr       = sim.parseLumpHeader(sim.memory[entry.word0_location]);
    const clistBase = entry.word0_location + hdr.lumpSize - hdr.cc;
    const slot0     = sim.memory[clistBase + 0] >>> 0;

    const tunnelNS = slot0 & 0xFFFF;
    const eBitSet  = ((slot0 >>> 30) & 1) === 1;
    const ok       = slot0 !== 0 && tunnelNS === TUNNEL_NS && eBitSet;

    process.stdout.write(JSON.stringify({
        ok,
        slot0:       slot0,
        slot0Hex:    `0x${slot0.toString(16).toUpperCase().padStart(8, '0')}`,
        tunnelNS,
        eBitSet,
        clistBase,
        lumpSize:    hdr.lumpSize,
        cc:          hdr.cc,
        bootComplete,
        faultCount,
        loaded:      loaded === true,
        navanaOk:    !!(navanaResult && navanaResult.ok),
        message:     ok
            ? `slot 0 = 0x${slot0.toString(16).toUpperCase().padStart(8, '0')} — Tunnel E-GT (NS[${TUNNEL_NS}]) wired correctly`
            : `slot 0 = 0x${slot0.toString(16).toUpperCase().padStart(8, '0')} — expected Tunnel GT (ns=${TUNNEL_NS}, E=1), got ns=${tunnelNS}, E=${eBitSet}`
    }) + '\n');
    process.exit(ok ? 0 : 1);
});
