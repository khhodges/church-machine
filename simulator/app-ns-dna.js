// app-ns-dna.js — Namespace DNA graph view
// Renders the GT-capability link graph between NS-slot abstractions as a
// force-directed SVG diagram.  No external dependencies.

// ── Graph data builder ───────────────────────────────────────────────────────

function buildNSDNAGraph() {
    // `abstractionRegistry` is a lexical `let` in app-shell.js, not on window.
    // Use a typeof guard so this file works in both browser and Node test contexts.
    /* global abstractionRegistry */
    const reg = (typeof abstractionRegistry !== 'undefined') ? abstractionRegistry : null;
    if (!reg) return { nodes: [], edges: [] };

    const abstractions = Object.values(reg.abstractions || {});
    if (!abstractions.length) return { nodes: [], edges: [] };

    // Index by slot for fast lookup
    const bySlot = {};
    for (const abs of abstractions) bySlot[abs.index] = abs;

    // Helper: find abstraction by name
    function findByName(name) {
        return abstractions.find(a => a.name === name) || null;
    }

    // Determine visual kind from perms
    function kindOf(abs) {
        const p = abs.perms || {};
        if (p.E) return 'executable';
        if (p.L || p.S) return 'lambda';
        if (p.X) return 'executable';
        return 'resource';
    }

    // Build nodes
    const nodes = abstractions.map(abs => ({
        slot: abs.index,
        name: abs.name,
        description: abs.description || '',
        kind: kindOf(abs),
        perms: abs.perms || {},
        isolated: true,       // updated below once edges are known
    }));

    // Build edges from declared capabilities
    const edges = [];
    const connectedSlots = new Set();

    for (const abs of abstractions) {
        const caps = abs.capabilities || [];
        for (const cap of caps) {
            // target may be a slot number or an abstraction name string
            let targetSlot = null;
            if (typeof cap.target === 'number') {
                if (bySlot[cap.target]) targetSlot = cap.target;
            } else if (typeof cap.target === 'string' && cap.target) {
                const t = findByName(cap.target);
                if (t) targetSlot = t.index;
            }
            if (targetSlot === null) continue;

            // Decode grants string into a permission label
            const grants = _nsDnaPermLabel(cap.grants);

            edges.push({
                source: abs.index,
                target: targetSlot,
                capName: cap.name || '?',
                grants,
                rawGrants: cap.grants || '',
            });
            connectedSlots.add(abs.index);
            connectedSlots.add(targetSlot);
        }
    }

    // Mark isolation
    for (const node of nodes) {
        node.isolated = !connectedSlots.has(node.slot);
    }

    return { nodes, edges };
}

// Convert a grants value (string like 'E', 'R+W', or object {R,W,X,L,S,E})
// into a short human-readable label.
function _nsDnaPermLabel(grants) {
    if (!grants) return '';
    if (typeof grants === 'string') return grants;
    if (typeof grants === 'object') {
        const parts = [];
        if (grants.R) parts.push('R');
        if (grants.W) parts.push('W');
        if (grants.X) parts.push('X');
        if (grants.L) parts.push('L');
        if (grants.S) parts.push('S');
        if (grants.E) parts.push('E');
        return parts.join('+');
    }
    return String(grants);
}

// ── SVG renderer ─────────────────────────────────────────────────────────────

