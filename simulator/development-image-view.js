/* Development Image as an IDE view. The read-only review and FPGA send
 * workflow stays in the same-origin content-only app; this shell owns the
 * header, navigation, hash route and the exact saved Namespace selection. */
(function(root) {
    'use strict';
    const VIEW = 'development-image';
    const APP = '/development-image/';
    let selection = '';
    // One-shot, in-memory user request from Build Approval. Never derived from
    // the URL, so reloads and selections cannot start preparation.
    let pendingLoad = null;
    let loadCounter = 0;
    function deliverLoad() {
        const el = frame();
        if (!pendingLoad || !el || !el.contentWindow) return;
        el.contentWindow.postMessage({type: 'development-image:load',
            namespace: pendingLoad.namespace, requestId: pendingLoad.requestId}, root.location.origin);
    }
    function requestLoad(namespace) {
        if (typeof namespace !== 'string' || !namespace || namespace.startsWith('bitstream:')) return false;
        loadCounter += 1;
        pendingLoad = {namespace, requestId: 'ba-' + Date.now().toString(36) + '-' + loadCounter};
        show(namespace);
        deliverLoad();
        return true;
    }

    function parseHash(hash) {
        const raw = String(hash || '').replace(/^#/, '');
        const at = raw.indexOf('?');
        const view = at < 0 ? raw : raw.slice(0, at);
        const params = new URLSearchParams(at < 0 ? '' : raw.slice(at + 1));
        return {view, namespace: params.get('namespace') || ''};
    }
    function routeFor(namespace) {
        return '#' + VIEW + (namespace ? '?namespace=' + encodeURIComponent(namespace) : '');
    }
    function frameSrc(namespace) {
        return APP + (namespace ? '?namespace=' + encodeURIComponent(namespace) : '');
    }
    function isActive() { return !!document.getElementById(VIEW)?.classList.contains('active'); }
    function frame() { return document.getElementById('developmentImageFrame'); }
    function syncHash() {
        if (parseHash(root.location.hash).view !== VIEW && !isActive()) return;
        const next = routeFor(selection);
        if (root.location.hash !== next)
            root.history.replaceState(null, '', root.location.pathname + root.location.search + next);
    }
    function load(force) {
        const el = frame();
        if (!el) return;
        const src = frameSrc(selection);
        if (force || el.getAttribute('src') !== src) el.setAttribute('src', src);
    }
    function show(namespace) {
        if (typeof namespace === 'string') {
            selection = namespace;
            root.NamespaceSelection?.remember(selection);
        } else selection = root.NamespaceSelection?.read() ?? selection;
        load(false);
        if (!isActive()) root.switchView(VIEW); else syncHash();
    }
    async function openFromNamespace(query) {
        try {
            const response = await fetch('/api/development-image/open?' + query, {cache: 'no-store'});
            if (!response.ok) {
                let message = 'Development Image could not open the saved Namespace.';
                try { message = (await response.json()).error || message; } catch (_) { /* keep default */ }
                throw Error(message);
            }
            const linked = new URL(response.url, root.location.href).searchParams.get('namespace');
            if (!linked) throw Error('The saved Namespace identity was not returned. Nothing was changed or sent.');
            show(linked);
        } catch (error) {
            root.alert(error.message + ' Nothing was changed or sent.');
        }
    }

    // Capture a linked selection before the shell rewrites the hash to the bare view id.
    const initial = parseHash(root.location.hash);
    if (initial.view === VIEW && initial.namespace) {
        selection = initial.namespace;
        root.NamespaceSelection?.remember(selection);
    }

    const original = root.switchView;
    if (typeof original === 'function' && !original._developmentImage) {
        const wrapped = function(viewId) {
            const result = original.apply(this, arguments);
            if (viewId === VIEW && isActive()) {
                selection = root.NamespaceSelection?.read() ?? selection;
                load(false); syncHash();
            }
            return result;
        };
        wrapped._developmentImage = true;
        root.switchView = wrapped;
    }

    // Back/forward and pasted links: follow the hash route and its selection.
    root.addEventListener('hashchange', () => {
        const route = parseHash(root.location.hash);
        if (route.view !== VIEW) {
            const views = Array.from(document.querySelectorAll('.view')).map(v => v.id);
            if (isActive() && views.includes(route.view)) root.switchView(route.view);
            return;
        }
        if (route.namespace) selection = route.namespace;
        show();
    });

    // The embedded app reports selection changes and its content height.
    root.addEventListener('message', event => {
        const el = frame();
        if (!el || event.origin !== root.location.origin || event.source !== el.contentWindow) return;
        const data = event.data || {};
        if (data.type === 'development-image:ready') {
            deliverLoad();
        } else if (data.type === 'development-image:load-accepted') {
            if (pendingLoad && data.requestId === pendingLoad.requestId) pendingLoad = null;
        } else if (data.type === 'development-image:selection' && typeof data.namespace === 'string') {
            selection = data.namespace;
            syncHash();
            deliverLoad();
        } else if (data.type === 'development-image:height' && Number.isFinite(data.height)) {
            el.style.height = Math.max(480, Math.ceil(data.height)) + 'px';
        } else if (data.type === 'development-image:navigate' && data.view === 'namespace') {
            root.switchView('namespace');
        }
    });

    root.DevelopmentImageView = {show, openFromNamespace, requestLoad,
        pendingLoad: () => pendingLoad, parseHash, routeFor, frameSrc,
        selection: () => selection};
})(window);
