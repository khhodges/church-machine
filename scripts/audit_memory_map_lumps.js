'use strict';
// Read-only current catalog check. Run audit_memory_map_review.py first.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file));
const evidence = JSON.parse(read('reports/memory-map-audit-evidence.json'));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const [file, hash] of Object.entries(evidence.input_sha256)) {
  if (digest(read(file)) !== hash) throw new Error(`Audit input changed: ${file}`);
}
globalThis.ThreadDesign = require('../simulator/thread_design.js');
const { lumpAudit } = require('../simulator/lump-audit.js');
const source = read('simulator/simulator.js').toString();
const start = source.indexOf('    parseLumpHeader(word) {');
const end = source.indexOf('\n    _threadLayoutAtBase', start);
if (start < 0 || end < 0) throw new Error('Cannot locate current simulator header decoder');
const decode = vm.runInNewContext('({' + source.slice(start, end) + '})').parseLumpHeader;
const results = [];
for (const item of evidence.catalog) {
  if (!item.header) continue;
  const bytes = read('server/lumps/' + item.filename);
  if (digest(bytes) !== item.sha256) throw new Error(`Artifact changed: ${item.filename}`);
  const words = Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readUInt32BE(i * 4));
  let findings;
  try {
    findings = lumpAudit(words).filter(row => row.severity !== 'pass');
  } catch (err) {
    findings = [{ severity: 'audit-error', message: err.message }];
  }
  const header = decode(words[0]);
  results.push({
    filename: item.filename,
    decoderMatches: (header.typ === 1 ? header.namespaceSize : header.lumpSize) === words.length,
    findings
  });
}
fs.writeFileSync(path.join(root, 'reports/memory-map-lump-audit.json'),
  JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({
  checked: results.length,
  decoderMismatches: results.filter(row => !row.decoderMatches).length,
  filesWithErrors: results.filter(row => row.findings.some(f => ['error', 'audit-error'].includes(f.severity))).length,
  filesWithWarnings: results.filter(row => row.findings.some(f => f.severity === 'warn')).length
}, null, 2));
