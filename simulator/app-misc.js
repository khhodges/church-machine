function saveUploadJSON() {
    const editor = document.getElementById('asmEditor');
    if (!editor || !cloomcCompiler) return;
    const source = editor.value;
    const con = document.getElementById('editorConsole');

    const result = cloomcCompiler.compile(source, []);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        if (con) con.textContent = `CLOOMC++ compilation errors:\n${errText}`;
        return;
    }

    const unresolved = [];
    const uploadCaps = (result.capabilities || []).map((capName) => {
        let target = -1;
        if (sim && sim.abstractionRegistry) {
            const allAbs = sim.abstractionRegistry.abstractions || [];
            for (let i = 0; i < allAbs.length; i++) {
                if (allAbs[i] && allAbs[i].name && allAbs[i].name.toUpperCase() === capName.toUpperCase()) {
                    target = i;
                    break;
                }
            }
        }
        if (target < 0) unresolved.push(capName);
        return { target: target, name: capName, grants: ['E'] };
    });

    const doc = buildDocBlock(result, source);

    const uploadProfile = result.profile || 'IoT';

    const upload = {
        abstraction: result.abstractionName || 'Unnamed',
        type: 'abstraction',
        grants: ['E'],
        capabilities: uploadCaps,
        methods: result.methods.map(m => ({
            name: m.name,
            code: m.code.map(w => '0x' + (w >>> 0).toString(16).padStart(8, '0'))
        })),
        doc: doc,
        profile: uploadProfile
    };

    const json = JSON.stringify(upload, null, 2);

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (result.abstractionName || 'upload') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const langNames3 = { english: 'English', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', javascript: 'JavaScript', lambda: 'Lambda Calculus' };
    const lang = langNames3[result.language] || 'JavaScript';
    let listing = `Upload JSON saved as "${a.download}"\n\n`;
    listing += `CLOOMC++ [${lang}] compiled "${result.abstractionName}":\n`;
    listing += `  Profile: ${uploadProfile}${result.targetDirective ? ' (@target ' + result.targetDirective + ')' : ' (auto-detected)'}\n`;
    listing += `  Methods: ${upload.methods.length}\n`;
    listing += `  Capabilities: ${upload.capabilities.length} (${upload.capabilities.map(c => c.name).join(', ') || 'none'})\n`;
    listing += `  Grants: ${upload.grants.join(', ')}\n`;
    if (unresolved.length > 0) {
        listing += `  WARNING: Unresolved capabilities: ${unresolved.join(', ')} (target=-1, boot system to resolve)\n`;
    }
    listing += `\nUpload JSON preview:\n${json}`;

    if (con) con.textContent = listing;
    appendOutput(`Saved upload JSON for "${result.abstractionName}"`, 'info');
}