function renderNamespaceDNA() {
    const container = document.getElementById('namespace-dna-body');
    if (!container) return;

    const { nodes, edges } = buildNSDNAGraph();

    if (!nodes.length) {
        container.innerHTML = '<div style="padding:2.5rem;text-align:center;color:#6e7681;">' +
            'No abstractions loaded yet. Run a simulation or initialise the registry first.</div>';
        return;
    }

    // Canvas dimensions — use actual container width when available
    const W = Math.max(container.clientWidth || 800, 500);
    const H = Math.max(Math.min(Math.floor(W * 0.65), 580), 380);
    const R = 22;       // node circle radius
    const PADDING = 70; // edge clearance from canvas boundary

    // ── Fruchterman–Reingold force layout ────────────────────────────────────
    const pos = {};
    const n = nodes.length;

    // Initialise on a circle to avoid symmetric collapse
    nodes.forEach((node, i) => {
        const angle = (2 * Math.PI * i) / n - Math.PI / 2;
        const r0 = Math.min(W, H) * 0.32;
        pos[node.slot] = {
            x: W / 2 + r0 * Math.cos(angle),
            y: H / 2 + r0 * Math.sin(angle),
            vx: 0, vy: 0,
        };
    });

    const k = Math.sqrt((W * H) / Math.max(n, 1)); // ideal spring length
    const ITERS = 200;
    let temp = W * 0.12;
    const cooling = temp / (ITERS + 1);

    for (let iter = 0; iter < ITERS; iter++) {
        // Reset velocities
        for (const node of nodes) {
            pos[node.slot].vx = 0;
            pos[node.slot].vy = 0;
        }

        // Repulsion between every pair
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = nodes[i].slot, b = nodes[j].slot;
                const dx = pos[a].x - pos[b].x;
                const dy = pos[a].y - pos[b].y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
                const f = (k * k) / dist;
                pos[a].vx += (dx / dist) * f;
                pos[a].vy += (dy / dist) * f;
                pos[b].vx -= (dx / dist) * f;
                pos[b].vy -= (dy / dist) * f;
            }
        }

        // Attraction along edges
        for (const edge of edges) {
            const ps = pos[edge.source], pt = pos[edge.target];
            if (!ps || !pt) continue;
            const dx = pt.x - ps.x;
            const dy = pt.y - ps.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const f = (dist * dist) / k;
            const fx = (dx / dist) * f;
            const fy = (dy / dist) * f;
            ps.vx += fx; ps.vy += fy;
            pt.vx -= fx; pt.vy -= fy;
        }

        // Weak centre-gravity so isolated nodes don't escape
        for (const node of nodes) {
            const p = pos[node.slot];
            p.vx += (W / 2 - p.x) * 0.012;
            p.vy += (H / 2 - p.y) * 0.012;
        }

        // Apply, clamped to temperature
        for (const node of nodes) {
            const p = pos[node.slot];
            const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 0.01;
            p.x += (p.vx / speed) * Math.min(speed, temp);
            p.y += (p.vy / speed) * Math.min(speed, temp);
            p.x = Math.max(PADDING, Math.min(W - PADDING, p.x));
            p.y = Math.max(PADDING, Math.min(H - PADDING, p.y));
        }
        temp -= cooling;
    }

    // ── Build SVG ─────────────────────────────────────────────────────────────
    const COLORS = {
        executable: { fill: '#14532d', stroke: '#22c55e', text: '#bbf7d0', label: '#dcfce7' },
        lambda:     { fill: '#3b0764', stroke: '#a78bfa', text: '#ddd6fe', label: '#ede9fe' },
        resource:   { fill: '#1e3a5f', stroke: '#60a5fa', text: '#bfdbfe', label: '#dbeafe' },
        isolated:   { fill: '#161b22', stroke: '#4b5563', text: '#6b7280', label: '#9ca3af' },
    };

    function col(node) {
        return node.isolated ? COLORS.isolated : (COLORS[node.kind] || COLORS.resource);
    }

    function _esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    let svg = `<svg id="ns-dna-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"` +
        ` style="display:block;background:#0d1117;border-radius:8px;font-family:inherit;">`;

    // ── Defs: arrowhead markers ────────────────────────────────────────────────
    svg += `<defs>
  <marker id="dna-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
    <polygon points="0 0,10 3.5,0 7" fill="#4b5563"/>
  </marker>
  <marker id="dna-arrow-hi" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
    <polygon points="0 0,10 3.5,0 7" fill="#f59e0b"/>
  </marker>
</defs>`;

    // ── Edges ─────────────────────────────────────────────────────────────────
    edges.forEach((edge, ei) => {
        const ps = pos[edge.source], pt = pos[edge.target];
        if (!ps || !pt) return;

        const dx = pt.x - ps.x, dy = pt.y - ps.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / dist, uy = dy / dist;

        // Start/end offset from node surface; extra offset for arrowhead
        const x1 = ps.x + ux * (R + 1);
        const y1 = ps.y + uy * (R + 1);
        const x2 = pt.x - ux * (R + 11);
        const y2 = pt.y - uy * (R + 11);

        // Perpendicular offset for quadratic curve (avoids overlap on parallel edges)
        const curveOff = 18;
        const mx = (x1 + x2) / 2 - uy * curveOff;
        const my = (y1 + y2) / 2 + ux * curveOff;

        // Quadratic bezier midpoint (at t=0.5)
        const lx = (x1 / 4 + mx / 2 + x2 / 4);
        const ly = (y1 / 4 + my / 2 + y2 / 4);

        const label = edge.capName + (edge.grants ? ' [' + edge.grants + ']' : '');

        svg += `<g class="dna-edge" data-ei="${ei}" data-src="${edge.source}" data-tgt="${edge.target}">`;
        // Invisible wider hit-path for pointer events
        svg += `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}"` +
               ` fill="none" stroke="transparent" stroke-width="14" style="cursor:pointer;"/>`;
        svg += `<path class="dna-edge-path" d="M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}"` +
               ` fill="none" stroke="#374151" stroke-width="1.5" marker-end="url(#dna-arrow)" style="pointer-events:none;"/>`;
        svg += `<text class="dna-edge-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}"` +
               ` text-anchor="middle" dominant-baseline="middle" font-size="9" fill="#6b7280"` +
               ` style="pointer-events:none;user-select:none;">${_esc(label)}</text>`;
        svg += `</g>`;
    });

    // ── Nodes ─────────────────────────────────────────────────────────────────
    for (const node of nodes) {
        const p = pos[node.slot];
        const c = col(node);
        const dash = node.isolated ? ' stroke-dasharray="4 3"' : '';
        const sw = node.isolated ? '1.5' : '2';

        const shortName = node.name.length > 15 ? node.name.slice(0, 13) + '\u2026' : node.name;

        svg += `<g class="dna-node" data-slot="${node.slot}" style="cursor:pointer;">`;
        svg += `<circle class="dna-node-circle" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${R}"` +
               ` fill="${c.fill}" stroke="${c.stroke}" stroke-width="${sw}"${dash}/>`;
        // Slot number centred in circle
        svg += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"` +
               ` font-size="11" font-weight="bold" fill="${c.stroke}" style="pointer-events:none;user-select:none;">${node.slot}</text>`;
        // Name label below circle
        svg += `<text x="${p.x.toFixed(1)}" y="${(p.y + R + 13).toFixed(1)}" text-anchor="middle"` +
               ` font-size="9" fill="${c.label}" style="pointer-events:none;user-select:none;">${_esc(shortName)}</text>`;
        svg += `</g>`;
    }

    svg += `</svg>`;

    // ── Legend ────────────────────────────────────────────────────────────────
    const legend = `<div style="display:flex;gap:1.1rem;flex-wrap:wrap;padding:0.5rem 0.25rem 0.4rem;` +
        `font-size:0.77rem;color:#6e7681;align-items:center;">` +
        _dnaSwatch('#14532d','#22c55e','solid') + 'Executable (E)&nbsp;&nbsp;' +
        _dnaSwatch('#3b0764','#a78bfa','solid') + 'Lambda (L/S)&nbsp;&nbsp;' +
        _dnaSwatch('#1e3a5f','#60a5fa','solid') + 'Resource (R/W/X)&nbsp;&nbsp;' +
        _dnaSwatch('#161b22','#4b5563','dashed') + 'Isolated' +
        `</div>`;

    // ── Toolbar row ───────────────────────────────────────────────────────────
    const toolbar = `<div style="display:flex;gap:0.5rem;align-items:center;padding:0.4rem 0 0.25rem;">` +
        `<button class="btn btn-primary btn-sm" onclick="renderNamespaceDNA()" style="font-size:0.78rem;">&#8635; Refresh</button>` +
        `<span style="font-size:0.78rem;color:#6e7681;">${nodes.length} node${nodes.length !== 1 ? 's' : ''}` +
        ` &middot; ${edges.length} edge${edges.length !== 1 ? 's' : ''}</span>` +
        `</div>`;

    // ── Tooltip ───────────────────────────────────────────────────────────────
    const tip = `<div id="ns-dna-tip" style="display:none;position:fixed;z-index:9999;` +
        `background:#161b22;border:1px solid #30363d;border-radius:6px;padding:0.45rem 0.65rem;` +
        `font-size:0.78rem;color:#e6edf3;pointer-events:none;max-width:280px;` +
        `line-height:1.55;box-shadow:0 4px 14px rgba(0,0,0,0.55);"></div>`;

    container.innerHTML = toolbar + legend + svg + tip;

    // ── Interactivity ─────────────────────────────────────────────────────────
    _nsDnaWireEvents(container, nodes, edges);
}

