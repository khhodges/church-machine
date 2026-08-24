#!/usr/bin/env node
// scripts/gen-api-reference.js
//
// Reads simulator/api-data.js and writes docs/api-reference.md.
// api-data.js is the single source of truth; this script keeps the
// markdown in sync whenever abstractions or methods change.
//
// Usage:
//   node scripts/gen-api-reference.js          # regenerate — write file
//   node scripts/gen-api-reference.js --check  # CI guard — exit 1 if stale
//
// The --check flag is designed for use in CI / pre-commit hooks.  It makes
// no writes; it only compares and exits non-zero when the file would change.

'use strict';

const fs   = require('fs');
const path = require('path');

const CHECK_MODE = process.argv.includes('--check');
const ROOT       = path.resolve(__dirname, '..');
const OUT_FILE   = path.join(ROOT, 'docs', 'api-reference.md');

const { API_DATA, API_LAYER_NAMES } =
    require(path.join(ROOT, 'simulator', 'api-data.js'));

// ── helpers ───────────────────────────────────────────────────────────────────

function displayName(name) {
    return (name.startsWith('(') && name.endsWith(')')) ? `*${name}*` : name;
}

function implLabel(abs) {
    if (abs.implemented === 'partial') return ' *(partial)*';
    if (abs.implemented === false)     return ' *(planned)*';
    return '';
}

function profileSuffix(abs) {
    if (!abs.profile || abs.profile === 'Full' || abs.profile === 'IoT') return '';
    return ` *(${abs.profile} only)*`;
}

function locationLabel(abs) {
    return abs.location || `NS[${abs.slot}]`;
}

function methodStatusIcon(m) {
    return m.implemented ? '✅' : '⏳ planned';
}

function needsStatusCol(abs) {
    return abs.implemented === 'partial' ||
           abs.methods.some(m => !m.implemented);
}

function methodTable(abs) {
    if (needsStatusCol(abs)) {
        const rows = abs.methods.map(m =>
            `| ${m.name} | \`${m.signature}\` | ${m.perms} | ${methodStatusIcon(m)} | ${m.description} |`
        );
        return [
            '| Method | Signature | Perms | Status | Description |',
            '|--------|-----------|-------|--------|-------------|',
            ...rows
        ].join('\n');
    }
    const rows = abs.methods.map(m =>
        `| ${m.name} | \`${m.signature}\` | ${m.perms} | ${m.description} |`
    );
    return [
        '| Method | Signature | Perms | Description |',
        '|--------|-----------|-------|-------------|',
        ...rows
    ].join('\n');
}

function mathMethodTable(abs) {
    const rows = abs.methods.map(m =>
        `| ${m.name} | \`${m.signature}\` | ${m.description} |`
    );
    return [
        '| Method | Signature | Description |',
        '|--------|-----------|-------------|',
        ...rows
    ].join('\n');
}

function slideruleTable(abs) {
    const rows = abs.methods.map((m, i) => {
        const idx = i >= 15 ? `${i}†` : String(i);
        return `| ${idx} | ${m.name} | \`${m.signature}\` | ${m.description} |`;
    });
    return [
        '| # | Method | Signature | Description |',
        '|---|--------|-----------|-------------|',
        ...rows,
        '',
        '† Methods 15–21 require DR3 = method index before CALL (escape convention for c-lists with > 15 entries).'
    ].join('\n');
}

function lambdaTable(abstractions) {
    const rows = abstractions.map(abs => {
        const colonIdx = abs.description.indexOf(':');
        const type   = colonIdx !== -1 ? abs.description.slice(0, colonIdx).trim()  : abs.description;
        const lambda = colonIdx !== -1 ? abs.description.slice(colonIdx + 1).trim() : '';
        const method = abs.methods.length === 0
            ? '*(value, not callable)*'
            : `\`${abs.methods[0].signature}\``;
        return `| ${abs.slot} | ${abs.name} | ${type} | ${abs.perms} | ${lambda} | ${method} |`;
    });
    return [
        '| Slot | Name | Type | Perms | Lambda | Method |',
        '|------|------|------|-------|--------|--------|',
        ...rows
    ].join('\n');
}