function buildDocBlock(result, source) {
    const settings = getStudentSettings();
    const sel = document.getElementById('langSelector');
    const lang = sel ? sel.value : (result.language || 'javascript');
    const langNames = { english: 'English', javascript: 'JavaScript', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', lambda: 'Lambda Calculus', assembly: 'Assembly' };
    const caps = result.capabilities || [];
    const methods = (result.methods || []).map(m => ({
        name: m.name,
        params: m.params || [],
        instructions: (m.code || []).length
    }));

    const lines = source.split('\n');
    const sourcePreview = lines.slice(0, 20).join('\n') + (lines.length > 20 ? '\n...' : '');

    return {
        author: settings.name || 'Anonymous',
        date: new Date().toISOString().split('T')[0],
        language: lang,
        languageLabel: langNames[lang] || lang,
        description: `${methods.length} method${methods.length !== 1 ? 's' : ''}, ${caps.length} capabilit${caps.length !== 1 ? 'ies' : 'y'}, language: ${langNames[lang] || lang}`,
        tags: [],
        methods: methods,
        capabilities: caps,
        sourcePreview: sourcePreview
    };
}

async function exportSimulatorToGitHub() {
    const btn = document.getElementById('dashTab-export');
    if (btn) btn.textContent = 'Pushing...';

    const phases = [];
    phases.push({ heading: '=== Push to GitHub ===', lines: ['Connecting to GitHub API...'] });

    var tok = showGitHubConsole(phases, 'push', 'Connecting to GitHub...');

    try {
        const r = await fetch('/api/github/export-simulator', { method: 'POST' });
        const data = await r.json();
        if (data.ok) {
            const fileLines = (data.pushed || []).map(function(f) { return '  + ' + f; });
            appendGitHubPhase({ heading: '--- Files Pushed ---', lines: fileLines }, tok);
            appendGitHubPhase({ heading: '=== Push Complete ===', lines: [
                'Total files exported: ' + data.total,
                'All files pushed successfully.'
            ]}, tok);
            updateGitHubStatus('Push complete — ' + data.total + ' files exported.', false, tok);
        } else {
            const msg = data.errors ? data.errors.join('\n') : (data.error || 'Unknown error');
            const pushed = data.pushed ? data.pushed.length : 0;
            appendGitHubPhase({ heading: '--- Push Results ---', lines: [
                'Files pushed: ' + pushed,
                '',
                'Errors:',
                msg
            ]}, tok);
            updateGitHubStatus('Push completed with errors.', true, tok);
        }
    } catch (e) {
        appendGitHubPhase({ heading: '--- Error ---', lines: [
            'Push failed: ' + e.message,
            '',
            'Check that GitHub is configured and accessible.'
        ]}, tok);
        updateGitHubStatus('Push failed — ' + e.message, true, tok);
    } finally {
        if (btn) btn.textContent = 'Push to GitHub';
    }
}

let libraryCache = null;
let libraryAllItems = [];

async function showLibrary() {
    if (!requirePermission('browseLibrary', 'Browse Library')) return;

    const phases = [];
    phases.push({ heading: '=== Get from GitHub ===', lines: ['Connecting to Mum Tunnel Library...'] });
    var tok = showGitHubConsole(phases, 'get', 'Fetching library index...');

    const repoLink = document.getElementById('libraryGitHubLink');
    let repoUrl = '';
    if (repoLink) {
        repoLink.href = '/api/library/repo-url';
        try {
            const r = await fetch('/api/library/repo-url');
            if (r.ok) {
                const data = await r.json();
                if (data.url) { repoLink.href = data.url; repoUrl = data.url; }
            }
        } catch (e) {}
    }

    try {
        const langFilter = document.getElementById('libraryLangFilter');
        const langParam = langFilter && langFilter.value ? '?language=' + langFilter.value : '';
        const resp = await fetch('/api/library/browse' + langParam);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        libraryAllItems = data.items || [];

        if (libraryAllItems.length > 0) {
            const itemLines = libraryAllItems.slice(0, 20).map(function(item) {
                var doc = item.doc || {};
                return '  ' + (item.name || 'Untitled') + ' — ' + (doc.language || 'unknown') + ' by ' + (doc.author || 'Anonymous');
            });
            if (libraryAllItems.length > 20) itemLines.push('  ... and ' + (libraryAllItems.length - 20) + ' more');
            appendGitHubPhase({ heading: '--- Abstractions Found ---', lines: itemLines }, tok);
            appendGitHubPhase({ heading: '=== Fetch Complete ===', lines: [
                'Found ' + libraryAllItems.length + ' shared abstractions.',
                repoUrl ? 'Repository: ' + repoUrl : ''
            ]}, tok);
            updateGitHubStatus('Loaded ' + libraryAllItems.length + ' abstractions. Opening library...', false, tok);
        } else {
            appendGitHubPhase({ heading: '=== Library Empty ===', lines: [
                'No shared abstractions found.',
                'Be the first to publish!'
            ]}, tok);
            updateGitHubStatus('Library is empty.', false, tok);
        }

        var capturedItems = libraryAllItems;
        _ghAutoCloseTimer = setTimeout(function() {
            _ghAutoCloseTimer = null;
            if (tok === _ghConsoleToken) {
                closeGitHubConsole();
                document.getElementById('libraryModal').style.display = 'flex';
                renderLibraryGrid(capturedItems);
            }
        }, 1500);

    } catch (e) {
        appendGitHubPhase({ heading: '--- Error ---', lines: [
            'Could not load library: ' + e.message,
            '',
            'Check your network connection and try again.'
        ]}, tok);
        updateGitHubStatus('Fetch failed — ' + e.message, true, tok);
    }
}

async function loadLibraryItems() {
    const grid = document.getElementById('libraryGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="library-loading">Loading shared abstractions...</div>';

    try {
        const langFilter = document.getElementById('libraryLangFilter');
        const langParam = langFilter && langFilter.value ? `?language=${langFilter.value}` : '';
        const resp = await fetch(`/api/library/browse${langParam}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        libraryAllItems = data.items || [];
        renderLibraryGrid(libraryAllItems);
    } catch (e) {
        grid.innerHTML = `<div class="library-empty">Could not load library: ${e.message}</div>`;
    }
}

function renderLibraryGrid(items) {
    const grid = document.getElementById('libraryGrid');
    if (!grid) return;

    if (items.length === 0) {
        grid.innerHTML = '<div class="library-empty">No shared abstractions yet. Be the first to publish!</div>';
        return;
    }

    let html = '';
    for (const item of items) {
        const doc = item.doc || {};
        const langClass = 'lang-' + (doc.language || 'javascript');
        const langLabel = doc.languageLabel || doc.language || 'Unknown';
        const tags = (doc.tags || []);
        html += '<div class="library-card">';
        html += `<div class="library-card-name">${escapeHTML(item.name || 'Untitled')}</div>`;
        html += `<div class="library-card-meta">`;
        html += `<span class="library-lang-badge ${langClass}">${escapeHTML(langLabel)}</span>`;
        html += `<span>by ${escapeHTML(doc.author || 'Anonymous')}</span>`;
        html += `<span>${escapeHTML(doc.date || '')}</span>`;
        html += `</div>`;
        html += `<div class="library-card-desc">${escapeHTML(doc.description || '')}</div>`;
        if (tags.length > 0) {
            html += '<div class="library-card-tags">';
            for (const t of tags) html += `<span class="library-tag">${escapeHTML(t)}</span>`;
            html += '</div>';
        }
        html += `<div class="library-card-actions">`;
        html += `<button class="btn btn-primary" onclick="importFromLibrary('${escapeHTML(item.path || '')}')">Import</button>`;
        html += `</div>`;
        html += '</div>';
    }
    grid.innerHTML = html;
}

function escapeHTML(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}

function filterLibrary() {
    const search = (document.getElementById('librarySearch').value || '').toLowerCase();
    const langFilter = document.getElementById('libraryLangFilter').value;

    let filtered = libraryAllItems;
    if (langFilter) {
        filtered = filtered.filter(item => (item.doc && item.doc.language) === langFilter);
    }
    if (search) {
        filtered = filtered.filter(item => {
            const name = (item.name || '').toLowerCase();
            const desc = (item.doc && item.doc.description || '').toLowerCase();
            const author = (item.doc && item.doc.author || '').toLowerCase();
            const tags = (item.doc && item.doc.tags || []).join(' ').toLowerCase();
            return name.includes(search) || desc.includes(search) || author.includes(search) || tags.includes(search);
        });
    }
    renderLibraryGrid(filtered);
}

function publishToLibrary() {
    if (!requirePermission('publish', 'Publish to Library')) return;

    if (_isSourceStale()) {
        appendOutput('Publish blocked — source has been edited since last Patch. Click Patch to recompile and run before publishing.', 'error');
        return;
    }
    const cleanRuns = _getConsecutiveCleanRuns();
    if (cleanRuns < 5) {
        appendOutput(`Publish blocked — requires 5 consecutive clean runs (you have ${cleanRuns}). Click Patch then Run repeatedly. The code must halt cleanly with no faults each time.`, 'error');
        return;
    }

    const settings = getStudentSettings();
    if (!settings.openSource) {
        appendOutput('Publish blocked — Open Source membership required. Open Settings and tick "Open Source member" to agree to the CLOOMC Open Source licence before publishing.', 'error');
        return;
    }

    const editor = document.getElementById('asmEditor');
    if (!editor || !cloomcCompiler) return;
    const source = editor.value;

    const result = cloomcCompiler.compile(source, []);
    if (result.errors.length > 0) {
        alert('Compile first — there are errors in the current source.');
        return;
    }

    const doc = buildDocBlock(result, source);
    const preview = document.getElementById('publishPreview');
    if (preview) {
        preview.textContent = `Abstraction: ${result.abstractionName}\nMethods: ${doc.methods.map(m => m.name).join(', ')}\nCapabilities: ${doc.capabilities.join(', ') || 'none'}\nLanguage: ${doc.languageLabel}\nAuthor: ${doc.author}`;
    }

    document.getElementById('publishDescription').value = doc.description;
    document.getElementById('publishTags').value = '';
    document.getElementById('publishModal').style.display = 'flex';
    document.getElementById('publishModal')._compiledResult = result;
    document.getElementById('publishModal')._source = source;
}

async function confirmPublish() {
    const modal = document.getElementById('publishModal');
    const result = modal._compiledResult;
    const source = modal._source;
    if (!result) return;

    const description = document.getElementById('publishDescription').value.trim();
    const tagsRaw = document.getElementById('publishTags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

    const doc = buildDocBlock(result, source);
    doc.description = description || doc.description;
    doc.tags = tags;

    const uploadCaps = (result.capabilities || []).map((capName) => {
        return { target: -1, name: capName, grants: ['E'] };
    });

    const settings = getStudentSettings();
    const payload = {
        abstraction: result.abstractionName || 'Unnamed',
        type: 'abstraction',
        grants: ['E'],
        capabilities: uploadCaps,
        methods: result.methods.map(m => ({
            name: m.name,
            code: m.code.map(w => '0x' + (w >>> 0).toString(16).padStart(8, '0'))
        })),
        doc: doc,
        source: source,
        profile: result.profile || 'IoT',
        simTestPassed: _getConsecutiveCleanRuns() >= 5,
        mtbfScore: _getConsecutiveCleanRuns(),
        totalRuns: _simRunHistory.filter(r => r.hash === _simRunHash).length,
        openSourceConsent: !!settings.openSource
    };

    try {
        const resp = await fetch('/api/library/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        modal.style.display = 'none';
        appendOutput(`Published "${result.abstractionName}" to Mum Tunnel Library`, 'info');
        await loadLibraryItems();
    } catch (e) {
        alert(`Publish failed: ${e.message}`);
    }
}

async function importFromLibrary(path) {
    try {
        const resp = await fetch(`/api/library/get/${encodeURIComponent(path)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data.source) {
            const editor = document.getElementById('asmEditor');
            if (editor) {
                editor.value = data.source;
                updateLineNumbers();
                saveEditorState();
            }

            if (data.doc && data.doc.language) {
                const sel = document.getElementById('langSelector');
                if (sel) {
                    sel.value = data.doc.language;
                    onLangChange(true);
                }
            }

            document.getElementById('libraryModal').style.display = 'none';
            appendOutput(`Imported "${data.abstraction || path}" from Mum Tunnel Library`, 'info');
            switchCodeTab('console');
        }
    } catch (e) {
        alert(`Import failed: ${e.message}`);
    }
}

let docsLoaded = false;
let _pendingDocAnchorNav = false;
let docsData = null;

async function loadDocsView() {
    if (docsLoaded) return;
    try {
        const resp = await fetch('/api/docs/list');
        docsData = await resp.json();
        renderDocsFileList();
        docsLoaded = true;
        if (!_pendingDocAnchorNav) {
            loadDoc('quick-start.md');
        }
    } catch (e) {
        const body = document.getElementById('docsContentBody');
        if (body) body.innerHTML = '<div class="docs-placeholder">Failed to load document list.</div>';
    }
}

function filterDocsList(query) {
    const q = (query || '').trim().toLowerCase();
    const docsList = document.getElementById('docsFileList');
    const figsList = document.getElementById('docsFigureList');
    const figsTitle = document.querySelector('.docs-figures-title');
    if (!docsList || !figsList) return;

    const groups = docsList.querySelectorAll('.docs-chapter-group');
    if (groups.length > 0) {
        groups.forEach(group => {
            const items = group.querySelectorAll('.docs-file-item');
            let visible = 0;
            items.forEach(item => {
                const match = !q || item.textContent.toLowerCase().includes(q);
                item.style.display = match ? '' : 'none';
                if (match) visible++;
            });
            group.style.display = visible ? '' : 'none';
        });
    } else {
        docsList.querySelectorAll('.docs-file-item').forEach(item => {
            item.style.display = !q || item.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
    }

    let figVisible = 0;
    figsList.querySelectorAll('.docs-file-item').forEach(item => {
        const match = !q || item.textContent.toLowerCase().includes(q);
        item.style.display = match ? '' : 'none';
        if (match) figVisible++;
    });
    if (figsTitle) figsTitle.style.display = (figVisible || !q) ? '' : 'none';
}

function renderDocsFileList() {
    const docsList = document.getElementById('docsFileList');
    const figsList = document.getElementById('docsFigureList');
    if (!docsList || !figsList || !docsData) return;
    const searchInput = document.getElementById('docsSearch');
    if (searchInput) searchInput.value = '';

    if (docsData.chapters && docsData.chapters.length > 0) {
        let chapterNum = 0;
        docsList.innerHTML = docsData.chapters.map(ch => {
            chapterNum++;
            const items = ch.docs.map((d, i) => {
                const sizeKB = (d.size / 1024).toFixed(1);
                const label = d.name.replace('.md', '');
                return `<div class="docs-file-item" onclick="loadDoc('${d.name}')" data-doc="${d.name}"><span class="docs-chapter-num">${chapterNum}.${i + 1}</span><span>${label}</span><span class="file-size">${sizeKB} KB</span></div>`;
            }).join('');
            return `<div class="docs-chapter-group"><div class="docs-chapter-title">${ch.title}</div>${items}</div>`;
        }).join('');
    } else {
        docsList.innerHTML = docsData.docs.map(d => {
            const sizeKB = (d.size / 1024).toFixed(1);
            const label = d.name.replace('.md', '');
            return `<div class="docs-file-item" onclick="loadDoc('${d.name}')" data-doc="${d.name}"><span>${label}</span><span class="file-size">${sizeKB} KB</span></div>`;
        }).join('');
    }

    figsList.innerHTML = docsData.figures.map(f => {
        const label = f.name.replace('.html', '');
        const sizeKB = (f.size / 1024).toFixed(1);
        return `<div class="docs-file-item" onclick="loadFigure('${f.name}')" data-fig="${f.name}"><span>${label}</span><span class="file-size">${sizeKB} KB</span></div>`;
    }).join('');
}

async function loadDoc(filename, anchor) {
    document.querySelectorAll('.docs-file-item').forEach(el => el.classList.remove('active'));
    const active = document.querySelector(`.docs-file-item[data-doc="${filename}"]`);
    if (active) active.classList.add('active');

    const title = document.getElementById('docsContentTitle');
    const body = document.getElementById('docsContentBody');
    if (title) title.textContent = filename;
    if (body) body.innerHTML = '<div class="docs-placeholder">Loading...</div>';

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        const sidebar = document.querySelector('.docs-sidebar');
        if (sidebar) sidebar.classList.add('docs-sidebar-collapsed');
    }

    try {
        const resp = await fetch('/api/docs/read/' + filename);
        const data = await resp.json();
        if (body) {
            body.innerHTML = renderMarkdown(data.content);
            if (anchor) {
                const anchorId = anchor.replace(/^#/, '');
                const target = body.querySelector('#' + CSS.escape(anchorId));
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    } catch (e) {
        if (body) body.innerHTML = '<div class="docs-placeholder">Failed to load document.</div>';
    }

    if (isMobile && !anchor) {
        const docsView = document.getElementById('docs');
        if (docsView) docsView.scrollTop = 0;
    }
}

async function openDocAnchor(filename, anchor) {
    _pendingDocAnchorNav = true;
    switchView('docs');
    try {
        await loadDoc(filename, anchor);
    } finally {
        _pendingDocAnchorNav = false;
    }
}

function loadFigure(filename) {
    document.querySelectorAll('.docs-file-item').forEach(el => el.classList.remove('active'));
    const active = document.querySelector(`.docs-file-item[data-fig="${filename}"]`);
    if (active) active.classList.add('active');

    const title = document.getElementById('docsContentTitle');
    const body = document.getElementById('docsContentBody');
    const label = filename.replace('.html', '');
    if (title) title.textContent = 'Figure: ' + label;
    if (body) body.innerHTML = `<iframe class="docs-figure-frame" src="/docs/figures/${filename}"></iframe>`;

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        const sidebar = document.querySelector('.docs-sidebar');
        if (sidebar) sidebar.classList.add('docs-sidebar-collapsed');
        const docsView = document.getElementById('docs');
        if (docsView) docsView.scrollTop = 0;
    }
}

function docsBackToList() {
    const sidebar = document.querySelector('.docs-sidebar');
    if (sidebar) {
        sidebar.classList.remove('docs-sidebar-collapsed');
        sidebar.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function _mdSlug(text) {
    return text.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function renderMarkdown(md) {
    let html = escapeHtml(md);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
        return '<pre><code>' + code.trim() + '</code></pre>';
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+)$/gm, (m, txt) => `<h3 id="${_mdSlug(txt)}">${txt}</h3>`);
    html = html.replace(/^## (.+)$/gm, (m, txt) => `<h2 id="${_mdSlug(txt)}">${txt}</h2>`);
    html = html.replace(/^# (.+)$/gm, (m, txt) => `<h1 id="${_mdSlug(txt)}">${txt}</h1>`);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;margin:8px 0;border-radius:6px;">');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    html = html.replace(/^---$/gm, '<hr>');
    html = html.replace(/^\> (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^\|(.+)\|$/gm, (match, row) => {
        const cells = row.split('|').map(c => c.trim());
        if (cells.every(c => !c || /^[-:]+$/.test(c))) return '';
        return '<tr>' + cells.filter(c => c).map(c => {
            return '<td>' + c + '</td>';
        }).join('') + '</tr>';
    });
    html = html.replace(/((<tr>.*<\/tr>\n?)+)/g, '<table>$1</table>');
    html = html.replace(/<tr><\/tr>/g, '');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    const lines = html.split('\n');
    const result = [];
    let inPre = false;
    for (const line of lines) {
        if (line.includes('<pre>')) inPre = true;
        if (line.includes('</pre>')) inPre = false;
        if (!inPre && line.trim() && !line.startsWith('<')) {
            result.push('<p>' + line + '</p>');
        } else {
            result.push(line);
        }
    }
    return result.join('\n');
}

var _nextStepsHidden = true;

function toggleNextSteps() {
    _nextStepsHidden = !_nextStepsHidden;
    const box = document.getElementById('nextStepsBox');
    if (!box) return;
    const body = box.querySelector('.next-steps-body');
    const arrow = box.querySelector('.next-steps-arrow');
    if (body) body.style.display = _nextStepsHidden ? 'none' : '';
    if (arrow) arrow.textContent = _nextStepsHidden ? '▶' : '▼';
}

function showNextSteps(context) {
    _nextStepsHidden = false;   // always expand when a new context is shown
    const box = document.getElementById('nextStepsBox');
    if (!box) return;

    const link = (label, view) => `<a class="next-step-link" href="#" onclick="event.preventDefault();switchView('${view}')">${label}</a>`;
    const btn  = (icon, label, fn, extra) =>
        `<button class="next-step-btn${extra ? ' ' + extra : ''}" onclick="${fn}" title="${label}">${icon} ${label}</button>`;
    const steps = {
        'compiled': `
            <div class="next-step-actions">
                ${btn('\uD83D\uDC63', 'Step', 'stepSim()')}
                ${btn('\uD83D\uDEB6', 'Walk', 'walkToggle()', 'ns-btn-walk')}
                ${link('Open Lump', 'lumps')}
            </div>`,
        'assembled': `
            <div class="next-step-actions">
                ${btn('\uD83D\uDC63', 'Step', 'stepSim()')}
                ${btn('\uD83D\uDEB6', 'Walk', 'walkToggle()', 'ns-btn-walk')}
                ${btn('\uD83C\uDFC3', 'Run', 'onRunBtnClick()', 'ns-btn-run')}
                ${link('Open Lump', 'lumps')}
            </div>`,
        'ran-clean': `
            <div class="next-step-actions">
                ${btn('\uD83D\uDC63', 'Step', 'stepSim()')}
                ${btn('\uD83D\uDEB6', 'Walk', 'walkToggle()', 'ns-btn-walk')}
                ${btn('\uD83C\uDFC3', 'Run', 'onRunBtnClick()', 'ns-btn-run')}
                ${link('Open Lump', 'lumps')}
            </div>`,
        'ran-fault': `
            <div class="next-step-actions">
                ${btn('\uD83D\uDC63', 'Step', 'stepSim()')}
                ${btn('\uD83D\uDEB6', 'Walk', 'walkToggle()', 'ns-btn-walk')}
                ${btn('\uD83C\uDFC3', 'Run', 'onRunBtnClick()', 'ns-btn-run')}
                ${link('Open Lump', 'lumps')}
            </div>`,
        'created': ``,
        'error': ``,
        'draft': ``
    };

    const bodyHTML = steps[context] || '';
    if (!bodyHTML) { box.innerHTML = ''; return; }

    const arrowChar = _nextStepsHidden ? '▶' : '▼';
    const bodyDisplay = _nextStepsHidden ? 'display:none' : '';
    box.innerHTML = `<div class="next-steps-header" onclick="toggleNextSteps()"><span class="next-steps-arrow">${arrowChar}</span><span class="next-steps-label">Next Steps</span></div><div class="next-steps-body" style="${bodyDisplay}">${bodyHTML}</div>`;
}

function initConsoleAutoSwitch() {
    const con = document.getElementById('editorConsole');
    if (!con) return;
    const observer = new MutationObserver(function() {
        if (currentView === 'editor') {
            switchCodeTab('console');
        }
    });
    observer.observe(con, { childList: true, characterData: true, subtree: true });
}

function initEditorDivider() {
    const divider = document.getElementById('editorDivider');
    if (!divider) return;
    const layout = divider.parentElement;
    const panels = layout.querySelectorAll('.editor-panel');
    if (panels.length < 2) return;
    const leftPanel = panels[0];
    const rightPanel = panels[1];
    let dragging = false;

    divider.addEventListener('mousedown', function(e) {
        e.preventDefault();
        dragging = true;
        divider.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        const rect = layout.getBoundingClientRect();
        const leftPct = Math.max(15, Math.min(85, ((e.clientX - rect.left) / rect.width) * 100));
        const rightPct = 100 - leftPct;
        leftPanel.style.flex = 'none';
        leftPanel.style.width = leftPct + '%';
        rightPanel.style.flex = 'none';
        rightPanel.style.width = rightPct + '%';
    });

    document.addEventListener('mouseup', function() {
        if (!dragging) return;
        dragging = false;
        divider.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    divider.addEventListener('touchstart', function(e) {
        e.preventDefault();
        dragging = true;
        divider.classList.add('dragging');
    }, { passive: false });

    document.addEventListener('touchmove', function(e) {
        if (!dragging) return;
        const touch = e.touches[0];
        const rect = layout.getBoundingClientRect();
        const leftPct = Math.max(15, Math.min(85, ((touch.clientX - rect.left) / rect.width) * 100));
        const rightPct = 100 - leftPct;
        leftPanel.style.flex = 'none';
        leftPanel.style.width = leftPct + '%';
        rightPanel.style.flex = 'none';
        rightPanel.style.width = rightPct + '%';
    }, { passive: true });

    document.addEventListener('touchend', function() {
        if (!dragging) return;
        dragging = false;
        divider.classList.remove('dragging');
    });
}

function initReplDivider() {
    const divider = document.getElementById('replDivider');
    if (!divider) return;
    const layout = divider.parentElement;
    const panel = layout.querySelector('.repl-panel');
    const sidebar = layout.querySelector('.repl-sidebar');
    let dragging = false;

    divider.addEventListener('mousedown', function(e) {
        e.preventDefault();
        dragging = true;
        divider.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        const rect = layout.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const total = rect.width - 10;
        const leftPct = Math.max(15, Math.min(85, (x / rect.width) * 100));
        const rightPct = 100 - leftPct;
        panel.style.flex = 'none';
        panel.style.width = leftPct + '%';
        sidebar.style.flex = 'none';
        sidebar.style.width = rightPct + '%';
    });

    document.addEventListener('mouseup', function() {
        if (!dragging) return;
        dragging = false;
        divider.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    divider.addEventListener('touchstart', function(e) {
        e.preventDefault();
        dragging = true;
        divider.classList.add('dragging');
    }, { passive: false });

    document.addEventListener('touchmove', function(e) {
        if (!dragging) return;
        const touch = e.touches[0];
        const rect = layout.getBoundingClientRect();
        const leftPct = Math.max(15, Math.min(85, ((touch.clientX - rect.left) / rect.width) * 100));
        const rightPct = 100 - leftPct;
        panel.style.flex = 'none';
        panel.style.width = leftPct + '%';
        sidebar.style.flex = 'none';
        sidebar.style.width = rightPct + '%';
    }, { passive: true });

    document.addEventListener('touchend', function() {
        if (!dragging) return;
        dragging = false;
        divider.classList.remove('dragging');
    });
}

function initTabOverflow(container) {
    if (!container || container.dataset.overflowInit) return;
    container.dataset.overflowInit = '1';

    var hamburger = document.createElement('button');
    hamburger.className = 'tab-overflow-btn';
    hamburger.innerHTML = '\u2630';
    hamburger.title = 'More tabs';

    var dropdown = document.createElement('div');
    dropdown.className = 'tab-overflow-dropdown';

    container.appendChild(hamburger);
    document.body.appendChild(dropdown);

    function closeDropdown() { dropdown.classList.remove('open'); }

    hamburger.addEventListener('click', function(e) {
        e.stopPropagation();
        var rect = hamburger.getBoundingClientRect();
        var top = rect.bottom + 2;
        var left = rect.right - 160;
        if (left < 4) left = 4;
        if (top + 200 > window.innerHeight) top = rect.top - 200;
        dropdown.style.top = top + 'px';
        dropdown.style.left = left + 'px';
        dropdown.style.right = '';
        dropdown.classList.toggle('open');
    });

    document.addEventListener('click', closeDropdown);

    dropdown.addEventListener('click', function(e) {
        e.stopPropagation();
    });

    function updateOverflow() {
        var tabs = Array.from(container.querySelectorAll('.math-mode-tab, .sidebar-tab'));
        tabs.forEach(function(t) { t.classList.remove('overflow-hidden'); });
        hamburger.classList.remove('visible', 'has-active');
        dropdown.innerHTML = '';
        dropdown.classList.remove('open');

        var visibleTabs = tabs.filter(function(t) { return t.style.display !== 'none'; });
        if (visibleTabs.length === 0) return;

        var totalTabWidth = 0;
        var tabWidths = [];
        visibleTabs.forEach(function(t) {
            var w = t.getBoundingClientRect().width;
            tabWidths.push(w);
            totalTabWidth += w;
        });

        var containerWidth = container.getBoundingClientRect().width;
        if (totalTabWidth <= containerWidth) return;

        hamburger.classList.add('visible');
        var hbWidth = hamburger.getBoundingClientRect().width || 36;
        var availableWidth = containerWidth - hbWidth;
        var usedWidth = 0;
        var overflowedTabs = [];
        var hasActiveInOverflow = false;

        for (var i = 0; i < visibleTabs.length; i++) {
            if (usedWidth + tabWidths[i] > availableWidth) {
                overflowedTabs.push(visibleTabs[i]);
            } else {
                usedWidth += tabWidths[i];
            }
        }

        if (overflowedTabs.length === 0) {
            hamburger.classList.remove('visible');
            return;
        }

        overflowedTabs.forEach(function(tab) {
            tab.classList.add('overflow-hidden');
            var item = document.createElement('button');
            item.textContent = tab.textContent;
            if (tab.classList.contains('active')) {
                item.classList.add('active');
                hasActiveInOverflow = true;
            }
            item.addEventListener('click', function() {
                tab.click();
                dropdown.classList.remove('open');
                setTimeout(updateOverflow, 50);
            });
            dropdown.appendChild(item);
        });

        if (hasActiveInOverflow) {
            hamburger.classList.add('has-active');
        }
    }

    var observer = new ResizeObserver(function() {
        requestAnimationFrame(updateOverflow);
    });
    observer.observe(container);

    var updating = false;
    var mutObserver = new MutationObserver(function(mutations) {
        if (updating) return;
        var dominated = mutations.some(function(m) {
            return m.target.classList.contains('tab-overflow-btn') || m.target.classList.contains('tab-overflow-dropdown');
        });
        if (dominated) return;
        updating = true;
        setTimeout(function() { updateOverflow(); updating = false; }, 20);
    });
    mutObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

    updateOverflow();
}

function initAllTabOverflows() {
    document.querySelectorAll('.math-mode-tabs, .sidebar-tabs').forEach(initTabOverflow);
}

function adjustViewTop() {
    const toolbar = document.querySelector('.fixed-toolbar');
    if (!toolbar) return;
    const h = toolbar.offsetHeight;
    document.querySelectorAll('.view').forEach(v => { v.style.top = h + 'px'; });
}

window.addEventListener('resize', adjustViewTop);
window.addEventListener('beforeunload', () => { if (typeof activeUserTabId !== 'undefined' && activeUserTabId && typeof userTabDirty !== 'undefined' && userTabDirty && typeof saveActiveUserTab === 'function') saveActiveUserTab(); });
window.addEventListener('pagehide', () => { if (typeof activeUserTabId !== 'undefined' && activeUserTabId && typeof userTabDirty !== 'undefined' && userTabDirty && typeof saveActiveUserTab === 'function') saveActiveUserTab(); });

(function initPullToRefresh() {
    let startY = 0;
    let pulling = false;
    let indicator = null;

    function getIndicator() {
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'pull-refresh-indicator';
            indicator.innerHTML = '<span class="pull-refresh-arrow">&#8635;</span><span class="pull-refresh-text">Pull to refresh</span>';
            document.body.appendChild(indicator);
        }
        return indicator;
    }

    document.addEventListener('touchstart', function(e) {
        const activeView = document.querySelector('.view.active');
        if (!activeView || activeView.scrollTop > 5) return;
        const toolbar = document.querySelector('.fixed-toolbar');
        const toolbarBottom = toolbar ? toolbar.offsetHeight : 60;
        const touchY = e.touches[0].clientY;
        if (touchY > toolbarBottom + 100) return;
        startY = touchY;
        pulling = true;
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
        if (!pulling) return;
        const dy = e.touches[0].clientY - startY;
        if (dy < 0) { pulling = false; return; }
        if (dy > 10) {
            const ind = getIndicator();
            const progress = Math.min(dy / 120, 1);
            const offset = Math.min(dy * 0.4, 60);
            ind.style.transform = `translateX(-50%) translateY(${offset}px)`;
            ind.style.opacity = progress;
            ind.querySelector('.pull-refresh-arrow').style.transform = `rotate(${progress * 360}deg)`;
            if (progress >= 1) {
                ind.querySelector('.pull-refresh-text').textContent = 'Release to refresh';
                ind.classList.add('ready');
            } else {
                ind.querySelector('.pull-refresh-text').textContent = 'Pull to refresh';
                ind.classList.remove('ready');
            }
            ind.style.display = 'flex';
        }
    }, { passive: true });

    function resetIndicator() {
        if (!indicator) return;
        indicator.style.opacity = '0';
        indicator.style.transform = 'translateX(-50%) translateY(0)';
        setTimeout(() => { if (indicator) indicator.style.display = 'none'; }, 200);
    }

    document.addEventListener('touchend', function() {
        if (!pulling) return;
        pulling = false;
        const ind = indicator;
        if (ind && ind.classList.contains('ready')) {
            ind.querySelector('.pull-refresh-text').textContent = 'Refreshing...';
            ind.querySelector('.pull-refresh-arrow').style.animation = 'pullSpin 0.6s linear infinite';
            setTimeout(() => location.reload(), 400);
        } else {
            resetIndicator();
        }
    }, { passive: true });

    document.addEventListener('touchcancel', function() {
        pulling = false;
        resetIndicator();
    }, { passive: true });
})();

document.addEventListener('DOMContentLoaded', () => {
    // Boot Image Designer Step 1 (Task #214): if the project has a saved
    // boot config, prefetch it BEFORE init() so the simulator's first reset
    // already sees the programmer-chosen lump sizes. When no config exists
    // the server returns config:null and the simulator keeps its historical
    // 65536/64/256/256 defaults — this avoids both (a) silently changing
    // memory size on no-config startup and (b) a re-reset race that would
    // wipe restored namespace state.
    const _bootCfgReady = fetch('/api/boot-config')
        .then(r => r.json())
        .then(data => {
            _hardwareProfiles = (data && data.profiles) || {};
            window.bootConfig = (data && data.config) || null;
            _lumpCatalog = (data && data.lumpCatalog) || [];
        })
        .catch(err => { console.warn('[bootConfig] prefetch failed:', err); });
    _bootCfgReady.finally(() => {
        window.init();
        // Delay SSE so networkidle can fire in tests (EventSource stays open forever,
        // which blocks waitForLoadState('networkidle') if opened synchronously).
        setTimeout(startDeviceEventStream, 3000);
        // Restore the fault log from the previous session so the Gate Log still
        // shows old faults (with the correct lump-name snapshot) after a reload.
        // Do NOT call faultAlertOn() here — stale faults from a prior session
        // must not trigger the alert icon on page load.  The icon fires only for
        // live faults in the current session (handled by sim.on('fault', …) in
        // app-shell.js).  Calling faultAlertOn() on restore was the root cause
        // of the "flashing fault icon on hard reboot" bug.
        if (typeof _restoreFaultLog === 'function') {
            _restoreFaultLog();
            if (sim && sim.faultLog && sim.faultLog.length > 0) {
                // Wire _lastFault so the recall button opens the modal rather than
                // calling faultClear() (which takes the else branch when null).
                if (typeof _lastFault !== 'undefined' && _lastFault === null) {
                    _lastFault = sim.faultLog[sim.faultLog.length - 1];
                }
                if (typeof updateGateLog === 'function') updateGateLog();
                // faultAlertOn() intentionally omitted — see comment above.
            }
        }
        initAllTabOverflows();
        adjustViewTop();
        initCodeCopyButtons();
        updateFPGAStatusBtn();
        const _asmEd = document.getElementById('asmEditor');
        if (_asmEd) {
            _asmEd.addEventListener('keydown', function(e) {
                if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
                    e.preventDefault();
                    if (typeof showEditorCListPopup === 'function') showEditorCListPopup(e);
                }
            });
        }
    });
});

function addCopyButton(pre) {
    if (pre.querySelector('.code-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const clone = pre.cloneNode(true);
        clone.querySelectorAll('.code-copy-btn').forEach(function(b) { b.remove(); });
        const text = clone.textContent;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                btn.textContent = 'Copied!';
                btn.classList.add('copied');
                setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
            }).catch(function() {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch(_) {}
                document.body.removeChild(ta);
                btn.textContent = 'Copied!';
                btn.classList.add('copied');
                setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
            });
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
        }
    });
    pre.appendChild(btn);
}

const _traceData = [];
const _TRACE_MAX = 50000;
let _traceRenderedCount = 0;
let _tracePendingRAF = false;

function _traceRecordStep(result) {
    if (!result) return;
    const state = sim.getState();
    const instr = result.instr;
    const entry = {
        step: state.stepCount,
        pc: result.pc,
        opName: instr ? sim.opName(instr.opcode) : '',
        cond: instr ? sim.condName(instr.cond) : '',
        dst: instr ? instr.crDst : '',
        src: instr ? instr.crSrc : '',
        desc: result.desc || '',
        skipped: !!result.skipped,
        dr: state.dr.slice(),
        flags: { N: state.flags.N, Z: state.flags.Z, C: state.flags.C, V: state.flags.V },
        sto: state.sto,
        gateChecks: (sim.auditLog && sim.auditLog.length > 0) ? sim.auditLog.map(function(a) {
            return {
                gate: a.gate,
                label: a.label,
                nsIndex: a.nsIndex,
                result: a.result,
                requiredPerm: a.requiredPerm,
                desc: a.desc,
                checks: a.checks ? Object.assign({}, a.checks) : null,
            };
        }) : null,
    };
    if (_traceData.length >= _TRACE_MAX) {
        const removeCount = _traceData.length - _TRACE_MAX + 1000;
        _traceData.splice(0, removeCount);
        const tbody = document.getElementById('traceTableBody');
        if (tbody) {
            // Each trace entry may produce multiple DOM rows (one main instruction
            // row with data-step set, plus zero or more gate-check sub-rows that
            // lack data-step). Remove rows from the top until we have evicted
            // removeCount main-instruction rows (or exhausted the DOM).
            const domTarget = Math.min(removeCount, _traceRenderedCount);
            let mainRowsRemoved = 0;
            while (mainRowsRemoved < domTarget && tbody.children.length > 0) {
                const first = tbody.children[0];
                const isMain = first.dataset && first.dataset.step !== undefined;
                tbody.removeChild(first);
                if (isMain) mainRowsRemoved++;
            }
        }
        _traceRenderedCount = Math.max(0, _traceRenderedCount - removeCount);
    }
    _traceData.push(entry);
    if (!_tracePendingRAF) {
        _tracePendingRAF = true;
        requestAnimationFrame(_traceFlushRender);
    }
}

function _traceFlushRender() {
    _tracePendingRAF = false;
    if (_traceRenderedCount >= _traceData.length) return;
    const tbody = document.getElementById('traceTableBody');
    if (!tbody) return;
    const frag = document.createDocumentFragment();
    const start = _traceRenderedCount;
    for (let i = start; i < _traceData.length; i++) {
        frag.appendChild(_traceBuildRow(i));
    }
    tbody.appendChild(frag);
    _traceRenderedCount = _traceData.length;
    const countEl = document.getElementById('traceRowCount');
    if (countEl) countEl.textContent = _traceData.length.toLocaleString() + ' rows';
    if (currentView === 'trace') {
        const wrap = document.getElementById('traceTableWrap');
        if (wrap) wrap.scrollTop = wrap.scrollHeight;
    }
}

function _traceBuildRow(idx) {
    const entry = _traceData[idx];
    const prev = idx > 0 ? _traceData[idx - 1] : null;
    const frag = document.createDocumentFragment();

    const tr = document.createElement('tr');
    tr.dataset.step = entry.step;
    if (entry.skipped) tr.className = 'trace-row-skipped';

    const cells = [
        entry.step,
        entry.pc,
        entry.opName,
        entry.cond,
        entry.dst,
        entry.src,
        entry.desc,
    ];
    const _cc = typeof _colorizeComment === 'function' ? _colorizeComment : null;
    for (let c = 0; c < cells.length; c++) {
        const td = document.createElement('td');
        if (_cc && c >= 3) {
            td.innerHTML = _cc(String(cells[c] == null ? '' : cells[c]));
        } else {
            td.textContent = cells[c];
        }
        tr.appendChild(td);
    }
    for (let d = 0; d < 16; d++) {
        const td = document.createElement('td');
        td.textContent = entry.dr[d] >>> 0;
        if (prev && (entry.dr[d] >>> 0) !== (prev.dr[d] >>> 0)) {
            td.className = 'trace-td-changed';
        }
        tr.appendChild(td);
    }
    const flagKeys = ['N', 'Z', 'C', 'V'];
    for (const fk of flagKeys) {
        const td = document.createElement('td');
        td.textContent = entry.flags[fk] ? '1' : '0';
        if (prev && entry.flags[fk] !== prev.flags[fk]) {
            td.className = 'trace-td-changed';
        }
        tr.appendChild(td);
    }
    const stoTd = document.createElement('td');
    stoTd.textContent = entry.sto;
    if (prev && entry.sto !== prev.sto) {
        stoTd.className = 'trace-td-changed';
    }
    tr.appendChild(stoTd);
    frag.appendChild(tr);

    // ── Gate-check sub-rows (mLoad / mSave fault details) ────────────────────
    if (entry.gateChecks && entry.gateChecks.length > 0) {
        for (let gi = 0; gi < entry.gateChecks.length; gi++) {
            const gc = entry.gateChecks[gi];
            const hasChecks = gc.checks && Object.keys(gc.checks).length > 0;
            const clickable = hasChecks || gc.desc;
            if (!clickable) continue;

            // Build summary string (truncated)
            let summary = '';
            if (gc.desc) {
                summary = gc.desc;
            } else if (hasChecks) {
                const failedNames = Object.entries(gc.checks)
                    .filter(function(kv) { return kv[1] && kv[1].pass === false; })
                    .map(function(kv) { return kv[0].toUpperCase(); });
                if (failedNames.length > 0) {
                    summary = 'FAIL: ' + failedNames.join(', ');
                } else {
                    summary = gc.result === 'pass' ? 'pass' : (gc.result || '');
                    if (gc.requiredPerm) summary += ' perm=' + gc.requiredPerm;
                }
            } else {
                summary = gc.result || '';
            }
            const truncated = summary.length > 60 ? summary.slice(0, 60) + '\u2026' : summary;
            const isFail = gc.result === 'fail';
            const detailRowId = 'trace-gate-detail-' + entry.step + '-' + gi;

            // Summary row
            const sumTr = document.createElement('tr');
            sumTr.className = 'crd-fault-row';
            if (isFail) sumTr.style.color = 'var(--church-red,#e05555)';
            sumTr.dataset.detailId = detailRowId;
            sumTr.onclick = function() { window.__crdToggleFaultDetail(this.dataset.detailId, this); };

            const gateTd = document.createElement('td');
            gateTd.className = 'cr-idx';
            gateTd.textContent = '';
            sumTr.appendChild(gateTd);

            const evtTd = document.createElement('td');
            evtTd.textContent = gc.gate || '\u2014';
            evtTd.colSpan = 2;
            sumTr.appendChild(evtTd);

            const detTd = document.createElement('td');
            detTd.style.fontSize = '0.78rem';
            detTd.colSpan = 25;
            detTd.textContent = truncated;
            sumTr.appendChild(detTd);

            frag.appendChild(sumTr);

            // Detail row (hidden, contains crd-check-grid)
            const detTr = document.createElement('tr');
            detTr.id = detailRowId;
            detTr.className = 'crd-fault-detail-row';
            detTr.style.display = 'none';

            const detCell = document.createElement('td');
            detCell.colSpan = 28;

            // Build crd-check-grid HTML
            let detailHtml = '';
            if (hasChecks) {
                detailHtml += '<div class="crd-check-grid">';
                for (const ck of Object.keys(gc.checks)) {
                    const cv = gc.checks[ck];
                    if (!cv || typeof cv !== 'object') continue;
                    const pass = cv.pass !== false;
                    const badgeClass = pass ? 'pass' : 'fail';
                    const badgeLabel = pass ? 'OK' : 'FAIL';
                    let valStr = '';
                    if (ck === 'perm') {
                        valStr = cv.perm ? 'requires ' + cv.perm : '';
                        if (!pass) valStr += (valStr ? ' \u2014 ' : '') + 'missing';
                    } else if (ck === 'range') {
                        const addr = '0x' + (cv.address >>> 0).toString(16);
                        const base = '0x' + (cv.base >>> 0).toString(16);
                        const lim  = '0x' + (cv.limit >>> 0).toString(16);
                        valStr = pass
                            ? addr + ' in [' + base + '..' + lim + ']'
                            : addr + ' outside [' + base + '..' + lim + ']';
                    } else if (ck === 'version' && !pass) {
                        valStr = 'GT seq mismatch';
                    } else if (ck === 'seal' && !pass) {
                        valStr = 'CRC invalid';
                    } else if (ck === 'bind' && !pass) {
                        valStr = 'bind check failed';
                    } else if (ck === 'far' && !pass) {
                        valStr = 'far check failed';
                    }
                    detailHtml += '<span class="crd-check-item">';
                    detailHtml += '<span class="crd-check-name">' + ck + '</span>';
                    detailHtml += '<span class="crd-check-badge ' + badgeClass + '">' + badgeLabel + '</span>';
                    if (valStr) detailHtml += '<span class="crd-check-value">' + valStr + '</span>';
                    detailHtml += '</span>';
                }
                detailHtml += '</div>';
            } else if (gc.desc) {
                detailHtml = '<span style="color:var(--text-secondary);font-size:0.76rem;">' + gc.desc + '</span>';
            }
            detCell.innerHTML = detailHtml;
            detTr.appendChild(detCell);
            frag.appendChild(detTr);
        }
    }

    return frag;
}

function clearTrace() {
    _traceData.length = 0;
    _traceRenderedCount = 0;
    const tbody = document.getElementById('traceTableBody');
    if (tbody) tbody.innerHTML = '';
    const countEl = document.getElementById('traceRowCount');
    if (countEl) countEl.textContent = '0 rows';
}

function renderTraceView() {
    if (_traceRenderedCount < _traceData.length) {
        _traceFlushRender();
    }
    const wrap = document.getElementById('traceTableWrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

function jumpToTraceStep(stepNum, faultType) {
    switchView('trace');
    if (_traceRenderedCount < _traceData.length) {
        _traceFlushRender();
    }
    const tbody = document.getElementById('traceTableBody');
    if (!tbody) return;
    const target = tbody.querySelector(`tr[data-step="${stepNum}"]`);
    if (!target) return;
    document.querySelectorAll('.trace-row-highlighted').forEach(el => el.classList.remove('trace-row-highlighted'));
    document.querySelectorAll('.trace-gatelog-back').forEach(el => el.remove());
    document.querySelectorAll('.trace-fault-label').forEach(el => el.remove());
    target.classList.add('trace-row-highlighted');
    const firstTd = target.querySelector('td');
    if (firstTd) {
        if (faultType) {
            const faultLabel = document.createElement('span');
            faultLabel.className = 'trace-fault-label';
            faultLabel.textContent = faultType;
            faultLabel.title = 'Click to dismiss';
            faultLabel.addEventListener('click', function() { faultLabel.remove(); });
            faultLabel.addEventListener('animationend', function() { faultLabel.remove(); });
            firstTd.insertBefore(faultLabel, firstTd.firstChild);
        }
        const backBtn = document.createElement('button');
        backBtn.className = 'trace-gatelog-back';
        backBtn.title = 'Return to Gate Log';
        backBtn.textContent = '\u2190 Gate Log';
        backBtn.addEventListener('click', function() {
            switchView('dashboard');
            switchDashTab('gatelog');
        });
        firstTd.insertBefore(backBtn, firstTd.firstChild);
    }
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function initCodeCopyButtons() {
    document.querySelectorAll('pre').forEach(addCopyButton);
    const observer = new MutationObserver(function(mutations) {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.tagName === 'PRE') addCopyButton(node);
                node.querySelectorAll && node.querySelectorAll('pre').forEach(addCopyButton);
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function _devRelativeTime(unixSec) {
    const diff = Math.floor(Date.now() / 1000) - unixSec;
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
    return Math.floor(diff / 86400) + 'd ago';
}

function setDeviceLabelAndSync(deviceId, label) {
    setDeviceLabel(deviceId, label);
    const nameEl = document.getElementById('devRowName_' + deviceId);
    if (nameEl) {
        const boardName = nameEl.dataset.boardName || '';
        nameEl.textContent = label.trim() || boardName;
    }
}

function loadGithubSyncStatus() {
    const badge = document.getElementById('ghSyncBadge');
    const meta  = document.getElementById('ghSyncMeta');
    const btn   = document.querySelector('.gh-sync-refresh-btn');
    if (!badge) return;
    badge.textContent = '⏳ loading…';
    badge.className = 'gh-sync-badge unknown';
    if (meta) meta.textContent = '';
    if (btn) btn.classList.add('spinning');
    fetch('/api/github/sync-status')
        .then(r => r.json())
        .then(d => {
            const ok = d.status === 'ok';
            const unknown = !d.status || d.status === 'unknown';
            badge.className = 'gh-sync-badge ' + (unknown ? 'unknown' : ok ? 'ok' : 'fail');
            badge.textContent = unknown ? '⚪ unknown' : ok ? '✔ ok' : '✖ failed';
            if (meta) {
                const parts = [];
                if (d.branch) parts.push(d.branch);
                if (d.sha)    parts.push(d.sha);
                if (d.timestamp) {
                    const dt = new Date(d.timestamp * 1000);
                    parts.push(dt.toLocaleString(undefined, {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                    }));
                }
                if (!ok && d.error) parts.push('— ' + d.error);
                meta.textContent = parts.join(' · ');
            }
        })
        .catch(() => {
            badge.className = 'gh-sync-badge fail';
            badge.textContent = '✖ unreachable';
            if (meta) meta.textContent = '/api/github/sync-status did not respond';
        })
        .finally(() => { if (btn) btn.classList.remove('spinning'); });
}

function loadDeviceList() {
    loadGithubSyncStatus();
    const grid = document.getElementById('devGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="dev-empty">Loading...</div>';
    fetch('/api/device/list')
        .then(r => r.json())
        .then(data => {
            if (!data.ok || !data.devices || data.devices.length === 0) {
                grid.innerHTML = '<div class="dev-empty">No devices registered. Connect a board via the local bridge to see it here.</div>';
                return;
            }
            _devLastSeenMap = {};
            grid.innerHTML = '';
            const _bootReasonNames = {0: 'Cold', 1: 'Warm', 2: 'Fault'};
            const _faultNames = {
                0:'None',1:'PERM_R',2:'PERM_W',3:'PERM_X',4:'PERM_L',5:'PERM_S',
                6:'PERM_E',7:'NULL_CAP',8:'BOUNDS',9:'VERSION',10:'SEAL',
                11:'INVALID_OP',12:'TPERM_RSV',13:'DOMAIN_PURITY',14:'BIND',
                15:'F_BIT',16:'STACK_OVERFLOW',17:'ABSENT_OUTFORM',
                18:'STACK_CORRUPT',19:'STACK_UNDERFLOW',
                21:'OUTFORM_CRC',22:'OUTFORM_ALLOC',23:'OUTFORM_MINT',24:'OUTFORM_HDR'
            };
            data.devices.forEach(dev => {
                const isOnline = dev.status === 'online';
                if (dev.last_seen) _devLastSeenMap[dev.id] = dev.last_seen;
                const profileClass = dev.profile === 'IoT' ? 'dev-badge-iot' : 'dev-badge-full';
                const _uidSuffix = (dev.device_uid && dev.device_uid !== '0000000000000000')
                    ? ' #' + dev.device_uid.slice(-8).toUpperCase() : '';
                const petName = (dev.label || '').trim() || (dev.board_name + _uidSuffix);
                const statusChip = isOnline
                    ? 'Online'
                    : 'Offline' + (dev.last_seen ? ' · ' + _devRelativeTime(dev.last_seen) : '');
                const bootReasonStr = _bootReasonNames[dev.boot_reason] || ('0x' + (dev.boot_reason || 0).toString(16));
                const faultStr = dev.last_fault ? (_faultNames[dev.last_fault] || ('0x' + dev.last_fault.toString(16))) : '';
                const niaStr = dev.fault_nia ? ' @ 0x' + dev.fault_nia.toString(16).toUpperCase().padStart(4, '0') : '';
                const faultBadge = dev.boot_reason === 2 && dev.last_fault
                    ? '<span class="dev-fault-badge">' + _escHtml(faultStr) + _escHtml(niaStr) + '</span>'
                    : '';
                const _ts = dev.tunnel_status || 'pending';
                const tunnelBadge = _tunnelBadgeHtml(_ts, 'devTunnelRow_' + dev.id);

                const wrap = document.createElement('div');
                wrap.className = 'dev-entry';
                wrap.id = 'devEntry_' + dev.id;

                const row = document.createElement('div');
                row.className = 'dev-row';
                row.innerHTML =
                    '<div class="dev-status-dot ' + (isOnline ? 'online' : 'offline') + '" id="devStatusDot_' + dev.id + '"></div>' +
                    '<span class="dev-row-name" id="devRowName_' + dev.id + '" data-board-name="' + _escHtml(dev.board_name) + '">' + _escHtml(petName) + '</span>' +
                    '<span class="dev-status-chip ' + (isOnline ? 'chip-online' : 'chip-offline') + '" id="devStatusChip_' + dev.id + '">' + _escHtml(statusChip) + '</span>' +
                    (tunnelBadge || '') +
                    '<span class="dev-badge ' + profileClass + '">' + _escHtml(dev.profile) + '</span>' +
                    '<span class="dev-chevron">&#x25B6;</span>';

                const detail = document.createElement('div');
                detail.className = 'dev-detail';
                detail.id = 'devDetail_' + dev.id;
                detail.innerHTML =
                    '<div class="dev-detail-grid">' +
                        '<div class="dev-detail-item"><span class="dev-detail-label">UID</span><span class="dev-detail-val">' + _escHtml(dev.device_uid) + '</span></div>' +
                        '<div class="dev-detail-item"><span class="dev-detail-label">FW</span><span class="dev-detail-val">' + _escHtml(dev.fw_version) + '</span></div>' +
                        '<div class="dev-detail-item"><span class="dev-detail-label">Boots</span><span class="dev-detail-val">' + dev.boot_count + '</span></div>' +
                        '<div class="dev-detail-item"><span class="dev-detail-label">Boot reason</span><span class="dev-detail-val">' + _escHtml(bootReasonStr) + (faultBadge ? ' ' + faultBadge : '') + '</span></div>' +
                        '<div class="dev-detail-item"><span class="dev-detail-label">Tunnel</span><span class="dev-detail-val">' + _tunnelBadgeHtml(_ts, 'devTunnelDetail_' + dev.id) + '</span></div>' +
                        (dev.bridge_host ? '<div class="dev-detail-item"><span class="dev-detail-label">Bridge</span><span class="dev-detail-val">' + _escHtml(dev.bridge_host) + ':' + _escHtml(String(dev.bridge_port || '')) + '</span></div>' : '') +
                        (dev.serial_port ? '<div class="dev-detail-item"><span class="dev-detail-label">Serial</span><span class="dev-detail-val">' + _escHtml(dev.serial_port) + '</span></div>' : '') +
                    '</div>' +
                    '<div class="dev-detail-footer">' +
                        '<label class="dev-detail-label-row">' +
                            '<span class="dev-detail-label">Pet name</span>' +
                            '<input class="dev-label-input" id="devLabelInput_' + dev.id + '" placeholder="Label" value="' + _escHtml(dev.label || '') + '" ' +
                                'onchange="setDeviceLabelAndSync(' + dev.id + ', this.value)" />' +
                        '</label>' +
                        '<div class="dev-deploy-status" id="devDeployStatus_' + dev.id + '" style="display:none;"></div>' +
                        '<button class="dev-action-btn' + (isOnline ? '' : ' dev-action-disabled') + '" onclick="deviceDeploy(' + dev.id + ')" title="Deploy bitstream to this device"' + (isOnline ? '' : ' disabled') + '>Deploy</button>' +
                    '</div>';

                detail.style.display = 'none';
                row.addEventListener('click', function() {
                    const isOpen = row.classList.contains('dev-row-open');
                    document.querySelectorAll('.dev-detail').forEach(d => { d.style.display = 'none'; });
                    document.querySelectorAll('.dev-row').forEach(r => r.classList.remove('dev-row-open'));
                    if (!isOpen) {
                        detail.style.display = 'block';
                        row.classList.add('dev-row-open');
                    }
                });

                // Newcomer banner — shown on first/second boot
                if (dev.is_newcomer) {
                    var newcomer = document.createElement('div');
                    newcomer.className = 'dev-newcomer-banner';
                    newcomer.innerHTML =
                        '<span class="dev-newcomer-icon">🎉</span>' +
                        '<span class="dev-newcomer-text">' +
                            '<strong>First boot!</strong> ' +
                            'Your ' + _escHtml(dev.board_name || 'Ti60') + ' is online. ' +
                            '<span class="dev-newcomer-abstr">First Abstraction: Hello World ✓</span>' +
                        '</span>' +
                        '<a href="/starter" class="dev-newcomer-btn" target="_blank">✏️ Write First Program →</a>';
                    wrap.appendChild(newcomer);
                }

                wrap.appendChild(row);
                wrap.appendChild(detail);
                grid.appendChild(wrap);
            });
            startDeviceTunnelPolling();
        })
        .catch(() => {
            grid.innerHTML = '<div class="dev-empty">Failed to load devices.</div>';
        });
}

function _escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _tunnelBadgeHtml(ts, id) {
    var cls, text, title;
    if (ts === 'online') {
        cls = 'dev-tunnel-badge';
        text = 'Tunnel online';
        title = 'Hello-Mum tunnel verified \u2014 GREET_RESPONSE received';
    } else if (ts === 'offline') {
        cls = 'dev-tunnel-badge-offline';
        text = 'Tunnel offline';
        title = 'Hello-Mum handshake failed at boot';
    } else {
        cls = 'dev-tunnel-badge-pending';
        text = 'Checking...';
        title = 'Tunnel handshake not yet confirmed';
    }
    return '<span class="' + cls + '" title="' + title + '"' + (id ? ' id="' + id + '"' : '') + '>' + text + '</span>';
}

var _deviceTunnelTimer = null;
var _deviceRelTimeTimer = null;
var _devLastSeenMap = {};

function startDeviceTunnelPolling() {
    stopDeviceTunnelPolling();
    _deviceTunnelTimer = setInterval(refreshTunnelStatuses, 12000);
    _refreshOfflineChipTimes();
    _deviceRelTimeTimer = setInterval(_refreshOfflineChipTimes, 30000);
}

function stopDeviceTunnelPolling() {
    if (_deviceTunnelTimer !== null) {
        clearInterval(_deviceTunnelTimer);
        _deviceTunnelTimer = null;
    }
    if (_deviceRelTimeTimer !== null) {
        clearInterval(_deviceRelTimeTimer);
        _deviceRelTimeTimer = null;
    }
}

function _refreshOfflineChipTimes() {
    for (var id in _devLastSeenMap) {
        var chipEl = document.getElementById('devStatusChip_' + id);
        if (!chipEl || chipEl.className.indexOf('chip-offline') === -1) continue;
        var lastSeen = _devLastSeenMap[id];
        if (!lastSeen) continue;
        chipEl.textContent = 'Offline \u00B7 ' + _devRelativeTime(lastSeen);
    }
}

function refreshTunnelStatuses() {
    var grid = document.getElementById('devGrid');
    if (!grid) { stopDeviceTunnelPolling(); return; }
    fetch('/api/device/list')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.ok || !data.devices) return;
            data.devices.forEach(function(dev) {
                if (dev.last_seen) _devLastSeenMap[dev.id] = dev.last_seen;
                var ts = dev.tunnel_status || 'pending';
                ['devTunnelRow_', 'devTunnelDetail_'].forEach(function(prefix) {
                    var el = document.getElementById(prefix + dev.id);
                    if (!el) return;
                    var newCls = ts === 'online' ? 'dev-tunnel-badge'
                                : ts === 'offline' ? 'dev-tunnel-badge-offline'
                                : 'dev-tunnel-badge-pending';
                    var newText = ts === 'online' ? 'Tunnel online'
                                : ts === 'offline' ? 'Tunnel offline'
                                : 'Checking...';
                    var newTitle = ts === 'online'
                                ? 'Hello-Mum tunnel verified \u2014 GREET_RESPONSE received'
                                : ts === 'offline'
                                    ? 'Hello-Mum handshake failed at boot'
                                    : 'Tunnel handshake not yet confirmed';
                    if (el.className !== newCls) {
                        el.className = newCls;
                        el.textContent = newText;
                        el.title = newTitle;
                    }
                });

                var isOnline = dev.status === 'online';
                var dotEl = document.getElementById('devStatusDot_' + dev.id);
                if (dotEl) {
                    var dotCls = 'dev-status-dot ' + (isOnline ? 'online' : 'offline');
                    if (dotEl.className !== dotCls) dotEl.className = dotCls;
                }
                var chipEl = document.getElementById('devStatusChip_' + dev.id);
                if (chipEl) {
                    var chipCls = 'dev-status-chip ' + (isOnline ? 'chip-online' : 'chip-offline');
                    var chipText = isOnline
                        ? 'Online'
                        : 'Offline' + (dev.last_seen ? ' \u00B7 ' + _devRelativeTime(dev.last_seen) : '');
                    if (chipEl.className !== chipCls) chipEl.className = chipCls;
                    chipEl.textContent = chipText;
                }
            });
        })
        .catch(function() {});
}

function setDeviceLabel(deviceId, label) {
    fetch('/api/device/' + deviceId + '/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label })
    });
}

function _resolveNIA(nia) {
    if (!nia || typeof sim === 'undefined' || !sim.readNSEntry || !sim.parseLumpHeader) {
        return { raw: nia, label: '0x' + (nia >>> 0).toString(16).toUpperCase().padStart(4, '0') };
    }
    for (var nsIdx = 0; nsIdx < (sim.nsCount || 0); nsIdx++) {
        var entry = sim.readNSEntry(nsIdx);
        if (!entry) continue;
        var loc = entry.word0_location >>> 0;
        if (loc >= sim.memory.length) continue;
        var hdrWord = sim.memory[loc] >>> 0;
        var hdr = sim.parseLumpHeader(hdrWord);
        if (!hdr.valid || hdr.cw === 0) continue;
        var codeStart = loc + 1;
        var codeEnd = codeStart + hdr.cw - 1;
        if (nia >= codeStart && nia <= codeEnd) {
            var offset = nia - codeStart;
            var absName = sim.nsLabels[nsIdx] || ('NS[' + nsIdx + ']');
            var absObj = (typeof abstractionRegistry !== 'undefined') ? abstractionRegistry.getAbstraction(nsIdx) : null;
            var methodName = '';
            if (absObj && absObj.result && absObj.result.methods) {
                methodName = absObj.result.methods[0] || '';
            }
            return {
                raw: nia,
                nsIdx: nsIdx,
                absName: absName,
                method: methodName,
                offset: offset,
                label: absName + (methodName ? '.' + methodName : '') + ':' + offset
            };
        }
    }
    return { raw: nia, label: '0x' + (nia >>> 0).toString(16).toUpperCase().padStart(4, '0') };
}

var _faultTypeNames = {
    0:'NONE',1:'PERM_R',2:'PERM_W',3:'PERM_X',4:'PERM_L',5:'PERM_S',
    6:'PERM_E',7:'NULL_CAP',8:'BOUNDS',9:'VERSION',10:'SEAL',
    11:'INVALID_OP',12:'TPERM_RSV',13:'DOMAIN_PURITY',14:'BIND',
    15:'F_BIT',16:'STACK_OVERFLOW',17:'ABSENT_OUTFORM',
    18:'STACK_CORRUPT',19:'STACK_UNDERFLOW',
    21:'OUTFORM_CRC',22:'OUTFORM_ALLOC',23:'OUTFORM_MINT',24:'OUTFORM_HDR'
};

function showDeviceFaultLog(deviceUid) {
    fetch('/api/device/faults' + (deviceUid ? '?device_uid=' + encodeURIComponent(deviceUid) : ''))
        .then(r => r.json())
        .then(data => {
            if (!data.ok) return;
            var events = data.events || [];
            var mtbfMap = data.mtbf_by_nia || {};

            var html = '<div class="fault-log-container">';
            html += '<div class="fault-log-title">MTBF by Instruction Address</div>';

            var niaKeys = Object.keys(mtbfMap);
            if (niaKeys.length === 0) {
                html += '<div class="fault-log-empty">No fault events recorded.</div>';
            } else {
                niaKeys.sort(function(a, b) {
                    var ia = mtbfMap[a], ib = mtbfMap[b];
                    var ma = ia.mtbf !== null ? ia.mtbf : Infinity;
                    var mb = ib.mtbf !== null ? ib.mtbf : Infinity;
                    if (ma !== mb) return ma - mb;
                    return ib.count - ia.count;
                });
                html += '<table class="fault-mtbf-table"><thead><tr>' +
                    '<th>Address</th><th>Location</th><th>Faults</th><th>MTBF</th>' +
                    '</tr></thead><tbody>';
                niaKeys.forEach(function(niaStr) {
                    var nia = parseInt(niaStr);
                    var resolved = _resolveNIA(nia);
                    var info = mtbfMap[niaStr];
                    var mtbfStr = info.mtbf !== null ? _formatMTBF(info.mtbf) : '\u2014';
                    var mtbfClass = info.mtbf === null ? '' : (info.mtbf > 3600 ? 'mtbf-cell-green' : info.mtbf > 300 ? 'mtbf-cell-amber' : 'mtbf-cell-red');
                    html += '<tr>' +
                        '<td class="fault-addr">0x' + (nia >>> 0).toString(16).toUpperCase().padStart(4, '0') + '</td>' +
                        '<td class="fault-loc">' + _escHtml(resolved.label) + '</td>' +
                        '<td class="fault-count">' + info.count + '</td>' +
                        '<td class="fault-mtbf ' + mtbfClass + '">' + mtbfStr + '</td>' +
                        '</tr>';
                });
                html += '</tbody></table>';
            }

            html += '<div class="fault-log-title" style="margin-top:1rem;">Recent Fault Events</div>';
            if (events.length === 0) {
                html += '<div class="fault-log-empty">No fault events.</div>';
            } else {
                html += '<table class="fault-events-table"><thead><tr>' +
                    '<th>Time</th><th>Device</th><th>Fault</th><th>Location</th>' +
                    '</tr></thead><tbody>';
                events.slice(0, 50).forEach(function(ev) {
                    var resolved = _resolveNIA(ev.fault_nia);
                    var fName = _faultTypeNames[ev.fault_type] || ('0x' + ev.fault_type.toString(16));
                    var ts = ev.timestamp ? new Date(ev.timestamp * 1000).toLocaleString() : '—';
                    html += '<tr>' +
                        '<td class="fault-ts">' + _escHtml(ts) + '</td>' +
                        '<td class="fault-dev">' + _escHtml(ev.device_uid) + '</td>' +
                        '<td class="dev-fault-badge">' + _escHtml(fName) + '</td>' +
                        '<td class="fault-loc">' + _escHtml(resolved.label) + '</td>' +
                        '</tr>';
                });
                html += '</tbody></table>';
            }
            html += '</div>';

            showModal('Fault Log \u2014 MTBF per Instruction', html);
        });
}

function _formatMTBF(seconds) {
    if (seconds >= 86400) return (seconds / 86400).toFixed(1) + 'd';
    if (seconds >= 3600) return (seconds / 3600).toFixed(1) + 'h';
    if (seconds >= 60) return (seconds / 60).toFixed(1) + 'm';
    return seconds.toFixed(1) + 's';
}

function _buildDeployFramesFromNS(nsIdx) {
    if (typeof sim === 'undefined' || !sim.readNSEntry) return null;
    var entry = sim.readNSEntry(nsIdx);
    if (!entry) return null;
    var loc = entry.word0_location >>> 0;
    if (loc >= sim.memory.length) return null;
    var hdrWord = sim.memory[loc] >>> 0;
    var hdr = sim.parseLumpHeader(hdrWord);
    if (!hdr.valid || hdr.cw === 0) return null;

    var codeStart = loc + 1;
    var words = [];
    for (var i = 0; i < hdr.cw; i++) {
        var addr = codeStart + i;
        words.push(addr < sim.memory.length ? (sim.memory[addr] >>> 0) : 0);
    }

    var blocks = [];
    var nsSlice = Array.from(sim.memory.slice(0, TangSerial.NS_WORDS));
    var clSlice = Array.from(sim.memory.slice(TangSerial.NS_WORDS, TangSerial.NS_WORDS + TangSerial.CLIST_WORDS));
    var totalNsWords = TangSerial.NS_WORDS + TangSerial.CLIST_WORDS;
    var nsWords = new Array(totalNsWords);
    for (var i = 0; i < TangSerial.NS_WORDS; i++) nsWords[i] = i < nsSlice.length ? nsSlice[i] : 0;
    for (var i = 0; i < TangSerial.CLIST_WORDS; i++) nsWords[TangSerial.NS_WORDS + i] = i < clSlice.length ? clSlice[i] : 0;
    blocks.push({ addr: 0x0000, words: nsWords });
    blocks.push({ addr: codeStart, words: words });

    function crc16ccitt(data) {
        var crc = 0xFFFF;
        for (var ci = 0; ci < data.length; ci++) {
            var byte = data[ci];
            for (var bi = 0; bi < 8; bi++) {
                var bit = ((byte >>> (7 - bi)) & 1) ^ ((crc >>> 15) & 1);
                crc = ((crc << 1) & 0xFFFF) ^ (bit ? 0x1021 : 0);
            }
        }
        return crc;
    }

    var allFrames = [];
    for (var b = 0; b < blocks.length; b++) {
        var blk = blocks[b];
        var bodyLen = 6 + blk.words.length * 4;
        var frame = new Uint8Array(bodyLen + 2);
        frame[0] = 0xBE;
        frame[1] = 0xEF;
        frame[2] = (blk.addr >> 8) & 0xFF;
        frame[3] = blk.addr & 0xFF;
        frame[4] = (blk.words.length >> 8) & 0xFF;
        frame[5] = blk.words.length & 0xFF;
        for (var i = 0; i < blk.words.length; i++) {
            var w = blk.words[i] >>> 0;
            frame[6 + i * 4 + 0] = w & 0xFF;
            frame[6 + i * 4 + 1] = (w >> 8) & 0xFF;
            frame[6 + i * 4 + 2] = (w >> 16) & 0xFF;
            frame[6 + i * 4 + 3] = (w >> 24) & 0xFF;
        }
        var crc = crc16ccitt(frame.subarray(0, bodyLen));
        frame[bodyLen] = (crc >> 8) & 0xFF;
        frame[bodyLen + 1] = crc & 0xFF;
        allFrames.push({ addr: blk.addr, count: blk.words.length, frame: frame, crc: crc });
    }
    return allFrames;
}

function _buildDeployFrames() {
    var patch = injectCRCode(null);
    if (!patch) return null;

    var blocks = [];
    var nsChanged = patch.newCW !== patch.oldCW;

    if (nsChanged && typeof sim !== 'undefined' && typeof TangSerial !== 'undefined') {
        var nsSlice = Array.from(sim.memory.slice(0, TangSerial.NS_WORDS));
        var clSlice = Array.from(sim.memory.slice(TangSerial.NS_WORDS, TangSerial.NS_WORDS + TangSerial.CLIST_WORDS));
        var totalWords = TangSerial.NS_WORDS + TangSerial.CLIST_WORDS;
        var nsWords = new Array(totalWords);
        for (var i = 0; i < TangSerial.NS_WORDS; i++) nsWords[i] = i < nsSlice.length ? nsSlice[i] : 0;
        for (var i = 0; i < TangSerial.CLIST_WORDS; i++) nsWords[TangSerial.NS_WORDS + i] = i < clSlice.length ? clSlice[i] : 0;
        blocks.push({ addr: 0x0000, words: nsWords });
    }

    blocks.push({ addr: patch.codeStart, words: patch.newWords });

    function crc16ccitt(data) {
        var crc = 0xFFFF;
        for (var ci = 0; ci < data.length; ci++) {
            var byte = data[ci];
            for (var bi = 0; bi < 8; bi++) {
                var bit = ((byte >>> (7 - bi)) & 1) ^ ((crc >>> 15) & 1);
                crc = ((crc << 1) & 0xFFFF) ^ (bit ? 0x1021 : 0);
            }
        }
        return crc;
    }

    var allFrames = [];
    for (var b = 0; b < blocks.length; b++) {
        var blk = blocks[b];
        var bodyLen = 6 + blk.words.length * 4;
        var frame = new Uint8Array(bodyLen + 2);
        frame[0] = 0xBE;
        frame[1] = 0xEF;
        frame[2] = (blk.addr >> 8) & 0xFF;
        frame[3] = blk.addr & 0xFF;
        frame[4] = (blk.words.length >> 8) & 0xFF;
        frame[5] = blk.words.length & 0xFF;
        for (var i = 0; i < blk.words.length; i++) {
            var w = blk.words[i] >>> 0;
            frame[6 + i * 4 + 0] = w & 0xFF;
            frame[6 + i * 4 + 1] = (w >> 8) & 0xFF;
            frame[6 + i * 4 + 2] = (w >> 16) & 0xFF;
            frame[6 + i * 4 + 3] = (w >> 24) & 0xFF;
        }
        var crc = crc16ccitt(frame.subarray(0, bodyLen));
        frame[bodyLen] = (crc >> 8) & 0xFF;
        frame[bodyLen + 1] = crc & 0xFF;
        allFrames.push({ addr: blk.addr, count: blk.words.length, frame: frame, crc: crc });
    }
    return allFrames;
}

function _parseDeployResponse(rx, expectedAddr, expectedCount) {
    if (rx.length >= 4) {
        var echoAddr = (rx[0] << 8) | rx[1];
        var echoCount = (rx[2] << 8) | rx[3];
        if (echoAddr === (expectedAddr & 0xFFFF) && echoCount === expectedCount) {
            return { success: true, msg: 'Echo OK: addr=0x' + echoAddr.toString(16).toUpperCase().padStart(4, '0') + ' count=' + echoCount };
        }
        return { success: false, msg: 'Echo mismatch: expected addr=0x' + (expectedAddr & 0xFFFF).toString(16).toUpperCase().padStart(4, '0') + ' count=' + expectedCount + ', got addr=0x' + echoAddr.toString(16).toUpperCase().padStart(4, '0') + ' count=' + echoCount };
    }
    if (rx.length === 1 && rx[0] === 0x15) {
        return { success: false, msg: 'NAK — CRC mismatch on FPGA side' };
    }
    return { success: false, msg: 'No echo received (' + rx.length + ' bytes)' };
}

function _setDeviceDeployStatus(deviceId, status, message) {
    var statusEl = document.getElementById('devDeployStatus_' + deviceId);
    if (!statusEl) return;
    statusEl.className = 'dev-deploy-status dev-deploy-' + status;
    statusEl.textContent = message || '';
    statusEl.style.display = message ? 'block' : 'none';
}

function _getDeployablePrograms() {
    var programs = [];
    if (typeof sim !== 'undefined' && sim.readNSEntry) {
        for (var i = 0; i < sim.nsCount; i++) {
            var entry = sim.readNSEntry(i);
            if (!entry) continue;
            var loc = entry.word0_location >>> 0;
            if (loc >= sim.memory.length) continue;
            var hdrWord = sim.memory[loc] >>> 0;
            var hdr = sim.parseLumpHeader(hdrWord);
            if (!hdr.valid || hdr.cw === 0) continue;
            var label = entry.label || ('NS[' + i + ']');
            programs.push({ nsIdx: i, label: label, cw: hdr.cw, loc: loc });
        }
    }
    return programs;
}

function deviceDeploy(deviceId) {
    var programs = _getDeployablePrograms();
    var hasEditor = !!(selectedCR !== null && ((document.getElementById('asmEditor') || {}).value || '').trim());

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';

    var progListHtml = '';
    if (hasEditor) {
        progListHtml += '<label class="deploy-program-option">' +
            '<input type="radio" name="deployProgSrc" value="editor" checked /> ' +
            '<span>Current editor code (compile &amp; deploy)</span>' +
            '</label>';
    }
    for (var p = 0; p < programs.length; p++) {
        var prog = programs[p];
        var checked = (!hasEditor && p === 0) ? ' checked' : '';
        progListHtml += '<label class="deploy-program-option">' +
            '<input type="radio" name="deployProgSrc" value="ns:' + prog.nsIdx + '"' + checked + ' /> ' +
            '<span>' + _escHtml(prog.label) + ' (NS[' + prog.nsIdx + '], ' + prog.cw + ' words @ 0x' + prog.loc.toString(16).toUpperCase().padStart(4, '0') + ')</span>' +
            '</label>';
    }
    if (!hasEditor && programs.length === 0) {
        progListHtml = '<div style="color:#ef5350;font-size:0.85rem;">No programs available. Write code in the editor or load an abstraction first.</div>';
    }

    overlay.innerHTML =
        '<div class="modal-dialog" style="max-width:500px;">' +
            '<h3 style="margin:0 0 1rem;color:var(--church-gold,#daa520);">Deploy to Device #' + deviceId + '</h3>' +
            '<div style="color:#bbb;font-size:0.88rem;margin-bottom:0.8rem;">Select a program to deploy:</div>' +
            '<div class="deploy-program-list" style="max-height:200px;overflow-y:auto;margin-bottom:1rem;">' + progListHtml + '</div>' +
            '<div id="deployModalLog" style="background:#111;border:1px solid #333;border-radius:4px;padding:0.5rem;font-family:monospace;font-size:0.78rem;color:#aaa;max-height:180px;overflow-y:auto;white-space:pre-wrap;margin-bottom:1rem;display:none;"></div>' +
            '<div style="display:flex;gap:0.5rem;justify-content:flex-end;">' +
                '<button id="deployModalCancel" class="dev-action-btn" style="padding:6px 16px;">Cancel</button>' +
                '<button id="deployModalConfirm" class="dev-action-btn" style="padding:6px 16px;background:#2d4a22;color:#8bc34a;border-color:#4caf50;">Deploy</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);

    function closeModal() { overlay.remove(); document.removeEventListener('keydown', onEsc); }
    function onEsc(e) { if (e.key === 'Escape') closeModal(); }
    document.addEventListener('keydown', onEsc);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
    document.getElementById('deployModalCancel').addEventListener('click', closeModal);

    document.getElementById('deployModalConfirm').addEventListener('click', function() {
        var logEl = document.getElementById('deployModalLog');
        logEl.style.display = 'block';
        logEl.textContent = '';
        var log = function(msg) { logEl.textContent += msg + '\n'; logEl.scrollTop = logEl.scrollHeight; };

        var selected = overlay.querySelector('input[name="deployProgSrc"]:checked');
        if (!selected) {
            log('ERROR: No program selected.');
            return;
        }

        document.getElementById('deployModalConfirm').disabled = true;
        document.getElementById('deployModalConfirm').textContent = 'Deploying…';
        _setDeviceDeployStatus(deviceId, 'deploying', 'Deploying…');

        var frames;
        var srcVal = selected.value;

        if (srcVal === 'editor') {
            log('Compiling current editor code…');
            frames = _buildDeployFrames();
        } else if (srcVal.startsWith('ns:')) {
            var nsIdx = parseInt(srcVal.substring(3), 10);
            log('Loading NS[' + nsIdx + '] for deploy…');
            frames = _buildDeployFramesFromNS(nsIdx);
        }

        if (!frames || frames.length === 0) {
            log('ERROR: Failed to build frames.');
            _setDeviceDeployStatus(deviceId, 'failed', 'Build failed');
            document.getElementById('deployModalConfirm').disabled = false;
            document.getElementById('deployModalConfirm').textContent = 'Deploy';
            return;
        }

        log('Built ' + frames.length + ' BEEF frame(s). Sending to device…');

        _sendFramesToDevice(deviceId, frames, log).then(function(ok) {
            if (ok) {
                log('');
                log('Deploy SUCCESS.');
                _setDeviceDeployStatus(deviceId, 'success', 'Deployed ✓');
            } else {
                log('');
                log('Deploy FAILED.');
                _setDeviceDeployStatus(deviceId, 'failed', 'Deploy failed');
            }
            document.getElementById('deployModalConfirm').disabled = false;
            document.getElementById('deployModalConfirm').textContent = 'Deploy';
        });
    });
}

function _sendFramesToDevice(deviceId, frames, log) {
    var idx = 0;
    var allOk = true;
    function sendNext() {
        if (idx >= frames.length) {
            if (!allOk) return Promise.resolve(false);
            log('  Sending RUN sentinel (0xBE 0xAA)…');
            return fetch('/api/device/' + deviceId + '/deploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tx: [0xBE, 0xAA],
                    rx_count: 0,
                    timeout_ms: 1000
                })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.ok) {
                    log('  RUN sentinel bridge error: ' + (data.error || 'unknown'));
                    return false;
                }
                log('  RUN sent — core executing from PC=0.');
                return true;
            })
            .catch(function(err) {
                log('  RUN sentinel network error: ' + err);
                return false;
            });
        }
        var f = frames[idx];
        log('  Frame ' + idx + ': addr=0x' + f.addr.toString(16).toUpperCase().padStart(4, '0') +
            ' words=' + f.count + ' CRC=0x' + f.crc.toString(16).toUpperCase().padStart(4, '0') +
            ' (' + f.frame.length + ' bytes)');
        idx++;
        return fetch('/api/device/' + deviceId + '/deploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tx: Array.from(f.frame),
                rx_count: 4,
                timeout_ms: 5000
            })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.ok) {
                log('  Bridge error: ' + (data.error || 'unknown'));
                allOk = false;
                return sendNext();
            }
            var rx = data.rx || [];
            var parsed = _parseDeployResponse(rx, f.addr, f.count);
            log('  ' + parsed.msg);
            if (!parsed.success) allOk = false;
            return sendNext();
        })
        .catch(function(err) {
            log('  Network error: ' + err);
            allOk = false;
            return sendNext();
        });
    }
    return sendNext();
}

function deployAll() {
    var programs = _getDeployablePrograms();
    var hasEditor = !!(selectedCR !== null && ((document.getElementById('asmEditor') || {}).value || '').trim());

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';

    var progListHtml = '';
    if (hasEditor) {
        progListHtml += '<label class="deploy-program-option">' +
            '<input type="radio" name="deployAllSrc" value="editor" checked /> ' +
            '<span>Current editor code (compile &amp; deploy)</span>' +
            '</label>';
    }
    for (var p = 0; p < programs.length; p++) {
        var prog = programs[p];
        var checked = (!hasEditor && p === 0) ? ' checked' : '';
        progListHtml += '<label class="deploy-program-option">' +
            '<input type="radio" name="deployAllSrc" value="ns:' + prog.nsIdx + '"' + checked + ' /> ' +
            '<span>' + _escHtml(prog.label) + ' (NS[' + prog.nsIdx + '], ' + prog.cw + ' words)</span>' +
            '</label>';
    }
    if (!hasEditor && programs.length === 0) {
        progListHtml = '<div style="color:#ef5350;font-size:0.85rem;">No programs available.</div>';
    }

    overlay.innerHTML =
        '<div class="modal-dialog" style="max-width:520px;">' +
            '<h3 style="margin:0 0 1rem;color:var(--church-gold,#daa520);">Deploy All — Online Boards</h3>' +
            '<div style="color:#bbb;font-size:0.88rem;margin-bottom:0.8rem;">Select a program to deploy to all online boards:</div>' +
            '<div class="deploy-program-list" style="max-height:160px;overflow-y:auto;margin-bottom:1rem;">' + progListHtml + '</div>' +
            '<div id="deployAllLog" style="background:#111;border:1px solid #333;border-radius:4px;padding:0.5rem;font-family:monospace;font-size:0.78rem;color:#aaa;max-height:240px;overflow-y:auto;white-space:pre-wrap;margin-bottom:1rem;display:none;"></div>' +
            '<div style="display:flex;gap:0.5rem;justify-content:flex-end;">' +
                '<button id="deployAllCancel" class="dev-action-btn" style="padding:6px 16px;">Cancel</button>' +
                '<button id="deployAllConfirm" class="dev-action-btn" style="padding:6px 16px;background:#2d4a22;color:#8bc34a;border-color:#4caf50;">Deploy All</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);

    function closeModal() { overlay.remove(); document.removeEventListener('keydown', onEsc); }
    function onEsc(e) { if (e.key === 'Escape') closeModal(); }
    document.addEventListener('keydown', onEsc);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
    document.getElementById('deployAllCancel').addEventListener('click', closeModal);

    document.getElementById('deployAllConfirm').addEventListener('click', function() {
        var selected = overlay.querySelector('input[name="deployAllSrc"]:checked');
        if (!selected) { alert('No program selected.'); return; }

        var logEl = document.getElementById('deployAllLog');
        logEl.style.display = 'block';
        logEl.textContent = '';
        var log = function(msg) { logEl.textContent += msg + '\n'; logEl.scrollTop = logEl.scrollHeight; };

        var frames;
        var srcVal = selected.value;
        if (srcVal === 'editor') {
            log('Compiling current editor code…');
            frames = _buildDeployFrames();
        } else if (srcVal.startsWith('ns:')) {
            var nsIdx = parseInt(srcVal.substring(3), 10);
            log('Loading NS[' + nsIdx + '] for deploy…');
            frames = _buildDeployFramesFromNS(nsIdx);
        }

        if (!frames || frames.length === 0) {
            log('ERROR: Failed to build frames.');
            return;
        }

        document.getElementById('deployAllConfirm').disabled = true;
        document.getElementById('deployAllConfirm').textContent = 'Deploying…';

        log('Built ' + frames.length + ' BEEF frame(s). Fetching device list…');

        fetch('/api/device/list')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var _resetBtn = function() {
                    var btn = document.getElementById('deployAllConfirm');
                    if (btn) { btn.disabled = false; btn.textContent = 'Deploy All'; }
                };
                if (!data.ok || !data.devices) {
                    log('Failed to fetch device list.');
                    _resetBtn();
                    return;
                }
                var targets = data.devices.filter(function(d) { return d.status === 'online' && d.profile === 'IoT'; });
                if (targets.length === 0) {
                    targets = data.devices.filter(function(d) { return d.status === 'online'; });
                }
                if (targets.length === 0) {
                    log('No online devices found.');
                    _resetBtn();
                    return;
                }
                log('Deploying to ' + targets.length + ' device(s)…');
                log('');

                var i = 0;
                function deployNext() {
                    if (i >= targets.length) {
                        log('');
                        log('Deploy All complete.');
                        document.getElementById('deployAllConfirm').disabled = false;
                        document.getElementById('deployAllConfirm').textContent = 'Deploy All';
                        return;
                    }
                    var dev = targets[i];
                    var label = dev.label || dev.board_name || ('Device #' + dev.id);
                    log('--- ' + label + ' (ID ' + dev.id + ', UID ' + dev.device_uid + ') ---');
                    _setDeviceDeployStatus(dev.id, 'deploying', 'Deploying…');
                    i++;
                    _sendFramesToDevice(dev.id, frames, log).then(function(ok) {
                        if (ok) {
                            log('Result: SUCCESS');
                            _setDeviceDeployStatus(dev.id, 'success', 'Deployed ✓');
                        } else {
                            log('Result: FAILED');
                            _setDeviceDeployStatus(dev.id, 'failed', 'Deploy failed');
                        }
                        log('');
                        deployNext();
                    });
                }
                deployNext();
            })
            .catch(function() {
                log('Network error fetching device list.');
                var btn = document.getElementById('deployAllConfirm');
                if (btn) { btn.disabled = false; btn.textContent = 'Deploy All'; }
            });
    });
}

var _currentDevicesTab = 'devices';

// ── Church Machine Instruction Decoder ────────────────────────────────────
var CM_MNEMONICS = [
    'LOAD', 'SAVE', 'CALL', 'RETURN', 'CHANGE',
    'SWITCH', 'TPERM', 'LAMBDA', 'ELOADCALL', 'XLOADLAMBDA',
    'DREAD', 'DWRITE', 'BFEXT', 'BFINS', 'MCMP',
    'IADD', 'ISUB', 'BRANCH', 'SHL', 'SHR'
];

var CM_CONDS = [
    'EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC',
    'HI', 'LS', 'GE', 'LT', 'GT', 'LE', 'AL', 'NV'
];

function _cmDecodeWord(word, wordAddr) {
    var hexStr = (word >>> 0).toString(16).toUpperCase().padStart(8, '0');
    if (word === 0) {
        return { addr: wordAddr, hex: hexStr, mnemonic: 'HALT', cond: 'AL', condSuffix: '', dst: null, src: null, imm: null, text: 'HALT' };
    }
    var opcode = (word >>> 27) & 0x1F;
    var cond   = (word >>> 23) & 0x0F;
    var dst    = (word >>> 19) & 0x0F;
    var src    = (word >>> 15) & 0x0F;
    var imm15  = word & 0x7FFF;

    if (opcode > 19) {
        return { addr: wordAddr, hex: hexStr, mnemonic: '?', cond: 'AL', condSuffix: '', dst: null, src: null, imm: null, text: '? 0x' + hexStr };
    }

    var mnemonic   = CM_MNEMONICS[opcode];
    var condStr    = CM_CONDS[cond];
    var condSuffix = (cond === 14) ? '' : ('.' + condStr);

    var operands = '';
    switch (opcode) {
        case 0:  operands = 'CR'+dst+', CR'+src+', #'+imm15; break;
        case 1:  operands = 'CR'+dst+', CR'+src+', #'+imm15; break;
        case 2:  operands = imm15 ? 'CR'+src+', #'+imm15 : 'CR'+src; break;
        case 3:  operands = imm15 ? '#0x'+(imm15).toString(16).toUpperCase() : ''; break;
        case 4:  operands = 'CR'+dst+', CR'+src+', #'+imm15; break;
        case 5:  operands = 'CR'+dst+', CR'+src; break;
        case 6:  operands = 'CR'+dst+', CR'+src+', #'+imm15; break;
        case 7:  operands = 'CR'+dst; break;
        case 8:  operands = 'CR'+dst+', CR'+src+', #'+imm15; break;
        case 9:  operands = 'CR'+dst+', CR'+src+', #'+imm15; break;
        case 10: operands = 'DR'+dst+', CR'+src+', #'+imm15; break;
        case 11: operands = 'CR'+dst+', #'+imm15+', DR'+src; break;
        case 12: case 13: case 15: case 16: case 18: case 19:
            operands = 'DR'+dst+', DR'+src+', #'+imm15; break;
        case 14: operands = 'DR'+dst+', DR'+src; break;
        case 17: {
            var signedOff = (imm15 & 0x4000) ? (imm15 - 0x8000) : imm15;
            var target    = (wordAddr + signedOff) >>> 0;
            operands = (signedOff >= 0 ? '+' : '') + signedOff + ' (→ 0x' + target.toString(16).toUpperCase() + ')';
            break;
        }
        default: operands = 'CR'+dst+', CR'+src+', #'+imm15;
    }

    var text = mnemonic + condSuffix + (operands ? ' ' + operands : '');
    return { addr: wordAddr, hex: hexStr, mnemonic: mnemonic, cond: condStr, condSuffix: condSuffix, dst: dst, src: src, imm: imm15, text: text };
}

// ── CR Role Names ─────────────────────────────────────────────────────────
// Maps CR register indices to their Church Machine ABI roles.
// Derived from the callhome data attributes: data-cr12 (Return),
// data-cr14 (Active LUMP), data-cr15 (Namespace).
function _crRoleName(n) {
    var ROLES = {
        0:  'Result',
        1:  'Arg\u202f1',
        2:  'Heap',
        3:  'C-List',
        4:  'Services',
        5:  'Thread',
        6:  'IRQ',
        12: 'Return',
        14: 'Active\u202fLUMP',
        15: 'Namespace'
    };
    if (n in ROLES) return ROLES[n];
    return 'Local\u202f#' + n;
}

// ── Plain-English Instruction Description ─────────────────────────────────
// Mnemonic set (opcode 0–19 + HALT for word=0):
//   0 LOAD  1 SAVE  2 CALL  3 RETURN  4 CHANGE  5 SWITCH  6 TPERM  7 LAMBDA
//   8 ELOADCALL  9 XLOADLAMBDA  10 DREAD  11 DWRITE  12 BFEXT  13 BFINS
//   14 MCMP  15 IADD  16 ISUB  17 BRANCH  18 SHL  19 SHR  (word=0 → HALT)
function _instrPlainEnglish(decoded) {
    if (!decoded || !decoded.mnemonic) return '';
    var m   = decoded.mnemonic;
    var dst = decoded.dst;
    var src = decoded.src;
    var imm = decoded.imm;
    var dn  = (dst !== null && dst !== undefined) ? _crRoleName(dst) : '';
    var sn  = (src !== null && src !== undefined) ? _crRoleName(src) : '';
    switch (m) {
        case 'LOAD':
            return 'Load namespace slot #' + imm + ' from ' + sn + ' into ' + dn + '.';
        case 'SAVE':
            return 'Save ' + dn + ' into namespace slot #' + imm + ' of ' + sn + '.';
        case 'CALL':
            return 'Call the capability held in ' + sn + (imm ? ', entry #' + imm : '') + '.';
        case 'RETURN':
            return 'Return to caller' + (imm ? ' with status 0x' + imm.toString(16).toUpperCase() : '') + '.';
        case 'CHANGE':
            return 'Replace ' + dn + ' with the capability at slot #' + imm + ' from ' + sn + '.';
        case 'SWITCH':
            return 'Switch context: hand control from ' + dn + ' to ' + sn + '.';
        case 'TPERM':
            return 'Test permission bit #' + imm + ' in ' + sn + '; store result into ' + dn + '.';
        case 'LAMBDA':
            return 'Create a lambda closure from ' + dn + '.';
        case 'ELOADCALL':
            return 'Extended-load slot #' + imm + ' from ' + sn + ' and call it; result into ' + dn + '.';
        case 'XLOADLAMBDA':
            return 'Cross-load lambda slot #' + imm + ' from ' + sn + ' into ' + dn + '.';
        case 'DREAD':
            return 'Read word at offset #' + imm + ' from capability ' + sn + ' into data register DR' + dst + '.';
        case 'DWRITE':
            return 'Write data register DR' + src + ' to the address pointed by ' + dn + ' + #' + imm + '.';
        case 'BFEXT':
            return 'Extract bit-field #' + imm + ' from DR' + src + ' into DR' + dst + '.';
        case 'BFINS':
            return 'Insert bit-field #' + imm + ' from DR' + src + ' into DR' + dst + '.';
        case 'MCMP':
            return 'Compare DR' + dst + ' with DR' + src + '; set condition flags.';
        case 'IADD':
            return 'Add DR' + src + ' and #' + imm + '; store result in DR' + dst + '.';
        case 'ISUB':
            return 'Subtract DR' + src + ' from DR' + dst + '; store result in DR' + dst + '.';
        case 'SHL':
            return 'Shift DR' + dst + ' left by #' + imm + ' bits; store in DR' + dst + '.';
        case 'SHR':
            return 'Shift DR' + dst + ' right by #' + imm + ' bits; store in DR' + dst + '.';
        case 'BRANCH': {
            var signedOff = (imm !== null && (imm & 0x4000)) ? (imm - 0x8000) : (imm || 0);
            return 'Branch ' + (signedOff >= 0 ? '+' : '') + signedOff + ' instructions if condition holds.';
        }
        case 'HALT':
            return 'Stop execution and halt the processor.';
        default:
            return '';
    }
}

// Returns a compact "dst role · src role" annotation string for CR operands in
// the disassembly role column. Returns '' when no CR operands are relevant.
// CR operand map (matches _cmDecodeWord operand encoding):
//   dst is CR: LOAD, SAVE, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA, DWRITE
//   src is CR: LOAD, SAVE, CALL, CHANGE, SWITCH, TPERM, ELOADCALL, XLOADLAMBDA, DREAD
function _instrRoleAnnotation(decoded) {
    if (!decoded || !decoded.mnemonic) return '';
    var m   = decoded.mnemonic;
    var dst = decoded.dst;
    var src = decoded.src;
    var dstIsCR = ['LOAD','SAVE','CHANGE','SWITCH','TPERM','LAMBDA','ELOADCALL','XLOADLAMBDA','DWRITE'].indexOf(m) >= 0;
    var srcIsCR = ['LOAD','SAVE','CALL','CHANGE','SWITCH','TPERM','ELOADCALL','XLOADLAMBDA','DREAD'].indexOf(m) >= 0;
    var parts = [];
    if (dstIsCR && dst !== null && dst !== undefined) parts.push(_crRoleName(dst));
    if (srcIsCR && src !== null && src !== undefined && src !== dst) parts.push(_crRoleName(src));
    return parts.join('\u2009\u00b7\u2009');
}

// ── Boot ROM / Boot.Abstr Word Cache ─────────────────────────────────────
var _cmRomCache  = null;   // flat array of 32-bit words, index = word address
var _cmLumpCache = null;   // { lump_base: N, code: [...] }

function _cmFetchWordCaches() {
    if (!_cmRomCache) {
        fetch('/api/boot-rom-words')
            .then(function(r) { return r.json(); })
            .then(function(d) { if (d.ok && d.rom) _cmRomCache = d.rom; })
            .catch(function() {});
    }
    if (!_cmLumpCache) {
        fetch('/api/boot-lump-words')
            .then(function(r) { return r.json(); })
            .then(function(d) { if (d.ok && d.code) _cmLumpCache = { lump_base: d.lump_base, code: d.code }; })
            .catch(function() {});
    }
}

function _cmLookupWord(wordAddr) {
    if (_cmRomCache && wordAddr >= 0 && wordAddr < _cmRomCache.length) {
        return _cmRomCache[wordAddr];
    }
    if (_cmLumpCache) {
        var off = wordAddr - (_cmLumpCache.lump_base + 1);
        if (off >= 0 && off < _cmLumpCache.code.length) {
            return _cmLumpCache.code[off];
        }
    }
    return null;
}

function _cmWordsAround(centreNia, radius) {
    var results = [];
    for (var i = centreNia - radius; i <= centreNia + radius; i++) {
        var w = _cmLookupWord(i);
        results.push({ wordAddr: i, word: (w === null || w === undefined) ? null : (w >>> 0) });
    }
    return results;
}

// ── Disassembly Panel ─────────────────────────────────────────────────────
// ── Callhome Row Detail Modals (floating, draggable, multiple) ─────────────
var _chlogModalSeq = 0;
var _chlogModalBaseLeft = 80;
var _chlogModalBaseTop  = 90;

// Fixed boot-image NS slot table — slot index → human pet name.
// Used to resolve CR14 (⚡ abstraction), CR12 (return), CR15 (data) values
// which are raw NS slot indices into the GT > CR6 > Namespace table.
var _CHLOG_NS_SLOT_NAMES = {
    0: 'Boot.ROM',
    1: 'Boot.NS',
    2: 'Boot.GT',
    3: 'Boot.Abstr',
    4: 'Locator',
    5: 'Scheduler',
    6: 'Navana',
    7: 'TrustKernel',
    8: 'Scheduler.IRQ',
    50: 'Scheduler.IRQ.Thread',
    51: 'Scheduler.IRQ.Thread.Alt'
};

function _chlogNsSlotName(rawStr) {
    if (!rawStr || rawStr === '\u2014' || rawStr === 'null' || rawStr === '') return '\u2014';
    var idx = parseInt(rawStr, 10);
    if (isNaN(idx)) return rawStr;
    // 1. Fixed boot-image table
    if (_CHLOG_NS_SLOT_NAMES[idx]) return _CHLOG_NS_SLOT_NAMES[idx];
    // 2. Live simulator namespace labels (if simulator is loaded)
    if (typeof sim !== 'undefined' && sim && sim.nsLabels && sim.nsLabels[idx]) {
        return sim.nsLabels[idx];
    }
    // 3. Numeric fallback
    return 'NS\u202f#' + idx;
}

function _chlogPetNameFromContext(niaInt, niaLabel) {
    // 1. Server-supplied human label wins
    if (niaLabel && niaLabel !== ('0x' + niaInt.toString(16).toUpperCase().padStart(4,'0'))) return niaLabel;
    // 2. Exact zero → boot entry
    if (niaInt === 0) return 'Boot ROM \u00b7 entry point';
    // 3. Inside boot ROM cache
    if (_cmRomCache && niaInt > 0 && niaInt < _cmRomCache.length) {
        var romOff = niaInt;
        // NS slot table occupies ROM from word 1: each slot = 4 words, so slot N starts at 1+N*4
        if (romOff >= 1) {
            var slotIdx = Math.floor((romOff - 1) / 4);
            var slotOff = (romOff - 1) % 4;
            var SLOT_NAMES = { 0:'Boot.ROM', 1:'Boot.NS', 2:'Boot.GT', 3:'Boot.Abstr',
                               4:'Locator', 5:'Scheduler', 6:'Navana', 7:'TrustKernel',
                               8:'Scheduler.IRQ' };
            var wordRole = ['ns-entry', 'limit/cc', 'token', 'padding'][slotOff] || '';
            var slotName = SLOT_NAMES[slotIdx] || ('NS#' + slotIdx);
            return 'Boot ROM \u00b7 ' + slotName + ' (' + wordRole + ')';
        }
        return 'Boot ROM \u00b7 offset +' + niaInt;
    }
    // 4. Inside Boot.Abstr lump code area
    if (_cmLumpCache) {
        var base = _cmLumpCache.lump_base;
        var end  = base + 1 + _cmLumpCache.code.length;
        if (niaInt >= base + 1 && niaInt < end) {
            return 'Boot.Abstr \u00b7 instruction +'  + (niaInt - base - 1);
        }
        if (niaInt === base) return 'Boot.Abstr \u00b7 lump header';
    }
    // 5. Extended-code area (loaded program)
    if (niaInt >= 0x0400 && niaInt < 0x8000) return 'Program code \u00b7 0x' + niaInt.toString(16).toUpperCase().padStart(4,'0');
    // 6. High address space
    if (niaInt >= 0x8000) return 'Data space \u00b7 0x' + niaInt.toString(16).toUpperCase().padStart(4,'0');
    return '0x' + niaInt.toString(16).toUpperCase().padStart(4,'0');
}

function _chlogMakeDraggable(modal) {
    var header = modal.querySelector('.chlog-modal-header');
    if (!header) return;
    var dragging = false, ox = 0, oy = 0;
    header.addEventListener('mousedown', function(e) {
        if (e.target.classList.contains('chlog-modal-close')) return;
        dragging = true;
        ox = e.clientX - modal.offsetLeft;
        oy = e.clientY - modal.offsetTop;
        modal.style.transition = 'none';
        e.preventDefault();
    });
    var moveHandler = function(e) {
        if (!dragging) return;
        modal.style.left = Math.max(0, e.clientX - ox) + 'px';
        modal.style.top  = Math.max(0, e.clientY - oy) + 'px';
    };
    var upHandler = function() { dragging = false; };
    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup',   upHandler);
    // Clean up listeners when modal is removed
    var obs = new MutationObserver(function(_, o) {
        if (!document.body.contains(modal)) {
            document.removeEventListener('mousemove', moveHandler);
            document.removeEventListener('mouseup',   upHandler);
            o.disconnect();
        }
    });
    obs.observe(document.body, { childList: true, subtree: true });
}

// ── _cmBuildDisasmHtml ────────────────────────────────────────────────────────
// Builds the disassembly rows HTML and spotlight block HTML from a NIA address
// and a words array (each element: { wordAddr: int, word: int|null }).
// Returns { rowsHtml, spotlightHtml }.
// Extracted as a standalone function so it can be unit-tested independently of
// the modal scaffolding in _openCallhomeModal.
function _cmBuildDisasmHtml(niaInt, words) {
    // Collapse leading no-data rows into a single separator line
    var firstRealIdx = 0;
    while (firstRealIdx < words.length && words[firstRealIdx].word === null && words[firstRealIdx].wordAddr < niaInt) {
        firstRealIdx++;
    }
    var hasLeadingNoData = (firstRealIdx > 0);

    // Find decoded current instruction for spotlight
    var currentEntry = null;
    words.forEach(function(entry) { if (entry.wordAddr === niaInt && entry.word !== null) currentEntry = entry; });
    var currentDecoded = currentEntry ? _cmDecodeWord(currentEntry.word, niaInt) : null;

    var rowsHtml = '<div class="nia-disasm-body">';
    if (hasLeadingNoData) {
        rowsHtml += '<div class="nia-nodata-sep">\u2500\u2500 nothing before this address \u2500\u2500</div>';
    }
    words.forEach(function(entry) {
        if (entry.word === null && entry.wordAddr < niaInt) return; // collapsed above
        var rel = entry.wordAddr - niaInt;
        var isCurrent = (rel === 0);
        var relStr = rel === 0 ? '\u25b6' : (rel > 0 ? '+' + rel : String(rel));
        var rowCls = 'nia-disasm-row' + (isCurrent ? ' nia-disasm-current' : '');
        var decoded = (entry.word === null)
            ? { hex: '????????', text: '(no data)', mnemonic: null, dst: null, src: null, imm: null }
            : _cmDecodeWord(entry.word, entry.wordAddr);
        if (entry.word === null && !isCurrent) {
            rowCls += ' nia-no-data';
        }
        var addrStr = '0x' + entry.wordAddr.toString(16).toUpperCase().padStart(4, '0');
        var roleStr = decoded.mnemonic ? _instrRoleAnnotation(decoded) : '';
        var plainEngRow = decoded.mnemonic ? (_instrPlainEnglish(decoded) || '') : '';
        if (plainEngRow && !isCurrent) rowCls += ' nia-row-has-desc';
        var descAttr = (plainEngRow && !isCurrent)
            ? ' data-desc="' + plainEngRow.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"'
            : '';
        var addrAttr = ' data-addr="' + entry.wordAddr + '"';
        rowsHtml +=
            '<div class="' + rowCls + '"' + descAttr + addrAttr + '>' +
                '<span class="nia-col-rel">'  + _escHtml(relStr)       + '</span>' +
                '<span class="nia-col-addr">' + _escHtml(addrStr)      + '</span>' +
                '<span class="nia-col-hex">'  + _escHtml(decoded.hex)  + '</span>' +
                '<span class="nia-col-text">' + _escHtml(decoded.text) + '</span>' +
                '<span class="nia-col-role">' + _escHtml(roleStr)      + '</span>' +
            '</div>';
        if (isCurrent && plainEngRow) {
            rowsHtml += '<div class="nia-disasm-desc nia-disasm-desc-current">' + _escHtml(plainEngRow) + '</div>';
        }
    });
    rowsHtml += '</div>';

    // Spotlight block (shown when current instruction word is known).
    // Suppress HALT in the boot ROM NS-table region (addr < 0x100):
    // word=0 there is an unloaded NS slot entry, not a real HALT instruction.
    var spotlightHtml = '';
    var _isSpuriousHalt = currentDecoded && currentDecoded.mnemonic === 'HALT' && niaInt < 0x100;
    if (currentDecoded && currentDecoded.mnemonic && !_isSpuriousHalt) {
        var roleAnnot = _instrRoleAnnotation(currentDecoded);
        var plainEng  = _instrPlainEnglish(currentDecoded);
        spotlightHtml =
            '<div class="chlog-modal-spotlight">' +
                '<div class="chlog-modal-spotlight-mnemonic">' +
                    _escHtml(currentDecoded.text) +
                    (roleAnnot ? '<span class="chlog-modal-spotlight-role">\u2002' + _escHtml(roleAnnot) + '</span>' : '') +
                '</div>' +
                (plainEng ? '<div class="chlog-modal-spotlight-english">' + _escHtml(plainEng) + '</div>' : '') +
            '</div>';
    }

    return { rowsHtml: rowsHtml, spotlightHtml: spotlightHtml };
}

function _openCallhomeModal(row) {
    var entryUid    = row.dataset.uid || (row.getAttribute('data-nia') || '0x0');
    var nia         = row.getAttribute('data-nia') || '0x0';
    var cr14        = row.getAttribute('data-cr14') || 'null';
    var cr12        = row.getAttribute('data-cr12') || 'null';
    var cr15        = row.getAttribute('data-cr15') || 'null';
    var niaLabel    = row.dataset.niaLabel  || '';
    var faultName   = row.dataset.faultName || '';
    var machLabel   = row.dataset.machineLabel || '?';
    var timeStr     = row.dataset.timeStr   || '';
    var fwStr       = row.dataset.fwStr     || '';
    var bootStr     = row.dataset.bootStr   || '';

    var niaInt = parseInt(nia, 16);
    if (isNaN(niaInt)) niaInt = 0;

    var cr14Str = (cr14 !== 'null' && cr14 !== '') ? cr14 : '\u2014';
    var cr12Str = (cr12 !== 'null' && cr12 !== '') ? cr12 : '\u2014';
    var cr15Str = (cr15 !== 'null' && cr15 !== '') ? cr15 : '\u2014';
    // Resolve NS slot indices → human pet names (GT > CR6 > Namespace table)
    var cr14Name = _chlogNsSlotName(cr14Str);   // ⚡ abstraction cap
    var cr12Name = _chlogNsSlotName(cr12Str);   // return cap
    var cr15Name = _chlogNsSlotName(cr15Str);   // data cap

    var petName = _chlogPetNameFromContext(niaInt, niaLabel);

    var seq  = ++_chlogModalSeq;
    var step = (seq - 1) % 8;
    var left = _chlogModalBaseLeft + step * 22;
    var top  = _chlogModalBaseTop  + step * 22;

    var modal = document.createElement('div');
    modal.className = 'chlog-modal';
    modal.id = 'chlog-modal-' + seq;
    modal.style.left = left + 'px';
    modal.style.top  = top  + 'px';

    var faultHtml = '';
    if (faultName) {
        faultHtml =
            '<div class="chlog-modal-fault">' +
                '<span class="chlog-fault-val">' + _escHtml(faultName) + '</span>' +
                ' <span class="chlog-recovery-tag">RECOVERY</span>' +
            '</div>';
    }

    var RADIUS = 8;
    var words = _cmWordsAround(niaInt, RADIUS);
    var _built = _cmBuildDisasmHtml(niaInt, words);
    var rowsHtml     = _built.rowsHtml;
    var spotlightHtml = _built.spotlightHtml;

    modal.innerHTML =
        '<div class="chlog-modal-header">' +
            '<div class="chlog-modal-title">' +
                '<span class="chlog-modal-machine">' + _escHtml(machLabel) + '</span>' +
                '<span class="chlog-modal-ts">' + _escHtml(timeStr) + '</span>' +
            '</div>' +
            '<button class="chlog-modal-close" title="Close">\u2715</button>' +
        '</div>' +
        '<div class="chlog-modal-body">' +
            '<div class="chlog-modal-petname">' + _escHtml(petName) + '</div>' +
            '<div class="chlog-modal-ctx-card">' +
                '<div class="chlog-modal-ctx-cell">' +
                    '<div class="chlog-modal-ctx-label">Active\u202fLUMP</div>' +
                    '<div class="chlog-modal-ctx-val">' + _escHtml(cr14Name) + '</div>' +
                '</div>' +
                '<div class="chlog-modal-ctx-cell">' +
                    '<div class="chlog-modal-ctx-label">Return\u202fto</div>' +
                    '<div class="chlog-modal-ctx-val">' + _escHtml(cr12Name) + '</div>' +
                '</div>' +
                '<div class="chlog-modal-ctx-cell">' +
                    '<div class="chlog-modal-ctx-label">Namespace</div>' +
                    '<div class="chlog-modal-ctx-val">' + _escHtml(cr15Name) + '</div>' +
                '</div>' +
            '</div>' +
            spotlightHtml +
            '<div class="chlog-modal-fw">FW\u2009' + _escHtml(fwStr) + '\u2002\u00b7\u2002Boot\u202f#' + _escHtml(bootStr) + '</div>' +
            faultHtml +
        '</div>' +
        rowsHtml;

    document.body.appendChild(modal);
    _chlogMakeDraggable(modal);

    // Highlight source row
    row.classList.add('nia-row-active');

    // Close button — pin is kept in _disasmPinnedMap so reopening restores it
    modal.querySelector('.chlog-modal-close').addEventListener('click', function(e) {
        e.stopPropagation();
        modal.remove();
        row.classList.remove('nia-row-active');
    });

    // Click-to-expand: any non-current disassembly row with a description
    var disasmBody = modal.querySelector('.nia-disasm-body');
    if (disasmBody) {
        // Auto-restore pinned row if this entry was previously opened
        var savedAddr = _disasmPinnedMap.has(entryUid) ? _disasmPinnedMap.get(entryUid) : null;
        if (savedAddr !== null) {
            var pinnedRow = disasmBody.querySelector('.nia-disasm-row[data-addr="' + savedAddr + '"]');
            if (pinnedRow && !pinnedRow.classList.contains('nia-disasm-current') && pinnedRow.dataset.desc) {
                var autoDesc = document.createElement('div');
                autoDesc.className = 'nia-disasm-desc';
                autoDesc.textContent = pinnedRow.dataset.desc;
                pinnedRow.insertAdjacentElement('afterend', autoDesc);
                pinnedRow.classList.add('nia-row-expanded', 'nia-row-pinned');
            }
        }

        disasmBody.addEventListener('click', function(e) {
            var clickedRow = e.target.closest('.nia-disasm-row');
            if (!clickedRow || clickedRow.classList.contains('nia-disasm-current') || !clickedRow.dataset.desc) return;

            var next = clickedRow.nextElementSibling;
            var isExpanded = next && next.classList.contains('nia-disasm-desc') && !next.classList.contains('nia-disasm-desc-current');

            // Collapse any previously-opened non-current description
            disasmBody.querySelectorAll('.nia-disasm-desc:not(.nia-disasm-desc-current)').forEach(function(d) { d.remove(); });
            disasmBody.querySelectorAll('.nia-disasm-row.nia-row-expanded').forEach(function(r) { r.classList.remove('nia-row-expanded', 'nia-row-pinned'); });

            if (!isExpanded) {
                var descEl = document.createElement('div');
                descEl.className = 'nia-disasm-desc';
                descEl.textContent = clickedRow.dataset.desc;
                clickedRow.insertAdjacentElement('afterend', descEl);
                clickedRow.classList.add('nia-row-expanded', 'nia-row-pinned');
                _disasmPinnedMap.set(entryUid, parseInt(clickedRow.dataset.addr, 10));
            } else {
                // User toggled the same row off — clear the pin for this entry
                _disasmPinnedMap.delete(entryUid);
            }
        });
    }

    // Bring to front on mousedown
    modal.addEventListener('mousedown', function() {
        document.querySelectorAll('.chlog-modal').forEach(function(m) { m.style.zIndex = '9999'; });
        modal.style.zIndex = '10000';
    });
}

// ── Disassembly pinned-row state ────────────────────────────────────────────
// Keyed by log-entry uid → pinned word address (integer).
// Survives modal close so reopening the same entry restores the last-opened row.
var _disasmPinnedMap = new Map();

// ── Live Call-Home Log ─────────────────────────────────────────────────────
var _callhomeLogSince = 0;
var _callhomeLogTimer = null;
var _callhomeLogRowCount = 0;
var _selectedMachineUid = '';
var _callhomeLatestTs = 0;    // Unix seconds of most-recent entry (callhome or UART)
var _deviceLabelCache = {};   // uid.toUpperCase() → pet name || board_name
var _callhomeFilter = 'all';  // 'all' | 'cloomc'

function toggleCallhomeFilter() {
    _callhomeFilter = (_callhomeFilter === 'all') ? 'cloomc' : 'all';
    var btn = document.getElementById('callhomeFilterBtn');
    if (btn) {
        btn.textContent = (_callhomeFilter === 'cloomc') ? 'CLOOMC' : 'All';
        btn.classList.toggle('active', _callhomeFilter === 'cloomc');
    }
    var panel = document.getElementById('callhomeLogEntries');
    if (!panel) return;
    panel.querySelectorAll('.callhome-uart-row').forEach(function(r) {
        var uid = (r.dataset.uid || '').toUpperCase();
        var uidHidden = _selectedMachineUid && uid !== _selectedMachineUid;
        if (uidHidden) { r.style.display = 'none'; return; }
        if (_callhomeFilter === 'cloomc') {
            var txt = r.querySelector('.uart-text');
            var isBoot = txt && txt.classList.contains('uart-text-boot');
            var isInit = txt && txt.classList.contains('uart-text-init');
            r.style.display = (isBoot || isInit) ? '' : 'none';
        } else {
            r.style.display = '';
        }
    });
}

function _updateLogSubtitle() {
    var sub = document.getElementById('callhomeLogSubtitle');
    if (!sub) return;
    if (!_callhomeLatestTs) { sub.textContent = 'live \u00b7 polling every 3 s'; return; }
    var d = new Date(_callhomeLatestTs * 1000);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var label = d.getDate() + ' ' + months[d.getMonth()] +
                ' \u00b7 ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    sub.textContent = label;
}

function _niaPetName(nia, niaLabel) {
    if (niaLabel) return niaLabel;
    if (!nia || nia === '0x00000000' || nia === '0x0' || nia === '0') return 'Boot';
    return nia;
}

function _startCallhomeLog() {
    if (_callhomeLogTimer) return;
    _refreshMachineDropdown();
    _callhomeLogTimer = setTimeout(_pollCallhomeLog, 400);
}

function _refreshMachineDropdown() {
    var sel = document.getElementById('callhomeMachineSelect');
    if (!sel) return;
    fetch('/api/device/list')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.ok || !data.devices) return;
            var current = sel.value;
            while (sel.options.length > 1) sel.remove(1);
            data.devices.forEach(function(dev) {
                var uidKey = (dev.device_uid || '').toUpperCase();
                _deviceLabelCache[uidKey] = dev.label || dev.board_name || uidKey.slice(-8);
                var opt = document.createElement('option');
                opt.value = dev.device_uid;
                var dot = dev.status === 'online' ? '● ' : '○ ';
                opt.textContent = dot + _deviceLabelCache[uidKey];
                opt.dataset.status = dev.status;
                sel.appendChild(opt);
            });
            var stillExists = Array.from(sel.options).some(function(o) { return o.value === current; });
            sel.value = stillExists ? current : '';
            if (!stillExists) _selectedMachineUid = '';
            else _selectedMachineUid = sel.value.toUpperCase();
        })
        .catch(function() {});
}