function _dnaSwatch(fill, stroke, style) {
    const dash = style === 'dashed' ? 'border-style:dashed;' : '';
    return `<span style="display:inline-flex;align-items:center;gap:5px;">` +
           `<span style="width:13px;height:13px;border-radius:50%;background:${fill};` +
           `border:2px ${style === 'dashed' ? 'dashed' : 'solid'} ${stroke};display:inline-block;flex-shrink:0;"></span>`;
}

function _nsDnaPermStr(perms) {
    if (!perms) return '\u2014';
    const p = [];
    if (perms.R) p.push('R');
    if (perms.W) p.push('W');
    if (perms.X) p.push('X');
    if (perms.L) p.push('L');
    if (perms.S) p.push('S');
    if (perms.E) p.push('E');
    return p.join('+') || '\u2014';
}

function _nsDnaEsc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _nsDnaWireEvents(container, nodes, edges) {
    const svgEl = container.querySelector('#ns-dna-svg');
    const tipEl = container.querySelector('#ns-dna-tip');
    if (!svgEl || !tipEl) return;

    function showTip(html, cx, cy) {
        tipEl.innerHTML = html;
        tipEl.style.display = 'block';
        const vw = window.innerWidth, vh = window.innerHeight;
        const tw = 290, th = 130;
        let tx = cx + 16, ty = cy - 12;
        if (tx + tw > vw) tx = cx - tw - 16;
        if (ty + th > vh) ty = cy - th - 12;
        tipEl.style.left = tx + 'px';
        tipEl.style.top  = ty + 'px';
    }

    function hideTip() { tipEl.style.display = 'none'; }

    function clearHL() {
        svgEl.querySelectorAll('.dna-edge-path').forEach(p => {
            p.setAttribute('stroke', '#374151');
            p.setAttribute('stroke-width', '1.5');
            p.setAttribute('marker-end', 'url(#dna-arrow)');
        });
        svgEl.querySelectorAll('.dna-edge-label').forEach(t => t.setAttribute('fill', '#6b7280'));
    }

    function hlNode(slot) {
        clearHL();
        svgEl.querySelectorAll('.dna-edge').forEach(g => {
            const src = +g.dataset.src, tgt = +g.dataset.tgt;
            if (src === slot || tgt === slot) {
                const path = g.querySelector('.dna-edge-path');
                const lbl  = g.querySelector('.dna-edge-label');
                if (path) { path.setAttribute('stroke', '#f59e0b'); path.setAttribute('stroke-width', '2.5'); path.setAttribute('marker-end', 'url(#dna-arrow-hi)'); }
                if (lbl)  lbl.setAttribute('fill', '#fbbf24');
            }
        });
    }

    function hlEdge(ei) {
        clearHL();
        const g = svgEl.querySelector(`.dna-edge[data-ei="${ei}"]`);
        if (!g) return;
        const path = g.querySelector('.dna-edge-path');
        const lbl  = g.querySelector('.dna-edge-label');
        if (path) { path.setAttribute('stroke', '#f59e0b'); path.setAttribute('stroke-width', '2.5'); path.setAttribute('marker-end', 'url(#dna-arrow-hi)'); }
        if (lbl)  lbl.setAttribute('fill', '#fbbf24');
    }

    // Node events
    svgEl.querySelectorAll('.dna-node').forEach(g => {
        const slot = +g.dataset.slot;
        const node = nodes.find(n => n.slot === slot);
        if (!node) return;

        g.addEventListener('pointerenter', e => {
            hlNode(slot);
            const outE = edges.filter(ed => ed.source === slot);
            const inE  = edges.filter(ed => ed.target === slot);
            let h = `<strong style="color:#f0f6fc;">${_nsDnaEsc(node.name)}</strong><br>`;
            h += `<span style="color:#8b949e;">Slot ${slot}&nbsp;&middot;&nbsp;${node.kind}&nbsp;&middot;&nbsp;perms: ${_nsDnaPermStr(node.perms)}</span>`;
            if (node.description) h += `<br><span style="color:#6e7681;font-size:0.72rem;">${_nsDnaEsc(node.description.slice(0, 110))}</span>`;
            if (outE.length) h += `<br><span style="color:#60a5fa;">\u2192 grants: ${outE.map(ed => _nsDnaEsc(ed.capName)).join(', ')}</span>`;
            if (inE.length)  h += `<br><span style="color:#a78bfa;">\u2190 receives: ${inE.map(ed => _nsDnaEsc(ed.capName)).join(', ')}</span>`;
            if (node.isolated) h += `<br><span style="color:#6b7280;font-style:italic;">No declared capability links</span>`;
            showTip(h, e.clientX, e.clientY);
        });
        g.addEventListener('pointermove', e => { tipEl.style.left = (e.clientX + 16) + 'px'; tipEl.style.top = (e.clientY - 12) + 'px'; });
        g.addEventListener('pointerleave', () => { clearHL(); hideTip(); });
    });

    // Edge events
    svgEl.querySelectorAll('.dna-edge').forEach(g => {
        const ei   = +g.dataset.ei;
        const edge = edges[ei];
        if (!edge) return;
        const srcNode = nodes.find(n => n.slot === edge.source);
        const tgtNode = nodes.find(n => n.slot === edge.target);

        g.addEventListener('pointerenter', e => {
            hlEdge(ei);
            const srcName = srcNode ? srcNode.name : `slot ${edge.source}`;
            const tgtName = tgtNode ? tgtNode.name : `slot ${edge.target}`;
            let h = `<strong style="color:#f0f6fc;">${_nsDnaEsc(edge.capName)}</strong><br>`;
            h += `<span style="color:#8b949e;">${_nsDnaEsc(srcName)} \u2192 ${_nsDnaEsc(tgtName)}</span><br>`;
            h += `<span style="color:#fbbf24;">Permission: ${_nsDnaEsc(edge.grants || edge.rawGrants || '\u2014')}</span>`;
            showTip(h, e.clientX, e.clientY);
        });
        g.addEventListener('pointermove', e => { tipEl.style.left = (e.clientX + 16) + 'px'; tipEl.style.top = (e.clientY - 12) + 'px'; });
        g.addEventListener('pointerleave', () => { clearHL(); hideTip(); });
    });
}
