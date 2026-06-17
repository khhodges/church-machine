'use strict';

const StartupWizard = (function () {

    const LS_KEY    = 'sw_step_ti60';
    const LS_VER    = 'sw_version_ti60';
    const LS_FAIL   = 'sw_fail_';
    const LS_DONE   = 'sw_done_';
    const LS_CHOICE = 'sw_choice_ti60';
    const STEPS    = ['bitstream', 'flash', 'powercycle', 'connect', 'upload', 'running'];
    const TOTAL    = STEPS.length;

    let _currentStep  = 0;
    let _open         = true;
    let _releaseData  = null;
    let _pollTimer    = null;

    // ── Demo mode ─────────────────────────────────────────────────────────────
    let _demoMode  = false;
    let _demoTimer = null;
    let _tourDone  = false;

    // ── Scratch-or-prepackaged choice ─────────────────────────────────────────
    let _choiceMade = null; // null | 'prepackaged' | 'scratch'
    const DEMO_DWELL_MS = 3000;

    // ── DOM helpers ──────────────────────────────────────────────────────────

    function _el(id) { return document.getElementById(id); }

    function _setStepState(idx, state) {
        const el = _el('swStep' + idx);
        if (!el) return;
        el.className = 'sw-strip-step sw-step-' + state;
        const icon = el.querySelector('.sw-step-icon');
        if (icon) {
            icon.textContent = state === 'done'    ? '✓'
                             : state === 'active'  ? '▶'
                             : state === 'fail'    ? '✗'
                             : '○';
        }
    }

    function _renderProgress() {
        for (let i = 0; i < TOTAL; i++) {
            if (i < _currentStep)        _setStepState(i, 'done');
            else if (i === _currentStep) _setStepState(i, 'active');
            else                         _setStepState(i, 'pending');
        }
        const pct = Math.round((_currentStep / TOTAL) * 100);
        const bar = _el('swProgressFill');
        if (bar) bar.style.width = pct + '%';
        const lbl = _el('swProgressLabel');
        if (lbl) lbl.textContent = 'Step ' + (_currentStep + 1) + ' of ' + TOTAL;

        for (let i = 0; i < TOTAL; i++) {
            const body = _el('swBody' + i);
            if (body) body.style.display = (i === _currentStep) ? 'block' : 'none';
        }

        // "No board yet?" row — only at step 0, not in demo mode, and only if
        // the wizard has never been completed before
        const noBoardRow = _el('swNoBoardRow');
        if (noBoardRow) {
            const show = _currentStep === 0 && !_demoMode && !_wizardEverCompleted();
            noBoardRow.style.display = show ? '' : 'none';
        }

        // "Scratch or prepackaged?" choice row — same conditions as noBoardRow,
        // but also hidden once the user has made their choice
        const choiceRow = _el('swChoiceRow');
        if (choiceRow) {
            const show = _currentStep === 0 && !_demoMode && !_wizardEverCompleted() && !_choiceMade;
            choiceRow.style.display = show ? '' : 'none';
        }

        // Flash step: show prepackaged or scratch variant
        const flashPrepack = _el('swFlashPrepack');
        const flashScratch = _el('swFlashScratch');
        if (flashPrepack && flashScratch) {
            const isPrepack = _choiceMade === 'prepackaged';
            flashPrepack.style.display = isPrepack ? '' : 'none';
            flashScratch.style.display = isPrepack ? 'none' : '';
        }

        // Demo mode: hide per-step footers, show shared demo bar
        const demoBar = _el('swDemoBar');
        for (let i = 0; i < TOTAL; i++) {
            const body = _el('swBody' + i);
            if (!body) continue;
            const footer = body.querySelector('.sw-footer-row');
            if (footer) footer.style.display = _demoMode ? 'none' : '';
        }
        if (demoBar) demoBar.style.display = _demoMode ? '' : 'none';
    }

    function _save() {
        try { localStorage.setItem(LS_KEY, String(_currentStep)); } catch (_) {}
    }

    function _load() {
        try {
            const s = parseInt(localStorage.getItem(LS_KEY), 10);
            if (!isNaN(s) && s >= 0 && s < TOTAL) _currentStep = s;
        } catch (_) {}
        try {
            const c = localStorage.getItem(LS_CHOICE);
            if (c === 'prepackaged' || c === 'scratch') _choiceMade = c;
        } catch (_) {}
    }

    function _checkBitstream() {
        var statuses = [_el('swBitstreamStatus'), _el('swBitstreamStatusScratch')];
        statuses.forEach(function (s) {
            if (s) { s.textContent = 'checking…'; s.className = 'sw-bitstream-status sw-bitstream-checking'; }
        });
        fetch('/api/bitstream/list')
            .then(function (r) { return r.json(); })
            .then(function (d) {
                const entry = d.bitstreams && d.bitstreams.find(function (b) { return b.board === 'ti60-f225'; });
                statuses.forEach(function (s) {
                    if (!s) return;
                    if (entry && entry.available) {
                        const mb = (entry.size / 1048576).toFixed(2);
                        s.textContent = '✓ Ready — ' + mb + ' MB';
                        s.className   = 'sw-bitstream-status sw-bitstream-ready';
                    } else {
                        s.textContent = '✗ Not yet uploaded';
                        s.className   = 'sw-bitstream-status sw-bitstream-unavail';
                    }
                });
            })
            .catch(function () {
                statuses.forEach(function (s) { if (s) { s.textContent = ''; s.className = 'sw-bitstream-status'; } });
            });
    }

    function _wizardEverCompleted() {
        try {
            return localStorage.getItem(LS_DONE + (TOTAL - 1)) === '1';
        } catch (_) { return false; }
    }

    // ── Success / failure / stuck state helpers ───────────────────────────────

    function markStepDone(idx) {
        _setStepState(idx, 'done');
        _clearFail(idx);
        const succ = _el('swSuccess' + idx);
        if (succ) succ.classList.add('sw-visible');
        try { localStorage.setItem(LS_DONE + idx, '1'); } catch (_) {}
    }

    // confirmStep — used by "✓ Done" buttons on steps 0–2.
    // Shows the success banner then auto-advances after a short pause so
    // the user can see the green confirmation before the step transitions.
    // The "→ Next step" button in the banner lets them skip the wait.
    function confirmStep(idx) {
        markStepDone(idx);
        setTimeout(function () {
            if (_currentStep === idx) advance();
        }, 700);
    }

    function markStepFail(idx, silent) {
        _setStepState(idx, 'fail');
        const trouble = _el('swTrouble' + idx);
        if (trouble) trouble.classList.add('sw-visible');
        // Show the retry button for steps that support it
        const retry = document.querySelector('#swBody' + idx + ' .sw-btn-retry');
        if (retry) retry.classList.add('sw-visible');
        if (!silent) {
            try { localStorage.setItem(LS_FAIL + idx, '1'); } catch (_) {}
        }
    }

    function toggleTrouble(idx) {
        const trouble = _el('swTrouble' + idx);
        if (!trouble) return;
        trouble.classList.toggle('sw-visible');
    }

    function _clearFail(idx) {
        try { localStorage.removeItem(LS_FAIL + idx); } catch (_) {}
        // Hide retry button when fail state is cleared
        const retry = document.querySelector('#swBody' + idx + ' .sw-btn-retry');
        if (retry) retry.classList.remove('sw-visible');
    }

    // ── Public ───────────────────────────────────────────────────────────────

    function advance() {
        if (_currentStep < TOTAL - 1) {
            _clearFail(_currentStep);
            _currentStep++;
            _save();
            _renderProgress();
            if (_currentStep === 1 && _choiceMade === 'prepackaged') _checkBitstream();
        }
    }

    function back() {
        if (_currentStep > 0) {
            _currentStep--;
            _save();
            _renderProgress();
        }
    }

    function goToStep(idx) {
        if (idx < 0 || idx >= TOTAL) return;
        if (idx > _currentStep) return; // can only go back, not skip ahead
        _currentStep = idx;
        _save();
        _renderProgress();
        if (_currentStep === 1 && _choiceMade === 'prepackaged') _checkBitstream();
    }

    // jumpToFlash — called by the "Flash via Wizard" button on the download card.
    // Unlike goToStep, this is allowed to move forward: it sets the prepackaged
    // path (the user already has a bitstream), opens the wizard if collapsed,
    // then jumps straight to step 1 (Flash).
    function jumpToFlash() {
        if (_choiceMade === null) {
            _choiceMade = 'prepackaged';
            try { localStorage.setItem(LS_CHOICE, 'prepackaged'); } catch (_) {}
        }
        open(); // ensure wizard is visible
        _currentStep = 1;
        _save();
        _renderProgress();
        _checkBitstream();
    }

    function reset() {
        for (let i = 0; i < TOTAL; i++) {
            try { localStorage.removeItem(LS_FAIL + i); } catch (_) {}
            try { localStorage.removeItem(LS_DONE + i); } catch (_) {}
        }
        _choiceMade = null;
        try { localStorage.removeItem(LS_CHOICE); } catch (_) {}
        _currentStep = 0;
        _save();
        _renderProgress();
        for (let i = 0; i < TOTAL; i++) {
            const succ = _el('swSuccess' + i);
            if (succ) succ.classList.remove('sw-visible');
            const trouble = _el('swTrouble' + i);
            if (trouble) trouble.classList.remove('sw-visible');
        }
    }

    function toggle() {
        const body = _el('swWizardBody');
        const chev = _el('swChevron');
        if (!body) return;
        _open = !_open;
        body.style.display = _open ? '' : 'none';
        if (chev) chev.textContent = _open ? '▾' : '▸';
    }

    function open() {
        const panel = _el('swPanel');
        const body = _el('swWizardBody');
        const chev = _el('swChevron');
        if (!body) return;
        if (panel) panel.style.display = '';
        _open = true;
        body.style.display = '';
        if (chev) chev.textContent = '▾';
    }

    // ── Connect button shortcuts ──────────────────────────────────────────────

    function _scrollToConnect() {
        const panel = document.getElementById('ti60ConnectPanel');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const menu = document.getElementById('ti60ConnectMenu');
        if (menu) menu.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function clickConnect() {
        _scrollToConnect();
        if (typeof Ti60Connect !== 'undefined') Ti60Connect.connect();
    }

    function clickDirect() {
        _scrollToConnect();
        if (typeof Ti60Connect !== 'undefined') Ti60Connect.connect();
    }

    function clickBridge() {
        _scrollToConnect();
        if (typeof Ti60Connect !== 'undefined') Ti60Connect.connectViaBridge();
    }

    // ── Release version check ────────────────────────────────────────────────

    async function _loadRelease() {
        try {
            const r = await fetch('/api/releases', { signal: AbortSignal.timeout(5000) });
            const d = await r.json();
            if (!d.ok || !d.release) return;
            _releaseData = d.release;

            const badge = _el('swVersionBadge');
            if (badge) {
                badge.textContent = 'v' + d.release.version;
                badge.title = d.release.description || '';
            }

            if (d.stale) {
                const warn = _el('swStaleWarning');
                if (warn) {
                    warn.textContent = '⚠ Verilog source has changed since v' + d.release.version + ' — re-synthesis recommended.';
                    warn.style.display = '';
                }
                const badge2 = _el('swVersionBadge');
                if (badge2) badge2.classList.add('sw-version-stale');
            }

            const dlBtn = _el('swDownloadBtn');
            if (dlBtn && d.release.verilog_download) {
                dlBtn.href = d.release.verilog_download;
                dlBtn.setAttribute('download', 'church_ti60_f225.v');
            }
            const zipBtn = _el('swZipBtn');
            if (zipBtn && d.release.zip_download) {
                zipBtn.href = d.release.zip_download;
            }

            try {
                const prev = localStorage.getItem(LS_VER);
                if (prev && prev !== d.release.version) {
                    const warn2 = _el('swUpdateWarning');
                    if (warn2) {
                        warn2.textContent = '🆕 New release v' + d.release.version + ' (was v' + prev + ') — re-flash recommended before connecting.';
                        warn2.style.display = '';
                    }
                }
                localStorage.setItem(LS_VER, d.release.version);
            } catch (_) {}

        } catch (_) {}
    }

    // ── Retry a failed step ───────────────────────────────────────────────────

    function retryStep(idx) {
        _clearFail(idx);
        _setStepState(idx, 'active');
        const trouble = _el('swTrouble' + idx);
        if (trouble) trouble.classList.remove('sw-visible');

        // Reset the underlying Ti60 step elements so the polling watcher does not
        // immediately re-fail from a stale ti60-step-fail class.
        if (idx === 3) {
            const uartEl = _el('ti60Step-uart');
            if (uartEl) {
                uartEl.className = uartEl.className
                    .replace(/\bti60-step-pass\b|\bti60-step-fail\b|\bti60-step-active\b/g, '')
                    .trim() + ' ti60-step-pending';
            }
            clickConnect();
        }

        if (idx === 4) {
            const relEl = _el('ti60Step-release');
            if (relEl) {
                relEl.className = relEl.className
                    .replace(/\bti60-step-pass\b|\bti60-step-fail\b|\bti60-step-active\b/g, '')
                    .trim() + ' ti60-step-pending';
            }
            // Open the connect menu so the user can retry the connection/upload flow
            clickConnect();
        }

        // Re-arm polling watcher
        _watchTi60Steps();
    }

    // ── Watch the existing Ti60 steps to auto-advance wizard ─────────────────

    function _watchTi60Steps() {
        if (_pollTimer) clearInterval(_pollTimer);
        _pollTimer = setInterval(function () {
            if (_demoMode) return;
            if (_currentStep < 3) return;

            const uartStep = _el('ti60Step-uart');
            if (_currentStep === 3 && uartStep) {
                if (uartStep.classList.contains('ti60-step-pass')) {
                    markStepDone(3);
                    setTimeout(function () {
                        if (_currentStep === 3) {
                            _currentStep = 4;
                            _save();
                            _renderProgress();
                        }
                    }, 700);
                } else if (uartStep.classList.contains('ti60-step-fail')) {
                    markStepFail(3);
                }
            }

            const relStep = _el('ti60Step-release');
            if (_currentStep >= 4 && relStep) {
                if (relStep.classList.contains('ti60-step-pass')) {
                    markStepDone(4);
                    setTimeout(function () {
                        if (_currentStep === 4) {
                            _currentStep = 5;
                            _save();
                            _renderProgress();
                            clearInterval(_pollTimer);
                        }
                    }, 700);
                } else if (relStep.classList.contains('ti60-step-fail')) {
                    markStepFail(4);
                }
            }
        }, 800);
    }

    // ── Demo tour ─────────────────────────────────────────────────────────────

    function choicePrepackaged() {
        _choiceMade = 'prepackaged';
        try { localStorage.setItem(LS_CHOICE, 'prepackaged'); } catch (_) {}
        _renderProgress();
        // Skip the "build" step — mark step 0 done and jump to step 1 (flash)
        // _checkBitstream() fires via advance() → step 1 reached
        confirmStep(0);
    }

    function choiceScratch() {
        _choiceMade = 'scratch';
        try { localStorage.setItem(LS_CHOICE, 'scratch'); } catch (_) {}
        _renderProgress(); // hides the choice row, step 0 content stays visible
    }

    function startDemo() {
        _demoMode = true;
        _tourDone = false;
        _currentStep = 0;

        // Show wizard if collapsed
        const body = _el('swWizardBody');
        const chev = _el('swChevron');
        if (body && !_open) {
            _open = true;
            body.style.display = '';
            if (chev) chev.textContent = '▾';
        }

        // Show DEMO badge and exit link
        const demoBadge = _el('swDemoBadge');
        if (demoBadge) demoBadge.style.display = '';
        const exitTour = _el('swExitTour');
        if (exitTour) exitTour.style.display = '';

        // Hide tour-complete card (in case re-entering)
        const tourComplete = _el('swTourComplete');
        if (tourComplete) tourComplete.style.display = 'none';

        _renderProgress();
        _scheduleDemoTick();
    }

    function _scheduleDemoTick() {
        if (_demoTimer) clearTimeout(_demoTimer);
        if (_demoMode && !_tourDone) {
            _demoTimer = setTimeout(_demoTick, DEMO_DWELL_MS);
        }
    }

    function _demoTick() {
        if (!_demoMode) return;
        if (_currentStep < TOTAL - 1) {
            _currentStep++;
            _renderProgress();
            _scheduleDemoTick();
        } else {
            _showTourComplete();
        }
    }

    function demoSimulate() {
        if (!_demoMode || _tourDone) return;
        if (_demoTimer) clearTimeout(_demoTimer);
        _demoTick();
    }

    function _showTourComplete() {
        _tourDone = true;
        if (_demoTimer) { clearTimeout(_demoTimer); _demoTimer = null; }

        // Hide all step bodies and demo bar
        for (let i = 0; i < TOTAL; i++) {
            const body = _el('swBody' + i);
            if (body) body.style.display = 'none';
        }
        const demoBar = _el('swDemoBar');
        if (demoBar) demoBar.style.display = 'none';

        // Show tour-complete card
        const tourComplete = _el('swTourComplete');
        if (tourComplete) tourComplete.style.display = '';
    }

    function exitDemo() {
        _demoMode = false;
        _tourDone = false;
        if (_demoTimer) { clearTimeout(_demoTimer); _demoTimer = null; }

        // Hide DEMO badge and exit link
        const demoBadge = _el('swDemoBadge');
        if (demoBadge) demoBadge.style.display = 'none';
        const exitTour = _el('swExitTour');
        if (exitTour) exitTour.style.display = 'none';

        // Hide tour-complete card
        const tourComplete = _el('swTourComplete');
        if (tourComplete) tourComplete.style.display = 'none';

        // Reset to step 0 in real mode
        _currentStep = 0;
        _save();
        _renderProgress();
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    function init() {
        _load();
        _renderProgress();

        // Wire step strip as navigation buttons — clicking a done/active step jumps back to it
        for (let i = 0; i < TOTAL; i++) {
            (function (idx) {
                const el = _el('swStep' + idx);
                if (el) el.addEventListener('click', function () { goToStep(idx); });
            })(i);
        }

        // Restore persisted done banners for steps before current
        for (let i = 0; i < _currentStep; i++) {
            try {
                if (localStorage.getItem(LS_DONE + i) === '1') {
                    const succ = _el('swSuccess' + i);
                    if (succ) succ.classList.add('sw-visible');
                }
            } catch (_) {}
        }

        // Restore fail state for current step — open troubleshoot panel,
        // but don't re-save (silent=true) so it is cleared on next visit
        try {
            if (localStorage.getItem(LS_FAIL + _currentStep) === '1') {
                markStepFail(_currentStep, true);
            }
        } catch (_) {}

        _loadRelease();
        _watchTi60Steps();
        // If restored into step 1 on the prepackaged path, check bitstream now
        if (_currentStep === 1 && _choiceMade === 'prepackaged') _checkBitstream();

        // Wizard hidden by default — full IDE mode.
        // jumpToFlash() calls open() to reveal it when explicitly invoked.
        const panel = _el('swPanel');
        if (panel) panel.style.display = 'none';
        _open = false;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { advance, back, goToStep, jumpToFlash, reset, toggle, open, clickConnect, clickDirect, clickBridge, markStepDone, markStepFail, toggleTrouble, confirmStep, retryStep, startDemo, exitDemo, demoSimulate, choicePrepackaged, choiceScratch };
})();