function _onMachineSelectChange() {
    var sel = document.getElementById('callhomeMachineSelect');
    _selectedMachineUid = (sel ? sel.value : '').toUpperCase();

    // Reset counters and wipe rows so the next poll fetches full history
    // for the newly selected machine (or all machines) from since=0.
    _callhomeLogSince = 0;
    _uartLogSince = 0;
    _callhomeLogRowCount = 0;
    _callhomeLatestTs = 0;

    var panel = document.getElementById('callhomeLogEntries');
    if (panel) {
        var header = panel.querySelector('.callhome-log-col-heads');
        panel.innerHTML = '';
        if (header) panel.appendChild(header);
    }

    // Cancel any pending poll and fire immediately.
    if (_callhomeLogTimer) { clearTimeout(_callhomeLogTimer); _callhomeLogTimer = null; }
    if (_uartLogTimer)     { clearTimeout(_uartLogTimer);     _uartLogTimer = null; }
    _pollCallhomeLog();
    _pollUartLog();
}

function _stopCallhomeLog() {
    if (_callhomeLogTimer) { clearTimeout(_callhomeLogTimer); _callhomeLogTimer = null; }
}

function _pollCallhomeLog() {
    _callhomeLogTimer = null;
    fetch('/api/device/callhome-log?since=' + _callhomeLogSince + '&limit=50')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var panel = document.getElementById('callhomeLogEntries');
            if (data.ok && data.entries && data.entries.length > 0 && panel) {
                var empty = panel.querySelector('.callhome-log-empty');
                if (empty) empty.remove();
                data.entries.slice().reverse().forEach(function(e) {
                    if (e.ts > _callhomeLogSince) _callhomeLogSince = e.ts;
                    if (e.ts > _callhomeLatestTs) _callhomeLatestTs = e.ts;
                    var d = new Date(e.ts * 1000);
                    var hh = String(d.getUTCHours()).padStart(2,'0');
                    var mm = String(d.getUTCMinutes()).padStart(2,'0');
                    var ss = String(d.getUTCSeconds()).padStart(2,'0');
                    var timeStr = mm + ':' + ss;
                    var ok = e.boot_ok === 1 || e.boot_ok === true;
                    var dotCls = ok ? 'chlog-dot-ok' : 'chlog-dot-fault';
                    var uid = (e.uid || '').toUpperCase();
                    var faultName = e.fault_name || (e.fault_code ? (_faultTypeNames[e.fault_code] || ('0x' + (e.fault_code >>> 0).toString(16))) : '');
                    var isRecovery = !ok && faultName;
                    var faultDisp = faultName
                        ? '<span class="chlog-fault-val">' + _escHtml(faultName) + '</span>'
                          + (isRecovery ? ' <span class="chlog-recovery-tag">RECOVERY</span>' : '')
                        : '<span class="chlog-ok-dash">—</span>';
                    var typeDisp = (e.type === 'register') ? '<span class="chlog-type-reg">register</span>' : '<span class="chlog-type-ch">callhome</span>';
                    var machineLabel = _deviceLabelCache[uid] || e.board || '?';
                    var ctxLabel = _niaPetName(e.nia, e.nia_label || e.abstraction_label || '');
                    var fwStr = (e.fw_major||1) + '.' + (e.fw_minor||0);
                    var bootStr = String(e.boot_count || 1);
                    var row = document.createElement('div');
                    row.className = 'callhome-log-row';
                    row.dataset.uid          = uid;
                    row.dataset.niaLabel     = ctxLabel;
                    row.dataset.faultName    = faultName;
                    row.dataset.machineLabel = machineLabel;
                    row.dataset.timeStr      = timeStr;
                    row.dataset.fwStr        = fwStr;
                    row.dataset.bootStr      = bootStr;
                    row.title = 'Click for details';
                    row.style.cursor = 'pointer';
                    if (_selectedMachineUid && uid !== _selectedMachineUid) row.style.display = 'none';
                    row.setAttribute('data-nia',  e.nia  || '0x0');
                    row.setAttribute('data-cr14', e.cr14 != null ? String(e.cr14) : 'null');
                    row.setAttribute('data-cr12', e.cr12 != null ? String(e.cr12) : 'null');
                    row.setAttribute('data-cr15', e.cr15 != null ? String(e.cr15) : 'null');
                    var timeCls = ok ? 'chlog-time' : 'chlog-time chlog-time-fault';
                    row.innerHTML =
                        '<span class="' + timeCls + '">' + timeStr + '</span>' +
                        '<span class="' + dotCls + '">\u25cf</span>' +
                        '<span class="chlog-board">' + _escHtml(machineLabel) + '</span>' +
                        '<span class="chlog-ctx">' + _escHtml(ctxLabel) + '</span>' +
                        '<span class="chlog-fw">' + _escHtml(fwStr) + '</span>' +
                        '<span class="chlog-boot">' + _escHtml(bootStr) + '</span>' +
                        '<span class="chlog-fault">' + faultDisp + '</span>' +
                        '<span class="chlog-type">' + typeDisp + '</span>';
                    row.addEventListener('click', function() { _openCallhomeModal(this); });
                    var colHeads = panel.querySelector('.callhome-log-col-heads');
                    var insertAfter = colHeads ? colHeads.nextSibling : panel.firstChild;
                    panel.insertBefore(row, insertAfter);
                    _callhomeLogRowCount++;
                });
                while (panel.children.length > 600) panel.removeChild(panel.lastChild);
            }
            _updateLogSubtitle();
        })
        .catch(function() {
            _updateLogSubtitle();
        })
        .finally(function() {
            if (document.getElementById('callhomeLogPanel')) {
                _callhomeLogTimer = setTimeout(_pollCallhomeLog, 3000);
            }
        });
}

