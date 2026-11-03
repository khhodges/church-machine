const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync('simulator/app-run.js', 'utf8');
const context = vm.createContext({});
context._WUKONG_FAULT_NAMES = {8: 'BOUNDS'};
context._WUKONG_EV_INSTR_NAME = {};
vm.runInContext(source.slice(source.indexOf('function _wukongBuildHwFaultObj('),
    source.indexOf('const _FAULT_GOLDEN_REFERENCE =')), context);
for (const nia of [null, undefined, -1]) {
    const missing = context._wukongBuildHwFaultObj({fault_code:8, nia});
    assert.equal(missing.physicalPC, null, 'absent NIA must not become address zero');
    assert.match(missing.message, /unavailable NIA/);
}
assert.equal(context._wukongBuildHwFaultObj({fault_code:8, nia:0}).physicalPC, 0);
assert.equal(context._wukongBuildHwFaultObj({fault_code:8, nia:0x3a08}).physicalPC, 0x3a08);
vm.runInContext(source.slice(source.indexOf('const _FAULT_GOLDEN_REFERENCE ='), source.indexOf('function _wukongFlagsStr(')), context);
const reference = vm.runInContext('_FAULT_GOLDEN_REFERENCE', context);
const trace = {incident_id:'fixture-incident', bridge_session:'fixture-session', nia:0x3a08, fault_code:8, bridge_trace_counter:1907};
const snapshot = { ...trace, source:'hardware', snapshot_complete:true, crc_valid:true,
    correlation_status:'correlated', cr:Array.from({length:16},()=>[0,0,0]), dr:Array(16).fill(0)};
snapshot.cr[6]=[0x4a000011,0x3bf8,1];
snapshot.cr[12]=[0x0200000c,0x3400,255];
snapshot.cr[14]=[0x42000011,0x3a04,3];
snapshot.cr[15]=[0x1a000001,0,255];
assert(context._wukongFaultSnapshotMatches(trace,snapshot));
for (const change of [{incident_id:'other'}, {bridge_session:'other'}, {nia:0x4000},
    {fault_code:9},{snapshot_complete:false},{crc_valid:false},{source:'simulator'},
    {correlation_status:'pending'}, {cr:[]}, {dr:[] }]) {
    assert(!context._wukongFaultSnapshotMatches(trace,{...snapshot,...change}));
}
const f = {type:'BOUNDS', physicalPC:trace.nia,faultCode:8,_hardwareTrace:trace,_acceptedSnapshot:snapshot};
const namedTrace = {...trace, gt_label:'@phase1 event FAULT Boot.NS / Thread.3 / ide.Mallory'};
const pending = context._wukongFaultDiagnosis({...f,_hardwareTrace:namedTrace,_acceptedSnapshot:null,_goldenReference:true});
assert(pending.context[0][1].includes('Boot.NS'));
assert(pending.context[1][1].includes('Thread.3'));
assert(pending.context[2][1].includes('ide.Mallory'));
assert.equal(pending.instruction,'Not captured by UART');
const older = {...trace, incident_id:'previous-incident',bridge_trace_counter:1906};
const latest = {...namedTrace, is_current:true,fault_valid:true};
const status = {latest_trace:latest,last_accepted_fault:snapshot};
assert.equal(context._wukongCurrentFaultReplacement(older,status),latest);
assert(!context._wukongFaultSnapshotMatches(older,snapshot));
for (const change of [{bridge_session:'other'},{nia:12},{fault_code:9},
    {bridge_trace_counter:1905}]) {
    assert.equal(context._wukongCurrentFaultReplacement({...older,...change},status),null);
}
assert.equal(context._wukongCurrentFaultReplacement(older,{...status,latest_trace:{...latest,is_current:false}}),null);
assert(!context._wukongFaultDiagnosis(f).title.includes('Mallory'));
f._goldenReference=true;
let d=context._wukongFaultDiagnosis(f);
assert(d.title.includes('only 0–1'));
assert(d.instruction.includes('0x070B0020'));
assert(d.context.some(row=>row[1].includes('Thread.3')));
assert(d.provenance.includes('NOT hardware attestation'));
assert(d.history[0].includes('not its caller'));
snapshot.dr[0]=1;
assert(!context._wukongFaultDiagnosis(f).title.includes('only 0–1'));
snapshot.dr[0]=0;
const imagePath='generated-artifacts/amoeba-retry-vendor-build/candidate-le.bin';
if(fs.existsSync(imagePath)){
    const image=fs.readFileSync(imagePath);
    assert.equal(crypto.createHash('sha256').update(image).digest('hex'),reference.image);
    assert.equal(image.readUInt32LE(reference.malloryLoad.nia),reference.malloryLoad.word);
    const binding = reference.lumps['ide.Mallory'];
    const manifest = JSON.parse(fs.readFileSync('server/lumps/manifest.json','utf8'));
    const selected = manifest.find(row=>row.token===binding.token);
    assert.equal(selected.lump_version,binding.revision);
    const binary=fs.readFileSync('server/lumps/'+selected.filename);
    assert.equal(crypto.createHash('sha256').update(binary).digest('hex'),binding.sha256);
    // Primary artifact is big-endian; bound image is little-endian. Only the
    // final two destination-localized capability rows differ.
    assert.equal(binary.length,512);
    for(let offset=0;offset<504;offset+=4)
        assert.equal(binary.readUInt32BE(offset),image.readUInt32LE(0x3a00+offset));
    assert.equal(image.readUInt32LE(0x3bf8),0x4a000011);
    assert.equal(image.readUInt32LE(0x3bfc),0x32000011);
    for(const [slot,row] of Object.entries(reference.slots)){
        assert.equal(image.readUInt32LE(Number(slot)*16)*4,row[1]);
        assert.equal(image.readUInt32LE(Number(slot)*16+4),row[2]);
    }
} else console.log('Preserved golden-image byte comparison skipped: image not distributed');
console.log('PASS hardware fault diagnosis: correlation, explicit reference, bounds, provenance');
module.exports={trace,snapshot};
