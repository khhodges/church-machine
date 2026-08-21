// test_docs_search_figures.js — regression tests for filterDocsList()
//
// Verifies that figure entries embedded inside chapter groups (docs-chapter-group)
// remain discoverable when their label text matches a search query, and are
// correctly hidden when the query does not match.
//
// Run with: node simulator/test_docs_search_figures.js
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

// ── Source extraction ─────────────────────────────────────────────────────────

function extractFunctionByName(srcPath, fnName) {
    const src   = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');
    const lines = src.split('\n');

    const startIdx = lines.findIndex(l =>
        new RegExp(`^(?:async\\s+)?function\\s+${fnName}\\s*\\(`).test(l.trimStart()));
    if (startIdx === -1) throw new Error(`Function ${fnName} not found in ${srcPath}`);

    let declStart = startIdx;
    for (let i = startIdx - 1; i >= 0; i--) {
        const t = lines[i].trim();
        if (/^(?:let|var)\s+/.test(t)) { declStart = i; }
        else if (t === '' || t.startsWith('//')) { continue; }
        else { break; }
    }

    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
        }
        if (depth === 0 && i > startIdx) break;
    }

    return lines.slice(declStart, endIdx + 1).join('\n');
}

const FILTER_SRC = extractFunctionByName('app-misc.js', 'filterDocsList');

// ── DOM factory ───────────────────────────────────────────────────────────────
//
// Builds a minimal HTML fixture that mirrors the structure renderDocsFileList()
// produces when chapters are present:
//
//   #docsFileList
//     .docs-chapter-group        ← "Getting Started" chapter
//       .docs-file-item[data-doc]  ← regular doc entry
//       .docs-file-item[data-fig]  ← figure entry embedded in chapter
//     .docs-chapter-group        ← "Advanced" chapter (only doc, no figure)
//       .docs-file-item[data-doc]
//   #docsFigureList              ← standalone figures section (may be empty)
//   .docs-figures-title

function makeCtx({ chapterFigureLabel = 'Biology of Abstractions',
                   chapterDocLabel    = 'Getting Started',
                   standaloneLabels   = [] } = {}) {

    const standaloneFigItems = standalones =>
        standalones.map(lbl =>
            `<div class="docs-file-item" data-fig="standalone.html"><span>${lbl}</span></div>`
        ).join('');

    const html = `<!DOCTYPE html><body>
        <div id="docsFileList">
            <div class="docs-chapter-group">
                <div class="docs-chapter-title">Getting Started</div>
                <div class="docs-file-item" data-doc="getting-started.md">
                    <span class="docs-chapter-num">1.1</span>
                    <span>${chapterDocLabel}</span>
                </div>
                <div class="docs-file-item" data-fig="biology-of-abstractions.html">
                    <span class="docs-chapter-num">1.2</span>
                    <span>&#x1F4CA; ${chapterFigureLabel}</span>
                </div>
            </div>
            <div class="docs-chapter-group">
                <div class="docs-chapter-title">Advanced</div>
                <div class="docs-file-item" data-doc="advanced.md">
                    <span class="docs-chapter-num">2.1</span>
                    <span>Advanced Topics</span>
                </div>
            </div>
        </div>
        <div id="docsFigureList">
            ${standaloneFigItems(standaloneLabels)}
        </div>
        <div class="docs-figures-title">Figures</div>
    </body>`;

    const dom      = new JSDOM(html);
    const document = dom.window.document;

    const sandbox = { document };

    const ctx = vm.createContext(new Proxy(sandbox, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            if (typeof prop === 'string' && prop in globalThis) return globalThis[prop];
            if (typeof prop === 'string' && /^[_a-zA-Z]/.test(prop)) return function() {};
            return undefined;
        },
        has() { return true; },
    }));

    vm.runInContext(FILTER_SRC, ctx, { filename: 'app-misc.js' });

    return { ctx, document };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isVisible(el) {
    return el.style.display !== 'none';
}

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail !== undefined ? ' — ' + detail : ''));
        failed++;
    }
}

// ── DS-1: figure inside chapter is visible when query matches its label ────────
{
    const { ctx, document } = makeCtx();
    vm.runInContext('filterDocsList("biology")', ctx);

    const figItem = document.querySelector('[data-fig="biology-of-abstractions.html"]');
    const docItem = document.querySelector('[data-doc="getting-started.md"]');
    const group   = document.querySelector('.docs-chapter-group');

    assert('DS-1: figure item is visible when query matches label',
        figItem && isVisible(figItem),
        figItem ? 'display=' + figItem.style.display : '(not found)');

    // The chapter group must stay visible because it has at least one match.
    assert('DS-1: chapter group stays visible when figure matches',
        group && isVisible(group),
        group ? 'display=' + group.style.display : '(not found)');

    // The doc item in the same group should be hidden (its label does not match).
    assert('DS-1: doc item with non-matching label is hidden',
        docItem && !isVisible(docItem),
        docItem ? 'display=' + docItem.style.display : '(not found)');
}