function clearCallhomeLog() {
    _callhomeLogSince = 0;
    _callhomeLogRowCount = 0;
    _uartLogSince = 0;
    _callhomeLatestTs = 0;
    var panel = document.getElementById('callhomeLogEntries');
    if (panel) {
        var header = panel.querySelector('.callhome-log-col-heads');
        panel.innerHTML = '';
        if (header) panel.appendChild(header);
        var empty = document.createElement('div');
        empty.className = 'callhome-log-empty';
        empty.textContent = 'Cleared \u2014 waiting for UART output\u2026';
        panel.appendChild(empty);
    }
    var sub = document.getElementById('callhomeLogSubtitle');
    if (sub) sub.textContent = 'live \u00b7 polling every 2 s';
}

// ── Live UART lines (rendered into the same callhomeLogEntries panel) ──────
var _uartLogSince = 0;
var _uartLogTimer = null;

function _startUartLog() {
    if (_uartLogTimer) return;
    _uartLogTimer = setTimeout(_pollUartLog, 600);
}

function _stopUartLog() {
    if (_uartLogTimer) { clearTimeout(_uartLogTimer); _uartLogTimer = null; }
}

function _pollUartLog() {
    _uartLogTimer = null;
    fetch('/api/device/uart-log?since=' + _uartLogSince + '&limit=200')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var panel = document.getElementById('callhomeLogEntries');
            if (data.ok && data.entries && data.entries.length > 0 && panel) {
                var empty = panel.querySelector('.callhome-log-empty');
                if (empty) empty.remove();
                data.entries.slice().reverse().forEach(function(e) {
                    if (e.ts > _uartLogSince) _uartLogSince = e.ts;
                    if (e.ts > _callhomeLatestTs) _callhomeLatestTs = e.ts;
                    // Drop firmware countdown ticks — T-1 … T-N are internal noise
                    if (/^T-\d+\s*$/.test(e.line)) return;
                    var d = new Date(e.ts * 1000);
                    var dateStr = String(d.getUTCMinutes()).padStart(2,'0') + ':' +
                        String(d.getUTCSeconds()).padStart(2,'0');
                    var rowUid = (e.uid || '').toUpperCase();
                    // Classify line: boot marker (red), recovery/init context (orange), normal
                    var uartTextCls = 'uart-text';
                    if (/^CHURCH\b/i.test(e.line)) {
                        uartTextCls = 'uart-text uart-text-boot';      // always RED
                    } else if (/^CONNECT NOW\b|^UID=|^\[CALL HOME\](?! ACK)|^APB3\b|^\[PP250\]/i.test(e.line)) {
                        uartTextCls = 'uart-text uart-text-init';      // orange
                    }
                    var row = document.createElement('div');
                    row.className = 'callhome-uart-row';
                    row.dataset.uid = rowUid;
                    if (_selectedMachineUid && rowUid !== _selectedMachineUid) row.style.display = 'none';
                    row.innerHTML =
                        '<span class="uart-ts">' + _escHtml(dateStr) + '</span>' +
                        '<span class="' + uartTextCls + '">' + _escHtml(e.line) + '</span>';
                    // Boot-marker and CALLHOME rows always visible in CLOOMC filter
                    if (_callhomeFilter === 'cloomc' &&
                            uartTextCls !== 'uart-text uart-text-boot' &&
                            uartTextCls !== 'uart-text uart-text-init') {
                        row.style.display = 'none';
                    }
                    var colHeads = panel.querySelector('.callhome-log-col-heads');
                    panel.insertBefore(row, colHeads ? colHeads.nextSibling : panel.firstChild);
                    while (panel.children.length > 600) panel.removeChild(panel.lastChild);
                });
            }
        })
        .catch(function() { })
        .finally(function() { _updateLogSubtitle(); })
        .finally(function() {
            if (document.getElementById('callhomeLogPanel')) {
                _uartLogTimer = setTimeout(_pollUartLog, 2000);
            }
        });
}