function compactSlots(slots) {
    if (slots.length === 0) return '';
    const sorted = [...slots].sort((a, b) => a - b);
    const groups = [];
    let start = sorted[0];
    let end   = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === end + 1) {
            end = sorted[i];
        } else {
            groups.push(start === end ? `${start}` : `${start}–${end}`);
            start = end = sorted[i];
        }
    }
    groups.push(start === end ? `${start}` : `${start}–${end}`);
    return groups.join(', ');
}

// ── group & sort ──────────────────────────────────────────────────────────────

const byLayer = {};
for (const abs of API_DATA) {
    if (!byLayer[abs.layer]) byLayer[abs.layer] = [];
    byLayer[abs.layer].push(abs);
}
for (const arr of Object.values(byLayer)) {
    arr.sort((a, b) => a.slot - b.slot);
}

// ── generation ────────────────────────────────────────────────────────────────

const out = [];

function L(s = '') { out.push(s); }
function sep()     { L(); L('---'); L(); }

// ── Header ────────────────────────────────────────────────────────────────────

L('# Church Machine Abstraction API Quick-Reference');
L();
L('> **Fast-lookup version.** For rationale, lump structure, and architectural narrative see [`docs/abstractions.md`](abstractions.md).');
L();
L('This document lists every namespace slot, its required permission, and a compact method table for each abstraction. One section per layer. Planned abstractions appear under a **Planned** subsection at the end of each layer.');
L();
L('Permission legend: **E** = Enter (CALL), **L** = Load (read device), **S** = Save (write device), **X** = LAMBDA (execute as closure), **—** = not callable.');
L();
L('---');
L();

// ── Layer 0 — Boot ────────────────────────────────────────────────────────────

{
    const layer = byLayer[0] || [];
    L('## Layer 0 — Boot');
    L();
    L('Hardware-initialized at reset. Not callable by programs.');
    L();
    L('| Slot | Name | Perms | Description |');
    L('|------|------|-------|-------------|');
    for (const abs of layer) {
        L(`| ${abs.slot} | ${displayName(abs.name)} | ${abs.perms} | ${abs.description} |`);
    }
    L();
    for (const abs of layer) {
        if (abs.methods.length === 0) continue;
        L(`### ${displayName(abs.name)} — ${locationLabel(abs)}`);
        L();
        L(methodTable(abs));
        L();
    }
    L('---');
    L();
}

// ── Layer 1 — System Services ─────────────────────────────────────────────────

{
    const layer = byLayer[1] || [];
    L('## Layer 1 — System Services');
    L();
    L('Shared, atomic system abstractions. All callable via E permission.');
    L();

    const live    = layer.filter(a => a.implemented !== false);
    const planned = layer.filter(a => a.implemented === false);

    for (const abs of live) {
        L(`### ${abs.name} — ${locationLabel(abs)} \`${abs.perms}\`${implLabel(abs)}`);
        L();
        L(abs.description);
        L();
        if (abs.methods.length > 0) {
            L(methodTable(abs));
            L();
        }
    }

    if (planned.length > 0) {
        L('### Planned (not yet implemented)');
        L();
        L('| Slot | Name | Perms | Methods |');
        L('|------|------|-------|---------|');
        for (const abs of planned) {
            L(`| ${abs.slot} | ${abs.name} | ${abs.perms} | ${abs.methods.map(m => m.name).join(', ')} |`);
        }
        L();
    }

    L('---');
    L();
}

// ── Layer 2 — Hardware Attachments ────────────────────────────────────────────

