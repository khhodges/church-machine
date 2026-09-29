// app-actions.js — one state owner for editor build/install actions.
//
// A build is deliberately not an install.  The compiler may replace this
// candidate only after it has completed successfully; execution keeps using
// the installed snapshot until the programmer explicitly installs/runs one.
(function () {
    'use strict';

    function cloneCap(cap) {
        if (!cap || typeof cap !== 'object') return cap;
        return Object.freeze(Object.assign({}, cap, {
            rights: Array.isArray(cap.rights) ? Object.freeze(cap.rights.slice()) : cap.rights,
            grants: Array.isArray(cap.grants) ? Object.freeze(cap.grants.slice()) : cap.grants,
        }));
    }
    function freezeSnapshot(value) {
        if (!value) return null;
        return Object.freeze({
            token: value.token || null,
            abstraction: value.abstraction || 'prog',
            language: value.language || '',
            languageIdentity: value.languageIdentity || value.language || '',
            sourceSurface: value.sourceSurface || 'asmEditor',
            source: String(value.source == null ? '' : value.source),
            isaProfile: value.isaProfile || 'LEGACY',
            executionLayout: value.executionLayout
                ? window.ChurchIDX1IDE.freezeLayout(value.executionLayout) : null,
            words: Object.freeze((value.words || []).map(word => word >>> 0)),
            capabilities: Object.freeze((value.capabilities || []).map(cloneCap)),
            labels: value.labels ? Object.freeze(Object.assign({}, value.labels)) : null,
            namedSlots: value.namedSlots ? Object.freeze(value.namedSlots.slice()) : null,
            methodTableSize: Number.isInteger(value.methodTableSize) ? value.methodTableSize : 0,
            binary: value.binary ? Object.freeze(value.binary.map(word => word >>> 0)) : null,
            createdAt: value.createdAt || Date.now(),
        });
    }

    let candidate = null;
    let saved = null;
    let installed = null;
    let activeOperation = null;

    function editorSource(sourceSurface) {
        const editor = document.getElementById(sourceSurface || 'asmEditor');
        return editor ? String(editor.value || '') : '';
    }
    function activeLanguage() {
        const select = document.getElementById('langSelector');
        return select ? String(select.value || '') : '';
    }
    function candidateIsCurrent(sourceSurface) {
        const surface = sourceSurface || 'asmEditor';
        return !!candidate && candidate.sourceSurface === surface &&
            candidate.source === editorSource(surface) &&
            (!candidate.language || !activeLanguage() ||
                candidate.languageIdentity === activeLanguage() || activeLanguage() === 'personal');
    }
    function hasInstalledProgram() {
        return !!installed || !!(typeof sim !== 'undefined' && sim &&
            (sim.programName || sim.programCapabilities));
    }
    function candidateInRegistry(snapshot) {
        snapshot = snapshot || candidate;
        if (!snapshot || !snapshot.token || !window.LumpRegistry ||
                typeof window.LumpRegistry.resolve !== 'function') return false;
        const entry = window.LumpRegistry.resolve(snapshot.token);
        const memory = entry && entry.sources && entry.sources.memory;
        return !!memory && Array.isArray(memory.words) &&
            memory.sourceText === snapshot.source;
    }
    function eligibility(action, sourceOverride, sourceSurface) {
        const surface = sourceSurface || 'asmEditor';
        const source = sourceOverride !== undefined ? String(sourceOverride) : editorSource(surface);
        const hasSource = source.trim().length > 0;
        const fresh = candidateIsCurrent(surface);
        if (action === 'compile') {
            return hasSource
                ? { ok: true, reason: '' }
                : { ok: false, reason: 'Enter source before compiling.' };
        }
        if (action === 'run') {
            // A workspace Run button is bound to its own editor surface. It
            // must never fall back to whichever program happens to be
            // installed when that workspace candidate is absent or stale.
            if (surface !== 'asmEditor' && !fresh) return {
                ok: true,
                reason: 'No current workspace build; Run continues the already loaded simulator bytes.'
            };
            if (candidate && !fresh) {
                return {
                    ok: true,
                    reason: 'The editor changed after this candidate was built; Run will keep the current simulator program.'
                };
            }
            // Step and Walk can execute the current simulator/boot state
            // without first compiling the editor. Run must offer the same
            // operation. A fresh candidate is installed below; otherwise Run
            // simply continues the current simulator program.
            return { ok: true, reason: '' };
        }
        if (action === 'save' || action === 'export') {
            if (candidate && candidate.isaProfile === 'IDX1') return {
                ok: false, reason: window.ChurchIDX1IDE.SAVE_MESSAGE,
            };
            if (fresh) return { ok: true, reason: '' };
            if (hasSource) {
                return {
                    ok: true,
                    reason: 'No candidate exists for the current source. This action will ask to Build and ' +
                        (action === 'save' ? 'Save' : 'Export') + ' one frozen snapshot.'
                };
            }
            return { ok: false, reason: 'Enter source and build a candidate first.' };
        }
        return { ok: false, reason: 'Unknown IDE action.' };
    }
    function applyButton(id, action) {
        const button = document.getElementById(id);
        if (!button) return;
        const state = eligibility(action);
        // A disabled Save button swallows clicks without reporting why (most
        // confusing immediately after opening a saved source asynchronously).
        // Keep it clickable so save() can give the precise prerequisite.
        const interactive = state.ok || action === 'save';
        button.disabled = !interactive;
        const base = button.dataset.actionBaseTooltip ||
            button.getAttribute('data-tooltip') || button.getAttribute('title') || button.textContent.trim();
        button.dataset.actionBaseTooltip = base;
        const suffix = state.ok
            ? (state.reason ? ' — ' + state.reason : '')
            : ' — unavailable: ' + state.reason;
        button.setAttribute('data-tooltip', base.replace(/\s+—\s+(?:unavailable: )?.*$/, '') + suffix);
        button.title = state.ok ? state.reason : state.reason;
        button.setAttribute('aria-disabled', interactive ? 'false' : 'true');
    }
    function refresh() {
        applyButton('btnHamCompile', 'compile');
        applyButton('btnToolbarCompile', 'compile');
        applyButton('btnHamSaveLump', 'save');
        applyButton('btnToolbarSaveLump', 'save');
        applyButton('btnSaveNS', 'save');
        applyButton('btnExportLump', 'export');
        applyButton('btnRunSim', 'run');
    }
    function reportUnavailable(action, sourceSurface) {
        const state = eligibility(action, undefined, sourceSurface);
        const message = state.reason || `${action} is unavailable.`;
        if (typeof appendOutput === 'function') appendOutput(message, 'warn');
        const con = document.getElementById('editorConsole');
        if (con) {
            con.textContent = message;
            con.scrollTop = 0;
        }
        return { ok: false, action, error: message };
    }
    function operationBusy(action) {
        return {
            ok: false, action,
            error: `Cannot ${action}: ${activeOperation} is already in progress.`
        };
    }
    function reportSaveFailure(result) {
        if (result && result.reported) return result;
        const reason = String(result && result.error || 'The Save LUMP review could not be opened.')
            .split(/[\r\n]/)[0]
            .replace(/https?:\/\/\S+/gi, '[URL redacted]')
            .replace(/(?:\/(?:home|private|Users|tmp)\/)\S+/g, '[path redacted]')
            .replace(/\b(?:token|password|secret|api[_-]?key)=[^\s]+/gi, '[credential redacted]')
            .slice(0, 240);
        const message = 'Save LUMP did not open: ' + reason +
            ' No LUMP was saved. Keep your draft, then retry Save LUMP after fixing this issue.';
        if (typeof appendOutput === 'function') appendOutput(message, 'error');
        const con = document.getElementById('editorConsole');
        if (con) con.textContent = message;
        window.alert(message);
        return Object.assign({}, result, { ok: false, error: message, reported: true });
    }
    async function compileSnapshot(snapshot, options) {
        options = options || {};
        const sourceSurface = options.sourceSurface || 'asmEditor';
        const state = eligibility('compile', snapshot, sourceSurface);
        if (!state.ok) return reportUnavailable('compile', sourceSurface);
        const result = await Promise.resolve(
            typeof smartCompile === 'function'
                ? smartCompile({
                    source: snapshot, candidateOnly: true, skipSavePlan: true,
                    sourceSurface,
                    languageIdentity: options.languageIdentity || activeLanguage(),
                })
                : { ok: false, error: 'The compiler entry point is unavailable.' }
        );
        refresh();
        return result;
    }
    async function compile(options) {
        if (activeOperation) return operationBusy('compile');
        activeOperation = 'compile';
        try {
            const sourceSurface = options && options.sourceSurface || 'asmEditor';
            const snapshot = String(options && options.source != null
                ? options.source : editorSource(sourceSurface));
            return await compileSnapshot(snapshot, options);
        } finally {
            activeOperation = null;
        }
    }
    async function buildThen(action, options) {
        options = options || {};
        const sourceSurface = options.sourceSurface || 'asmEditor';
        // Formatting a save artifact needs the compiler's source/code region,
        // not the execution-only method-table representation. Save LUMP itself
        // is the explicit request to build one frozen snapshot, so it must not
        // open a redundant browser confirmation before the unified review.
        const needsRegistryCandidate = action === 'save' && !candidateInRegistry(candidate);
        if (!candidateIsCurrent(sourceSurface) || needsRegistryCandidate) {
            const snapshot = editorSource(sourceSurface);
            if (action !== 'save') {
                const verb = 'Build and Export';
                if (!window.confirm(`${verb} the current source?\n\nThe compiler will use one frozen editor snapshot. It will not install or run the result.`)) {
                    return { ok: false, action, cancelled: true };
                }
            }
            const result = await compileSnapshot(snapshot, options);
            if (!result || result.ok === false) return result;
            // A user edit while the asynchronous compiler was running must
            // not cause this command to format a newer draft with older
            // words. The next Save click can explicitly build that new draft.
            if (!candidate || candidate.sourceSurface !== sourceSurface ||
                    candidate.source !== snapshot || editorSource(sourceSurface) !== snapshot) {
                return {
                    ok: false, action,
                    error: 'Source changed while building. Build again before saving this draft.'
                };
            }
        }
        return candidate;
    }
    async function save(options) {
        if (activeOperation) return reportSaveFailure(operationBusy('save'));
        activeOperation = 'save';
        try {
        const sourceSurface = options && options.sourceSurface || 'asmEditor';
        const state = eligibility('save', undefined, sourceSurface);
        if (!state.ok) return reportSaveFailure(reportUnavailable('save', sourceSurface));
        const built = await buildThen('save', options);
        if (!built || built.ok === false) return reportSaveFailure(built);
        if (built.isaProfile === 'IDX1')
            return reportSaveFailure({ ok: false, error: window.ChurchIDX1IDE.SAVE_MESSAGE });
        // Format/approval code consumes the registry snapshot. Restore this
        // candidate's selection if the programmer merely inspected another
        // LUMP while leaving the source draft unchanged.
        if (window.LumpRegistry && typeof window.LumpRegistry.setCurrent === 'function') {
            window.LumpRegistry.setCurrent(built.token);
        }
        // showFormatLump builds the single review/destination dialog; this
        // command never calls Save-to-NS recursively.
        if (typeof showFormatLump !== 'function') {
            return reportSaveFailure({ ok: false, error: 'The Format LUMP dialog is unavailable.' });
        }
        const review = await showFormatLump();
        if (review && review.ok === false) return reportSaveFailure(review);
        const dialog = document.getElementById('saveNSDialog');
        if (!dialog || dialog.style.display === 'none') {
            return reportSaveFailure({ ok: false,
                error: 'The review dialog did not open. Build the current source and try again.' });
        }
        return { ok: true, action: 'save', candidate: built.token };
        } catch (error) {
            console.error('Save LUMP review failed:', error);
            return reportSaveFailure({ ok: false, error:
                (error && error.name ? error.name + ': ' : '') +
                (error && error.message ? error.message : 'An internal error interrupted review preparation.') });
        } finally {
            activeOperation = null;
        }
    }
    async function exportCandidate(options) {
        if (activeOperation) return operationBusy('export');
        activeOperation = 'export';
        try {
        const sourceSurface = options && options.sourceSurface || 'asmEditor';
        const state = eligibility('export', undefined, sourceSurface);
        if (!state.ok) return reportUnavailable('export', sourceSurface);
        const built = await buildThen('export', options);
        if (!built || built.ok === false) return built;
        if (built.isaProfile === 'IDX1')
            return { ok: false, error: window.ChurchIDX1IDE.SAVE_MESSAGE };
        // Use the established canonical exporter. It owns the exact LUMP
        // layout and capability-slot representation; do not synthesize an
        // incomplete c-list in this shared command.
        if (typeof buildLumpFromAssembly !== 'function') {
            return { ok: false, error: 'The canonical LUMP exporter is unavailable.' };
        }
        let exported;
        try {
            exported = buildLumpFromAssembly(built);
        } catch (error) {
            return {
                ok: false,
                error: 'Canonical LUMP export failed: ' +
                    (error && error.message ? error.message : String(error))
            };
        }
        if (!exported || exported.ok === false) {
            return {
                ok: false,
                error: exported && exported.error || 'Canonical LUMP export did not complete.'
            };
        }
        return {
            ok: true,
            action: 'export',
            // Export names/fingerprints the final audited bytes. It may differ
            // from an older candidate metadata token, so never report that
            // stale identifier as the downloaded artifact's token.
            token: exported.token,
            candidateToken: built.token,
        };
        } finally {
            activeOperation = null;
        }
    }
    function installCandidate(options) {
        if (typeof _idx1AdmissionInFlight !== 'undefined' && _idx1AdmissionInFlight)
            return { ok: false, error: 'IDX1 admission is still in progress.' };
        const sourceSurface = options && options.sourceSurface || 'asmEditor';
        const state = eligibility('run', undefined, sourceSurface);
        if (!state.ok) return reportUnavailable('run', sourceSurface);
        // Run is not Install: a stale candidate does not replace live bytes.
        if (!candidate || !candidateIsCurrent(sourceSurface)) return { ok: true, installed: false };
        if (activeOperation) return operationBusy('install');
        if ((typeof sim !== 'undefined' && sim && sim.running) ||
                (typeof _simRunActive !== 'undefined' && _simRunActive)) {
            return {
                ok: false,
                error: 'Stop the active program before installing a candidate.'
            };
        }
        if (typeof _pendingSimLoad !== 'undefined' && _pendingSimLoad) {
            return { ok: false, error: 'A program install is already pending.' };
        }
        if ((typeof walkRunning !== 'undefined' && walkRunning) ||
                (typeof bootAnimating !== 'undefined' && bootAnimating) ||
                (typeof sim !== 'undefined' && sim && sim.walkActive)) {
            return { ok: false, error: 'Stop Walk or Boot before installing a candidate.' };
        }
        // Target authorization is an install prerequisite, not a best-effort
        // decoration. Fail closed if its infrastructure was not loaded.
        if (!window.TargetState || typeof window.TargetState.authorize !== 'function') {
            return { ok: false, error: 'Simulator target authorization is unavailable.' };
        }
        const authorization = window.TargetState.authorize('simulator', {
            id: candidate.token || candidate.abstraction,
        });
        if (!authorization || !authorization.ok) {
            return {
                ok: false,
                error: authorization && authorization.error ||
                    'Simulator target authorization failed.'
            };
        }
        if (typeof _setPendingSimLoad !== 'function') {
            return { ok: false, error: 'The safe install command is unavailable.' };
        }
        if (window.ExecutionIdentity) {
            window.ExecutionIdentity.begin({
                abstraction: candidate.abstraction,
                token: candidate.token,
                source: candidate.source,
                runKind: 'editor',
                runStatus: 'installing',
            });
        }
        _setPendingSimLoad(candidate);
        return { ok: true, installed: true, token: candidate.token };
    }
    function run(options) {
        if (typeof runSimGo !== 'function') {
            return { ok: false, error: 'The run command is unavailable.' };
        }
        // Plain Run/F5 resumes the exact loaded bytes. Building or merely
        // viewing a newer candidate does not silently replace the target.
        // Clear only the volatile install queue: otherwise the next Step/Walk
        // would unexpectedly replace the bytes Run just chose. The compiled
        // candidate itself remains available under the explicit menu action.
        if (typeof _clearPendingSimLoad === 'function') _clearPendingSimLoad();
        runSimGo(undefined, { applyPendingLoad: false });
        return { ok: true, action: 'run', token: installed && installed.token };
    }
    function runCandidate(options) {
        const install = installCandidate(options);
        if (!install.ok || !install.installed) return install.installed
            ? install : { ok: false, error: 'Build the current source before running its candidate.' };
        runSimGo();
        return { ok: true, action: 'run', token: install.token };
    }

    window.IDEActionState = {
        get: () => Object.freeze({ draft: editorSource(), candidate, saved, installed }),
        recordCandidate(value) { candidate = freezeSnapshot(value); refresh(); return candidate; },
        recordSaved(value) { saved = freezeSnapshot(value); refresh(); return saved; },
        recordInstalled(value) {
            // Callers at the install boundary must provide the pending local
            // snapshot. Falling back to the newest global candidate could
            // mislabel a newer concurrent build as the installed program.
            if (!value) return installed;
            installed = freezeSnapshot(value);
            refresh();
            return installed;
        },
        eligibility,
        refresh,
    };
    window.IDEActions = { compile, save, export: exportCandidate, installCandidate, run, runCandidate, refresh };

    document.addEventListener('input', event => {
        if (event.target && event.target.id === 'asmEditor') refresh();
    });
    document.addEventListener('keydown', event => {
        if (event.defaultPrevented || event.isComposing) return;
        const target = event.target;
        const editable = target && (target.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName || ''));
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            compile();
        } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey &&
                String(event.key).toLowerCase() === 's') {
            event.preventDefault();
            save();
        } else if (event.key === 'F5') {
            event.preventDefault();
            run();
        } else if (!editable && (event.ctrlKey || event.metaKey) &&
                String(event.key).toLowerCase() === 'e') {
            event.preventDefault();
            exportCandidate();
        }
    }, true);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', refresh);
    } else {
        refresh();
    }
}());