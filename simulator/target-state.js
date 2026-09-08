// Authoritative programming destination.  Requested state survives reloads;
// resolved state is deliberately recomputed from live connection observations.
(function(global) {
    'use strict';
    var KEY = 'church_programming_target_v1';
    var MODES = {
        SIMULATOR: 'simulator-ram',
        RUNTIME: 'wukong-runtime-ram',
        BITSTREAM: 'wukong-fpga-bitstream'
    };
    var requested = { mode: MODES.SIMULATOR, deviceUid: null, buildId: null };
    var live = { uid: null, sessionId: null, connected: false, seenAt: 0, runtimeArtifactId: null, runningBuildId: null };
    var bitstream = { generatedId: null, downloadedId: null };
    var listeners = [];
    try {
        var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
        if (Object.keys(MODES).some(function(k) { return MODES[k] === saved.mode; })) {
            requested.mode = saved.mode;
            requested.deviceUid = saved.deviceUid || null;
            requested.buildId = saved.buildId || null;
        }
    } catch (_) {}

    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(requested)); } catch (_) {}
    }
    function resolve() {
        var physical = requested.mode !== MODES.SIMULATOR;
        var fresh = live.connected && live.uid && live.sessionId &&
            (Date.now() - live.seenAt < 30000);
        var deviceMatches = fresh && requested.deviceUid === live.uid;
        var buildMatches = requested.mode !== MODES.BITSTREAM ||
            (!!requested.buildId && requested.buildId === live.runningBuildId);
        var ok = !physical || (deviceMatches && (requested.mode !== MODES.BITSTREAM || !!requested.buildId));
        var reason = !physical ? 'Simulator RAM selected' :
            !requested.deviceUid ? 'Unresolved: select a Wukong device UID' :
            !live.connected || !live.uid ? 'Unresolved: selected Wukong is not live' :
            !live.sessionId ? 'Unresolved: live Wukong transport session is not verified' :
            !fresh ? 'Unresolved: selected Wukong session is stale' :
            !deviceMatches ? 'Unresolved: live Wukong UID does not match selected UID' :
            requested.mode === MODES.BITSTREAM && !requested.buildId ? 'Unresolved: select an exact bitstream build' :
            'Selected Wukong is live';
        return {
            mode: requested.mode, deviceUid: requested.deviceUid, buildId: requested.buildId,
            liveUid: live.uid, liveSessionId: live.sessionId,
            runtimeArtifactId: live.runtimeArtifactId,
            liveBuildId: live.runningBuildId, fresh: !!fresh,
            deviceMatches: !!deviceMatches, buildMatches: !!buildMatches, ok: !!ok, reason: reason
        };
    }
    function notify() {
        var state = resolve();
        listeners.slice().forEach(function(fn) { try { fn(state); } catch (_) {} });
        render(state);
    }
    function select(next) {
        next = next || {};
        if (next.mode && Object.keys(MODES).some(function(k) { return MODES[k] === next.mode; })) requested.mode = next.mode;
        if (Object.prototype.hasOwnProperty.call(next, 'deviceUid')) requested.deviceUid = next.deviceUid || null;
        if (Object.prototype.hasOwnProperty.call(next, 'buildId')) requested.buildId = next.buildId || null;
        save(); notify(); return resolve();
    }
    function observeDevice(info) {
        info = info || {};
        var nextUid = info.uid || info.deviceUid || null;
        var nextSession = info.sessionId || info.session_id || null;
        // Runtime RAM is tied to a particular board *session*.  It is not
        // evidence about a replacement board, a reconnect, or a stale report.
        if (!nextUid || info.connected === false ||
            (live.uid && nextUid && live.uid !== nextUid) ||
            (live.sessionId && nextSession && live.sessionId !== nextSession)) {
            live.runtimeArtifactId = null;
        }
        live.uid = nextUid;
        live.sessionId = nextSession;
        live.connected = info.connected !== false && !!live.uid;
        live.seenAt = live.connected ? Date.now() : 0;
        if (!live.connected) live.runningBuildId = null;
        if (Object.prototype.hasOwnProperty.call(info, 'runningBuildId')) {
            live.runningBuildId = info.runningBuildId || null;
        }
        notify(); return resolve();
    }
    function observeRuntimeUpload(info) {
        info = info || {};
        // Only the bridge's correlated, successful ACK may establish runtime
        // identity. Queue acceptance is deliberately not programming evidence.
        if (info.acknowledged !== true || info.ok !== true ||
            !live.connected || !live.uid ||
            info.deviceUid !== live.uid ||
            (info.sessionId && info.sessionId !== live.sessionId) ||
            !info.artifactId) return resolve();
        live.runtimeArtifactId = info.artifactId || null;
        notify(); return resolve();
    }
    function observeBitstreamLifecycle(info) {
        info = info || {};
        if (info.generatedId) bitstream.generatedId = info.generatedId;
        if (info.downloadedId) bitstream.downloadedId = info.downloadedId;
        notify(); return resolve();
    }
    function deny(message) {
        var text = 'Programming target blocked: ' + message;
        if (typeof global.appendOutput === 'function') global.appendOutput(text, 'error');
        return { ok: false, error: text, target: resolve() };
    }
    function authorize(kind, artifact) {
        var s = resolve();
        if (kind === 'simulator') return s.mode === MODES.SIMULATOR ? { ok: true, target: s } : deny('select Simulator RAM before changing simulator memory.');
        var wanted = kind === 'bitstream' ? MODES.BITSTREAM : MODES.RUNTIME;
        if (s.mode !== wanted) return deny('select ' + (wanted === MODES.BITSTREAM ? 'Wukong FPGA — Bitstream' : 'Wukong RAM — Runtime Upload') + '.');
        if (!s.ok) return deny(s.reason + '.');
        if (!artifact || !artifact.id) return deny('an exact artifact/build identity is required.');
        if (kind === 'bitstream' && artifact.id !== s.buildId) return deny('selected build does not match the requested bitstream build.');
        return { ok: true, target: s, request: {
            target_device_uid: s.deviceUid,
            target_session_id: s.liveSessionId,
            target_uid: s.deviceUid,
            device_uid: s.deviceUid,
            artifact_identity: artifact.id,
            artifact_id: artifact.id,
            build_id: kind === 'bitstream' ? artifact.id : undefined
        } };
    }
    // Destination-only authorization is used before the server materialises a
    // Wukong-native upload. The server, not the browser, derives that payload's
    // digest/size/identity and returns them for ACK correlation.
    function authorizeDestination(kind) {
        var s = resolve();
        var wanted = kind === 'bitstream' ? MODES.BITSTREAM : MODES.RUNTIME;
        if (s.mode !== wanted) return deny('select ' +
            (wanted === MODES.BITSTREAM ? 'Wukong FPGA — Bitstream' : 'Wukong RAM — Runtime Upload') + '.');
        if (!s.ok) return deny(s.reason + '.');
        return { ok: true, target: s, request: {
            target_device_uid: s.deviceUid,
            target_session_id: s.liveSessionId,
            target_uid: s.deviceUid,
            device_uid: s.deviceUid
        } };
    }
    function render(s) {
        var sel = document.getElementById('programmingTargetSelect');
        var status = document.getElementById('programmingTargetStatus');
        var targetIdent = document.getElementById('programmingTargetIdentity');
        var runtimeIdent = document.getElementById('programmingRuntimeIdentity');
        var bitstreamIdent = document.getElementById('programmingBitstreamIdentity');
        if (sel) sel.value = s.mode;
        if (status) status.textContent = s.ok ? s.reason : s.reason;
        if (targetIdent) targetIdent.textContent = s.mode === MODES.SIMULATOR ?
            'Target: browser simulator' : 'Target UID: ' + (s.deviceUid || 'Unresolved');
        if (runtimeIdent) runtimeIdent.textContent =
            'Runtime RAM: ' + (s.runtimeArtifactId || 'no correlated upload reported');
        if (bitstreamIdent) bitstreamIdent.textContent =
            'Generated: ' + (bitstream.generatedId || 'not reported') +
            ' · downloaded: ' + (bitstream.downloadedId || 'not reported') +
            ' · programmed: external tool / not verified' +
            ' · running reported: ' + (s.liveBuildId || 'not reported') +
            (s.buildId ? ' · selected: ' + s.buildId : '');
        var downloadControls = document.querySelectorAll
            ? document.querySelectorAll('[data-bitstream-download]') : [];
        downloadControls.forEach(function(el) {
            var enabled = s.mode === MODES.BITSTREAM && s.ok;
            el.setAttribute('aria-disabled', enabled ? 'false' : 'true');
            el.classList.toggle('is-target-blocked', !enabled);
            el.title = enabled ? '' :
                'Select a live Wukong and its exact provenance build in FPGA — Bitstream mode first.';
        });
    }
    document.addEventListener('DOMContentLoaded', function() {
        var sel = document.getElementById('programmingTargetSelect');
        var uid = document.getElementById('programmingTargetUid');
        var build = document.getElementById('programmingTargetBuild');
        var control = document.getElementById('programmingTargetControl');
        var toggle = document.getElementById('programmingTargetToggle');
        function setDetailsExpanded(expanded) {
            if (!control || !toggle) return;
            control.classList.toggle('is-collapsed', !expanded);
            toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            toggle.setAttribute('aria-label', expanded ?
                'Hide programming target details' : 'Show programming target details');
            toggle.title = expanded ?
                'Hide programming target details' : 'Show programming target details';
            try { localStorage.setItem('church_programmingTargetDetailsExpanded', expanded ? '1' : '0'); }
            catch (_) {}
        }
        var detailsExpanded = false;
        try { detailsExpanded = localStorage.getItem('church_programmingTargetDetailsExpanded') === '1'; }
        catch (_) {}
        setDetailsExpanded(detailsExpanded);
        if (toggle) toggle.addEventListener('click', function() {
            setDetailsExpanded(toggle.getAttribute('aria-expanded') !== 'true');
        });
        if (sel) sel.addEventListener('change', function() { select({ mode: sel.value }); });
        if (uid) {
            uid.value = requested.deviceUid || '';
            uid.addEventListener('change', function() { select({ deviceUid: uid.value.trim() || null }); });
        }
        if (build) {
            build.value = requested.buildId || '';
            build.addEventListener('change', function() { select({ buildId: build.value.trim() || null }); });
        }
        // Links are deliberately guarded at click time too: a stale rendered
        // state or keyboard activation must never become a physical download
        // bypass.
        document.addEventListener('click', function(event) {
            var link = event.target.closest && event.target.closest('[data-bitstream-download]');
            if (!link) return;
            var buildId = link.getAttribute('data-build-id') || requested.buildId;
            var auth = authorize('bitstream', { id: buildId });
            if (!auth.ok) {
                event.preventDefault();
            }
        });
        notify();
    });
    global.TargetState = { MODES: MODES, select: select, observeDevice: observeDevice,
        observeRuntimeUpload: observeRuntimeUpload, observeBitstreamLifecycle: observeBitstreamLifecycle, resolve: resolve,
        authorize: authorize, authorizeDestination: authorizeDestination,
        onChange: function(fn) { listeners.push(fn); fn(resolve()); return function() { listeners = listeners.filter(function(x) { return x !== fn; }); }; } };
})(window);