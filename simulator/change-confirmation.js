(function () {
    'use strict';
    var queue = Promise.resolve();
    // Audit delivery is independent of the mutation promise. Never retry the
    // mutation (or approval) because this best-effort notification failed.
    function reportRejection(details, outcome) {
        if (!details.review_id) return; // Local source-only reviews have no server intent.
        try {
            var report = new Request(new URL('/api/change-reviews/reject', window.location.href), {
                method: 'POST', credentials: 'same-origin', keepalive: true,
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({review_id: details.review_id, outcome: outcome}),
            });
            Promise.resolve(nativeFetch(report)).then(function (response) {
                if (!response || !response.ok) throw new Error('Audit delivery failed');
            }).catch(auditDeliveryFailed);
        } catch (_) { auditDeliveryFailed(); }
    }
    function auditDeliveryFailed() {
        // No request data, review credentials, or source text in diagnostics.
        if (window.console) window.console.warn(
            'Change remains cancelled. Its rejection audit could not be delivered. No mutation was retried.');
    }

    var DIFF_CELL_LIMIT = 2000000; // Bounded LCS work; larger middles fall back to block replace.
    function splitLines(text) { return String(text).split('\n'); }
    // Returns rows: {type:'same'|'del'|'add'|'mod', oldNo, oldText, newNo, newText}.
    function diffRows(before, after) {
        var a = splitLines(before), b = splitLines(after);
        var start = 0, endA = a.length, endB = b.length;
        while (start < endA && start < endB && a[start] === b[start]) start++;
        while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
        var ops = []; // [kind, aIndex, bIndex]
        var i, j;
        for (i = 0; i < start; i++) ops.push(['=', i, i]);
        var n = endA - start, m = endB - start;
        if (n && m && (n + 1) * (m + 1) <= DIFF_CELL_LIMIT) {
            var w = m + 1, t = new Uint32Array((n + 1) * w);
            for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) {
                t[i * w + j] = a[start + i] === b[start + j] ? t[(i + 1) * w + j + 1] + 1 :
                    Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
            }
            i = 0; j = 0;
            while (i < n || j < m) {
                if (i < n && j < m && a[start + i] === b[start + j]) { ops.push(['=', start + i, start + j]); i++; j++; }
                else if (j < m && (i >= n || t[i * w + j + 1] >= t[(i + 1) * w + j])) { ops.push(['+', -1, start + j]); j++; }
                else { ops.push(['-', start + i, -1]); i++; }
            }
        } else {
            for (i = start; i < endA; i++) ops.push(['-', i, -1]);
            for (j = start; j < endB; j++) ops.push(['+', -1, j]);
        }
        for (i = endA, j = endB; i < a.length; i++, j++) ops.push(['=', i, j]);
        var rows = [], k = 0;
        while (k < ops.length) {
            if (ops[k][0] === '=') {
                rows.push({type: 'same', oldNo: ops[k][1] + 1, oldText: a[ops[k][1]], newNo: ops[k][2] + 1, newText: b[ops[k][2]]});
                k++; continue;
            }
            var dels = [], adds = [];
            while (k < ops.length && ops[k][0] !== '=') { (ops[k][0] === '-' ? dels : adds).push(ops[k]); k++; }
            for (var r = 0; r < Math.max(dels.length, adds.length); r++) {
                var d = dels[r], ad = adds[r];
                rows.push({type: d && ad ? 'mod' : d ? 'del' : 'add',
                    oldNo: d ? d[1] + 1 : null, oldText: d ? a[d[1]] : null,
                    newNo: ad ? ad[2] + 1 : null, newText: ad ? b[ad[2]] : null});
            }
        }
        return rows;
    }
    var MONO = 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.45;';
    function cell(text, css) {
        var el = document.createElement('div');
        el.style.cssText = css;
        el.textContent = text;
        return el;
    }
    function renderDiff(before, after, labels) {
        labels = labels || {};
        var wrap = document.createElement('div');
        wrap.setAttribute('role', 'table');
        wrap.setAttribute('aria-label', 'Source changes, Before and After side by side');
        wrap.style.cssText = 'max-height:50vh;overflow:auto;border:1px solid #3a4a66;border-radius:6px;background:#0f1828;margin:8px 0';
        var grid = document.createElement('div');
        grid.style.cssText = MONO + 'display:grid;grid-template-columns:3.5em 1.4em minmax(260px,1fr) 3.5em 1.4em minmax(260px,1fr);min-width:640px';
        var head = 'position:sticky;top:0;background:#22314b;color:#e8b94f;font-weight:600;padding:4px 8px;border-bottom:1px solid #3a4a66;';
        grid.appendChild(cell(labels.before || 'Before', head + 'grid-column:1 / span 3'));
        grid.appendChild(cell(labels.after || 'After', head + 'grid-column:4 / span 3;border-left:1px solid #3a4a66'));
        var rows = diffRows(before, after);
        var DEL = 'background:#4a1d24;color:#ffd7d7;', ADD = 'background:#173d27;color:#d3f5dc;',
            SAME = 'color:#c9d3e3;', EMPTY = 'background:#141e30;';
        var num = 'text-align:right;padding:0 6px;opacity:.6;user-select:none;';
        var cue = 'text-align:center;user-select:none;font-weight:700;';
        var txt = 'white-space:pre-wrap;overflow-wrap:anywhere;min-width:0;padding:0 8px;';
        rows.forEach(function (row) {
            var hasOld = row.oldNo !== null, hasNew = row.newNo !== null;
            var oc = row.type === 'same' ? SAME : hasOld ? DEL : EMPTY;
            var nc = row.type === 'same' ? SAME : hasNew ? ADD : EMPTY;
            grid.appendChild(cell(hasOld ? String(row.oldNo) : '', num + oc));
            grid.appendChild(cell(row.type !== 'same' && hasOld ? '-' : '', cue + oc));
            grid.appendChild(cell(hasOld ? row.oldText : '', txt + oc));
            grid.appendChild(cell(hasNew ? String(row.newNo) : '', num + nc + 'border-left:1px solid #3a4a66;'));
            grid.appendChild(cell(row.type !== 'same' && hasNew ? '+' : '', cue + nc));
            grid.appendChild(cell(hasNew ? row.newText : '', txt + nc));
        });
        wrap.appendChild(grid);
        return wrap;
    }
    function renderChanges(list, labels) {
        var container = document.createElement('div');
        container.style.cssText = 'max-height:60vh;overflow:auto';
        var bi = -1, ai = -1;
        list.forEach(function (c, idx) {
            if (typeof c !== 'string') return;
            if (bi < 0 && c.indexOf('Before:\n') === 0) bi = idx;
            else if (bi >= 0 && ai < 0 && c.indexOf('After:\n') === 0) ai = idx;
        });
        var rest = [];
        function flush() {
            if (!rest.length) return;
            var pre = document.createElement('pre');
            pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:45vh;overflow:auto';
            pre.textContent = rest.join('\n\n');
            container.appendChild(pre);
            rest = [];
        }
        list.forEach(function (c, idx) {
            if (idx === ai) return;
            if (idx === bi && ai >= 0) {
                flush();
                container.appendChild(renderDiff(c.slice(8), list[ai].slice(7), labels));
                return;
            }
            rest.push(c);
        });
        flush();
        return container;
    }
    window._sourceDiffRows = diffRows;
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
            dialog.appendChild(renderChanges(details.changes || [], details.comparisonLabels));
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
            function finish(value, outcome) {
                if (settled) return;
                settled = true;
                if (window.removeEventListener) window.removeEventListener('pagehide', dismissed);
                dialog.remove();
                if (previous && previous.isConnected) previous.focus();
                if (!value) reportRejection(details, outcome || 'dismissed');
                resolve(value);
            }
            function dismissed() { finish(false, 'dismissed'); }
            reject.onclick = function () { finish(false, 'rejected'); };
            confirm.onclick = function () { finish(true); };
            dialog.addEventListener('cancel', function (event) {
                event.preventDefault();
                finish(false);
            });
            dialog.addEventListener('close', function () { finish(false); });
            if (window.addEventListener) window.addEventListener('pagehide', dismissed);
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
    window.confirmSourceReplacement = async function (editor, after, reason, labels) {
        if (!editor) return false;
        var before = editor.value;
        var epoch = window._editorNavigationEpoch;
        if (before === after) return true;
        var approved = await window.confirmProtectedChange({
            title: 'Replace editor source',
            reason: reason,
            comparisonLabels: labels ? {
                before: labels.before + ' (' + splitLines(before).length + ' lines, ' + before.length + ' characters)',
                after: labels.after + ' (' + splitLines(after).length + ' lines, ' + after.length + ' characters)',
            } : undefined,
            changes: ['Before:\n' + before, 'After:\n' + after,
                ...(labels && after.length > 0 && before.length > after.length && before.startsWith(after)
                    ? ['The proposed replacement is only the opening portion of the current editor text. Its remaining code is absent from this copy—not hidden by the preview. Confirming replaces the full editor text with this shorter copy.']
                    : []),
                'This review does not save or compile the replacement.'],
        });
        return approved && editor.value === before &&
            (editor.isConnected === undefined || editor.isConnected) &&
            window._editorNavigationEpoch === epoch;
    };
    var nativeFetch = window.fetch.bind(window);
    var mutationQueue = Promise.resolve();
    function needsReview(url) {
        if (url.origin !== window.location.origin) return false;
        var path = url.pathname;
        if (['/api/namespace/image-refresh/prepare', '/api/namespace/review-upgrades',
            '/api/lumps/save-plan', '/api/lumps/finalize',
            '/api/lumps/save-diagnostics', '/api/lumps/approval-intent',
            '/api/lumps/deploy-authorize'].includes(path) ||
            path.startsWith('/api/lumps/lease')) return false;
        return ['/api/lump/', '/api/lumps/', '/api/boot-config',
            '/api/boot-image/', '/api/namespace/', '/api/source-file/']
            .some(function (prefix) { return path.startsWith(prefix); });
    }
    window.fetch = async function (input, options) {
        var method = String((options && options.method) ||
            (input instanceof Request && input.method) || 'GET').toUpperCase();
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
            return nativeFetch(input, options);
        }
        var request = new Request(input instanceof Request ? input :
            new URL(input, window.location.href), options);
        if (!needsReview(new URL(request.url))) return nativeFetch(request);
        // Queue the entire review/commit, not merely the visible dialogs.
        // Otherwise later intents bind pre-commit state (and first-use session
        // cookies) before an earlier approved mutation has completed.
        var beforeCommit = options && options.beforeConfirmedMutation;
        var result = mutationQueue.then(function () { return reviewedFetch(request, beforeCommit); });
        mutationQueue = result.catch(function () {});
        return result;
    };
    async function reviewedFetch(request, beforeCommit) {
        if (beforeCommit) beforeCommit();
        var response = await nativeFetch(request.clone());
        if (response.status !== 428 || new URL(request.url).origin !== window.location.origin) return response;
        var payload;
        try { payload = await response.clone().json(); } catch (_) { return response; }
        if (payload.error !== 'change_confirmation_required' || !payload.change_confirmation) return response;
        var approved = await window.confirmProtectedChange(payload.change_confirmation);
        if (!approved || request.signal.aborted) {
            if (approved) reportRejection(payload.change_confirmation, 'dismissed');
            return new Response(JSON.stringify({
                error: 'change_rejected', committed: false,
                message: 'You rejected the change. Protected data was not changed.',
            }), {status: 409, headers: {'Content-Type': 'application/json'}});
        }
        var headers = new Headers(request.headers);
        if (beforeCommit) beforeCommit();
        headers.set('X-Change-Confirmation', payload.change_confirmation.id);
        // One retry only. Expiry, stale state and replay require a new action.
        return nativeFetch(new Request(request, {headers: headers}));
    }
})();