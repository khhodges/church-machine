'use strict';

// Offline compiler candidates only. No signing, catalog publication, selection,
// destination binding, approval, or activation is performed by this command.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const frame = require('../simulator/lump-content-frame');
const ROOT = path.resolve(__dirname, '..');
const ALLOWED = ['WukongCallHome', 'CapabilityTest'];
const CAPABILITY_TEST_THREADS = ['Thread.2', 'Thread.3', 'Boot.Thread'];
const CAPABILITY_TEST_CALL_APIS = ['SelfTest', 'WukongCallHome'];
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, c =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function inside(root, name) {
    const relative = path.relative(root, name);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative);
}

function readFrozen(reviewDir, review) {
    const files = {};
    for (const [name, hash] of Object.entries(review.inputs)) {
        const file = path.resolve(reviewDir, 'inputs', name);
        if (!inside(path.join(reviewDir, 'inputs'), file) ||
                fs.lstatSync(file).isSymbolicLink() ||
                !inside(fs.realpathSync(path.join(reviewDir, 'inputs')), fs.realpathSync(file))) {
            throw Error(`Unsafe frozen input: ${name}`);
        }
        const data = fs.readFileSync(file);
        if (sha(data) !== hash) throw Error(`Frozen input hash mismatch: ${name}`);
        files[name] = data;
    }
    return files;
}

function checkOutput(result, source, name) {
    if (!result.ok) throw Error(`${name}: ${result.error || 'compilation failed'}`);
    if (result.abstractionName !== name) throw Error(`${name}: compiler identity changed`);
    const raw = Buffer.from(result.lump_binary, 'base64');
    if (!Array.isArray(result.words) || raw.length !== result.words.length * 4 ||
            sha(raw) !== result.compiler_record.binary_hash ||
            sha(Buffer.from(source)) !== result.compiler_record.source_hash) {
        throw Error(`${name}: compiler output evidence mismatch`);
    }
    result.words.forEach((word, i) => {
        if (raw.readUInt32BE(i * 4) !== (word >>> 0)) {
            throw Error(`${name}: binary/word mismatch`);
        }
    });
    const cc = result.words[0] & 255;
    if (!cc || result.capabilities.length !== cc ||
            !result.capabilities[0].symbolic_self ||
            result.words.slice(-cc).some(word => word !== 0)) {
        throw Error(`${name}: expected unresolved compiler C-List including symbolic SELF`);
    }
    return raw;
}

function capabilityTestPreflight(source, hierarchy, review, frozen) {
    const blockers = [];
    const policy = require('../simulator/capability_tokens.js');
    const validHierarchy = policy.validateHierarchyConfiguration(hierarchy);
    if (!validHierarchy.ok) {
        blockers.push(`Thread permissions are not trusted: ${validHierarchy.error}`);
    } else {
        for (const name of CAPABILITY_TEST_THREADS) {
            const canonical = hierarchy.aliases &&
                Object.prototype.hasOwnProperty.call(hierarchy.aliases, name)
                ? hierarchy.aliases[name] : null;
            if (!canonical) {
                blockers.push(`Thread permission is not trusted: add the exact ${name} alias to server/ide-hierarchy.json.`);
                continue;
            }
            const decision = policy.checkLeafOwnership(
                {name, rights: [], canonical_leaf: canonical}, hierarchy);
            if (decision.error || decision.ownership !== 'local') {
                blockers.push(`Thread permission is not trusted for ${name}: ${
                    decision.error || `configured target ${canonical} is not owned by this IDE`}`);
            }
        }
    }

    const authorities = {};
    const selectedArtifacts = review && review.proposal &&
        Array.isArray(review.proposal.selectedArtifacts)
        ? review.proposal.selectedArtifacts : [];
    for (const name of CAPABILITY_TEST_CALL_APIS) {
        const matches = selectedArtifacts.filter(item => item && item.name === name);
        if (matches.length !== 1) {
            blockers.push(`CALL API is not trusted for ${name}: the frozen review must select exactly one matching artifact.`);
            continue;
        }
        const selected = matches[0];
        const raw = frozen && frozen[`lumps/${selected.filename}`];
        if (!raw || sha(raw) !== selected.sha256) {
            blockers.push(`CALL API is not trusted for ${name}: exact frozen selected binary is unavailable or mismatched.`);
            continue;
        }
        const words = Array.from({length: raw.length / 4},
            (_, i) => raw.readUInt32BE(i * 4));
        const api = frame.lumpDecodeContentFrameApi(words);
        if (!api || !Array.isArray(api.methods)) {
            blockers.push(`CALL API is not trusted for ${name}: selected binary has no valid embedded method API.`);
            continue;
        }
        const token = String(selected.token || selected.T || '');
        const revision = sha(raw);
        authorities[name] = {
            source: 'embedded-binary',
            embedded: true,
            token,
            selectedToken: token,
            revision,
            selectedRevision: revision,
            api,
        };
    }

    if (Object.keys(authorities).length === CAPABILITY_TEST_CALL_APIS.length) {
        const Compiler = require('../simulator/cloomc_compiler.js');
        const diagnostics = new Compiler()._callApiDiagnostics(source, {
            callApiAuthorities: authorities,
        });
        for (const diagnostic of [...diagnostics.warnings, ...diagnostics.errors]) {
            blockers.push(`CALL API is not trusted: ${diagnostic.message}`);
        }
    }
    return {blockers, callApiAuthorities: authorities};
}