function switchDevicesTab(tab) {
    _currentDevicesTab = tab;
    var isDevices     = (tab === 'devices');
    var isLaunch      = (tab === 'launch');
    var isReliability = (tab === 'reliability');

    var tabDevices      = document.getElementById('devTabDevices');
    var tabLaunch       = document.getElementById('devTabLaunch');
    var tabReliability  = document.getElementById('devTabReliability');
    var paneDevices     = document.getElementById('devPaneDevices');
    var paneLaunch      = document.getElementById('devPaneLaunch');
    var paneReliability = document.getElementById('devPaneReliability');
    var actionsDevices     = document.getElementById('devTabActionsDevices');
    var actionsLaunch      = document.getElementById('devTabActionsLaunch');
    var actionsReliability = document.getElementById('devTabActionsReliability');

    if (tabDevices)      tabDevices.classList.toggle('active', isDevices);
    if (tabLaunch)       tabLaunch.classList.toggle('active', isLaunch);
    if (tabReliability)  tabReliability.classList.toggle('active', isReliability);

    if (paneDevices)     paneDevices.style.display     = isDevices     ? '' : 'none';
    if (paneLaunch)      paneLaunch.style.display      = isLaunch      ? '' : 'none';
    if (paneReliability) paneReliability.style.display = isReliability ? '' : 'none';

    if (actionsDevices)     actionsDevices.style.display     = isDevices     ? '' : 'none';
    if (actionsLaunch)      actionsLaunch.style.display      = isLaunch      ? '' : 'none';
    if (actionsReliability) actionsReliability.style.display = isReliability ? '' : 'none';

    if (isLaunch)       loadLaunchTests();
    if (isReliability)  loadReliabilityPanel();
}

