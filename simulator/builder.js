class NamespaceBuilder {
    static VERSION = '1.2';
    constructor() {
        this.computers = [];
        this.nextComputerId = 1;
        this.nextNamespaceId = 1;
        this.nextAbstractionId = 1;
        this.selectedComputer = null;
        this.selectedNamespace = null;
        this.draggingNode = null;
        this.dragOffset = { x: 0, y: 0 };
        this._dragMoved = false;
        this.error = null;
        this.mapStyle = 'space';
        this._boundDocMouseUp = this._onDocMouseUp.bind(this);
        this._boundDocMouseMove = this._onDocMouseMove.bind(this);
        this._docListenersAttached = false;
        this._hintDismissed = { canvas: false, computer: false, namespace: false };
        this._loadState();
    }

    _esc(s) {
        if (typeof s !== 'string') s = String(s);
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    _loadState() {
        try {
            var saved = localStorage.getItem('church_builder');
            if (saved) {
                var s = JSON.parse(saved);
                this.computers = s.computers || [];
                this.nextComputerId = s.nextComputerId || 1;
                this.nextNamespaceId = s.nextNamespaceId || 1;
                this.nextAbstractionId = s.nextAbstractionId || 1;
                this.mapStyle = s.mapStyle || 'space';
                this.computers.forEach(function(c) {
                    if (!c.dataAttributes) c.dataAttributes = [];
                    if (!c.location) c.location = { name: '', lat: null, lng: null };
                    c.namespaces.forEach(function(n) {
                        if (!n.dataAttributes) n.dataAttributes = [];
                        n.abstractions.forEach(function(a) {
                            if (!a.dataAttributes) a.dataAttributes = [];
                        });
                    });
                });
            }
        } catch (e) {}
    }

    _saveState() {
        try {
            localStorage.setItem('church_builder', JSON.stringify({
                computers: this.computers,
                nextComputerId: this.nextComputerId,
                nextNamespaceId: this.nextNamespaceId,
                nextAbstractionId: this.nextAbstractionId,
                mapStyle: this.mapStyle
            }));
        } catch (e) {}
    }

    addComputer(x, y) {
        var id = this.nextComputerId++;
        this.computers.push({
            id: id,
            label: 'Computer ' + id,
            x: x, y: y,
            namespaces: [],
            dataAttributes: [],
            location: { name: '', lat: null, lng: null }
        });
        this._saveState();
        this.render();
    }

    removeComputer(id) {
        this.computers = this.computers.filter(function(c) { return c.id !== id; });
        if (this.selectedComputer && this.selectedComputer.id === id) {
            this.selectedComputer = null;
            this.selectedNamespace = null;
        }
        this._saveState();
        this.render();
    }

    selectComputer(id) {
        this.selectedComputer = this.computers.find(function(c) { return c.id === id; }) || null;
        this.selectedNamespace = null;
        this.error = null;
        this.render();
    }

    addNamespace(computerId, label) {
        var comp = this.computers.find(function(c) { return c.id === computerId; });
        if (!comp) return;
        if (comp.namespaces.length >= 8) {
            this.error = 'Maximum 8 namespaces per computer';
            this.render();
            return;
        }
        var id = this.nextNamespaceId++;
        var nsLabel = label || 'Namespace ' + id;
        comp.namespaces.push({ id: id, label: nsLabel, abstractions: [], dataAttributes: [] });
        this._saveState();
        this.render();
    }

    removeNamespace(computerId, nsId) {
        var comp = this.computers.find(function(c) { return c.id === computerId; });
        if (!comp) return;
        comp.namespaces = comp.namespaces.filter(function(n) { return n.id !== nsId; });
        if (this.selectedNamespace && this.selectedNamespace.id === nsId) {
            this.selectedNamespace = null;
        }
        this._saveState();
        this.render();
    }

    selectNamespace(computerId, nsId) {
        var comp = this.computers.find(function(c) { return c.id === computerId; });
        if (!comp) return;
        this.selectedComputer = comp;
        this.selectedNamespace = comp.namespaces.find(function(n) { return n.id === nsId; }) || null;
        this.error = null;
        this.render();
    }

    addAbstraction(computerId, nsId, json) {
        var comp = this.computers.find(function(c) { return c.id === computerId; });
        if (!comp) return false;
        var ns = comp.namespaces.find(function(n) { return n.id === nsId; });
        if (!ns) return false;
        if (!json.abstraction || typeof json.abstraction !== 'string') {
            this.error = 'Invalid abstraction: "abstraction" must be a non-empty string';
            this.render();
            return false;
        }
        if (!json.methods || !Array.isArray(json.methods) || json.methods.length === 0) {
            this.error = 'Invalid abstraction: "methods" must be a non-empty array';
            this.render();
            return false;
        }
        if (!json.capabilities || !Array.isArray(json.capabilities)) {
            this.error = 'Invalid abstraction: "capabilities" must be an array (use [] if none)';
            this.render();
            return false;
        }
        if (!json.grants || !Array.isArray(json.grants)) {
            this.error = 'Invalid abstraction: "grants" must be an array';
            this.render();
            return false;
        }
        var localNames = ns.abstractions.map(function(a) { return a.name.toUpperCase(); });
        var unresolvedCaps = [];
        for (var ci = 0; ci < json.capabilities.length; ci++) {
            var capName = String(json.capabilities[ci].name || 'unknown').toUpperCase();
            if (localNames.indexOf(capName) < 0) {
                var crossFound = this._findAbstractionLocation(capName, computerId, nsId);
                if (!crossFound) {
                    unresolvedCaps.push(json.capabilities[ci].name || 'unknown');
                }
            }
        }
        var rawDataAttrs = [];
        if (json.dataAttributes && Array.isArray(json.dataAttributes)) {
            rawDataAttrs = json.dataAttributes.map(function(d) {
                return { key: String(d.key || ''), value: String(d.value || '') };
            });
        }
        var id = this.nextAbstractionId++;
        ns.abstractions.push({
            id: id,
            name: String(json.abstraction),
            methods: json.methods.map(function(m) { return String(m.name || 'unnamed'); }),
            methodCount: json.methods.length,
            capabilities: json.capabilities.map(function(c) {
                return {
                    name: String(c.name || 'unknown'),
                    target: c.target,
                    grants: (c.grants || ['E']).map(function(g) { return String(g); })
                };
            }),
            grants: json.grants.map(function(g) { return String(g); }),
            codeSize: json.methods.reduce(function(sum, m) { return sum + (m.code ? m.code.length : 0); }, 0),
            dataAttributes: rawDataAttrs
        });
        if (unresolvedCaps.length > 0) {
            this.error = 'Warning: unresolved dependencies: ' + unresolvedCaps.join(', ') + '. Add the required abstractions to resolve.';
        } else {
            this.error = null;
        }
        this._saveState();
        this.render();
        return true;
    }

    removeAbstraction(computerId, nsId, absId) {
        var comp = this.computers.find(function(c) { return c.id === computerId; });
        if (!comp) return;
        var ns = comp.namespaces.find(function(n) { return n.id === nsId; });
        if (!ns) return;
        ns.abstractions = ns.abstractions.filter(function(a) { return a.id !== absId; });
        this._saveState();
        this.render();
    }

    setMapStyle(style) {
        this.mapStyle = style;
        this._saveState();
        this.render();
    }

    async locateComputer(compId, query) {
        if (!query || !query.trim()) return;
        var comp = this.computers.find(function(c) { return c.id === compId; });
        if (!comp) return;
        this.error = null;
        try {
            var url = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query.trim()) + '&format=json&limit=1';
            var r = await fetch(url, { headers: { 'Accept-Language': 'en', 'User-Agent': 'ChurchMachineBuilder/1.2' } });
            var data = await r.json();
            if (data && data.length > 0) {
                var lat = parseFloat(data[0].lat);
                var lng = parseFloat(data[0].lon);
                var shortName = (data[0].display_name || query).split(',').slice(0, 2).join(',').trim();
                comp.location = { name: shortName, lat: lat, lng: lng };
                comp.x = Math.max(0, Math.min(640, (lng + 180) / 360 * 800 - 75));
                comp.y = Math.max(0, Math.min(440, (90 - lat) / 180 * 500 - 30));
                this._saveState();
                this.render();
            } else {
                this.error = 'Location "' + query + '" not found. Try a city name like "Stuart, FL" or "London".';
                this.render();
            }
        } catch (e) {
            this.error = 'Location lookup failed: ' + e.message;
            this.render();
        }
    }

    _getAttrTarget(scope, id1, id2, id3) {
        var comp = this.computers.find(function(c) { return c.id === id1; });
        if (!comp) return null;
        if (scope === 'computer') return comp;
        var ns = comp.namespaces.find(function(n) { return n.id === id2; });
        if (!ns) return null;
        if (scope === 'namespace') return ns;
        var abs = ns.abstractions.find(function(a) { return a.id === id3; });
        return abs || null;
    }

    addDataAttr(scope, id1, id2, id3) {
        var obj = this._getAttrTarget(scope, id1, id2, id3);
        if (!obj) return;
        if (!obj.dataAttributes) obj.dataAttributes = [];
        obj.dataAttributes.push({ key: '', value: '' });
        this._saveState();
        this.render();
    }

    removeDataAttr(scope, id1, id2, id3, idx) {
        var obj = this._getAttrTarget(scope, id1, id2, id3);
        if (!obj || !obj.dataAttributes) return;
        obj.dataAttributes.splice(idx, 1);
        this._saveState();
        this.render();
    }

    updateDataAttrKey(scope, id1, id2, id3, idx, key) {
        var obj = this._getAttrTarget(scope, id1, id2, id3);
        if (!obj || !obj.dataAttributes || !obj.dataAttributes[idx]) return;
        obj.dataAttributes[idx].key = key;
        this._saveState();
    }

    updateDataAttrVal(scope, id1, id2, id3, idx, val) {
        var obj = this._getAttrTarget(scope, id1, id2, id3);
        if (!obj || !obj.dataAttributes || !obj.dataAttributes[idx]) return;
        obj.dataAttributes[idx].value = val;
        this._saveState();
    }

    _renderDataAttributes(scope, id1, id2, id3, attrs) {
        var s = '\'' + scope + '\',' + id1 + ',' + id2 + ',' + id3;
        var html = '<div class="builder-data-attrs">';
        html += '<div class="builder-data-attrs-header">';
        html += '<span class="builder-data-attrs-label">\u{1F4CB} Data Attributes</span>';
        html += '<button class="btn btn-sm builder-add-attr-btn" onclick="builder.addDataAttr(' + s + ')" title="Add key-value data attribute">+ Attr</button>';
        html += '</div>';
        if (attrs && attrs.length > 0) {
            html += '<div class="builder-attr-list">';
            for (var i = 0; i < attrs.length; i++) {
                var attr = attrs[i];
                html += '<div class="builder-attr-row">';
                html += '<input class="builder-attr-key" placeholder="key" value="' + this._esc(attr.key) + '" onchange="builder.updateDataAttrKey(' + s + ',' + i + ',this.value)" />';
                html += '<span class="builder-attr-eq">=</span>';
                html += '<input class="builder-attr-val" placeholder="value" value="' + this._esc(attr.value) + '" onchange="builder.updateDataAttrVal(' + s + ',' + i + ',this.value)" />';
                html += '<button class="builder-remove-btn" onclick="builder.removeDataAttr(' + s + ',' + i + ')">\u00d7</button>';
                html += '</div>';
            }
            html += '</div>';
        } else {
            html += '<div class="builder-attr-empty">No attributes. Click + Attr to add one.</div>';
        }
        html += '</div>';
        return html;
    }

    _resolveCapabilities(ns) {
        var names = ns.abstractions.map(function(a) { return a.name.toUpperCase(); });
        var resolved = [];
        for (var i = 0; i < ns.abstractions.length; i++) {
            var abs = ns.abstractions[i];
            for (var j = 0; j < abs.capabilities.length; j++) {
                var cap = abs.capabilities[j];
                var targetIdx = names.indexOf(cap.name.toUpperCase());
                resolved.push({
                    from: abs.name,
                    fromId: abs.id,
                    to: cap.name,
                    toId: targetIdx >= 0 ? ns.abstractions[targetIdx].id : null,
                    resolved: targetIdx >= 0
                });
            }
        }
        return resolved;
    }

    _resolveCrossNamespaceDeps() {
        var crossDeps = [];
        for (var ci = 0; ci < this.computers.length; ci++) {
            var comp = this.computers[ci];
            for (var ni = 0; ni < comp.namespaces.length; ni++) {
                var ns = comp.namespaces[ni];
                var localNames = ns.abstractions.map(function(a) { return a.name.toUpperCase(); });
                for (var ai = 0; ai < ns.abstractions.length; ai++) {
                    var abs = ns.abstractions[ai];
                    for (var ci2 = 0; ci2 < abs.capabilities.length; ci2++) {
                        var cap = abs.capabilities[ci2];
                        if (localNames.indexOf(cap.name.toUpperCase()) >= 0) continue;
                        var found = this._findAbstractionLocation(cap.name, comp.id, ns.id);
                        crossDeps.push({
                            fromCompId: comp.id,
                            fromNsId: ns.id,
                            fromAbsName: abs.name,
                            capName: cap.name,
                            toCompId: found ? found.compId : null,
                            toNsId: found ? found.nsId : null,
                            toNsLabel: found ? found.nsLabel : null,
                            resolved: !!found
                        });
                    }
                }
            }
        }
        return crossDeps;
    }

    _findAbstractionLocation(name, excludeCompId, excludeNsId) {
        var upper = name.toUpperCase();
        for (var ci = 0; ci < this.computers.length; ci++) {
            var comp = this.computers[ci];
            for (var ni = 0; ni < comp.namespaces.length; ni++) {
                var ns = comp.namespaces[ni];
                if (comp.id === excludeCompId && ns.id === excludeNsId) continue;
                for (var ai = 0; ai < ns.abstractions.length; ai++) {
                    if (ns.abstractions[ai].name.toUpperCase() === upper) {
                        return { compId: comp.id, nsId: ns.id, nsLabel: ns.label };
                    }
                }
            }
        }
        return null;
    }

    _findSharedDeps() {
        var crossDeps = this._resolveCrossNamespaceDeps();
        var edgeSet = {};
        var edges = [];
        for (var i = 0; i < crossDeps.length; i++) {
            var dep = crossDeps[i];
            if (!dep.resolved || !dep.toCompId) continue;
            if (dep.fromCompId === dep.toCompId) continue;
            var key = Math.min(dep.fromCompId, dep.toCompId) + '-' + Math.max(dep.fromCompId, dep.toCompId);
            if (!edgeSet[key]) {
                edgeSet[key] = true;
                edges.push({ from: dep.fromCompId, to: dep.toCompId });
            }
        }
        return edges;
    }

    _buildConnectionMap() {
        var connections = [];
        for (var ci = 0; ci < this.computers.length; ci++) {
            var comp = this.computers[ci];
            for (var ni = 0; ni < comp.namespaces.length; ni++) {
                var ns = comp.namespaces[ni];
                var deps = this._resolveCapabilities(ns);
                for (var di = 0; di < deps.length; di++) {
                    var dep = deps[di];
                    connections.push({
                        fromComputer: comp.label,
                        fromNamespace: ns.label,
                        fromAbstraction: dep.from,
                        toAbstraction: dep.to,
                        resolved: dep.resolved,
                        scope: 'local'
                    });
                }
                var crossDeps = this._resolveCrossNamespaceDeps();
                for (var xi = 0; xi < crossDeps.length; xi++) {
                    var xd = crossDeps[xi];
                    if (xd.fromCompId === comp.id && xd.fromNsId === ns.id) {
                        connections.push({
                            fromComputer: comp.label,
                            fromNamespace: ns.label,
                            fromAbstraction: xd.fromAbsName,
                            toAbstraction: xd.capName,
                            toNamespace: xd.toNsLabel || null,
                            resolved: xd.resolved,
                            scope: 'cross-namespace'
                        });
                    }
                }
            }
        }
        return connections;
    }

    _computeLoadOrder(ns) {
        var abstractions = ns.abstractions.slice();
        var ordered = [];
        var placed = {};
        var maxIter = abstractions.length * abstractions.length + 1;
        var iter = 0;
        while (abstractions.length > 0 && iter < maxIter) {
            iter++;
            for (var i = abstractions.length - 1; i >= 0; i--) {
                var abs = abstractions[i];
                var allResolved = true;
                for (var j = 0; j < abs.capabilities.length; j++) {
                    var capName = abs.capabilities[j].name.toUpperCase();
                    if (!placed[capName]) { allResolved = false; break; }
                }
                if (allResolved) {
                    ordered.push(abs.name);
                    placed[abs.name.toUpperCase()] = true;
                    abstractions.splice(i, 1);
                }
            }
        }
        for (var k = 0; k < abstractions.length; k++) ordered.push(abstractions[k].name);
        return ordered;
    }

    exportTopology() {
        var self = this;
        var topology = {
            version: '1.2',
            mapStyle: this.mapStyle,
            exported: new Date().toISOString(),
            computers: this.computers.map(function(comp) {
                return {
                    id: comp.id,
                    label: comp.label,
                    position: { x: comp.x, y: comp.y },
                    location: comp.location || { name: '', lat: null, lng: null },
                    dataAttributes: comp.dataAttributes || [],
                    namespaces: comp.namespaces.map(function(ns) {
                        return {
                            id: ns.id,
                            label: ns.label,
                            dataAttributes: ns.dataAttributes || [],
                            loadOrder: self._computeLoadOrder(ns),
                            abstractions: ns.abstractions.map(function(abs) {
                                return {
                                    name: abs.name,
                                    methods: abs.methods,
                                    capabilities: abs.capabilities,
                                    grants: abs.grants,
                                    codeSize: abs.codeSize,
                                    dataAttributes: abs.dataAttributes || []
                                };
                            })
                        };
                    })
                };
            }),
            connectionMap: this._buildConnectionMap()
        };
        var blob = new Blob([JSON.stringify(topology, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'topology.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    clearAll() {
        this.computers = [];
        this.nextComputerId = 1;
        this.nextNamespaceId = 1;
        this.nextAbstractionId = 1;
        this.selectedComputer = null;
        this.selectedNamespace = null;
        this.error = null;
        this._saveState();
        this.render();
    }

    _renderMapBackground(W, H, style) {
        var svg = '';
        if (style === 'earth') {
            svg += '<defs><radialGradient id="oceanGrad" cx="50%" cy="40%" r="70%"><stop offset="0%" stop-color="#1a6896"/><stop offset="100%" stop-color="#0b3d6b"/></radialGradient></defs>';
            svg += '<rect width="' + W + '" height="' + H + '" fill="url(#oceanGrad)" rx="6" class="builder-canvas-bg"/>';
            var landColor = '#2d6a3f';
            var landOpacity = '0.92';
            var continents = [
                'M 100,50 L 280,42 L 295,75 L 315,115 L 308,165 L 278,190 L 248,198 L 225,192 L 198,208 L 182,193 L 155,178 L 122,158 L 92,128 L 72,98 Z',
                'M 192,212 L 242,204 L 268,228 L 282,262 L 288,325 L 272,378 L 246,402 L 216,398 L 192,362 L 178,312 L 172,265 L 182,232 Z',
                'M 372,92 L 398,78 L 432,68 L 462,72 L 488,88 L 502,108 L 492,132 L 466,144 L 440,144 L 416,138 L 392,128 L 370,112 Z',
                'M 390,138 L 446,132 L 494,142 L 522,165 L 530,222 L 526,302 L 510,362 L 485,372 L 452,368 L 424,346 L 402,302 L 385,240 L 380,185 Z',
                'M 490,78 L 552,58 L 622,44 L 702,54 L 756,68 L 772,104 L 762,142 L 742,168 L 702,183 L 658,178 L 618,173 L 578,183 L 544,164 L 510,142 L 496,118 Z',
                'M 534,148 L 578,144 L 592,168 L 596,208 L 572,232 L 545,222 L 530,194 Z',
                'M 648,168 L 698,168 L 722,208 L 708,232 L 682,234 L 658,202 Z',
                'M 590,308 L 660,282 L 732,292 L 770,328 L 774,372 L 756,402 L 702,412 L 642,406 L 600,382 L 580,346 Z',
                'M 182,32 L 218,28 L 228,50 L 210,60 L 188,58 Z'
            ];
            for (var i = 0; i < continents.length; i++) {
                svg += '<path d="' + continents[i] + '" fill="' + landColor + '" opacity="' + landOpacity + '"/>';
            }
            svg += '<text x="10" y="492" fill="rgba(255,255,255,0.25)" font-size="9" font-family="sans-serif">Earth</text>';
        } else if (style === 'moon') {
            svg += '<defs><radialGradient id="moonGrad" cx="40%" cy="35%" r="75%"><stop offset="0%" stop-color="#c8c8c8"/><stop offset="100%" stop-color="#6e6e6e"/></radialGradient></defs>';
            svg += '<rect width="' + W + '" height="' + H + '" fill="url(#moonGrad)" rx="6" class="builder-canvas-bg"/>';
            var craters = [
                [120,80,35],[340,200,25],[580,130,40],[200,360,20],[700,300,30],
                [450,400,18],[650,60,22],[80,280,28],[500,250,15],[280,140,16],
                [740,420,24],[380,340,12],[150,430,20],[620,380,16],[240,50,14]
            ];
            for (var c = 0; c < craters.length; c++) {
                var cx = craters[c][0], cy = craters[c][1], cr = craters[c][2];
                svg += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + cr + '" ry="' + (cr * 0.55) + '" fill="none" stroke="#555" stroke-width="1.5" opacity="0.5"/>';
                svg += '<ellipse cx="' + (cx+cr*0.15) + '" cy="' + (cy+cr*0.1) + '" rx="' + (cr*0.7) + '" ry="' + (cr*0.35) + '" fill="#8a8a8a" opacity="0.3"/>';
            }
            svg += '<text x="10" y="492" fill="rgba(0,0,0,0.25)" font-size="9" font-family="sans-serif">Moon</text>';
        } else if (style === 'mars') {
            svg += '<defs><radialGradient id="marsGrad" cx="45%" cy="40%" r="70%"><stop offset="0%" stop-color="#c1440e"/><stop offset="100%" stop-color="#7a2504"/></radialGradient></defs>';
            svg += '<rect width="' + W + '" height="' + H + '" fill="url(#marsGrad)" rx="6" class="builder-canvas-bg"/>';
            var patches = [
                [150,100,100,60,'#8b3103','0.4'],[350,220,140,70,'#a03a06','0.35'],
                [600,150,120,55,'#7a2504','0.4'],[200,350,90,50,'#c04a10','0.3'],
                [500,380,110,60,'#8b3103','0.35'],[720,280,80,50,'#7a2504','0.4'],
                [80,260,70,40,'#a03a06','0.3'],[450,80,100,45,'#9b3806','0.35']
            ];
            for (var p = 0; p < patches.length; p++) {
                var pt = patches[p];
                svg += '<ellipse cx="' + pt[0] + '" cy="' + pt[1] + '" rx="' + pt[2] + '" ry="' + pt[3] + '" fill="' + pt[4] + '" opacity="' + pt[5] + '"/>';
            }
            var mcraters = [[300,150,18],[550,300,14],[180,400,12],[650,100,20],[400,340,10]];
            for (var mc = 0; mc < mcraters.length; mc++) {
                var mx = mcraters[mc][0], my = mcraters[mc][1], mr = mcraters[mc][2];
                svg += '<ellipse cx="' + mx + '" cy="' + my + '" rx="' + mr + '" ry="' + (mr*0.5) + '" fill="none" stroke="#5a1e02" stroke-width="1.5" opacity="0.5"/>';
            }
            svg += '<rect x="0" y="465" width="800" height="35" fill="#d4b483" opacity="0.15" rx="0"/>';
            svg += '<text x="10" y="492" fill="rgba(255,200,150,0.3)" font-size="9" font-family="sans-serif">Mars</text>';
        } else {
            svg += '<defs><radialGradient id="spaceGrad" cx="30%" cy="25%" r="80%"><stop offset="0%" stop-color="#111833"/><stop offset="100%" stop-color="#050510"/></radialGradient></defs>';
            svg += '<rect width="' + W + '" height="' + H + '" fill="url(#spaceGrad)" rx="6" class="builder-canvas-bg"/>';
            var stars = [[45,32],[120,88],[230,18],[315,145],[400,62],[488,198],[550,28],[620,112],[710,55],[760,180],[80,210],[175,310],[310,270],[460,330],[580,290],[680,360],[740,240],[30,380],[150,420],[260,460],[380,408],[510,445],[650,430],[790,380]];
            for (var st = 0; st < stars.length; st++) {
                var sr = (st % 3 === 0) ? 1.5 : (st % 2 === 0 ? 1 : 0.7);
                var so = (st % 3 === 0) ? '0.9' : '0.6';
                svg += '<circle cx="' + stars[st][0] + '" cy="' + stars[st][1] + '" r="' + sr + '" fill="white" opacity="' + so + '"/>';
            }
            svg += '<text x="10" y="492" fill="rgba(255,255,255,0.15)" font-size="9" font-family="sans-serif">Universal Cyberspace</text>';
        }
        return svg;
    }

    _renderSvgCanvas() {
        var W = 800, H = 500;
        var edges = this._findSharedDeps();
        var svg = '<svg class="builder-svg" width="100%" height="100%" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
        svg += '<defs><marker id="arrowResolved" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#4ade80"/></marker>';
        svg += '<marker id="arrowUnresolved" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#f87171"/></marker>';
        svg += '<marker id="arrowCross" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#fbbf24"/></marker></defs>';
        svg += this._renderMapBackground(W, H, this.mapStyle);

        var self = this;
        var isCompVisible = function(c) {
            var hasGeoLoc = c.location && c.location.lat !== null;
            return !hasGeoLoc || self.mapStyle === 'earth';
        };

        for (var ei = 0; ei < edges.length; ei++) {
            var edge = edges[ei];
            var a = this.computers.find(function(c) { return c.id === edge.from; });
            var b = this.computers.find(function(c) { return c.id === edge.to; });
            if (a && b && isCompVisible(a) && isCompVisible(b)) {
                svg += '<line x1="' + (a.x + 75) + '" y1="' + (a.y + 30) + '" x2="' + (b.x + 75) + '" y2="' + (b.y + 30) + '" stroke="#3a86ff" stroke-width="1.5" stroke-dasharray="6,3" opacity="0.5"/>';
            }
        }

        var visibleCount = 0;
        for (var ci = 0; ci < this.computers.length; ci++) {
            var comp = this.computers[ci];
            if (!isCompVisible(comp)) continue;
            visibleCount++;
            var isSelected = this.selectedComputer && this.selectedComputer.id === comp.id;
            var stroke = isSelected ? '#fbbf24' : '#3a86ff';
            var fill = isSelected ? 'rgba(26,21,0,0.92)' : 'rgba(17,24,51,0.92)';
            var sw = isSelected ? 2.5 : 1.5;
            var hasLoc = comp.location && comp.location.name;
            var hasAttrs = comp.dataAttributes && comp.dataAttributes.length > 0;
            var nodeH = hasLoc ? 72 : 60;
            svg += '<g class="builder-node" data-comp-id="' + comp.id + '" style="cursor:pointer;">';
            svg += '<rect x="' + comp.x + '" y="' + comp.y + '" width="150" height="' + nodeH + '" rx="6" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"/>';
            svg += '<text x="' + (comp.x + 75) + '" y="' + (comp.y + 22) + '" fill="' + stroke + '" font-size="12" font-weight="bold" text-anchor="middle" font-family="monospace">' + this._esc(comp.label) + '</text>';
            svg += '<text x="' + (comp.x + 75) + '" y="' + (comp.y + 40) + '" fill="#888" font-size="10" text-anchor="middle" font-family="monospace">' + comp.namespaces.length + ' namespace' + (comp.namespaces.length !== 1 ? 's' : '') + (hasAttrs ? ' \u00b7 ' + comp.dataAttributes.length + ' attr' + (comp.dataAttributes.length !== 1 ? 's' : '') : '') + '</text>';
            if (hasLoc) {
                svg += '<text x="' + (comp.x + 75) + '" y="' + (comp.y + 58) + '" fill="#4ade80" font-size="9" text-anchor="middle" font-family="sans-serif">\uD83D\uDCCD ' + this._esc(comp.location.name.length > 22 ? comp.location.name.substring(0, 22) + '\u2026' : comp.location.name) + '</text>';
            }
            svg += '<text x="' + (comp.x + 140) + '" y="' + (comp.y + 14) + '" fill="#f87171" font-size="11" font-weight="bold" text-anchor="middle" class="builder-remove-node" data-comp-id="' + comp.id + '" style="cursor:pointer;">\u00d7</text>';
            svg += '</g>';
        }

        if (visibleCount === 0) {
            var msgFill = this.mapStyle === 'moon' ? '#333' : '#555';
            var subFill = this.mapStyle === 'moon' ? '#444' : '#444';
            svg += '<text x="' + (W / 2) + '" y="' + (H / 2 - 10) + '" fill="' + msgFill + '" font-size="14" text-anchor="middle" font-family="sans-serif">Drop or click to add a computer</text>';
            svg += '<text x="' + (W / 2) + '" y="' + (H / 2 + 12) + '" fill="' + subFill + '" font-size="11" text-anchor="middle" font-family="sans-serif">Drag nodes to reposition \u00b7 Click to select</text>';
        }
        svg += '</svg>';
        return svg;
    }

    _renderComputerPanel() {
        var comp = this.selectedComputer;
        if (!comp) return '<div class="builder-panel-empty">Select a computer on the canvas to see its namespaces</div>';
        var html = '';
        if (!this._hintDismissed.computer) {
            html += '<div class="builder-hint-banner" id="builderHintComputer">';
            html += '<span>Add up to 8 namespaces. Click a namespace to add abstractions. Set a location to pin this computer on the map.</span>';
            html += '<button class="builder-hint-dismiss" onclick="builder._hintDismissed.computer=true;this.parentElement.remove()">\u00d7</button>';
            html += '</div>';
        }
        if (this.error) {
            html += '<div class="builder-error">' + this._esc(this.error) + '</div>';
        }
        html += '<div class="builder-panel-header">';
        html += '<input class="builder-label-input" value="' + this._esc(comp.label) + '" onchange="builder.renameComputer(' + comp.id + ', this.value)" />';
        html += '<button class="btn btn-sm builder-add-btn" onclick="builder.addNamespace(' + comp.id + ')">+ Namespace</button>';
        html += '</div>';

        var locName = (comp.location && comp.location.name) ? comp.location.name : '';
        html += '<div class="builder-location-row">';
        html += '<span class="builder-location-icon">\uD83D\uDCCD</span>';
        html += '<input class="builder-location-input" id="builderLocInput_' + comp.id + '" placeholder="e.g. Stuart, FL or London, UK" value="' + this._esc(locName) + '" onkeydown="if(event.key===\'Enter\'){builder.locateComputer(' + comp.id + ',this.value)}" />';
        html += '<button class="btn btn-sm builder-locate-btn" onclick="builder.locateComputer(' + comp.id + ',document.getElementById(\'builderLocInput_' + comp.id + '\').value)" title="Pin this computer at the typed location on the map">Locate</button>';
        html += '</div>';

        html += this._renderDataAttributes('computer', comp.id, 0, 0, comp.dataAttributes || []);

        html += '<div class="builder-ns-list" id="builderNsDropTarget" data-comp-id="' + comp.id + '">';
        html += '<div class="builder-ns-drop-zone" id="nsDropZone">';
        html += '<span class="builder-drop-hint">Drop namespace card here or click + Namespace</span>';
        html += '</div>';

        for (var ni = 0; ni < comp.namespaces.length; ni++) {
            var ns = comp.namespaces[ni];
            var isSelected = this.selectedNamespace && this.selectedNamespace.id === ns.id;
            var cls = isSelected ? 'builder-ns-card selected' : 'builder-ns-card';
            html += '<div class="' + cls + '" draggable="true" data-ns-id="' + ns.id + '" onclick="builder.selectNamespace(' + comp.id + ', ' + ns.id + ')">';
            html += '<div class="builder-ns-card-header">';
            html += '<span class="builder-ns-name">' + this._esc(ns.label) + '</span>';
            html += '<span class="builder-ns-count">' + ns.abstractions.length + ' abstraction' + (ns.abstractions.length !== 1 ? 's' : '');
            if (ns.dataAttributes && ns.dataAttributes.length > 0) html += ' \u00b7 ' + ns.dataAttributes.length + ' attr' + (ns.dataAttributes.length !== 1 ? 's' : '');
            html += '</span>';
            html += '<button class="builder-remove-btn" onclick="event.stopPropagation(); builder.removeNamespace(' + comp.id + ', ' + ns.id + ')">\u00d7</button>';
            html += '</div></div>';
        }

        var crossDeps = this._resolveCrossNamespaceDeps();
        var compCross = [];
        for (var xi = 0; xi < crossDeps.length; xi++) {
            if (crossDeps[xi].fromCompId === comp.id) compCross.push(crossDeps[xi]);
        }
        if (compCross.length > 0) {
            html += '<div class="builder-cross-deps-section">';
            html += '<div class="builder-cross-deps-title">Cross-namespace dependencies</div>';
            for (var xj = 0; xj < compCross.length; xj++) {
                var xd = compCross[xj];
                var cls2 = xd.resolved ? 'builder-cross-dep resolved' : 'builder-cross-dep unresolved';
                var icon = xd.resolved ? '\u2714' : '\u26a0';
                var target = xd.resolved ? ' \u2192 ' + this._esc(xd.toNsLabel) : ' (unresolved)';
                html += '<div class="' + cls2 + '">' + icon + ' ' + this._esc(xd.fromAbsName) + ' needs ' + this._esc(xd.capName) + target + '</div>';
            }
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    _renderNamespacePanel() {
        var comp = this.selectedComputer;
        var ns = this.selectedNamespace;
        if (!comp || !ns) return '';
        var html = '<div class="builder-panel-header">';
        html += '<input class="builder-label-input" value="' + this._esc(ns.label) + '" onchange="builder.renameNamespace(' + comp.id + ', ' + ns.id + ', this.value)" />';
        html += '<button class="btn btn-sm builder-back-btn" onclick="builder.selectedNamespace = null; builder.render()">\u2190 Back</button>';
        html += '</div>';

        if (!this._hintDismissed.namespace) {
            html += '<div class="builder-hint-banner builder-hint-schema" id="builderHintNamespace">';
            html += '<span>Drop an <strong>abstraction JSON</strong> file below. Required fields: ';
            html += '<code>abstraction</code> (string), <code>methods</code> (array), <code>capabilities</code> (array), <code>grants</code> (array).</span>';
            html += '<button class="builder-hint-dismiss" onclick="builder._hintDismissed.namespace=true;this.parentElement.remove()">\u00d7</button>';
            html += '</div>';
        }

        html += this._renderDataAttributes('namespace', comp.id, ns.id, 0, ns.dataAttributes || []);

        html += '<div class="builder-drop-zone" id="builderDropZone">';
        html += '<div class="builder-drop-icon">\u2b07</div>';
        html += '<div class="builder-drop-text">Drop .json abstraction file here</div>';
        html += '<div class="builder-drop-sub">or <label class="builder-file-label"><input type="file" accept=".json" onchange="builder.handleFilePick(event, ' + comp.id + ', ' + ns.id + ')" style="display:none;"/>click to browse</label></div>';
        html += '</div>';

        if (this.error) {
            html += '<div class="builder-error">' + this._esc(this.error) + '</div>';
        }

        var deps = this._resolveCapabilities(ns);

        if (ns.abstractions.length > 0) {
            html += '<div class="builder-abs-list" id="builderAbsList">';
            for (var ai = 0; ai < ns.abstractions.length; ai++) {
                var abs = ns.abstractions[ai];
                var absDeps = deps.filter(function(d) { return d.fromId === abs.id; });
                html += '<div class="builder-abs-card" data-abs-id="' + abs.id + '">';
                html += '<div class="builder-abs-header">';
                html += '<span class="builder-abs-name">' + this._esc(abs.name) + '</span>';
                html += '<span class="builder-abs-meta">' + abs.methodCount + ' method' + (abs.methodCount !== 1 ? 's' : '') + ' \u00b7 ' + abs.codeSize + ' words</span>';
                html += '<button class="builder-remove-btn" onclick="builder.removeAbstraction(' + comp.id + ', ' + ns.id + ', ' + abs.id + ')">\u00d7</button>';
                html += '</div>';
                html += '<div class="builder-abs-grants">Grants: ' + this._esc(abs.grants.join(', ')) + '</div>';
                if (abs.methods.length > 0) {
                    html += '<div class="builder-abs-methods">Methods: ' + this._esc(abs.methods.join(', ')) + '</div>';
                }
                if (absDeps.length > 0) {
                    html += '<details class="builder-abs-deps-details">';
                    html += '<summary class="builder-deps-label">Requires (' + absDeps.length + ')</summary>';
                    html += '<div class="builder-abs-deps">';
                    for (var di = 0; di < absDeps.length; di++) {
                        var dep = absDeps[di];
                        var dcls = dep.resolved ? 'builder-dep resolved' : 'builder-dep unresolved';
                        var dicon = dep.resolved ? '\u2714' : '\u26a0';
                        html += '<span class="' + dcls + '">' + dicon + ' ' + this._esc(dep.to) + '</span>';
                    }
                    html += '</div>';
                    html += '</details>';
                }
                html += this._renderDataAttributes('abstraction', comp.id, ns.id, abs.id, abs.dataAttributes || []);
                html += '</div>';
            }
            html += '</div>';
        }
        return html;
    }

    _drawDependencyArrows() {
        var listEl = document.getElementById('builderAbsList');
        if (!listEl) return;
        var comp = this.selectedComputer;
        var ns = this.selectedNamespace;
        if (!comp || !ns || ns.abstractions.length < 2) return;
        var deps = this._resolveCapabilities(ns);
        if (deps.length === 0) return;

        var cards = listEl.querySelectorAll('.builder-abs-card');
        var cardMap = {};
        for (var i = 0; i < cards.length; i++) {
            var absId = parseInt(cards[i].getAttribute('data-abs-id'));
            var rect = cards[i].getBoundingClientRect();
            var listRect = listEl.getBoundingClientRect();
            cardMap[absId] = {
                top: rect.top - listRect.top,
                bottom: rect.bottom - listRect.top,
                left: rect.left - listRect.left,
                right: rect.right - listRect.left,
                midY: (rect.top + rect.bottom) / 2 - listRect.top,
                width: rect.width
            };
        }

        var existingSvg = listEl.querySelector('.builder-dep-arrows');
        if (existingSvg) existingSvg.remove();

        var svgNs = 'http://www.w3.org/2000/svg';
        var svgEl = document.createElementNS(svgNs, 'svg');
        svgEl.setAttribute('class', 'builder-dep-arrows');
        svgEl.setAttribute('style', 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;');
        svgEl.setAttribute('xmlns', svgNs);

        var defs = document.createElementNS(svgNs, 'defs');
        var markers = [{ id: 'arrR', color: '#4ade80' }, { id: 'arrU', color: '#f87171' }];
        for (var mi = 0; mi < markers.length; mi++) {
            var marker = document.createElementNS(svgNs, 'marker');
            marker.setAttribute('id', markers[mi].id);
            marker.setAttribute('markerWidth', '8');
            marker.setAttribute('markerHeight', '6');
            marker.setAttribute('refX', '8');
            marker.setAttribute('refY', '3');
            marker.setAttribute('orient', 'auto');
            var poly = document.createElementNS(svgNs, 'polygon');
            poly.setAttribute('points', '0 0, 8 3, 0 6');
            poly.setAttribute('fill', markers[mi].color);
            marker.appendChild(poly);
            defs.appendChild(marker);
        }
        svgEl.appendChild(defs);

        for (var di = 0; di < deps.length; di++) {
            var dep = deps[di];
            var fromBox = cardMap[dep.fromId];
            var toBox = dep.toId ? cardMap[dep.toId] : null;
            if (!fromBox) continue;
            if (dep.resolved && toBox) {
                var x1 = fromBox.width - 5, y1 = fromBox.midY;
                var x2 = toBox.width - 5, y2 = toBox.midY;
                var offset = (di % 3) * 6 + 12;
                var path = document.createElementNS(svgNs, 'path');
                var cx = fromBox.width + offset;
                var d = 'M ' + x1 + ' ' + y1 + ' C ' + cx + ' ' + y1 + ', ' + cx + ' ' + y2 + ', ' + x2 + ' ' + y2;
                path.setAttribute('d', d);
                path.setAttribute('stroke', '#4ade80');
                path.setAttribute('stroke-width', '1.5');
                path.setAttribute('fill', 'none');
                path.setAttribute('marker-end', 'url(#arrR)');
                path.setAttribute('opacity', '0.7');
                svgEl.appendChild(path);
            } else {
                var dashLine = document.createElementNS(svgNs, 'line');
                dashLine.setAttribute('x1', fromBox.width - 5);
                dashLine.setAttribute('y1', fromBox.midY);
                dashLine.setAttribute('x2', fromBox.width + 30);
                dashLine.setAttribute('y2', fromBox.midY);
                dashLine.setAttribute('stroke', '#f87171');
                dashLine.setAttribute('stroke-width', '1.5');
                dashLine.setAttribute('stroke-dasharray', '4,3');
                dashLine.setAttribute('marker-end', 'url(#arrU)');
                dashLine.setAttribute('opacity', '0.7');
                svgEl.appendChild(dashLine);
                var label = document.createElementNS(svgNs, 'text');
                label.setAttribute('x', fromBox.width + 34);
                label.setAttribute('y', fromBox.midY + 4);
                label.setAttribute('fill', '#f87171');
                label.setAttribute('font-size', '9');
                label.setAttribute('font-family', 'monospace');
                label.textContent = '? ' + dep.to;
                svgEl.appendChild(label);
            }
        }
        listEl.style.position = 'relative';
        listEl.appendChild(svgEl);
    }

    renameComputer(id, label) {
        var comp = this.computers.find(function(c) { return c.id === id; });
        if (comp) { comp.label = label; this._saveState(); this.render(); }
    }

    renameNamespace(compId, nsId, label) {
        var comp = this.computers.find(function(c) { return c.id === compId; });
        if (!comp) return;
        var ns = comp.namespaces.find(function(n) { return n.id === nsId; });
        if (ns) { ns.label = label; this._saveState(); this.render(); }
    }

    handleFilePick(event, compId, nsId) {
        var file = event.target.files[0];
        if (!file) return;
        this._readJsonFile(file, compId, nsId);
        event.target.value = '';
    }

    _readJsonFile(file, compId, nsId) {
        var self = this;
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var json = JSON.parse(e.target.result);
                self.addAbstraction(compId, nsId, json);
            } catch (err) {
                self.error = 'Failed to parse JSON: ' + err.message;
                self.render();
            }
        };
        reader.readAsText(file);
    }

    render() {
        var container = document.getElementById('builderView');
        if (!container) return;

        if (document.activeElement && container.contains(document.activeElement)) {
            document.activeElement.blur();
        }

        var ms = this.mapStyle;
        var html = '<div class="builder-layout">';
        html += '<div class="builder-canvas-area">';
        html += '<div class="builder-toolbar">';
        html += '<span class="builder-title">Universal Cyberspace</span>';
        html += '<div class="builder-toolbar-actions">';
        html += '<div class="builder-map-btns">';
        html += '<button class="btn btn-sm builder-map-btn' + (ms==='space'?' active':'') + '" onclick="builder.setMapStyle(\'space\')" title="Space">🔭</button>';
        html += '<button class="btn btn-sm builder-map-btn' + (ms==='earth'?' active':'') + '" onclick="builder.setMapStyle(\'earth\')" title="Earth">🌍</button>';
        html += '<button class="btn btn-sm builder-map-btn' + (ms==='moon'?' active':'') + '" onclick="builder.setMapStyle(\'moon\')" title="Moon">🌑</button>';
        html += '<button class="btn btn-sm builder-map-btn' + (ms==='mars'?' active':'') + '" onclick="builder.setMapStyle(\'mars\')" title="Mars">🔴</button>';
        html += '</div>';
        html += '<div class="builder-palette-card" draggable="true" id="paletteComputer" data-tooltip="Computer — Drag onto canvas to add a computer node">\u2395 Computer</div>';
        html += '<div class="builder-palette-card" draggable="true" id="paletteNamespace" data-tooltip="Namespace — Drag onto computer panel to add a namespace">\u2630 Namespace</div>';
        html += '<button class="btn btn-sm builder-export-btn" onclick="builder.exportTopology()" data-tooltip="Save Topology — Export the full topology as a JSON file">Save Topology</button>';
        html += '<button class="btn btn-sm builder-clear-btn" onclick="if(confirm(\'Clear all?\')) builder.clearAll()" data-tooltip="Clear All — Remove all computers, namespaces, and abstractions">Clear All</button>';
        html += '<button class="btn btn-sm builder-help-btn" onclick="showBuilderHelpPopup(true)" data-tooltip="Help — Show the Builder quick-start guide">?</button>';
        html += '</div>';
        html += '</div>';
        html += '<div class="builder-canvas" id="builderCanvas">';
        html += this._renderSvgCanvas();
        html += '</div>';
        if (!this._hintDismissed.canvas && !this.selectedComputer) {
            html += '<div class="builder-hint-banner" id="builderHintCanvas">';
            html += '<span>Click or drag to add a Computer node. Use 🌍 Earth mode + Locate to pin computers to real-world locations.</span>';
            html += '<button class="builder-hint-dismiss" onclick="builder._hintDismissed.canvas=true;this.parentElement.remove()">\u00d7</button>';
            html += '</div>';
        }
        html += '</div>';

        html += '<div class="builder-side-panel">';
        if (this.selectedNamespace) {
            html += this._renderNamespacePanel();
        } else {
            html += this._renderComputerPanel();
        }
        html += '</div>';

        html += '</div>';
        container.innerHTML = html;

        this._attachCanvasEvents();
        this._attachDropZoneEvents();
        this._attachNsDropEvents();
        this._attachPaletteDragEvents();
        this._drawDependencyArrows();
        this._drawCrossNamespaceLines();
    }

    _getSvgCoords(e, svg) {
        var svgRect = svg.getBoundingClientRect();
        var scaleX = 800 / svgRect.width;
        var scaleY = 500 / svgRect.height;
        return {
            x: (e.clientX - svgRect.left) * scaleX,
            y: (e.clientY - svgRect.top) * scaleY
        };
    }

    _updateDraggedNodeSvg() {
        if (!this.draggingNode) return;
        var comp = this.draggingNode;
        var svg = document.querySelector('#builderCanvas .builder-svg');
        if (!svg) return;
        var group = svg.querySelector('.builder-node[data-comp-id="' + comp.id + '"]');
        if (!group) return;
        var rect = group.querySelector('rect');
        var texts = group.querySelectorAll('text');
        if (rect) { rect.setAttribute('x', comp.x); rect.setAttribute('y', comp.y); }
        if (texts[0]) { texts[0].setAttribute('x', comp.x + 75); texts[0].setAttribute('y', comp.y + 22); }
        if (texts[1]) { texts[1].setAttribute('x', comp.x + 75); texts[1].setAttribute('y', comp.y + 40); }
        if (texts[2]) { texts[2].setAttribute('x', comp.x + 140); texts[2].setAttribute('y', comp.y + 14); }

        var edges = this._findSharedDeps();
        var lines = svg.querySelectorAll('line');
        var lineIdx = 0;
        for (var ei = 0; ei < edges.length; ei++) {
            var a = this.computers.find(function(c) { return c.id === edges[ei].from; });
            var b = this.computers.find(function(c) { return c.id === edges[ei].to; });
            if (a && b && lineIdx < lines.length) {
                lines[lineIdx].setAttribute('x1', a.x + 75);
                lines[lineIdx].setAttribute('y1', a.y + 30);
                lines[lineIdx].setAttribute('x2', b.x + 75);
                lines[lineIdx].setAttribute('y2', b.y + 30);
                lineIdx++;
            }
        }
    }

    _onDocMouseMove(e) {
        if (!this.draggingNode) return;
        var svg = document.querySelector('#builderCanvas .builder-svg');
        if (!svg) return;
        var coords = this._getSvgCoords(e, svg);
        this.draggingNode.x = Math.max(0, Math.min(650, coords.x - this.dragOffset.x));
        this.draggingNode.y = Math.max(0, Math.min(440, coords.y - this.dragOffset.y));
        this._dragMoved = true;
        this._updateDraggedNodeSvg();
    }

    _onDocMouseUp() {
        if (this.draggingNode) {
            this._saveState();
            if (this._dragMoved) this.render();
            this.draggingNode = null;
            this._dragMoved = false;
        }
    }

    _attachCanvasEvents() {
        var canvas = document.getElementById('builderCanvas');
        if (!canvas) return;
        var svg = canvas.querySelector('.builder-svg');
        if (!svg) return;
        var self = this;

        if (!this._docListenersAttached) {
            document.addEventListener('mousemove', this._boundDocMouseMove);
            document.addEventListener('mouseup', this._boundDocMouseUp);
            this._docListenersAttached = true;
        }

        svg.querySelectorAll('.builder-remove-node').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = parseInt(this.getAttribute('data-comp-id'));
                self.removeComputer(id);
            });
        });

        svg.querySelectorAll('.builder-node').forEach(function(el) {
            el.addEventListener('mousedown', function(e) {
                if (e.target.classList.contains('builder-remove-node')) return;
                var id = parseInt(this.getAttribute('data-comp-id'));
                var comp = self.computers.find(function(c) { return c.id === id; });
                if (!comp) return;
                self.draggingNode = comp;
                self._dragMoved = false;
                var coords = self._getSvgCoords(e, svg);
                self.dragOffset = { x: coords.x - comp.x, y: coords.y - comp.y };
                e.preventDefault();
            });
        });

        var bgRect = svg.querySelector('.builder-canvas-bg');
        if (bgRect) {
            bgRect.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
            bgRect.addEventListener('drop', function(e) {
                e.preventDefault();
                var type = e.dataTransfer.getData('text/plain');
                if (type === 'new-computer') {
                    var coords = self._getSvgCoords(e, svg);
                    self.addComputer(Math.max(0, Math.min(650, coords.x - 75)), Math.max(0, Math.min(440, coords.y - 30)));
                }
            });
        }

        svg.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        svg.addEventListener('drop', function(e) {
            e.preventDefault();
            var type = e.dataTransfer.getData('text/plain');
            if (type === 'new-computer') {
                var coords = self._getSvgCoords(e, svg);
                self.addComputer(Math.max(0, Math.min(650, coords.x - 75)), Math.max(0, Math.min(440, coords.y - 30)));
            }
        });

        svg.addEventListener('click', function(e) {
            if (self._dragMoved) return;
            if (self.draggingNode) return;
            if (e.target.classList.contains('builder-remove-node')) return;
            var nodeEl = e.target.closest('.builder-node');
            if (nodeEl) {
                var id = parseInt(nodeEl.getAttribute('data-comp-id'));
                self.selectComputer(id);
                return;
            }
            var coords = self._getSvgCoords(e, svg);
            self.addComputer(Math.max(0, Math.min(650, coords.x - 75)), Math.max(0, Math.min(440, coords.y - 30)));
        });
    }

    _attachNsDropEvents() {
        var nsDropZone = document.getElementById('nsDropZone');
        if (!nsDropZone || !this.selectedComputer) return;
        var compId = this.selectedComputer.id;
        var self = this;

        nsDropZone.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            nsDropZone.classList.add('drag-over');
        });
        nsDropZone.addEventListener('dragleave', function(e) { nsDropZone.classList.remove('drag-over'); });
        nsDropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            nsDropZone.classList.remove('drag-over');
            var type = e.dataTransfer.getData('text/plain');
            if (type === 'new-namespace' || type === '') self.addNamespace(compId);
        });

        var nsCards = document.querySelectorAll('.builder-ns-card[draggable]');
        nsCards.forEach(function(card) {
            card.addEventListener('dragstart', function(e) {
                e.dataTransfer.setData('text/plain', 'namespace-' + card.getAttribute('data-ns-id'));
                e.dataTransfer.effectAllowed = 'move';
            });
        });
    }

    _attachDropZoneEvents() {
        var dropZone = document.getElementById('builderDropZone');
        if (!dropZone || !this.selectedComputer || !this.selectedNamespace) return;
        var compId = this.selectedComputer.id;
        var nsId = this.selectedNamespace.id;
        var self = this;

        dropZone.addEventListener('dragover', function(e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', function(e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); });
        dropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
            var files = e.dataTransfer.files;
            if (files.length > 0) {
                for (var i = 0; i < files.length; i++) self._readJsonFile(files[i], compId, nsId);
            }
        });
    }

    _attachPaletteDragEvents() {
        var palComp = document.getElementById('paletteComputer');
        var palNs = document.getElementById('paletteNamespace');
        if (palComp) {
            palComp.addEventListener('dragstart', function(e) {
                e.dataTransfer.setData('text/plain', 'new-computer');
                e.dataTransfer.effectAllowed = 'copy';
            });
        }
        if (palNs) {
            palNs.addEventListener('dragstart', function(e) {
                e.dataTransfer.setData('text/plain', 'new-namespace');
                e.dataTransfer.effectAllowed = 'copy';
            });
        }
    }

    _drawCrossNamespaceLines() {
        var comp = this.selectedComputer;
        if (!comp || this.selectedNamespace) return;
        var nsCards = document.querySelectorAll('.builder-ns-card[data-ns-id]');
        if (nsCards.length < 2) return;

        var crossDeps = this._resolveCrossNamespaceDeps();
        var compCross = [];
        for (var xi = 0; xi < crossDeps.length; xi++) {
            if (crossDeps[xi].fromCompId === comp.id && crossDeps[xi].resolved && crossDeps[xi].toCompId === comp.id) {
                compCross.push(crossDeps[xi]);
            }
        }
        if (compCross.length === 0) return;

        var listEl = document.getElementById('builderNsDropTarget');
        if (!listEl) return;
        var listRect = listEl.getBoundingClientRect();

        var cardMap = {};
        for (var i = 0; i < nsCards.length; i++) {
            var nsId = parseInt(nsCards[i].getAttribute('data-ns-id'));
            var rect = nsCards[i].getBoundingClientRect();
            cardMap[nsId] = {
                midY: (rect.top + rect.bottom) / 2 - listRect.top,
                right: rect.right - listRect.left,
                left: rect.left - listRect.left,
                width: rect.width
            };
        }

        var svgNs = 'http://www.w3.org/2000/svg';
        var svgEl = document.createElementNS(svgNs, 'svg');
        svgEl.setAttribute('class', 'builder-cross-ns-lines');
        svgEl.setAttribute('style', 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;');
        var defs = document.createElementNS(svgNs, 'defs');
        var marker = document.createElementNS(svgNs, 'marker');
        marker.setAttribute('id', 'arrCross');
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        var poly = document.createElementNS(svgNs, 'polygon');
        poly.setAttribute('points', '0 0, 8 3, 0 6');
        poly.setAttribute('fill', '#fbbf24');
        marker.appendChild(poly);
        defs.appendChild(marker);
        svgEl.appendChild(defs);

        for (var di = 0; di < compCross.length; di++) {
            var dep = compCross[di];
            var fromBox = cardMap[dep.fromNsId];
            var toBox = cardMap[dep.toNsId];
            if (!fromBox || !toBox || dep.fromNsId === dep.toNsId) continue;
            var offset = (di % 3) * 8 + 15;
            var path = document.createElementNS(svgNs, 'path');
            var x1 = fromBox.width - 5, y1 = fromBox.midY;
            var x2 = toBox.width - 5, y2 = toBox.midY;
            var cx = fromBox.width + offset;
            var d = 'M ' + x1 + ' ' + y1 + ' C ' + cx + ' ' + y1 + ', ' + cx + ' ' + y2 + ', ' + x2 + ' ' + y2;
            path.setAttribute('d', d);
            path.setAttribute('stroke', '#fbbf24');
            path.setAttribute('stroke-width', '1.5');
            path.setAttribute('stroke-dasharray', '6,3');
            path.setAttribute('fill', 'none');
            path.setAttribute('marker-end', 'url(#arrCross)');
            path.setAttribute('opacity', '0.6');
            svgEl.appendChild(path);
        }
        listEl.style.position = 'relative';
        listEl.appendChild(svgEl);
    }
}

