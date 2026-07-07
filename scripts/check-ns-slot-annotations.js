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

if (violations.length === 0) {
    console.log('check-ns-slot-annotations: OK — all NS[\\d+] references carry an abstraction name');
    process.exit(0);
} else {
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
    process.exit(1);
}