{
    const layer = byLayer[2] || [];
    L('## Layer 2 — Hardware Attachments');
    L();
    L('Device drivers accessed via Abstract GTs. L = read device, S = write device, E = call abstraction.');
    L();

    const live    = layer.filter(a => a.implemented !== false);
    const planned = layer.filter(a => a.implemented === false);

    if (planned.length > 0) {
        const plannedNames = planned.map(a => a.name).join(', ');
        L(`> **Note:** ${plannedNames} are **planned** — Abstract GT hardware validation not yet implemented.`);
        const partials = live.filter(a => a.implemented === 'partial');
        if (partials.length > 0) {
            const names = partials.map(a => a.name).join(', ');
            L(`> **${names}** ${partials.length === 1 ? 'is' : 'are'} **partially** implemented in the simulator.`);
        }
        L();
    }

    for (const abs of live) {
        L(`### ${abs.name} — ${locationLabel(abs)} \`${abs.perms}\`${implLabel(abs)}${profileSuffix(abs)}`);
        L();
        L(abs.description);
        L();
        if (abs.methods.length > 0) {
            L(methodTable(abs));
            L();
        }
    }

    if (planned.length > 0) {
        L('### Planned (not yet implemented)');
        L();
        L('| Slot | Name | Perms | Methods |');
        L('|------|------|-------|---------|');
        for (const abs of planned) {
            L(`| ${abs.slot} | ${abs.name} | ${abs.perms} | ${abs.methods.map(m => m.name).join(', ')} |`);
        }
        L();
    }

    L('---');
    L();
}

// ── Layer 3 — Mathematics ─────────────────────────────────────────────────────

{
    const layer = byLayer[3] || [];
    L('## Layer 3 — Mathematics');
    L();

    const live    = layer.filter(a => a.implemented !== false);
    const planned = layer.filter(a => a.implemented === false);

    for (const abs of live) {
        L(`### ${abs.name} — ${locationLabel(abs)} \`${abs.perms}\`${implLabel(abs)}`);
        L();
        L(abs.description);
        L();
        if (abs.methods.length > 0) {
            if (abs.name === 'SlideRule') {
                L(slideruleTable(abs));
            } else {
                L(mathMethodTable(abs));
            }
            L();
        }
    }

    if (planned.length > 0) {
        L('### Planned (not yet implemented)');
        L();
        L('| Slot | Name | Perms | Methods |');
        L('|------|------|-------|---------|');
        for (const abs of planned) {
            L(`| ${abs.slot} | ${abs.name} | ${abs.perms} | ${abs.methods.map(m => m.name).join(', ')} |`);
        }
        L();
    }

    L('---');
    L();
}

// ── Layer 4 — Lambda Calculus ─────────────────────────────────────────────────

{
    const layer = byLayer[4] || [];
    L('## Layer 4 — Lambda Calculus');
    L();
    L('Church numerals and booleans as DATA-domain code objects. Each is a pure function. Numeric combinators use `X` permission; boolean values use `L` permission.');
    L();
    L(lambdaTable(layer));
    L();
    L('---');
    L();
}

// ── Layers 5, 6, 7 — All Planned ──────────────────────────────────────────────

const PLANNED_LAYER_NOTES = {
    5: '**Status: Planned** — Tunnel (Outform+Far) prerequisite not yet complete.',
    6: '**Status: Planned** — Hardware debugger integration and UART wire protocol pending.',
    7: '**Status: Planned** — Home Base Tunnel + service catalog API required.'
};

const LAYER_7_EXTRA = `
The c-list IS the parental approval. Parent holds S permission on the child's internet c-list rows and SAVEs GTs for approved resources. Child holds L permission — they can LOAD whatever GTs the parent has placed, but cannot add new ones.
`.trim();

for (const layerNum of [5, 6, 7]) {
    const layer = byLayer[layerNum] || [];
    L(`## Layer ${layerNum} — ${API_LAYER_NAMES[layerNum]}`);
    L();
    if (PLANNED_LAYER_NOTES[layerNum]) {
        L(`> ${PLANNED_LAYER_NOTES[layerNum]}`);
        L();
    }
    if (layerNum === 7) {
        L(LAYER_7_EXTRA);
        L();
    }
    L('| Slot | Name | Perms | Methods |');
    L('|------|------|-------|---------|');
    for (const abs of layer) {
        L(`| ${abs.slot} | ${abs.name} | ${abs.perms} | ${abs.methods.map(m => m.name).join(', ')} |`);
    }
    L();
    L('---');
    L();
}

// ── Layer 8 — Garbage Collection ──────────────────────────────────────────────

