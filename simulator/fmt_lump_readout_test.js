// node simulator/fmt_lump_readout_test.js — Save LUMP dialog readout numbers + identity labels
'use strict';
const R = require('./fmt-lump-readout.js');
let fail = 0;
function eq(l, a, b) { if (a !== b) { fail++; console.log('FAIL ' + l + ': ' + a + ' !== ' + b); } else console.log('PASS ' + l); }
const mk = (fw, size, flags, sb) => ({ cw: 7, cc: 5, lumpSize: size, frame: { frameWords: new Array(fw).fill(0), flags, sourceBytesLength: sb } });
const cases = { api: [mk(104, 128, 0), 117, 128, 11], compact: [mk(144, 256, 5, 160), 157, 256, 99], full: [mk(217, 256, 7, 448), 230, 256, 26] };
for (const p in cases) {
    const [c, u, a, pad] = cases[p]; const L = R.layout(c);
    eq(p + ' used', L.usedWords, u); eq(p + ' alloc', L.allocatedWords, a); eq(p + ' bytes', L.allocatedBytes, a * 4); eq(p + ' padding', L.paddingWords, pad);
    const h = R.renderProfileStats(p, c, 'x'.repeat(1200));
    eq(p + ' html used', h.includes('data-used="' + u + '"'), true);
    eq(p + ' html padding', h.includes(pad + ' words padding'), true);
}
eq('full plaintext vs compressed', R.sourceInfo('full', cases.full[0].frame, 'x'.repeat(1200)).text, 'Embedded full source: 448 B deflate-compressed (from 1,200 B plaintext)');
eq('api linked', /not embedded.*linked revision bundle/.test(R.sourceInfo('api', cases.api[0].frame, 'abc').text), true);
const html = R.renderIdentity({ petname: 'ide', name: 'Alice', issue: 1, revision: null, token: '3bcd9520' });
eq('program', html.includes('>ide.Alice<'), true);
eq('issue', html.includes('>#1<'), true);
eq('no revision invented', html.includes('none known') && !/>v\d/.test(html), true);
eq('token in technical detail', /<details class="fmt-id-tech">[\s\S]*3bcd9520/.test(html), true);
eq('never exact full binary hash', /exact full binary hash/i.test(html), false);
eq('not full binary hash disclaimer', html.includes('Not a hash of the complete saved binary'), true);
eq('known revision', R.renderIdentity({ name: 'A', issue: 2, revision: R.knownRevision({ lump_version: 4 }) }).includes('>v4<'), true);
eq('knownRevision none', R.knownRevision({}), null);
eq('registry server revision', R.knownRevision({sources:{server:{lump_version:5}}}), 5);
eq('malformed revision rejected', R.knownRevision({lump_version:'5garbage'}), null);
console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
