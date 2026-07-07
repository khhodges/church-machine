/*
 * app-source-library.js — Source Library panel for the Abstractions view
 *
 * Displays all example scaffolds in one scrollable, searchable panel,
 * grouped by language. Each card shows the abstraction name, language badge,
 * method count, and full source in a read-only code block. A "Load" button
 * pushes the source into the editor exactly as the example tab buttons do.
 *
 * Data sources:
 *   window._cloomcExampleSources   — inline CLOOMC/Haskell/Symbolic/English/Lambda examples
 *   window._cloomcExampleLanguages — language map for all inline examples (set by app-compile.js)
 *   window._cloomcFileExamples     — url map for file-based CLOOMC examples
 *   window._cloomcFileLanguages    — lang map for file-based CLOOMC examples
 *   window._asmExampleSources      — inline Assembly examples
 *
 * These globals are populated on first call to loadCLOOMCExample() /
 * loadExample() respectively (patched in app-compile.js / app-run.js).
 *
 * Registry is built dynamically from the globals above so that adding a new
 * example to app-compile.js or app-run.js automatically makes it appear here.
 * _SL_METADATA provides display-name overrides and explicit ordering for keys
 * whose auto-generated name would be unclear or ambiguous.
 */

'use strict';

/* ── Metadata overrides ──────────────────────────────────────────────────── */
/*
 * Keyed by 'exampleKey' or 'exampleKey:lang' (the latter disambiguates when
 * the same key exists in both assembly and a CLOOMC front-end, e.g. ada_note_g).
 *
 * Supported fields:
 *   name  — display name shown in the card header (overrides auto-generated name)
 *   lang  — language group override; use when the key is absent from
 *            LANG_EXAMPLE_GROUPS (e.g. a temporary example not yet wired to a tab)
 *   order — numeric sort position within the language group (lower = earlier;
 *            defaults to insertion order from the source globals)
 *
 * Only entries that need a non-obvious name (or emergency lang override) require
 * an entry here. New examples added to app-compile.js / app-run.js appear
 * automatically without touching this map; add an entry only when the auto-
 * generated TitleCase name is ambiguous or wrong.
 */
const _SL_METADATA = {
    'recall_demo':              { name: 'Feedback' },
    'billing':                  { name: 'BudgetTracker' },
    'physical_pool':            { name: 'DMABuffer' },
    'sliderule':                { name: 'SlideRule' },
    'sliderule_haskell':        { name: 'SlideRule (Haskell)' },
    'ada_note_g:assembly':      { name: 'NoteG (Assembly)' },
    'ada_note_g:symbolic':      { name: 'NoteG (Symbolic)' },
    'ada_note_g_published_bug': { name: 'NoteG (Published Bug)' },
    'english_integer_ops':      { name: 'IntegerOps (English)' },
    'english_packed_string':    { name: 'StringOps (English)' },
    'english_contact':          { name: 'Contact (English)' },
    'english_contact_stage2':   { name: 'ContactStage2 (English)' },
    'lambda_church_numerals':   { name: 'ChurchNumerals' },
    'lambda_church_encoding':   { name: 'ChurchEncoding' },
    'lambda_fixed_point':       { name: 'FixedPoint' },
    'lambda_sliderule':         { name: 'LambdaSlideRule' },
    'lambda_rational':          { name: 'RationalArithmetic' },
};

