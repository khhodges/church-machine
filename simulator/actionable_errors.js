'use strict';

function _actionableReason(body) {
    var parsed = body;
    if (typeof body === 'string') {
        try { parsed = JSON.parse(body); } catch (_err) { parsed = null; }
    }
    var reason = parsed && (parsed.error || parsed.reason || parsed.message);
    if (!reason && typeof body === 'string') {
        var plain = body.replace(/\s+/g, ' ').trim();
        if (plain && plain[0] !== '<') reason = plain.slice(0, 240);
    }
    return reason || 'The server did not provide a reason.';
}

function _formatActionableHttpError(operation, status, body, options) {
    var opts = options || {};
    var changed = opts.dataChanged === true
        ? 'Data may have changed.'
        : (opts.dataChanged === false ? 'No data was changed.' : 'Data-change status is unknown.');
    var next = opts.nextAction ||
        'Retry the operation. If it fails again, inspect the server logs using the same operation and status.';
    return operation + ' failed (HTTP ' + status + '). Reason: ' + _actionableReason(body) +
        ' ' + changed + ' Next: ' + next;
}

function _formatActionableNetworkError(operation, error, options) {
    var opts = options || {};
    var reason = error && error.message
        ? error.message
        : 'The request could not reach the server.';
    var changed = opts.dataChanged === true
        ? 'Data may have changed.'
        : (opts.dataChanged === false ? 'No data was changed.' : 'Data-change status is unknown.');
    var next = opts.nextAction || 'Check your connection, then retry the operation.';
    return operation + ' failed. Reason: ' + reason + ' ' + changed + ' Next: ' + next;
}

async function _actionableResponseError(response, operation, options) {
    var body = '';
    try {
        body = typeof response.text === 'function'
            ? await response.text()
            : (typeof response.json === 'function' ? await response.json() : '');
    } catch (_err) {}
    return new Error(_formatActionableHttpError(operation, response.status, body, options));
}

async function _actionableJsonResponse(response, operation, options) {
    var body = '';
    var parsed;
    if (typeof response.text === 'function') {
        try { body = await response.text(); } catch (_err) {}
        try { parsed = JSON.parse(body); } catch (_err) {}
    } else if (typeof response.json === 'function') {
        try { parsed = await response.json(); } catch (_err) {}
    }
    if (parsed === undefined) {
        if (!response.ok) {
            throw new Error(_formatActionableHttpError(operation, response.status, body, options));
        }
        throw new Error(
            operation + ' failed. Reason: The server returned an invalid response. ' +
            (options && options.dataChanged === false ? 'No data was changed. ' : 'Data-change status is unknown. ') +
            'Next: ' + ((options && options.nextAction) || 'Retry the operation, then inspect the server logs.')
        );
    }
    if (!response.ok || (parsed && parsed.ok === false)) {
        throw new Error(_formatActionableHttpError(operation, response.status, parsed, options));
    }
    return parsed;
}

if (typeof window !== 'undefined') {
    window._actionableReason = _actionableReason;
    window._formatActionableHttpError = _formatActionableHttpError;
    window._formatActionableNetworkError = _formatActionableNetworkError;
    window._actionableResponseError = _actionableResponseError;
    window._actionableJsonResponse = _actionableJsonResponse;
}

if (typeof module !== 'undefined') {
    module.exports = {
        _actionableReason,
        _formatActionableHttpError,
        _formatActionableNetworkError,
        _actionableResponseError,
        _actionableJsonResponse,
    };
}