function html(record) {
    return `<!doctype html><html lang="en"><meta charset="utf-8">
<title>Namespace resident compiler candidates</title>
<style>body{max-width:960px;margin:3rem auto;padding:0 1rem;font:16px/1.6 system-ui;color:#17202b}
table{border-collapse:collapse;width:100%}th,td{padding:.7rem;border:1px solid #ccd3db;text-align:left}
code{overflow-wrap:anywhere}.notice{padding:1rem;background:#fff1cf}h1{line-height:1.2}</style>
<h1>Namespace resident compiler candidates</h1>
<p class="notice">Unapproved, unsigned compiler outputs with unresolved C-Lists.
Not installable or executable. No current artifact or Namespace selection was changed.</p>
<p>Preparation uses the exact embedded Full source from the frozen selected
artifacts. Compiler inputs, compiler files, successful output bytes and hashes are retained.
No concrete destination GT has been inserted.</p>
<table><tr><th>Candidate</th><th>Old → new words</th><th>Code words</th><th>SHA-256</th></tr>
${record.candidates.map(c => `<tr><td>${escape(c.name)}</td>
<td>${c.previousWords} → ${c.words}</td><td>${c.previousCodeWords} → ${c.codeWords}</td>
<td><code>${escape(c.sha256)}</code></td></tr>`).join('')}</table>
<h2>Destination work still required</h2>
<p>The frozen layout review specifies the destination slots and retained
versions. These are proposed bindings, not installed authority.</p>
<p>Exact dependency identity and authorization must be validated before binding.
Compiler attestation, new-format Namespace generation and approval, and active-CR15
handoff conformance remain outstanding. SelfTest remains the original selected revision.</p>
<h2>Compiler warnings</h2>
${record.candidates.map(c => `<h3>${escape(c.name)}</h3><ul>${
    c.warnings.length ? c.warnings.map(w => `<li>${escape(w.message)}</li>`).join('') :
        '<li>None.</li>'}</ul>`).join('')}
<h2>Blocked compilations</h2>
${(record.failures || []).length ? record.failures.map(f =>
    `<h3>${escape(f.name)}</h3><pre style="white-space:pre-wrap">${escape(f.error)}</pre>
<p>No binary was produced for this LUMP. Its exact source and failed compiler
request/response are retained. No ownership policy was bypassed.</p>`).join('') : '<p>None.</p>'}
<p>Frozen layout review SHA-256: <code>${escape(record.layoutReviewSha256)}</code></p></html>`;
}

