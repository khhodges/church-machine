// test_artifact_link.js — Unit tests for openArtifactLink()
//
// Verifies that the artifact link click handler in app-misc.js correctly:
//
//   AL-1  Opens a placeholder window synchronously (before async fetch) so
//         popup blockers honour the user-activation gesture
//   AL-2  Navigates the placeholder to the artifact URL when reachable
//   AL-3  Closes the placeholder and renders an inline notice when unreachable
//   AL-4  Notice is present immediately (auto-dismiss timer registered)
//   AL-5  Removes a stale notice before starting a new reachability check
//   AL-6  Opens the URL directly (no fetch) when port is 0/falsy
//   AL-7  Does nothing when url is empty
//
// Run with:  node simulator/test_artifact_link.js
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

// ── Extract production function ───────────────────────────────────────────────

function extractFn(srcPath, marker) {
    const src = fs.readFileSync(path.resolve(__dirname, srcPath), 'utf8');
    const start = src.indexOf(marker);
    if (start === -1) throw new Error(marker + ' not found in ' + srcPath);
    let depth = 0, i = start;
    while (i < src.length) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') { if (--depth === 0) { i++; break; } }
        i++;
    }
    return src.slice(start, i);
}

// Structural guard: fails fast if the function was renamed or removed.
const LINK_SRC = extractFn('app-misc.js', 'async function openArtifactLink(');
const MENU_LAUNCH_SRC = extractFn('app-misc.js', 'function openArtifact(');

// ── Fixture ───────────────────────────────────────────────────────────────────
//
// Each test gets a fresh JSDOM + window so state never leaks between cases.

function makeEnv(fetchOk) {
    const dom = new JSDOM(
        '<!DOCTYPE html><body>' +
        '<div class="docs-file-item docs-file-link" id="link-item"></div>' +
        '</body>',
        { runScripts: 'outside-only' }
    );
    const w = dom.window;

    const opened = [];
    w.open = function(url) {
        const win = {
            url:      url || '',
            closed:   false,
            opener:   null,
            location: { href: '' },
            close:    function() { this.closed = true; },
        };
        opened.push(win);
        return win;
    };

    w.fetch = async function() {
        return { ok: true, json: async function() { return { ok: fetchOk }; } };
    };

    vm.runInContext(LINK_SRC, dom.getInternalVMContext());

    function ev() {
        return { currentTarget: w.document.getElementById('link-item') };
    }

    return { w: w, opened: opened, ev: ev };
}

function makeMenuEnv(url) {
    const dom = new JSDOM('<!DOCTYPE html><body></body>', {
        runScripts: 'outside-only',
        url: url,
    });
    const w = dom.window;
    const launches = [];
    w.openArtifactLink = function(event, targetUrl, port, label) {
        launches.push({ event: event, url: targetUrl, port: port, label: label });
    };
    vm.runInContext(MENU_LAUNCH_SRC, dom.getInternalVMContext());
    return { w: w, launches: launches };
}

// ── Test runner ───────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
    if (cond) {
        console.log('  PASS  ' + label);
        pass++;
    } else {
        console.error('  FAIL  ' + label + (detail != null ? '  (' + detail + ')' : ''));
        fail++;
    }
}

