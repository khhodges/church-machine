#!/usr/bin/env node
'use strict';
// check-ns-slot-annotations.js — CI guard: every NS[\d+] reference in
// pseudocode snippets must be accompanied by a human-readable abstraction name.
//
// Background
// ----------
// app-absdetail.js and app-run.js embed CLOOMC pseudocode as JS string literals.
// A "bare" NS slot reference (e.g. NS[42]) with no surrounding name annotation
// is a readability violation — readers have no idea which abstraction lives at
// that slot without cross-referencing the namespace table separately.
//
// Rule
// ----
// For every line that contains NS[\d+], either the SAME line OR the
// IMMEDIATELY PRECEDING line must contain at least one PascalCase token
// (a word whose first character is uppercase and whose second character is
// lowercase, i.e. /\b[A-Z][a-z][A-Za-z.]*/). This naturally distinguishes
// human-readable abstraction names ("Salvation", "SlideRule", "DijkstraFlag",
// "Namespace", "Boot.Abstr", …) from all-caps mnemonics and acronyms
// ("LOAD", "CALL", "GT", "CR1", "DR1", "NS", …).
//
// Exemption
// ---------
// Add the marker  // ns-slot-ok  anywhere on a NS[\d+] line to suppress the
// check for that individual occurrence when a bare slot reference is genuinely
// intentional (e.g. a dynamically-resolved slot with no fixed name).
//
// Target files
// ------------
// Only simulator/app-absdetail.js and simulator/app-run.js are scanned.
// These are the files where pseudocode snippets live; other JS files are
// outside scope (slot indices there are handled by check-slot-index-leak.js).
//
// Exit: 0 if clean, 1 if violations found.

const fs   = require('fs');
const path = require('path');

const TARGET_FILES = [
    'simulator/app-absdetail.js',
    'simulator/app-run.js',
];

// Matches any NS[\d+] reference in text.
const NS_SLOT_RE = /NS\[\d+\]/;

// A PascalCase token: first char uppercase, second char lowercase, rest any.
// This distinguishes proper names from all-caps acronyms and mnemonics.
const PASCAL_RE = /\b[A-Z][a-z][A-Za-z.]*/;

// An explicit assignment annotation: NS[\d+] = something  (even if not PascalCase).
// This covers cases like "NS[50] = example dynamic slot" and "NS[26] = TRUE abstraction"
// where the slot is clearly identified even though the label is not PascalCase.
const EXPLICIT_ASSIGN_RE = /NS\[\d+\]\s*[=—–]/;

// Inline exemption marker — suppress this specific line from the check.
// Works in both JS comments (// ns-slot-ok) and assembly comments (; ns-slot-ok).
const EXEMPT_MARKER = /\bns-slot-ok\b/;

function hasAbstractionName(line) {
    return PASCAL_RE.test(line) || EXPLICIT_ASSIGN_RE.test(line);
}

function scanFile(filePath) {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
        console.error(`check-ns-slot-annotations: WARN — file not found: ${filePath}`);
        return [];
    }

    const lines      = fs.readFileSync(absPath, 'utf8').split('\n');
    const violations = [];

    lines.forEach((line, idx) => {
        if (!NS_SLOT_RE.test(line)) return;           // no NS[\d+] on this line
        if (EXEMPT_MARKER.test(line))  return;         // explicitly exempted

        const prevLine = idx > 0 ? lines[idx - 1] : '';

        if (!hasAbstractionName(line) && !hasAbstractionName(prevLine)) {
            violations.push({
                file:    filePath,
                lineNum: idx + 1,
                text:    line.trimEnd(),
            });
        }
    });

    return violations;
}

const violations = TARGET_FILES.flatMap(f => scanFile(f));

