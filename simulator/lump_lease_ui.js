'use strict';

// Small, DOM-free lease/wait contract adapter.  The server may call these
// fields lease, wait, or operation; this keeps the IDE tolerant while making
// sure private account identifiers never reach the screen.
function _lumpLeaseSafeIdentity(value) {
    if (!value || typeof value === 'object') {
        value = value && (value.display_name || value.display_identity ||
            value.label || value.name);
    }
    if (!value) return 'Another IDE session';
    return String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) ||
        'Another IDE session';
}

function _lumpLeaseStage(value) {
    var stage = String(value || 'updating').toLowerCase().replace(/[_-]+/g, ' ');
    if (stage.indexOf('prepar') === 0) return 'preparing';
    if (stage.indexOf('compil') !== -1 || stage.indexOf('verif') !== -1) {
        return 'compiling and verifying';
    }
    if (stage.indexOf('approv') !== -1) return 'approving';
    if (stage.indexOf('activ') !== -1 || stage.indexOf('commit') !== -1) {
        return 'activating';
    }
    return stage || 'updating';
}

function _lumpLeaseInfo(response) {
    var body = response && typeof response === 'object' ? response : {};
    var lease = body.lease || body.wait || body.lock || body.conflict || body;
    lease = lease && typeof lease === 'object' ? lease : {};
    var operation = lease.operation_label || lease.operation || lease.action ||
        body.operation_label || body.operation || 'this LUMP';
    var identity = _lumpLeaseSafeIdentity(lease.holder || lease.holder_identity ||
        lease.display_identity || body.holder_identity || body.holder);
    var dotName = lease.canonical_dot_name || lease.dot_name ||
        body.canonical_dot_name || body.dot_name ||
        body.identity || '';
    var started = lease.started_at || lease.start_time || lease.started ||
        body.started_at || body.start_time;
    var stage = _lumpLeaseStage(lease.stage || lease.current_stage ||
        body.stage || body.current_stage);
    var operationId = lease.operation_id || body.operation_id || '';
    var urls = body.actions || body.links || lease.actions || lease.links || {};
    return {
        holder: identity,
        operation: String(operation).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100),
        dotName: String(dotName || '').slice(0, 160),
        startedAt: started,
        stage: stage,
        operationId: String(operationId || '').slice(0, 128),
        messageUrl: urls.message || urls.message_url || lease.message_url ||
            body.message_url || '/api/lumps/lease/message',
        cancelUrl: urls.cancel || urls.cancel_url || lease.cancel_url ||
            body.cancel_url || '/api/lumps/lease/cancel',
    };
}

function _lumpLeaseMessagePayload(info, text) {
    info = info || {};
    return { dot_name: String(info.dotName || ''), operation_id: String(info.operationId || ''),
        text: String(text || '') };
}

function _lumpLeaseCancelPayload(info) {
    info = info || {};
    return { dot_name: String(info.dotName || ''), operation_id: String(info.operationId || '') };
}

function _lumpLeaseCopyDotName(dotName) {
    var base = String(dotName || 'LUMP').trim().replace(/[^A-Za-z0-9_.-]+/g, '-');
    base = base.replace(/^[.-]+|[.-]+$/g, '') || 'LUMP';
    return (base + '.Copy').slice(0, 160);
}

function _lumpLeaseStartedText(value, formatter) {
    if (!value) return 'just now';
    try {
        var date = new Date(value);
        if (!isNaN(date.getTime())) {
            return typeof formatter === 'function' ? formatter(date) :
                date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        }
    } catch (_) {}
    return String(value).slice(0, 40);
}

function _lumpLeaseWaitingMessage(response, formatter) {
    var info = _lumpLeaseInfo(response);
    var name = info.dotName ? ' ' + info.dotName : '';
    var operation = info.operation && info.operation.toLowerCase() !==
        String(info.dotName || '').toLowerCase() ? ' ' + info.operation : '';
    return info.holder + ' is ' + info.stage + operation + name +
        '. Started ' + _lumpLeaseStartedText(info.startedAt, formatter) +
        '. Your draft is safe and will continue when this update finishes.';
}