(async function run() {
    console.log('\nrunning artifact link tests…\n');

    // AL-1 / AL-2: server reachable ───────────────────────────────────────────
    {
        const { w, opened, ev } = makeEnv(true);
        // Record how many windows existed BEFORE the async operation resolves.
        const p = w.openArtifactLink(ev(), 'https://21279-x.replit.dev/', 21279, 'IDE');
        const syncCount = opened.length;          // must be 1 before await
        await p;
        check('AL-1 window opened synchronously before fetch', syncCount === 1,
              'count=' + syncCount);
        check('AL-1 placeholder starts as about:blank', opened[0].url === '',
              'url=' + opened[0].url);
        check('AL-2 placeholder navigated to artifact URL',
              opened[0].location.href === 'https://21279-x.replit.dev/',
              'href=' + opened[0].location.href);
        check('AL-2 window not closed when server is up', !opened[0].closed, '');
    }

    // AL-3: server unreachable ─────────────────────────────────────────────────
    {
        const { w, opened, ev } = makeEnv(false);
        await w.openArtifactLink(ev(), 'https://21279-x.replit.dev/', 21279, 'IDE');
        check('AL-3 blank window closed when unreachable',
              opened.length === 1 && opened[0].closed,
              'count=' + opened.length + ' closed=' + (opened[0] && opened[0].closed));
        const notice = w.document.querySelector('.artifact-offline-notice');
        check('AL-3 offline notice rendered', notice !== null, '');
        check('AL-3 notice text mentions not running',
              !!notice && notice.textContent.includes('not running'), '');
    }

    // AL-4: notice is present immediately (timer will auto-dismiss at 6 s) ────
    {
        const { w, ev } = makeEnv(false);
        await w.openArtifactLink(ev(), 'https://21279-x.replit.dev/', 21279, 'IDE');
        check('AL-4 notice present before 6 s elapses',
              w.document.querySelector('.artifact-offline-notice') !== null, '');
    }

    // AL-5: stale notice removed before second check ──────────────────────────
    {
        const { w, ev } = makeEnv(false);
        await w.openArtifactLink(ev(), 'https://21279-x.replit.dev/', 21279, 'IDE');
        check('AL-5 stale notice present after first call',
              w.document.querySelector('.artifact-offline-notice') !== null, '');
        // Swap fetch to OK and call again
        w.fetch = async function() {
            return { ok: true, json: async function() { return { ok: true }; } };
        };
        await w.openArtifactLink(ev(), 'https://21279-x.replit.dev/', 21279, 'IDE');
        check('AL-5 stale notice removed by second call',
              w.document.querySelector('.artifact-offline-notice') === null, '');
    }

    // AL-6: no port → direct open, no fetch ───────────────────────────────────
    {
        const { w, opened, ev } = makeEnv(true);
        const fetchCalls = [];
        w.fetch = async function(u) { fetchCalls.push(u); return { ok: true, json: async function() { return { ok: true }; } }; };
        await w.openArtifactLink(ev(), 'https://example.replit.dev/', 0, 'lbl');
        check('AL-6 fetch not called when port is 0', fetchCalls.length === 0,
              'calls=' + fetchCalls.length);
        check('AL-6 URL opened directly',
              opened.length === 1 && opened[0].url === 'https://example.replit.dev/',
              'url=' + (opened[0] && opened[0].url));
    }

    // AL-7: empty url → no-op ─────────────────────────────────────────────────
    {
        const { w, opened, ev } = makeEnv(true);
        await w.openArtifactLink(ev(), '', 21279, 'lbl');
        check('AL-7 empty url: window.open not called', opened.length === 0,
              'count=' + opened.length);
    }

    // AL-8: hamburger buttons use the same launch flow as Docs sidebar links ──
    {
        const { w, launches } = makeMenuEnv('https://5000-demo.replit.dev/simulator/');
        w.openArtifact({}, 21279, '/', '/ide-intro/', 'IDE Introduction');
        check('AL-8 dev hamburger link uses the artifact proxy URL',
              launches.length === 1 && launches[0].url === 'https://21279-demo.replit.dev/',
              JSON.stringify(launches));
        check('AL-8 dev hamburger link probes the artifact port',
              launches[0] && launches[0].port === 21279,
              JSON.stringify(launches[0]));
    }

    // AL-9: production never points a user at an unavailable dev-server port ──
    {
        const { w, launches } = makeMenuEnv('https://church-machine.replit.app/simulator/');
        w.openArtifact({}, 21279, '/handout', '/ide-intro/handout', 'Facilitator Handout');
        check('AL-9 production hamburger link stays on the IDE origin',
              launches.length === 1 &&
              launches[0].url === 'https://church-machine.replit.app/ide-intro/handout',
              JSON.stringify(launches));
        check('AL-9 production hamburger link skips the dev-server probe',
              launches[0] && launches[0].port === 0,
              JSON.stringify(launches[0]));
    }

    // Summary ─────────────────────────────────────────────────────────────────
    console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
    if (fail > 0) process.exit(1);
})();