// ── Reliability Dashboard ──────────────────────────────────────────────────
var _relRows       = [];
var _relSortDir    = 'asc';

function setReliabilitySort(dir) {
    _relSortDir = dir;
    var btnAsc  = document.getElementById('relSortAsc');
    var btnDesc = document.getElementById('relSortDesc');
    if (btnAsc)  btnAsc.classList.toggle('active',  dir === 'asc');
    if (btnDesc) btnDesc.classList.toggle('active', dir === 'desc');
    _renderReliabilityTable(_relRows);
}

function loadReliabilityPanel() {
    var wrap = document.getElementById('relTableWrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="rel-empty">Loading&hellip;</div>';

    var uidFilter = (document.getElementById('relBoardFilter') || {}).value || '';
    var url = '/api/device/mtbf' + (uidFilter ? '?uid=' + encodeURIComponent(uidFilter) : '');

    fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.ok) {
                wrap.innerHTML = '<div class="rel-empty">Failed to load reliability data.</div>';
                return;
            }
            _relRows = data.rows || [];
            _populateRelBoardFilter(_relRows);
            _renderReliabilityTable(_relRows);
        })
        .catch(function() {
            wrap.innerHTML = '<div class="rel-empty">Could not reach server.</div>';
        });
}

function _populateRelBoardFilter(rows) {
    var sel = document.getElementById('relBoardFilter');
    if (!sel) return;
    var seen = {};
    var currentVal = sel.value;
    var options = '<option value="">All boards</option>';
    rows.forEach(function(r) {
        var uid = r.machine_uid || '';
        var label = (r.board_name || uid || 'Unknown');
        if (uid && !seen[uid]) {
            seen[uid] = true;
            options += '<option value="' + _escHtml(uid) + '">' + _escHtml(label) + '</option>';
        }
    });
    sel.innerHTML = options;
    if (currentVal) sel.value = currentVal;
}