// ── DS-2: figure inside chapter is hidden when query does not match ────────────
{
    const { ctx, document } = makeCtx();
    vm.runInContext('filterDocsList("zzznomatch")', ctx);

    const figItem = document.querySelector('[data-fig="biology-of-abstractions.html"]');
    assert('DS-2: figure item is hidden when query does not match',
        figItem && !isVisible(figItem),
        figItem ? 'display=' + figItem.style.display : '(not found)');
}

// ── DS-3: chapter group is hidden when no items match the query ────────────────
{
    const { ctx, document } = makeCtx();
    vm.runInContext('filterDocsList("zzznomatch")', ctx);

    const groups = document.querySelectorAll('.docs-chapter-group');
    let allHidden = true;
    groups.forEach(g => { if (isVisible(g)) allHidden = false; });
    assert('DS-3: all chapter groups are hidden when no items match',
        allHidden, 'some groups still visible');
}

// ── DS-4: empty query shows all items including embedded figures ──────────────
{
    const { ctx, document } = makeCtx();
    vm.runInContext('filterDocsList("")', ctx);

    const figItem = document.querySelector('[data-fig="biology-of-abstractions.html"]');
    const docItem = document.querySelector('[data-doc="getting-started.md"]');
    const groups  = document.querySelectorAll('.docs-chapter-group');
    let allGroupsVisible = true;
    groups.forEach(g => { if (!isVisible(g)) allGroupsVisible = false; });

    assert('DS-4: figure item visible with empty query',
        figItem && isVisible(figItem),
        figItem ? 'display=' + figItem.style.display : '(not found)');
    assert('DS-4: doc item visible with empty query',
        docItem && isVisible(docItem),
        docItem ? 'display=' + docItem.style.display : '(not found)');
    assert('DS-4: all chapter groups visible with empty query',
        allGroupsVisible, 'some groups hidden');
}

// ── DS-5: query matching the doc label shows doc, hides figure ────────────────
{
    const { ctx, document } = makeCtx();
    // "getting" matches the doc label "Getting Started" but not the figure label
    vm.runInContext('filterDocsList("getting started")', ctx);

    const docItem = document.querySelector('[data-doc="getting-started.md"]');
    const figItem = document.querySelector('[data-fig="biology-of-abstractions.html"]');

    assert('DS-5: doc item visible when query matches its label',
        docItem && isVisible(docItem),
        docItem ? 'display=' + docItem.style.display : '(not found)');
    assert('DS-5: figure item hidden when query matches only the doc',
        figItem && !isVisible(figItem),
        figItem ? 'display=' + figItem.style.display : '(not found)');
}

// ── DS-6: standalone figures section shown/hidden independently ───────────────
{
    const { ctx, document } = makeCtx({ standaloneLabels: ['Standalone Figure Alpha'] });
    vm.runInContext('filterDocsList("alpha")', ctx);

    const standaloneItem = document.querySelector('#docsFigureList .docs-file-item');
    const figTitle       = document.querySelector('.docs-figures-title');
    const chapterFig     = document.querySelector('[data-fig="biology-of-abstractions.html"]');

    assert('DS-6: standalone figure visible when query matches',
        standaloneItem && isVisible(standaloneItem),
        standaloneItem ? 'display=' + standaloneItem.style.display : '(not found)');
    assert('DS-6: figures title visible when standalone figure matches',
        figTitle && isVisible(figTitle),
        figTitle ? 'display=' + figTitle.style.display : '(not found)');
    assert('DS-6: chapter-embedded figure hidden when query only matches standalone',
        chapterFig && !isVisible(chapterFig),
        chapterFig ? 'display=' + chapterFig.style.display : '(not found)');
}

// ── DS-7: null/undefined query shows everything ───────────────────────────────
{
    // filterDocsList accepts an empty/undefined query string
    const { ctx, document } = makeCtx();
    vm.runInContext('filterDocsList(null)', ctx);

    const figItem = document.querySelector('[data-fig="biology-of-abstractions.html"]');
    assert('DS-7: figure visible when query is null',
        figItem && isVisible(figItem),
        figItem ? 'display=' + figItem.style.display : '(not found)');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
