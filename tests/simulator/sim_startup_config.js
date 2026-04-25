// Headless harness used by tests/test_startup_config.py.
//
// Exercises all 8 Startup.Config methods via the AbstractionRegistry and
// SystemAbstractions, using a real ChurchSimulator instance so the NS table
// is fully initialised (slot 2 = Startup.Config lump at 0x0140).
//
// Prints a single JSON object to stdout with keys:
//   GetEntry         { result }
//   SetEntry_slot16  { result }
//   GetEntry_after   { result }
//   SetEntry_slot2   { result }   (must reject — recursive)
//   SetEntry_slot3   { result }   (must reject — recursive)
//   ReadParam_key0   { result }   (entry_slot after SetEntry_slot16)
//   ReadParam_key1   { result }   (config_version)
//   ReadParam_oob    { result }   (key 64 → 0xFFFFFFFF)
//   WriteParam_ok    { result }
//   WriteParam_ro    { result }   (key 1 → READ_ONLY)
//   WriteParam_oob   { result }   (key 64 → KEY_OOB)
//   Validate         { result }
//   Version          { result }
//   Reset_entry      { result }   (entry_slot after Reset)
//   Execute_ok       { ok, message }
//   Execute_fault    { ok, fault }  (BAD_FLAGS pre-check)
//   nsLabel2         string label of NS slot 2
//   nsCount          number
//   clist4IsSlot2    bool  — Boot.Abstr c-list[4] points to NS slot 2

global.window = {
    bootConfig: {
        step1: {
            totalNamespaceWords: 16384,
            namespaceLumpWords:     64,
            threadLumpWords:       256,
        }
    }
};

const ChurchSimulator    = require('../../simulator/simulator.js');
const AbstractionRegistry = require('../../simulator/abstractions.js');
const SystemAbstractions  = require('../../simulator/system_abstractions.js');
const {
    SC_LAST_DATA_KEY,
    SC_OOB_KEY,
    SC_FLAGS_WORD,
    SC_FAULT_COUNT_WORD,
} = require('../../simulator/startup_config_layout.js');

const sim      = new ChurchSimulator();
const registry = new AbstractionRegistry();
const sys      = new SystemAbstractions(registry);
sim.initAbstractions(registry, sys, null);

function call(method, args) {
    return registry.dispatchMethod(2, method, sim, args || {});
}

const out = {};

// GetEntry — default should be 4
const ge = call('GetEntry');
out.GetEntry = { result: ge.result };

// SetEntry(16) — should succeed
const se16 = call('SetEntry', { dr1: 16 });
out.SetEntry_slot16 = { result: se16.result };

// GetEntry after SetEntry(16) — should return 16
const ge2 = call('GetEntry');
out.GetEntry_after = { result: ge2.result };

// SetEntry(2) — must reject RECURSIVE_SLOT (code 3)
const se2 = call('SetEntry', { dr1: 2 });
out.SetEntry_slot2 = { result: se2.result };

// SetEntry(3) — must reject RECURSIVE_SLOT (code 3)
const se3 = call('SetEntry', { dr1: 3 });
out.SetEntry_slot3 = { result: se3.result };

// Reset back to defaults before further tests
call('Reset');

// ReadParam(0) — entry_slot = 4 (default after Reset)
const rp0 = call('ReadParam', { dr1: 0 });
out.ReadParam_key0 = { result: rp0.result };

// ReadParam(1) — config_version = 0x00000001
const rp1 = call('ReadParam', { dr1: 1 });
out.ReadParam_key1 = { result: rp1.result };

// ReadParam(SC_LAST_DATA_KEY) — last valid key (data region: words 4-62, c-list at 63 → keys 0..SC_LAST_DATA_KEY)
const rp62 = call('ReadParam', { dr1: SC_LAST_DATA_KEY });
out.ReadParam_key62 = { result: rp62.result };

// ReadParam(SC_OOB_KEY) — first OOB key → 0xFFFFFFFF
const rpOob = call('ReadParam', { dr1: SC_OOB_KEY });
out.ReadParam_oob = { result: rpOob.result };

// ReadParam(SC_OOB_KEY + 1) — also OOB → 0xFFFFFFFF
const rpOob64 = call('ReadParam', { dr1: SC_OOB_KEY + 1 });
out.ReadParam_oob64 = { result: rpOob64.result };

// WriteParam(5, 0xABCD) — ok
const wp = call('WriteParam', { dr1: 5, dr2: 0xABCD });
out.WriteParam_ok = { result: wp.result };

// Verify round-trip: ReadParam(5) should return 0xABCD
const rp5 = call('ReadParam', { dr1: 5 });
out.ReadParam_key5 = { result: rp5.result };

// WriteParam(SC_LAST_DATA_KEY, 0x1234) — last valid writable key (data region: keys 0..SC_LAST_DATA_KEY)
const wp62 = call('WriteParam', { dr1: SC_LAST_DATA_KEY, dr2: 0x1234 });
out.WriteParam_key62 = { result: wp62.result };