function _mtbfHoursClass(mtbfHours) {
    if (mtbfHours === null || mtbfHours === undefined) return 'mtbf-none';
    if (mtbfHours >= 24)  return 'mtbf-green';
    if (mtbfHours >= 1)   return 'mtbf-amber';
    return 'mtbf-red';
}

function _formatMTBFHours(mtbfHours) {
    if (mtbfHours === null || mtbfHours === undefined) return '—';
    if (mtbfHours >= 24)   return (mtbfHours / 24).toFixed(1) + 'd';
    if (mtbfHours >= 1)    return mtbfHours.toFixed(1) + 'h';
    if (mtbfHours >= 1/60) return (mtbfHours * 60).toFixed(1) + 'm';
    return (mtbfHours * 3600).toFixed(1) + 's';
}

function _renderReliabilityTable(rows) {
    var wrap = document.getElementById('relTableWrap');
    if (!wrap) return;

    var uidFilter = (document.getElementById('relBoardFilter') || {}).value || '';
    var filtered = uidFilter
        ? rows.filter(function(r) { return (r.machine_uid || '') === uidFilter; })
        : rows;

    if (filtered.length === 0) {
        wrap.innerHTML = '<div class="rel-empty">No fault history recorded for this selection.<br>' +
            'Faults are logged when an FPGA board calls home after a capability fault.</div>';
        return;
    }

    var sorted = filtered.slice().sort(function(a, b) {
        var aH = a.mtbf_hours, bH = b.mtbf_hours;
        var aNone = (aH === null || aH === undefined);
        var bNone = (bH === null || bH === undefined);
        if (aNone && bNone) return 0;
        if (aNone) return 1;
        if (bNone) return -1;
        return _relSortDir === 'asc' ? (aH - bH) : (bH - aH);
    });

    var sortArrow = _relSortDir === 'asc' ? '&#x25B2;' : '&#x25BC;';
    var html = '<div class="rel-table-wrap"><table class="rel-table"><thead><tr>' +
        '<th>Abstraction</th>' +
        '<th>Board</th>' +
        '<th>Mnemonic</th>' +
        '<th style="text-align:center">Slot</th>' +
        '<th style="text-align:center">Faults</th>' +
        '<th style="text-align:right" onclick="setReliabilitySort(_relSortDir===\'asc\'?\'desc\':\'asc\')">' +
            'MTBF <span class="rel-th-sort">' + sortArrow + '</span></th>' +
        '</tr></thead><tbody>';

    sorted.forEach(function(r) {
        var abstrLabel = r.abstraction_label || ('Slot ' + (r.ns_slot !== null ? r.ns_slot : '?'));
        var boardLabel = r.board_name || r.machine_uid || '—';
        var mnemonic   = r.mnemonic || '—';
        var slotStr    = (r.ns_slot !== null && r.ns_slot !== undefined) ? String(r.ns_slot) : '—';
        var mtbfClass  = _mtbfHoursClass(r.mtbf_hours);
        var mtbfStr    = _formatMTBFHours(r.mtbf_hours);

        html += '<tr>' +
            '<td class="rel-td-abstr">' + _escHtml(abstrLabel) + '</td>' +
            '<td class="rel-td-board">' + _escHtml(boardLabel) + '</td>' +
            '<td class="rel-td-mnemonic">' + _escHtml(mnemonic) + '</td>' +
            '<td class="rel-td-slot">' + _escHtml(slotStr) + '</td>' +
            '<td class="rel-td-faults">' + r.fault_count + '</td>' +
            '<td class="rel-td-mtbf ' + mtbfClass + '">' + mtbfStr + '</td>' +
            '</tr>';
    });

    html += '</tbody></table></div>' +
        '<div class="rel-legend">' +
        '<span class="rel-legend-item"><span class="rel-legend-dot green"></span> &ge; 24 h — stable</span>' +
        '<span class="rel-legend-item"><span class="rel-legend-dot amber"></span> 1–24 h — watch</span>' +
        '<span class="rel-legend-item"><span class="rel-legend-dot red"></span> &lt; 1 h — critical</span>' +
        '</div>';

    wrap.innerHTML = html;
}