{
    const layer = byLayer[8] || [];
    L('## Layer 8 — Garbage Collection');
    L();

    const live    = layer.filter(a => a.implemented !== false);
    const planned = layer.filter(a => a.implemented === false);

    for (const abs of live) {
        L(`### ${abs.name} — ${locationLabel(abs)} \`${abs.perms}\`${implLabel(abs)}`);
        L();
        L(abs.description);
        L();
        if (abs.methods.length > 0) {
            L(methodTable(abs));
            L();
        }
    }

    if (planned.length > 0) {
        L('### Planned (not yet implemented)');
        L();
        L('| Slot | Name | Perms | Methods |');
        L('|------|------|-------|---------|');
        for (const abs of planned) {
            L(`| ${abs.slot} | ${abs.name} | ${abs.perms} | ${abs.methods.map(m => m.name).join(', ')} |`);
        }
        L();
    }

    L('---');
    L();
}

// ── Internal / Reserved (Layer 9) ─────────────────────────────────────────────

{
    const layer = byLayer[9] || [];
    L('## Internal / Reserved');
    L();
    L('| Slot | Name | Description |');
    L('|------|------|-------------|');
    for (const abs of layer) {
        L(`| ${abs.slot} | ${abs.name} | ${abs.description} |`);
    }
    L();
    L('---');
    L();
}

// ── Slot Map Summary ──────────────────────────────────────────────────────────

L('## Slot Map Summary');
L();
L('| Slots | Layer | Count | Status |');
L('|-------|-------|-------|--------|');

const layerOrder = Object.keys(byLayer).map(Number).sort((a, b) => a - b);
for (const layerNum of layerOrder) {
    if (layerNum === 9) continue;
    const layer = byLayer[layerNum];
    const slots = layer.filter(a => Number.isInteger(a.slot)).map(a => a.slot);
    const dynamic = layer.filter(a => !Number.isInteger(a.slot));
    const staticSlotStr = slots.length ? compactSlots(slots) : '';
    const dynamicStr = dynamic.map(a => a.location || `${a.name} (dynamic)`).join(', ');
    const slotStr = [staticSlotStr, dynamicStr].filter(Boolean).join('; ');
    const layerName = API_LAYER_NAMES[layerNum];
    const count = layer.length;

    const allImpl = layer.every(a => a.implemented === true);
    const allPlan = layer.every(a => a.implemented === false);
    let status;
    if (allPlan)      status = '🔴 Planned';
    else if (allImpl) status = '✅ Complete';
    else              status = '🟡 Partial';

    L(`| ${slotStr} | ${layerName} | ${count} | ${status} |`);
}

const int9 = byLayer[9] || [];
if (int9.length > 0) {
    L(`| ${int9.map(a => a.slot).join(', ')} | Internal | ${int9.length} | ✅ (simulator-only) |`);
}

L();
L('---');
L();
L('*Generated from `simulator/api-data.js` — that file is the single source of truth for both this document and the IDE Reference panel.*');

// ── write or check ────────────────────────────────────────────────────────────

const generated = out.join('\n') + '\n';
const existing  = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null;

if (CHECK_MODE) {
    if (existing === generated) {
        console.log('gen-api-reference (check mode): docs/api-reference.md is up to date.');
        process.exit(0);
    } else {
        console.error('gen-api-reference (check mode): docs/api-reference.md is STALE.');
        console.error('');

        // Print a short unified diff to show exactly what changed.
        try {
            const os  = require('os');
            const tmp = path.join(os.tmpdir(), 'api-reference-expected.md');
            fs.writeFileSync(tmp, generated, 'utf8');
            const { execSync } = require('child_process');
            const diffOut = execSync(
                `diff -u "${OUT_FILE}" "${tmp}" || true`,
                { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
            );
            if (diffOut) {
                // Limit output to first 60 lines so CI logs stay readable.
                const diffLines = diffOut.split('\n');
                const shown = diffLines.slice(0, 60).join('\n');
                console.error(shown);
                if (diffLines.length > 60) {
                    console.error(`... (${diffLines.length - 60} more lines)`);
                }
            }
            fs.unlinkSync(tmp);
        } catch (_) {
            // diff not available — skip diff output
        }

        console.error('');
        console.error('Run  node scripts/gen-api-reference.js  to regenerate it.');
        process.exit(1);
    }
} else {
    if (existing === generated) {
        console.log('gen-api-reference: docs/api-reference.md is already up to date.');
    } else {
        fs.writeFileSync(OUT_FILE, generated, 'utf8');
        console.log('gen-api-reference: docs/api-reference.md written.');
    }
}