/* Convert a snake_case key to a TitleCase display name. */
function _keyToName(key) {
    return key.split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

/*
 * Look up metadata for a given key + lang combination.
 * Checks 'key:lang' first (for disambiguation), then 'key'.
 */
function _slMeta(key, lang) {
    return _SL_METADATA[key + ':' + lang] || _SL_METADATA[key] || {};
}

/*
 * Build the registry dynamically.
 *
 * Key list sources (always available at script-load time — no prior user
 * interaction required):
 *   - LANG_EXAMPLE_GROUPS (module-level const in app-compile.js) for CLOOMC
 *     and Assembly tabs, keyed by language.
 *   - window._cloomcFileExamples for any file-based examples that have no tab.
 *   - window._cloomcExampleSources for any inline examples that have no tab.
 *
 * Source text (lazily available; populated by first loadCLOOMCExample() /
 * loadExample() call, which is triggered at page load by onLangChange()):
 *   - window._cloomcExampleSources[key]
 *   - window._asmExampleSources[key]
 *   Falls back to '' which renders as "(source not available)".
 *
 * Returns an array of { key, name, lang, loader } objects in display order.
 */
function _buildSLRegistry() {
    const cloomcSrc  = window._cloomcExampleSources   || {};
    const cloomcLang = window._cloomcExampleLanguages  || {};
    const fileEx     = window._cloomcFileExamples      || {};
    const fileLang   = window._cloomcFileLanguages     || {};

    /* LANG_EXAMPLE_GROUPS is a module-level const in app-compile.js (always
       available since that script loads before this one). */
    const legGroups = (typeof LANG_EXAMPLE_GROUPS !== 'undefined') ? LANG_EXAMPLE_GROUPS : {};

    const entries = [];
    const seenCloomc = new Set();

    /* ── CLOOMC examples from LANG_EXAMPLE_GROUPS (always populated) ──────── */
    for (const [lang, tabKeys] of Object.entries(legGroups)) {
        if (lang === 'assembly' || lang === 'personal') continue;
        for (const tabKey of tabKeys) {
            const key = tabKey.startsWith('cloomc_') ? tabKey.slice(7) : tabKey;
            if (seenCloomc.has(key)) continue;
            seenCloomc.add(key);
            const derivedLang = cloomcLang[key] || fileLang[key] || lang;
            const meta = _slMeta(key, derivedLang);
            entries.push({ key, name: meta.name || _keyToName(key), lang: meta.lang || derivedLang, loader: 'cloomc' });
        }
    }

    /* ── File-based examples not covered by any tab (future-proof) ─────────── */
    for (const key of Object.keys(fileEx)) {
        if (seenCloomc.has(key)) continue;
        seenCloomc.add(key);
        const derivedLang = fileLang[key] || cloomcLang[key] || 'javascript';
        const meta = _slMeta(key, derivedLang);
        entries.push({ key, name: meta.name || _keyToName(key), lang: meta.lang || derivedLang, loader: 'cloomc' });
    }

    /* ── Inline examples in globals but not in LANG_EXAMPLE_GROUPS ──────────
       (e.g. examples added to the sources dict before being wired to a tab) */
    const missingLang = [];
    for (const key of Object.keys(cloomcSrc)) {
        if (seenCloomc.has(key)) continue;
        seenCloomc.add(key);
        const derivedLang = cloomcLang[key];
        const meta = _slMeta(key, derivedLang || 'javascript');
        const finalLang = meta.lang || derivedLang || 'javascript';
        if (!derivedLang && !meta.lang) missingLang.push(key);
        entries.push({ key, name: meta.name || _keyToName(key), lang: finalLang, loader: 'cloomc' });
    }
    if (missingLang.length) {
        console.warn('[SourceLibrary] CLOOMC example(s) have no language classification ' +
            '(add to LANG_EXAMPLE_GROUPS in app-compile.js or set lang in _SL_METADATA):', missingLang);
    }

    /* ── Assembly examples: primary list from LANG_EXAMPLE_GROUPS ──────────── */
    const seenAsm = new Set();
    const asmTabKeys = legGroups.assembly || [];
    for (const key of asmTabKeys) {
        seenAsm.add(key);
        const meta = _slMeta(key, 'assembly');
        entries.push({ key, name: meta.name || _keyToName(key), lang: 'assembly', loader: 'assembly' });
    }

    /* ── Fallback: assembly examples in globals but absent from LANG_EXAMPLE_GROUPS
       (catches new examples added to app-run.js before a tab is wired up). */
    const asmSrc = window._asmExampleSources || {};
    const missingAsmKeys = [];
    for (const key of Object.keys(asmSrc)) {
        if (seenAsm.has(key)) continue;
        seenAsm.add(key);
        const meta = _slMeta(key, 'assembly');
        entries.push({ key, name: meta.name || _keyToName(key), lang: 'assembly', loader: 'assembly' });
        missingAsmKeys.push(key);
    }
    if (missingAsmKeys.length) {
        console.warn('[SourceLibrary] Assembly example(s) in _asmExampleSources but absent from ' +
            'LANG_EXAMPLE_GROUPS (add to LANG_EXAMPLE_GROUPS.assembly in app-compile.js for tab visibility):', missingAsmKeys);
    }

    /* Apply explicit ordering within each language group where metadata.order is set. */
    const langBuckets = {};
    for (const e of entries) {
        if (!langBuckets[e.lang]) langBuckets[e.lang] = [];
        langBuckets[e.lang].push(e);
    }
    const ordered = [];
    for (const lang of _SL_LANG_ORDER) {
        const bucket = langBuckets[lang] || [];
        bucket.sort((a, b) => {
            const oa = (_slMeta(a.key, lang).order ?? Infinity);
            const ob = (_slMeta(b.key, lang).order ?? Infinity);
            return oa - ob;
        });
        ordered.push(...bucket);
    }
    /* Any lang not in _SL_LANG_ORDER goes at the end. */
    for (const [lang, bucket] of Object.entries(langBuckets)) {
        if (!_SL_LANG_ORDER.includes(lang)) ordered.push(...bucket);
    }

    return ordered;
}

const _SL_LANG_ORDER = ['javascript', 'assembly', 'haskell', 'symbolic', 'english', 'lambda'];

const _SL_LANG_LABELS = {
    javascript: 'CLOOMC++ (JavaScript)',
    assembly:   'Assembly',
    haskell:    'Haskell',
    symbolic:   'Symbolic Math (Ada)',
    english:    'English',
    lambda:     'Lambda Calculus',
};

const _SL_LANG_BADGE_CLASS = {
    javascript: 'sl-badge-js',
    assembly:   'sl-badge-asm',
    haskell:    'sl-badge-hs',
    symbolic:   'sl-badge-sym',
    english:    'sl-badge-en',
    lambda:     'sl-badge-lc',
};

/* Cached fetched source text keyed by URL. */
const _SL_FETCH_CACHE = {};

/* Whether the panel has been rendered at least once. */
let _slRendered = false;
/*
 * Whether window._cloomcExampleSources and window._asmExampleSources were
 * both available the last time the panel was rendered. If sources become
 * available after a render-without-sources, _openSourceLibrary() triggers
 * a re-render so source text is filled in.
 */
let _slRenderedWithSources = false;

function _slSourcesAvailable() {
    return !!(window._cloomcExampleSourcesReady && window._asmExampleSourcesReady);
}

/* ── Sub-tab switching ───────────────────────────────────────────────────── */

function switchAbsSubtab(tab) {
    ['catalog', 'sources'].forEach(t => {
        const btn = document.getElementById('absSubtab-' + t);
        const panel = document.getElementById('absSubpanel-' + t);
        const active = t === tab;
        if (btn)   btn.classList.toggle('abs-subtab-active', active);
        if (panel) panel.style.display = active ? '' : 'none';
    });
    if (tab === 'sources') _openSourceLibrary();
}

/* ── Open / render ───────────────────────────────────────────────────────── */

function _openSourceLibrary() {
    const panel = document.getElementById('absSubpanel-sources');
    if (!panel) return;
    /* Re-render if: never rendered, OR sources just became available since
       last render (fills in source text that showed "(source not available)"). */
    if (_slRendered && (_slRenderedWithSources || !_slSourcesAvailable())) return;
    _renderSourceLibrary();
}

async function _renderSourceLibrary() {
    const container = document.getElementById('slContent');
    if (!container) return;

    container.innerHTML = '<div class="sl-loading">Loading sources\u2026</div>';

    /* Structural globals (_cloomcFileExamples, _cloomcExampleLanguages) are
       set at app-compile.js load time and are always available.
       Source globals (_cloomcExampleSources, _asmExampleSources) are set by
       the first loadCLOOMCExample() / loadExample() call (triggered by
       onLangChange() at page load). Warn if absent for debugging. */
    if (!window._cloomcExampleSources) {
        console.warn('[SourceLibrary] window._cloomcExampleSources not set yet ' +
            '— source text will show "(source not available)" until an example is loaded');
    }
    if (!window._asmExampleSources) {
        console.warn('[SourceLibrary] window._asmExampleSources not set yet ' +
            '— assembly source text will show "(source not available)" until an example is loaded');
    }

    /* Fetch all file-based CLOOMC examples that are not yet cached. */
    const fileExamples = window._cloomcFileExamples || {};

    const urlsNeeded = new Set();
    for (const url of Object.values(fileExamples)) {
        if (!_SL_FETCH_CACHE[url]) urlsNeeded.add(url);
    }

    if (urlsNeeded.size > 0) {
        await Promise.allSettled([...urlsNeeded].map(url =>
            fetch(url)
                .then(r => r.ok ? r.text() : Promise.reject('not found'))
                .then(t  => { _SL_FETCH_CACHE[url] = t; })
                .catch(() => { _SL_FETCH_CACHE[url] = ''; })
        ));
    }

    /* Sanity-check metadata: warn about orphan _SL_METADATA entries that
       don't match any key in the actual example globals. */
    _checkRegistryParity();

    _slRendered = true;
    _slRenderedWithSources = _slSourcesAvailable();
    _drawSourceLibrary(container);
}

function _checkRegistryParity() {
    /* Only run parity checks once sources are fully loaded; earlier renders use
       structural seeds (empty-value dicts) which would produce false positives. */
    if (!_slSourcesAvailable()) return;

    const cloomcSrc    = window._cloomcExampleSources || {};
    const asmSrc       = window._asmExampleSources    || {};
    const fileExamples = window._cloomcFileExamples   || {};

    /* All example keys known to the globals — used to spot orphan metadata entries. */
    const allKnownKeys = new Set([
        ...Object.keys(cloomcSrc),
        ...Object.keys(asmSrc),
        ...Object.keys(fileExamples),
    ]);

    /* Orphan _SL_METADATA entries: keyed by 'key' or 'key:lang'.
       Strip ':lang' suffix before checking against allKnownKeys. */
    const orphanMeta = Object.keys(_SL_METADATA).filter(mk => {
        const baseKey = mk.includes(':') ? mk.split(':')[0] : mk;
        return !allKnownKeys.has(baseKey);
    });

    if (orphanMeta.length) {
        console.warn('[SourceLibrary] _SL_METADATA entries with no matching example ' +
            '(stale override or wrong key):', orphanMeta);
    }

    /* Assembly key drift: warn if loadExample() added keys not in seed / tab groups. */
    const tabAsmKeys = new Set((window._cloomcLangExampleGroups || {}).assembly || []);
    const extraAsm = Object.keys(asmSrc).filter(k => !tabAsmKeys.has(k));
    if (extraAsm.length) {
        console.warn('[SourceLibrary] Assembly example(s) in _asmExampleSources but absent from ' +
            'LANG_EXAMPLE_GROUPS.assembly (add to app-compile.js + index.html tab):', extraAsm);
    }
}

/* ── Draw ────────────────────────────────────────────────────────────────── */

function _drawSourceLibrary(container) {
    const cloomcSrc = window._cloomcExampleSources || {};
    const asmSrc    = window._asmExampleSources    || {};
    const fileExamples = window._cloomcFileExamples || {};

    /* Build the registry dynamically, then group by lang in defined order. */
    const registry = _buildSLRegistry();
    const groups = {};
    for (const lang of _SL_LANG_ORDER) groups[lang] = [];
    for (const entry of registry) {
        if (!groups[entry.lang]) groups[entry.lang] = [];
        groups[entry.lang].push(entry);
    }

    let html = '';

    for (const lang of _SL_LANG_ORDER) {
        const entries = groups[lang];
        if (!entries || entries.length === 0) continue;

        html += `<div class="sl-group" data-lang="${_esc(lang)}">`;
        html += `<div class="sl-group-header">${_esc(_SL_LANG_LABELS[lang] || lang)}</div>`;

        for (const entry of entries) {
            const src = _getEntrySource(entry, cloomcSrc, asmSrc, fileExamples);
            const methodCount = _countMethods(src, lang);
            const badgeClass  = _SL_LANG_BADGE_CLASS[lang] || '';
            const methodLabel = methodCount === 1 ? '1 method' : `${methodCount} methods`;
            const cardId      = `sl-card-${lang}-${entry.key}`;

            html += `
<div class="sl-card" id="${_esc(cardId)}"
     data-key="${_esc(entry.key)}"
     data-lang="${_esc(lang)}"
     data-name="${_esc(entry.name.toLowerCase())}"
     data-src="${_esc((src || '').toLowerCase())}">
  <div class="sl-card-header">
    <span class="sl-card-name">${_esc(entry.name)}</span>
    <span class="sl-badge ${_esc(badgeClass)}">${_esc(_slLangShort(lang))}</span>
    <span class="sl-method-count">${_esc(methodLabel)}</span>
    <div class="sl-card-actions">
      <button class="sl-load-btn" onclick="slLoadEntry('${entry.key}','${entry.loader}','${lang}')"
              title="Load into editor">Load \u2192 Editor</button>
      <button class="sl-toggle-btn" onclick="slToggleCard('${cardId}')"
              title="Show/hide source">Source \u25BE</button>
    </div>
  </div>
  <pre class="sl-source-pre" style="display:none">${_esc(src || '(source not available)')}</pre>
</div>`;
        }

        html += '</div>';
    }

    container.innerHTML = html;
    _applySourceLibraryFilter();
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function _getEntrySource(entry, cloomcSrc, asmSrc, fileExamples) {
    if (entry.loader === 'assembly') {
        return (asmSrc[entry.key] || '').replace(
            /\` \+ '.*?'\.slice\(.*?\)$/s, ''
        );
    }
    /* File-based CLOOMC example */
    if (fileExamples[entry.key]) {
        return _SL_FETCH_CACHE[fileExamples[entry.key]] || '';
    }
    /* Inline CLOOMC example */
    return cloomcSrc[entry.key] || '';
}

function _countMethods(src, lang) {
    if (!src) return 0;
    if (lang === 'assembly') {
        /* Count numbered entries in the header comment block:
           ";   1. methodName" */
        return (src.match(/^;\s+\d+\./mg) || []).length;
    }
    /* For all high-level front-ends: count "method <name>" lines. */
    return (src.match(/\bmethod\s+\w+/g) || []).length;
}

function _slLangShort(lang) {
    return { javascript: 'JS', assembly: 'ASM', haskell: 'HS', symbolic: 'ADA', english: 'EN', lambda: 'λ' }[lang] || lang;
}

function _esc(str) {
    if (typeof str !== 'string') str = String(str || '');
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Public interaction functions ────────────────────────────────────────── */

function slLoadEntry(key, loader, lang) {
    /* Switch to editor view first. */
    if (typeof switchView === 'function') switchView('editor');

    if (loader === 'assembly') {
        /* Switch language selector to assembly, then load. */
        const sel = document.getElementById('langSelector');
        if (sel) sel.value = 'assembly';
        if (typeof onLangChange === 'function') onLangChange(true);
        if (typeof loadExample === 'function') loadExample(key);
    } else {
        /* Always set the language selector and trigger onLangChange so the
           editor toolbar, tab-strip, and compiler mode all update consistently
           — even if the selector already shows the target language (e.g. the
           user clicked two Haskell cards in a row). */
        const sel = document.getElementById('langSelector');
        if (sel) sel.value = lang;
        if (typeof onLangChange === 'function') onLangChange(true);
        if (typeof loadCLOOMCExample === 'function') loadCLOOMCExample(key);
    }
}

function slToggleCard(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;
    const pre = card.querySelector('.sl-source-pre');
    const btn = card.querySelector('.sl-toggle-btn');
    if (!pre) return;
    const visible = pre.style.display !== 'none';
    pre.style.display = visible ? 'none' : 'block';
    if (btn) btn.textContent = visible ? 'Source \u25BE' : 'Source \u25B4';
}

/* ── Search / filter ─────────────────────────────────────────────────────── */

function filterSourceLibrary() {
    _applySourceLibraryFilter();
}

function _applySourceLibraryFilter() {
    const q = ((document.getElementById('slSearch') || {}).value || '').toLowerCase().trim();
    const cards = document.querySelectorAll('#slContent .sl-card');
    let visiblePerGroup = {};

    cards.forEach(card => {
        const name = (card.dataset.name || '');
        const src  = (card.dataset.src  || '');
        const lang = (card.dataset.lang  || '');
        const match = !q || name.includes(q) || src.includes(q);
        card.style.display = match ? '' : 'none';
        if (match) visiblePerGroup[lang] = (visiblePerGroup[lang] || 0) + 1;
    });

    /* Show/hide group headers based on whether any card is visible. */
    document.querySelectorAll('#slContent .sl-group').forEach(group => {
        const lang = group.dataset.lang || '';
        group.style.display = (visiblePerGroup[lang] > 0) ? '' : 'none';
    });
}

/* ── Startup assertion ───────────────────────────────────────────────────────
 * Verify that required structural globals were set by app-compile.js and
 * app-run.js before this script executed.  Fires once after DOMContentLoaded
 * so the check runs in every page load, not just when the panel is opened.
 * A console.error here means the script load order in index.html is wrong. */
document.addEventListener('DOMContentLoaded', function _slStartupAssert() {
    const required = [
        '_cloomcFileExamples',
        '_cloomcFileLanguages',
        '_cloomcExampleLanguages',
        '_cloomcLangExampleGroups',
        '_asmExampleSources',
    ];
    const missing = required.filter(g => !window[g]);
    if (missing.length) {
        console.error('[SourceLibrary] Missing structural globals after script load — ' +
            'check script order in index.html (app-compile → app-run → app-source-library):', missing);
    }
}, { once: true });