// ── Lumps Directory capability note check ─────────────────────────────────────
// Rule: any capability whose `gt` field is empty ("") must NOT have a note that
// claims a fixed "NS slot N".  Empty-gt capabilities are runtime-issued; the
// slot is only assigned when the Namespace bitstream or Lazy Loader loads the
// abstraction — it is architecturally wrong to imply the slot is pre-allocated.
//
// Pattern matched: /NS slot \d+/i anywhere in the note string.
//
// To fix a violation, replace the bare "NS slot N" text with language that
// makes the runtime-issued nature explicit, e.g.:
//   "lazy-issued — slot assigned when <Name> abstraction is loaded"
// ─────────────────────────────────────────────────────────────────────────────
const LUMP_DIR_PATH = 'docs/figures/lumps-directory.html';
const GT_NOTE_NS_SLOT_RE = /NS slot \d+/i;
const lumpDirViolations = [];

if (fs.existsSync(LUMP_DIR_PATH)) {
    // Extract all JS object literals from the file's inline script.
    // The file embeds lump data as a JS array; extract capability entries by
    // scanning for lines that look like capability objects with gt:"" and a note.
    const lumpLines = fs.readFileSync(LUMP_DIR_PATH, 'utf8').split('\n');

    // State machine: track the current lump id and scan capability objects.
    let currentLumpId = null;
    let capSlot = null;

    lumpLines.forEach((line, idx) => {
        // Detect lump id lines:  id:"SomeName"
        const idMatch = line.match(/\bid\s*:\s*"([^"]+)"/);
        if (idMatch) currentLumpId = idMatch[1];

        // Detect capability slot:  { slot:N, ...
        const slotMatch = line.match(/\bslot\s*:\s*(\d+)/);
        if (slotMatch) capSlot = parseInt(slotMatch[1], 10);

        // Check for gt:"" combined with a note that claims an NS slot number.
        const hasEmptyGt = /\bgt\s*:\s*""/.test(line);
        const noteMatch  = line.match(/\bnote\s*:\s*"([^"]*)"/);
        if (hasEmptyGt && noteMatch && GT_NOTE_NS_SLOT_RE.test(noteMatch[1])) {
            lumpDirViolations.push({
                lumpId:   currentLumpId || '<unknown>',
                slot:     capSlot,
                lineNum:  idx + 1,
                note:     noteMatch[1],
            });
        }
    });
}

if (lumpDirViolations.length > 0) {
    console.error('check-ns-slot-annotations: FAIL — capability notes claim a fixed NS slot but gt is empty (runtime-issued):');
    console.error('');
    for (const v of lumpDirViolations) {
        console.error(`  Lump "${v.lumpId}", c-list slot ${v.slot} (line ${v.lineNum}):`);
        console.error(`    note: "${v.note}"`);
    }
    console.error('');
    console.error('Fix: replace "NS slot N" with language that makes the GT runtime-issued, e.g.:');
    console.error('  "lazy-issued — slot assigned when <Name> abstraction is loaded"');
    console.error('');
}

const allViolations = violations.length + lumpDirViolations.length;

if (allViolations === 0) {
    console.log('check-ns-slot-annotations: OK — all NS[\\d+] references carry an abstraction name');
    console.log('check-ns-slot-annotations: OK — no capability notes claim a fixed NS slot for a runtime-issued GT');
    process.exit(0);
} else {
    if (violations.length > 0) {
        console.error('check-ns-slot-annotations: FAIL — bare NS slot references found (no abstraction name):');
        console.error('');
        for (const v of violations) {
            console.error(`  ${v.file}:${v.lineNum}:  ${v.text}`);
        }
        console.error('');
        console.error('Fix: annotate each bare NS[N] with the abstraction name on the same line or the');
        console.error('     line immediately before it.  Examples:');
        console.error('       ; NS[4] = Salvation       ← explicit equals annotation');
        console.error('       LOAD CR1, Navana  ; NS[5] ← PascalCase name on same line');
        console.error('       ; -- Loader (NS[19])      ← name on preceding comment');
        console.error('');
        console.error('     If the slot is genuinely dynamic (no fixed name), add the inline marker:');
        console.error('       NS[N] (caller-supplied)  // ns-slot-ok');
    }
    process.exit(1);
}
