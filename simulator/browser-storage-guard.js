// Never replace durable editor storage with an in-memory fallback.
(function () {
    'use strict';
    try {
        void window.localStorage.length;
        void window.sessionStorage.length;
        window.churchBrowserStorageBlocked = false;
        return;
    } catch (_) {
        window.churchBrowserStorageBlocked = true;
    }
    function showStorageNotice() {
        const notice = document.createElement('section');
        notice.id = 'browser-storage-notice';
        notice.setAttribute('role', 'alert');
        notice.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#161625;color:#eee;padding:48px 24px;font:16px/1.6 system-ui;overflow:auto';
        notice.innerHTML = '<div style="max-width:650px;margin:8vh auto">' +
            '<h1>Browser storage is blocked in this preview</h1>' +
            '<p>The IDE cannot safely load your local drafts and settings in this embedded frame. ' +
            'It has not replaced or cleared them.</p>' +
            '<p>Open the IDE directly, or allow storage access for this frame.</p>' +
            '<p><a id="storage-open-ide" target="_blank" rel="noopener noreferrer" ' +
            'style="color:#ffcc66;font-weight:bold">Open IDE in a new tab</a></p>' +
            '<button id="storage-allow" type="button" style="padding:10px 16px">Allow storage and reload</button>' +
            '<p id="storage-access-status" aria-live="polite"></p></div>';
        document.body.appendChild(notice);
        notice.querySelector('#storage-open-ide').href = window.location.href;
        const button = notice.querySelector('#storage-allow');
        const status = notice.querySelector('#storage-access-status');
        button.addEventListener('click', async function () {
            if (typeof document.requestStorageAccess !== 'function') {
                status.textContent = 'This browser cannot grant access here. Use Open IDE in a new tab.';
                return;
            }
            try {
                await document.requestStorageAccess();
                void window.localStorage.length;
                void window.sessionStorage.length;
                window.location.reload();
            } catch (_) {
                status.textContent = 'Storage access is still blocked. Use Open IDE in a new tab or allow site storage in your browser settings.';
            }
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', showStorageNotice, {once: true});
    } else {
        showStorageNotice();
    }
})();
