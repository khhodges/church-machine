// Presentation only: never cancels compilation, changes source, or saves data.
(function(root) {
    'use strict';
    let dialog, log, status, clock, close, reopen, current;
    function mount() {
        if (dialog) return;
        const style = document.createElement('style');
        style.textContent = `
          #compileProgressDialog{box-sizing:border-box;width:min(720px,94vw);max-height:90vh;background:#111827;color:#e5e7eb;border:1px solid #475569;border-radius:10px;padding:20px;box-shadow:0 20px 70px #0009}
          #compileProgressDialog::backdrop{background:#0009}
          #compileProgressDialog h2{margin:0 0 12px;font-size:18px}
          #compileProgressDialog pre{background:#080e1a;border:1px solid #334155;padding:14px;max-height:50vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 monospace}
          #compileProgressDialog footer{display:flex;justify-content:space-between;gap:16px;align-items:center}
          #compileProgressDialog button,#compileProgressReopen{background:#1e293b;color:#f8fafc;border:1px solid #64748b;border-radius:5px;padding:8px 14px;cursor:pointer}
          #compileProgressDialog button:focus-visible,#compileProgressReopen:focus-visible{outline:2px solid #facc15;outline-offset:3px}
          #compileProgressReopen{position:fixed;bottom:12px;right:12px;z-index:2000}
        `;
        document.head.appendChild(style);
        dialog = document.createElement('dialog');
        dialog.id = 'compileProgressDialog';
        dialog.setAttribute('aria-labelledby', 'compileProgressTitle');
        dialog.innerHTML = '<h2 id="compileProgressTitle">Compile console</h2>' +
            '<p role="status" id="compileProgressStatus"></p>' +
            '<pre role="log" aria-live="polite" aria-label="Compilation progress"></pre>' +
            '<footer><span aria-hidden="true"></span><button type="button">Hide — compilation continues</button></footer>';
        document.body.appendChild(dialog);
        status = dialog.querySelector('[role="status"]');
        log = dialog.querySelector('pre');
        clock = dialog.querySelector('footer span');
        close = dialog.querySelector('button');
        close.onclick = () => dialog.close();
        reopen = document.createElement('button');
        reopen.id = 'compileProgressReopen';
        reopen.textContent = 'Compile console';
        reopen.hidden = true;
        reopen.onclick = () => { reopen.hidden = true; dialog.showModal(); };
        document.body.appendChild(reopen);
        dialog.addEventListener('close', () => { reopen.hidden = false; });
    }
    function write(session, text) {
        if (current !== session) return;
        const seconds = ((Date.now() - session.start) / 1000).toFixed(1);
        log.textContent += `[${seconds}s] ${text}\n`;
        log.scrollTop = log.scrollHeight;
    }
    function stage(text) {
        if (!current || current.done) return;
        status.textContent = text;
        write(current, text);
    }
    async function run(work, options = {}) {
        mount();
        const session = {start: Date.now(), done: false};
        if (current && current.timer) clearInterval(current.timer);
        current = session;
        log.textContent = '';
        close.textContent = 'Hide — compilation continues';
        reopen.hidden = true;
        clock.textContent = 'Elapsed: 0.0s';
        if (!dialog.open) dialog.showModal();
        stage('Starting compilation…');
        session.timer = setInterval(() => {
            clock.textContent = `Elapsed: ${((Date.now() - session.start) / 1000).toFixed(1)}s`;
        }, 100);
        let success = false;
        try {
            // Give the browser a paint opportunity before synchronous parsing.
            await new Promise(resolve => setTimeout(resolve, 32));
            stage('Compiling the captured source…');
            const result = await work();
            success = !!result && result.ok !== false;
            if (current === session) {
                status.textContent = success ? 'Compilation complete' : 'Compilation failed';
                write(session, success ? 'Candidate ready. No LUMP was saved or installed.' :
                    result && result.error || 'Compilation produced no candidate.');
                if (result && result.detail) write(session, result.detail);
            }
            return result;
        } catch (error) {
            if (current === session) {
                status.textContent = 'Compilation failed';
                write(session, error && error.message || String(error));
            }
            throw error;
        } finally {
            clearInterval(session.timer);
            session.done = true;
            if (current === session) {
                clock.textContent = `Elapsed: ${((Date.now() - session.start) / 1000).toFixed(1)}s`;
                close.textContent = 'Close — view output';
                if (success && options.closeOnSuccess && dialog.open) dialog.close();
            }
        }
    }
    root.CompileProgress = {run, stage};
})(window);