var builder;
function initBuilder() {
    if (!builder) builder = new NamespaceBuilder();
    builder._hintDismissed = { canvas: false, computer: false, namespace: false };
    builder.render();
    showBuilderHelpPopup();
}

function showBuilderHelpPopup(force) {
    if (typeof POPUPS_DISABLED !== 'undefined' && POPUPS_DISABLED) return;
    var modal = document.getElementById('builderHelpModal');
    if (!modal) return;
    if (!force && localStorage.getItem('church_builder_help_dismissed')) return;
    if (!force && typeof isWelcomeNeeded === 'function' && isWelcomeNeeded()) return;
    var welcomeModal = document.getElementById('welcomeModal');
    if (!force && welcomeModal && welcomeModal.style.display !== 'none') return;
    var body = document.getElementById('builderHelpBody');
    if (!body) return;
    body.innerHTML =
        '<div style="margin-bottom:0.75rem;">' +
        '<p style="font-size:0.88rem;line-height:1.55;margin-bottom:0.6rem;">' +
        'The <strong>Namespace Builder</strong> lets you design a deployment topology ' +
        'by arranging <em>Computers</em>, <em>Namespaces</em>, and <em>Abstractions</em> ' +
        'on a visual canvas.</p></div>' +

        '<div style="font-weight:700;color:var(--church-gold);font-size:0.95rem;margin-bottom:0.5rem;">Three levels</div>' +

        '<div class="welcome-step"><span class="welcome-step-num">1</span>' +
        '<div class="welcome-step-text"><strong>Canvas</strong> \u2014 Click the canvas or drag \u2395 Computer to place nodes. Switch backgrounds: 🔭 Space, 🌍 Earth, 🌑 Moon, 🔴 Mars.</div></div>' +

        '<div class="welcome-step"><span class="welcome-step-num">2</span>' +
        '<div class="welcome-step-text"><strong>Computer</strong> \u2014 Select a computer to configure namespaces, set a geographic location (e.g. "Stuart, FL"), and add data attributes.</div></div>' +

        '<div class="welcome-step"><span class="welcome-step-num">3</span>' +
        '<div class="welcome-step-text"><strong>Namespace</strong> \u2014 Drop abstraction JSON files to add abstractions. Each object supports key-value data attributes.</div></div>' +

        '<div style="background:rgba(218,165,32,0.06);border:1px solid rgba(218,165,32,0.2);border-radius:8px;padding:0.6rem 1rem;margin-top:0.75rem;font-size:0.82rem;line-height:1.5;">' +
        '<strong style="color:var(--church-gold);">Tip:</strong> Use 🌍 Earth view and type a city in the <em>Locate</em> box to pin each computer to a real-world location on the map. ' +
        'Use <em>Save Topology</em> to export everything as JSON.</div>';

    modal.style.display = 'flex';
}

function closeBuilderHelp() {
    localStorage.setItem('church_builder_help_dismissed', '1');
    var modal = document.getElementById('builderHelpModal');
    if (modal) modal.style.display = 'none';
}
