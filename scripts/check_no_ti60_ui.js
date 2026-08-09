#!/usr/bin/env node
// check_no_ti60_ui.js — Task #2506 regression guard.
//
// The QMTECH Wukong Artix-7 is the only approved hardware. This guard fails
// if any *user-visible* string served to the browser mentions the retired
// Efinix Ti60 F225 board or the Efinity toolchain.
//
// Scope: simulator/*.html, simulator/*.js (served verbatim) and server/app.py
// (server-rendered pages / JSON strings).
//
// Internal identifiers are ALLOWED and stripped before matching:
//   - ids/classes/keys/vars where "ti60" is attached to other identifier
//     chars: ti60-connect, toolbarTi60ConnectBtn, sw_step_ti60, ti60-f225,
//     isTi60, Ti60Connect, /dl/ti60-hex, BUILD_MD_TI60, ...
//   - exact protocol/data literals (UART banner match, board_type values)
//   - comments in server/app.py and the script-facing BUILD_MD_TI60 doc
//
// Anything else containing "Ti60", "Efinix" or "Efinity" fails the check.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Exact literals that are protocol / stored-data values, not UI copy.
const ALLOWED_LITERALS = [
    'CHURCH Ti60 SoC+CM',   // UART greeting the connect code must keep matching
    'Ti60F225',             // board_type data value in call-home packets
];

// Identifier-attached forms: ti60 glued to other identifier characters.
const ATTACHED_RE = /(?:[A-Za-z0-9_$#.\/-]+[tT][iI]60[A-Za-z0-9_$-]*)|(?:[tT][iI]60[A-Za-z0-9_$-]+)/g;

// Per-file extra allow patterns (regex tested against the raw line).
const FILE_ALLOW = {
    'server/app.py': [
        /^\s*#/,                      // python comments
        /is_ti60/,                    // internal flag docs
        /"label": "Efinix Ti60 F225"/,        // HARDWARE_PROFILES metadata (never rendered)
        /"notes": "Efinix Titanium Ti60 F225/, // HARDWARE_PROFILES metadata (never rendered)
        /Efinix Ti60 F225 \(legacy\)/,        // token-gated admin upload page label
        /app\.logger\./,                       // server-side log lines, never sent to the browser
        /commit_msg = f"chore: update Ti60/,  // git commit message for script pushes
        /^\s*"ti60":\s/,                       // board-code dict key
    ],
};

// In server/app.py, skip the script-facing BUILD_MD_TI60 document block.
function stripBuildMdBlock(lines) {
    const out = [];
    let inBlock = false;
    for (const line of lines) {
        if (!inBlock && /^BUILD_MD_TI60 = """/.test(line)) { inBlock = true; out.push(''); continue; }
        if (inBlock) { if (/"""\s*$/.test(line)) inBlock = false; out.push(''); continue; }
        out.push(line);
    }
    return out;
}

function scanFile(rel) {
    const abs = path.join(ROOT, rel);
    let lines = fs.readFileSync(abs, 'utf8').split('\n');
    if (rel === 'server/app.py') lines = stripBuildMdBlock(lines);
    const allow = FILE_ALLOW[rel] || [];
    const failures = [];
    lines.forEach((line, i) => {
        if (!/ti60|efinix|efinity/i.test(line)) return;
        if (allow.some(re => re.test(line))) return;
        let t = line;
        for (const lit of ALLOWED_LITERALS) t = t.split(lit).join('');
        t = t.replace(ATTACHED_RE, '');
        if (/ti60|efinix|efinity/i.test(t)) {
            failures.push({ file: rel, line: i + 1, text: line.trim().slice(0, 160) });
        }
    });
    return failures;
}

function listTargets() {
    const targets = [];
    const simDir = path.join(ROOT, 'simulator');
    for (const f of fs.readdirSync(simDir)) {
        if (/\.(html|js)$/.test(f)) targets.push('simulator/' + f);
    }
    targets.push('landing.html');
    targets.push('server/app.py');
    return targets;
}

// Retired Ti60-era artifact names that must not appear in browser-served copy.
// (server/app.py keeps script-facing legacy endpoints; only UI files are checked.)
const RETIRED_ARTIFACTS = /church_soc_cm\.(hex|xml)|church_ti60_f225|setup_ti60_peri\.py|ti60_f225_project|efinixinc\.com|\/dl\/ti60|titanium_ti60/;

function scanRetiredArtifacts(rel) {
    const abs = path.join(ROOT, rel);
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    const failures = [];
    lines.forEach((line, i) => {
        if (RETIRED_ARTIFACTS.test(line)) {
            failures.push({ file: rel, line: i + 1, text: line.trim().slice(0, 160) });
        }
    });
    return failures;
}

// Current Wukong artifacts the wizard/connect flow must keep referencing.
const REQUIRED_WUKONG_STRINGS = [
    { file: 'simulator/index.html', re: /church_wukong_xc7a100t\.bit/ },
    { file: 'simulator/index.html', re: /wukong_xc7a100t\.tcl/ },
    { file: 'simulator/index.html', re: /\/dl\/wukong-zip/ },
    { file: 'simulator/index.html', re: /\/dl\/wukong-bit/ },
];

// The current release entry in the manifest drives the Startup Wizard's
// download links at runtime — it must be a Wukong release.
function scanReleaseManifest() {
    const rel = 'server/releases/manifest.json';
    const abs = path.join(ROOT, rel);
    const failures = [];
    let d;
    try { d = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) {
        return [{ file: rel, line: 0, text: 'unreadable manifest: ' + e.message }];
    }
    const cur = (d.releases || []).find(r => r.version === d.latest) || (d.releases || [])[0];
    if (!cur) return [{ file: rel, line: 0, text: 'no current release entry' }];
    const blob = JSON.stringify(cur);
    if (/ti60|efinix|efinity/i.test(blob)) failures.push({ file: rel, line: 0, text: 'current release mentions Ti60/Efinity: ' + blob.slice(0, 140) });
    if (cur.board !== 'wukong-xc7a100t') failures.push({ file: rel, line: 0, text: 'current release board is not wukong-xc7a100t: ' + cur.board });
    if (cur.verilog_download !== '/dl/wukong-verilog') failures.push({ file: rel, line: 0, text: 'current release verilog_download is not /dl/wukong-verilog' });
    if (cur.zip_download !== '/dl/wukong-zip') failures.push({ file: rel, line: 0, text: 'current release zip_download is not /dl/wukong-zip' });
    return failures;
}

let failures = [];
failures = failures.concat(scanReleaseManifest());
for (const rel of listTargets()) {
    failures = failures.concat(scanFile(rel));
    if (rel !== 'server/app.py') failures = failures.concat(scanRetiredArtifacts(rel));
}
for (const req of REQUIRED_WUKONG_STRINGS) {
    const abs = path.join(ROOT, req.file);
    if (!req.re.test(fs.readFileSync(abs, 'utf8'))) {
        failures.push({ file: req.file, line: 0, text: `MISSING required Wukong reference: ${req.re}` });
    }
}

if (failures.length) {
    console.error(`FAIL: ${failures.length} user-visible Ti60/Efinix/Efinity reference(s) found:`);
    for (const f of failures) console.error(`  ${f.file}:${f.line}: ${f.text}`);
    console.error('\nThe Wukong Artix-7 is the only approved board. Rewrite these strings');
    console.error('or, for genuinely internal identifiers/protocol literals, extend the');
    console.error('allowlist in scripts/check_no_ti60_ui.js.');
    process.exit(1);
}
console.log('PASS: no user-visible Ti60/Efinix/Efinity references in served HTML/JS.');