function _lumpLeaseIsWaiting(response, status) {
    return !!(response && (response.lease_waiting || response.waiting ||
        response.lease_held || response.locked || status === 409 || status === 423) &&
        (response.lease || response.wait || response.lock || response.holder ||
            response.holder_identity || response.waiting));
}

function _lumpLeaseUrl(response, kind) {
    var info = _lumpLeaseInfo(response);
    return kind === 'message' ? info.messageUrl : info.cancelUrl;
}

function _lumpLeaseRenewPayload(info) {
    return { dot_name: String(info && info.dotName || ''),
        operation_id: String(info && info.operationId || '') };
}

function _lumpLeaseRenewUrl(response) {
    var info = _lumpLeaseInfo(response);
    var lease = response && response.lease || {};
    var actions = response && (response.actions || response.links) || {};
    return actions.renew || lease.renew_url || response.renew_url ||
        '/api/lumps/lease/renew';
}

function _lumpLeaseWaitUrl(response) {
    var lease = response && response.lease || {};
    var actions = response && (response.actions || response.links) || {};
    return actions.wait || lease.wait_url || response.wait_url ||
        '/api/lumps/lease/wait';
}

function _lumpLeaseStartHeartbeat(fetchImpl, response, intervalMs) {
    var info = _lumpLeaseInfo(response);
    var timer = null;
    var stopped = false;
    var tick = function() {
        if (stopped) return;
        return fetchImpl(_lumpLeaseRenewUrl(response), {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(_lumpLeaseRenewPayload(info)),
        }).catch(function() {});
    };
    timer = setInterval(tick, intervalMs || 30000);
    return function() { stopped = true; if (timer) clearInterval(timer); };
}

function _lumpLeasePoll(fetchImpl, response, onReleased, intervalMs) {
    var stopped = false;
    var info = _lumpLeaseInfo(response);
    var tick = function() {
        if (stopped) return;
        return fetchImpl(_lumpLeaseWaitUrl(response), {
            method: 'POST',
            cache: 'no-store',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(_lumpLeaseRenewPayload(info)),
        }).then(function(r) {
            if (!r || r.ok !== true) return;
            return r.json().then(function(body) {
                if (!body || body.waiting !== false) return;
                if (!stopped && typeof onReleased === 'function') {
                    stopped = true;
                    clearInterval(timer);
                    onReleased(body);
                }
            });
        }).catch(function() {});
    };
    var timer = setInterval(tick, intervalMs || 5000);
    return function() { stopped = true; clearInterval(timer); };
}

if (typeof window !== 'undefined') {
    window.LumpLeaseUI = {
        info: _lumpLeaseInfo,
        isWaiting: _lumpLeaseIsWaiting,
        message: _lumpLeaseWaitingMessage,
        url: _lumpLeaseUrl,
        safeIdentity: _lumpLeaseSafeIdentity,
        stage: _lumpLeaseStage,
        messagePayload: _lumpLeaseMessagePayload,
        cancelPayload: _lumpLeaseCancelPayload,
        copyDotName: _lumpLeaseCopyDotName,
        renewPayload: _lumpLeaseRenewPayload,
        renewUrl: _lumpLeaseRenewUrl,
        waitUrl: _lumpLeaseWaitUrl,
        startHeartbeat: _lumpLeaseStartHeartbeat,
        poll: _lumpLeasePoll,
    };
}

if (typeof module !== 'undefined') {
    module.exports = {
        _lumpLeaseInfo,
        _lumpLeaseIsWaiting,
        _lumpLeaseWaitingMessage,
        _lumpLeaseUrl,
        _lumpLeaseSafeIdentity,
        _lumpLeaseStage,
        _lumpLeaseMessagePayload,
        _lumpLeaseCancelPayload,
        _lumpLeaseCopyDotName,
        _lumpLeaseRenewPayload,
        _lumpLeaseRenewUrl,
        _lumpLeaseWaitUrl,
        _lumpLeaseStartHeartbeat,
        _lumpLeasePoll,
    };
}