(function () {
    'use strict';
    var queue = Promise.resolve();
    function show(details) {
        return new Promise(function (resolve) {
            var previous = document.activeElement;
            var dialog = document.createElement('dialog');
            dialog.setAttribute('aria-label', details.title || 'Review protected change');
            dialog.style.cssText = 'max-width:760px;width:85vw;max-height:85vh;overflow:auto;background:#172235;color:#fff;border:2px solid #e8b94f;border-radius:8px;padding:24px;z-index:2147483647';
            var title = document.createElement('h2');
            title.textContent = '⚠ ' + (details.title || 'Review protected change');
            dialog.appendChild(title);
            var reason = document.createElement('p');
            reason.textContent = details.reason || 'This action changes protected data.';
            dialog.appendChild(reason);
            var changes = document.createElement('pre');
            changes.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:45vh;overflow:auto';
            changes.textContent = (details.changes || []).join('\n\n');
            dialog.appendChild(changes);
            var reject = document.createElement('button');
            reject.textContent = 'Reject — keep unchanged';
            var confirm = document.createElement('button');
            confirm.textContent = 'Confirm this change';
            [reject, confirm].forEach(function (button) {
                button.type = 'button';
                button.style.cssText = 'margin:8px;padding:10px;cursor:pointer';
                dialog.appendChild(button);
            });
            var settled = false;
            function finish(value) {
                if (settled) return;
                settled = true;
                dialog.remove();
                if (previous && previous.isConnected) previous.focus();
                resolve(value);
            }
            reject.onclick = function () { finish(false); };
            confirm.onclick = function () { finish(true); };
            dialog.addEventListener('cancel', function (event) {
                event.preventDefault();
                finish(false);
            });
            dialog.addEventListener('close', function () { finish(false); });
            document.body.appendChild(dialog);
            // Browsers without a modal dialog implementation must fail closed.
            if (typeof dialog.showModal !== 'function') { finish(false); return; }
            try { dialog.showModal(); } catch (_) { finish(false); return; }
            reject.focus();
        });
    }
    window.confirmProtectedChange = function (details) {
        var result = queue.then(function () { return show(details); });
        queue = result.catch(function () { return false; });
        return result;
    };
    window.confirmSourceReplacement = async function (editor, after, reason) {
        if (!editor) return false;
        var before = editor.value;
        var epoch = window._editorNavigationEpoch;
        if (before === after) return true;
        var approved = await window.confirmProtectedChange({
            title: 'Replace editor source',
            reason: reason,
            changes: ['Before:\n' + before, 'After:\n' + after,
                'This review does not save or compile the replacement.'],
        });
        return approved && editor.value === before &&
            (editor.isConnected === undefined || editor.isConnected) &&
            window._editorNavigationEpoch === epoch;
    };
    var nativeFetch = window.fetch.bind(window);
    window.fetch = async function (input, options) {
        var method = String((options && options.method) ||
            (input instanceof Request && input.method) || 'GET').toUpperCase();
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
            return nativeFetch(input, options);
        }
        var request = new Request(input instanceof Request ? input :
            new URL(input, window.location.href), options);
        var response = await nativeFetch(request.clone());
        if (response.status !== 428 || new URL(request.url).origin !== window.location.origin) return response;
        var payload;
        try { payload = await response.clone().json(); } catch (_) { return response; }
        if (payload.error !== 'change_confirmation_required' || !payload.change_confirmation) return response;
        var approved = await window.confirmProtectedChange(payload.change_confirmation);
        if (!approved || request.signal.aborted) {
            return new Response(JSON.stringify({
                error: 'change_rejected', committed: false,
                message: 'You rejected the change. Protected data was not changed.',
            }), {status: 409, headers: {'Content-Type': 'application/json'}});
        }
        var headers = new Headers(request.headers);
        headers.set('X-Change-Confirmation', payload.change_confirmation.id);
        // One retry only. Expiry, stale state and replay require a new action.
        return nativeFetch(new Request(request, {headers: headers}));
    };
})();