var _LAUNCH_AUTO_IDS = new Set(['TEST-01', 'TEST-02']);

function loadLaunchTests() {
    var grid = document.getElementById('launchTestGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="dev-empty">Loading...</div>';
    fetch('/api/launch-tests')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.ok || !data.tests || data.tests.length === 0) {
                grid.innerHTML = '<div class="dev-empty">No launch tests found.</div>';
                return;
            }
            var tests = data.tests;
            var passing = tests.filter(function(t) { return t.status === 'passing'; }).length;
            var failing = tests.filter(function(t) { return t.status === 'failing'; }).length;
            var total = tests.length;
            var pct = Math.round((passing / total) * 100);

            var html = '<div class="launch-progress-bar-wrap">' +
                '<div class="launch-progress-track"><div class="launch-progress-fill" style="width:' + pct + '%"></div></div>' +
                '<span class="launch-progress-label">' + passing + ' / ' + total + ' passing</span>' +
                '</div>';

            tests.forEach(function(t) {
                var dotClass = t.status === 'passing' ? 'launch-dot-passing' :
                               t.status === 'failing' ? 'launch-dot-failing' : 'launch-dot-notrun';
                var chipClass = t.status === 'passing' ? 'launch-chip-passing' :
                                t.status === 'failing' ? 'launch-chip-failing' : 'launch-chip-notrun';
                var chipLabel = t.status === 'passing' ? 'Passing' :
                                t.status === 'failing' ? 'Failing' : 'Not Run';
                var autoBadge = _LAUNCH_AUTO_IDS.has(t.test_id)
                    ? '<span class="launch-badge-auto">Auto</span>' : '';
                var notesHtml = (t.notes && t.notes.trim())
                    ? '<div class="launch-test-notes">' + _escHtml(t.notes) + '</div>' : '';

                var nextPass = t.status === 'passing' ? 'not-run' : 'passing';
                var nextFail = t.status === 'failing' ? 'not-run' : 'failing';
                var qId = _escHtml(JSON.stringify(t.test_id));
                var qPass = _escHtml(JSON.stringify(nextPass));
                var qFail = _escHtml(JSON.stringify(nextFail));

                html += '<div class="launch-test-row" id="launchRow_' + _escHtml(t.test_id) + '">' +
                    '<div class="launch-dot ' + dotClass + '"></div>' +
                    '<div class="launch-test-body">' +
                        '<div class="launch-test-header">' +
                            '<span class="launch-test-id">' + _escHtml(t.test_id) + '</span>' +
                            '<span class="launch-test-name">' + _escHtml(t.name) + '</span>' +
                            autoBadge +
                        '</div>' +
                        '<div class="launch-test-desc">' + _escHtml(t.description) + '</div>' +
                        notesHtml +
                    '</div>' +
                    '<div class="launch-test-actions">' +
                        '<span class="launch-status-chip ' + chipClass + '">' + chipLabel + '</span>' +
                        '<button class="launch-set-btn" onclick="setLaunchTestStatus(' + qId + ', ' + qPass + ')">' +
                            (t.status === 'passing' ? 'Clear' : 'Mark Pass') +
                        '</button>' +
                        '<button class="launch-set-btn" onclick="setLaunchTestStatus(' + qId + ', ' + qFail + ')">' +
                            (t.status === 'failing' ? 'Clear' : 'Mark Fail') +
                        '</button>' +
                    '</div>' +
                '</div>';
            });

            grid.innerHTML = html;
        })
        .catch(function() {
            grid.innerHTML = '<div class="dev-empty">Failed to load launch tests.</div>';
        });
}

function setLaunchTestStatus(testId, status) {
    fetch('/api/launch-tests/' + encodeURIComponent(testId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: status })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.ok) loadLaunchTests();
    })
    .catch(function() {});
}

// ── Device SSE — live board notifications ─────────────────────────────────────

function startDeviceEventStream() {
    if (window._deviceEventSource) return;
    var es = new EventSource('/api/device/events');
    window._deviceEventSource = es;

    es.onmessage = function(e) {
        try {
            var evt = JSON.parse(e.data);
            if (evt.type === 'device_online') _onDeviceOnline(evt);
        } catch (_) {}
    };

    es.onerror = function() {
        es.close();
        window._deviceEventSource = null;
        setTimeout(startDeviceEventStream, 6000);
    };
}

function _onDeviceOnline(evt) {
    // Always refresh the device list
    loadDeviceList();

    // Only show the toast if Devices view is not the current view
    var active = document.querySelector('.view.active');
    if (!active || active.id !== 'devices') {
        _showDeviceToast(evt);
    }
}

function _showDeviceToast(evt) {
    var container = document.getElementById('deviceToastContainer');
    if (!container) return;

    var isNew    = !!evt.is_new;
    var name     = evt.board_name || 'Ti60 F225';

    var toast = document.createElement('div');
    toast.className = 'device-toast' + (isNew ? ' device-toast-new' : '');

    toast.innerHTML =
        '<div class="device-toast-icon">' + (isNew ? '🎉' : '📡') + '</div>' +
        '<div class="device-toast-body">' +
            '<div class="device-toast-title">' +
                (isNew ? 'Board online for the first time!' : 'Board reconnected') +
            '</div>' +
            '<div class="device-toast-name">' + _escHtml(name) + '</div>' +
            (isNew
                ? '<div class="device-toast-sub">First abstraction ready ✓</div>'
                : '') +
        '</div>' +
        '<button class="device-toast-go" ' +
            'onclick="switchView(\'devices\');switchDevicesTab(\'devices\');' +
            'this.closest(\'.device-toast\').remove();">View →</button>' +
        '<button class="device-toast-close" ' +
            'onclick="this.closest(\'.device-toast\').remove();" ' +
            'title="Dismiss">✕</button>';

    container.appendChild(toast);

    // Trigger animation in next frame
    requestAnimationFrame(function() { toast.classList.add('device-toast-visible'); });

    // Auto-dismiss after 9 s
    var timer = setTimeout(function() {
        toast.classList.remove('device-toast-visible');
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 350);
    }, 9000);

    toast.querySelector('.device-toast-close').addEventListener('click', function() {
        clearTimeout(timer);
    });
}

// ─────────────────────────────────────────────────────────────────────────────

function confirmResetLaunchTests() {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML =
        '<div class="modal-dialog" style="max-width:420px;padding:1.5rem;">' +
            '<div class="modal-title" style="margin-bottom:0.75rem;">Reset Launch Tests</div>' +
            '<p style="color:#aaa;font-size:0.88rem;margin-bottom:1.25rem;">Reset all 16 tests to <strong>not-run</strong>? This cannot be undone.</p>' +
            '<div style="display:flex;gap:0.5rem;justify-content:flex-end;">' +
                '<button id="launchResetCancel" class="dev-action-btn" style="padding:6px 16px;">Cancel</button>' +
                '<button id="launchResetConfirm" class="dev-launch-reset-btn" style="padding:6px 16px;">Reset All</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);

    function close() { document.body.removeChild(overlay); }
    document.getElementById('launchResetCancel').addEventListener('click', close);
    document.getElementById('launchResetConfirm').addEventListener('click', function() {
        fetch('/api/launch-tests/reset', { method: 'POST' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                close();
                if (data.ok) loadLaunchTests();
            })
            .catch(function() { close(); });
    });
}

