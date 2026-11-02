/* Browser-local hardware connection policy. No board commands on toggle. */
(function () {
    'use strict';
    const key = 'church.ide.bridge.enabled';
    let enabled = true;
    try { enabled = localStorage.getItem(key) !== 'false'; } catch (_) {}
    let generation = 0;
    const pending = new Set();
    const nativeFetch = window.fetch.bind(window);
    const stopped = () => new DOMException('Bridge is Off in this IDE. Turn Bridge On to use hardware.', 'AbortError');

    // One boundary covers all Wukong consumers, including Testing and uploads.
    // Unrelated requests retain the native fetch behavior.
    window.fetch = async function (input, init) {
        const url = new URL(typeof input === 'string' || input instanceof URL
            ? input : input.url, window.location.href);
        if (url.origin !== window.location.origin ||
                !/^\/hardware\/wukong(?:\/|$)/.test(url.pathname)) {
            return nativeFetch(input, init);
        }
        if (!enabled) throw stopped();
        const epoch = generation;
        const controller = new AbortController();
        const signal = init?.signal || input?.signal;
        const abort = () => controller.abort();
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, {once: true});
        pending.add(controller);
        try {
            const response = await nativeFetch(input, {...init, signal: controller.signal});
            if (!enabled || epoch !== generation) throw stopped();
            // A response body may finish after Off, or after a quick Off/On.
            for (const method of ['json', 'text', 'blob', 'arrayBuffer', 'formData']) {
                const consume = response[method].bind(response);
                response[method] = async function () {
                    const value = await consume();
                    if (!enabled || epoch !== generation) throw stopped();
                    return value;
                };
            }
            return response;
        } finally {
            pending.delete(controller);
            signal?.removeEventListener('abort', abort);
        }
    };

    function render() {
        const button = document.getElementById('ideBridgeToggle');
        if (!button) return;
        button.textContent = enabled ? 'Wukong: On' : 'Wukong: Off';
        button.setAttribute('aria-checked', String(enabled));
        button.title = 'IDE hardware connection only. Off stops monitoring and blocks new hardware requests. It does not stop the board or the external bridge.';
    }
    function setEnabled(value, persist = true) {
        if (enabled === value) { render(); return; }
        enabled = value;
        generation++;
        if (!enabled) pending.forEach(controller => controller.abort());
        if (persist) {
            try { localStorage.setItem(key, String(enabled)); } catch (_) {}
        }
        render();
        window.dispatchEvent(new CustomEvent('ide-bridge-change', {detail: {enabled}}));
    }
    window.IDEBridge = {isEnabled: () => enabled, setEnabled,
        toggle: () => setEnabled(!enabled)};
    document.addEventListener('DOMContentLoaded', render);
    window.addEventListener('storage', event => {
        if (event.key === key) setEnabled(event.newValue !== 'false', false);
    });
})();