// WriteParam(1, 0) — READ_ONLY (key 0..2 are protected)
const wpRo = call('WriteParam', { dr1: 1, dr2: 0 });
out.WriteParam_ro = { result: wpRo.result };

// WriteParam(SC_OOB_KEY, 0xDEAD) — KEY_OOB (data region is keys 0..SC_LAST_DATA_KEY; SC_OOB_KEY is past end)
// Record Boot.Abstr header BEFORE, attempt write, verify header unchanged.
const oobBootAbstrBase = sim.NS_TABLE_BASE + 3 * sim.NS_ENTRY_WORDS;
const oobBootAbstrLoc  = sim.memory[oobBootAbstrBase] >>> 0;
const bootAbstrHdrBefore = sim.memory[oobBootAbstrLoc] >>> 0;
const wpOob = call('WriteParam', { dr1: SC_OOB_KEY, dr2: 0xDEADBEEF });
const bootAbstrHdrAfter  = sim.memory[oobBootAbstrLoc] >>> 0;
out.WriteParam_oob = { result: wpOob.result };
out.WriteParam_oob_boot_abstr_hdr_unchanged = (bootAbstrHdrBefore === bootAbstrHdrAfter);

// WriteParam(SC_OOB_KEY + 1, 0) — also KEY_OOB
const wpOob64 = call('WriteParam', { dr1: SC_OOB_KEY + 1, dr2: 0 });
out.WriteParam_oob64 = { result: wpOob64.result };

// Validate — all four foundational slots should be non-null → 0xF
const val = call('Validate');
out.Validate = { result: val.result };

// Version — must return 0x00000001
const ver = call('Version');
out.Version = { result: ver.result };

// SetEntry(16) then Reset; entry_slot should be back to 4
call('SetEntry', { dr1: 16 });
call('Reset');
const geReset = call('GetEntry');
out.Reset_entry = { result: geReset.result };

// Execute — should pass all pre-checks with default config and return ok
const exec = call('Execute', {});
out.Execute_ok = { ok: exec.ok, message: exec.message || '' };

// Verify auditLog has a Startup.Config.Execute gate entry (the boot integration check)
const scAuditEntry = (sim.auditLog || []).find(e => e.gate === 'Startup.Config.Execute');
out.auditLog_has_startup_config = scAuditEntry !== undefined;
out.auditLog_entry_label = scAuditEntry ? (scAuditEntry.label || '') : '';
out.auditLog_entry_nsIndex = scAuditEntry ? (scAuditEntry.nsIndex | 0) : -1;
out.auditLog_entry_result  = scAuditEntry ? (scAuditEntry.result || '') : '';

// Execute with BAD_FLAGS — fault_count increments and Execute returns !ok
// We can't WriteParam(2) directly (READ_ONLY), so we patch memory directly via lumpLoc.
// Lump layout: word 0 = header, words 1-3 = code, word 4 = data[0], word 5 = data[1],
//              SC_FLAGS_WORD = data[2] (flags), SC_FAULT_COUNT_WORD = data[3] (fault_count).
const sc_loc = sim.memory[sim.NS_TABLE_BASE + 2 * sim.NS_ENTRY_WORDS] >>> 0;
const prevFaultCount = sim.memory[sc_loc + SC_FAULT_COUNT_WORD]; // data[3] = lump[SC_FAULT_COUNT_WORD]
// Corrupt flags (lump[SC_FLAGS_WORD] = data[2]) in simulator memory to trigger BAD_FLAGS
sim.memory[sc_loc + SC_FLAGS_WORD] = 0xFF; // data[2] = flags = 0xFF (non-zero → BAD_FLAGS)
const execFault = call('Execute', {});
const newFaultCount = sim.memory[sc_loc + SC_FAULT_COUNT_WORD];
out.Execute_fault_bad_flags = { ok: execFault.ok, result: execFault.result };
out.Execute_fault_count_incremented = (newFaultCount === prevFaultCount + 1);
// Restore: reset flags to 0
sim.memory[sc_loc + SC_FLAGS_WORD] = 0;

// NS label for slot 2
out.nsLabel2 = sim.nsLabels[2] || '';

// nsCount
out.nsCount = sim.nsCount | 0;

// Check Boot.Abstr c-list[4] points to NS slot 2
// Boot.Abstr lump is at NS_TABLE_BASE + 3*NS_ENTRY_WORDS → word0 = physical location
const bootAbstrLoc = sim.memory[sim.NS_TABLE_BASE + 3 * sim.NS_ENTRY_WORDS];
const bootAbstrLumpSize = 64; // BOOT_ABSTR_DEFAULT_SIZE (Task #568)
const clistStart = bootAbstrLumpSize - 18; // DEMO_CLIST_SIZE = 18
const clist4Word = sim.memory[bootAbstrLoc + clistStart + 4];
// GT index bits [8:0] = NS slot index
const gtIndex = clist4Word & 0x1FF;
out.clist4IsSlot2 = (gtIndex === 2);
out.clist4GtIndex = gtIndex;

process.stdout.write(JSON.stringify(out) + '\n');