async function prepare(reviewDirectory, outputDirectory, authorized) {
    if (!Array.isArray(authorized) || !authorized.length ||
            new Set(authorized).size !== authorized.length ||
            authorized.some(name => !ALLOWED.includes(name))) {
        throw Error('Explicit, unique per-LUMP authorization is required');
    }
    const staging = fs.realpathSync(path.join(ROOT, 'generated-artifacts'));
    const reviewDir = fs.realpathSync(reviewDirectory);
    const output = path.resolve(outputDirectory);
    if (!inside(staging, reviewDir) || !inside(staging, output) ||
            path.dirname(output) !== staging) {
        throw Error('Use an existing frozen review and a new direct child of generated-artifacts');
    }
    if (fs.existsSync(output)) throw Error('Candidate directory already exists');
    const reviewRaw = fs.readFileSync(path.join(reviewDir, 'candidate.json'));
    const review = JSON.parse(reviewRaw);
    if (review.status !== 'review-only' || review.activationAllowed !== false ||
            review.proposal.format !== 'ascending-nst-metadata-slot0-v1') {
        throw Error('Unsupported or activatable review');
    }
    const frozen = readFrozen(reviewDir, review);
    // Retain local compiler sources and shared contracts, not just the worker.
    const compiler = {};
    for (const file of ['server/compile_worker.js',
        ...fs.readdirSync(path.join(ROOT, 'simulator')).filter(n => n.endsWith('.js'))
            .map(n => `simulator/${n}`),
        ...fs.readdirSync(path.join(ROOT, 'shared')).filter(n => n.endsWith('.json'))
            .map(n => `shared/${n}`), 'server/ide-hierarchy.json']) {
        compiler[file] = fs.readFileSync(path.join(ROOT, file));
    }
    const outputs = [], failures = [];
    for (const name of authorized) {
        const matches = review.proposal.selectedArtifacts.filter(a => a.name === name);
        if (matches.length !== 1) throw Error(`${name}: exact selected artifact is required`);
        const selected = matches[0], original = frozen[`lumps/${selected.filename}`];
        if (!original || sha(original) !== selected.sha256) throw Error(`${name}: selected bytes differ`);
        const words = Array.from({length: original.length / 4}, (_,i) => original.readUInt32BE(i * 4));
        const decoded = await frame.lumpInspectContentFrameSource(words);
        if (decoded.status !== 'source') throw Error(`${name}: exact embedded source unavailable`);
        const input = {source: decoded.source, language: 'english', tier: 2,
            namespace_hint: {allocation_words: words.length},
            _ide_hierarchy: JSON.parse(compiler['server/ide-hierarchy.json'])};
        if (name === 'CapabilityTest') {
            const preflight = capabilityTestPreflight(
                decoded.source, input._ide_hierarchy, review, frozen);
            if (preflight.blockers.length) {
                const error = `Blocked before compilation:\n${preflight.blockers.join('\n')}`;
                failures.push({name, input, result: {ok: false, error}, error});
                continue;
            }
            input._resolved_call_api_authorities = preflight.callApiAuthorities;
        }
        const result = JSON.parse(cp.execFileSync(process.execPath,
            [path.join(ROOT, 'server/compile_worker.js')], {
                input: JSON.stringify(input), timeout: 15000, maxBuffer: 8 * 1024 * 1024,
                cwd: ROOT,
            }));
        if (!result.ok) {
            failures.push({name, input, result, error: result.error || 'Compilation failed'});
            continue;
        }
        const raw = checkOutput(result, decoded.source, name);
        if (await frame.lumpDecodeContentFrame(result.words) !== decoded.source) {
            throw Error(`${name}: embedded source changed`);
        }
        outputs.push({name, raw, input, result, original, selected, oldWords: words});
    }
    for (const [file, bytes] of Object.entries(compiler)) {
        if (sha(fs.readFileSync(path.join(ROOT, file))) !== sha(bytes)) {
            throw Error(`Compiler input changed during preparation: ${file}`);
        }
    }
    readFrozen(reviewDir, review);
    const record = {schema: 'namespace-resident-candidates/1',
        status: failures.length ? 'partially-blocked-compiler-candidates' :
            'unsigned-unbound-compiler-candidates', approvalEligible: false,
        activationAllowed: false, authorizedNames: authorized,
        layoutReviewSha256: sha(reviewRaw), nodeVersion: process.version,
        compilerHashes: Object.fromEntries(Object.entries(compiler).map(([p,b]) => [p,sha(b)])),
        failures: failures.map(f => ({name: f.name, error: f.error})),
        candidates: outputs.map(o => ({name: o.name, sourceArtifact: o.selected,
            sha256: sha(o.raw), sourceSha256: sha(Buffer.from(o.input.source)),
            words: o.raw.length / 4, previousWords: o.original.length / 4,
            codeWords: (o.result.words[0] >>> 10) & 8191,
            previousCodeWords: (o.oldWords[0] >>> 10) & 8191,
            capabilities: o.result.capabilities, warnings: o.result.warnings,
            filename: `${o.name}/candidate.lump`}))};
    fs.mkdirSync(output);
    function write(name, data) {
        const file = path.join(output, name);
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, data, {flag: 'wx'});
    }
    write('layout-review.json', reviewRaw);
    for (const [name, raw] of Object.entries(frozen)) write(`inputs/${name}`, raw);
    for (const [name, raw] of Object.entries(compiler)) write(`compiler/${name}`, raw);
    for (const o of outputs) {
        write(`${o.name}/candidate.lump`, o.raw);
        write(`${o.name}/source.cloomc`, o.input.source);
        write(`${o.name}/compile-input.json`, JSON.stringify(o.input, null, 2));
        write(`${o.name}/compile-output.json`, JSON.stringify(o.result, null, 2));
    }
    for (const f of failures) {
        write(`${f.name}/source.cloomc`, f.input.source);
        write(`${f.name}/compile-input.json`, JSON.stringify(f.input, null, 2));
        write(`${f.name}/compile-output.json`, JSON.stringify(f.result, null, 2));
    }
    write('review.html', html(record));
    write('candidates.json', JSON.stringify(record, null, 2));
    return record;
}

if (require.main === module) {
    const [review, output, ...authorized] = process.argv.slice(2);
    if (!review || !output) {
        console.error('Usage: node scripts/prepare_namespace_resident_candidates.js REVIEW OUTPUT WukongCallHome CapabilityTest');
        process.exitCode = 1;
    } else prepare(review, output, authorized).then(record => {
        console.log(JSON.stringify({output, status: record.status,
            candidates: record.candidates.map(c => ({name: c.name, words: c.words, sha256: c.sha256})),
            failures: record.failures}, null, 2));
        if (record.failures.length) process.exitCode = 2;
    }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = {
    prepare, readFrozen, checkOutput, html, capabilityTestPreflight,
};
