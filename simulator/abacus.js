const abacusState = {
    rods: [],
    display: '0',
    trace: [],
    maxTrace: 50,
    rendered: false,
    numRods: 13
};

function abacusInit() {
    abacusState.rods = [];
    for (let i = 0; i < abacusState.numRods; i++) {
        abacusState.rods.push({ heaven: 0, earth: 0 });
    }
    abacusState.display = '0';
}

function abacusTraceLog(lambdaExpr, desc) {
    abacusState.trace.unshift({ lambda: lambdaExpr, desc: desc, time: Date.now() });
    if (abacusState.trace.length > abacusState.maxTrace) abacusState.trace.pop();
}

function abacusGetValue() {
    let value = 0;
    for (let i = 0; i < abacusState.numRods; i++) {
        const rod = abacusState.rods[i];
        const placeValue = Math.pow(10, abacusState.numRods - 1 - i);
        value += (rod.heaven * 5 + rod.earth) * placeValue;
    }
    return value;
}

function abacusToggleHeaven(rodIndex) {
    const rod = abacusState.rods[rodIndex];
    rod.heaven = rod.heaven ? 0 : 1;
    const val = abacusGetValue();
    abacusState.display = val.toLocaleString();
    const place = Math.pow(10, abacusState.numRods - 1 - rodIndex);
    const action = rod.heaven ? 'lower' : 'raise';
    abacusTraceLog(
        `CALL Abacus.${rod.heaven ? 'Add' : 'Sub'}(${5 * place})`,
        `Heaven bead ${action} on rod ${rodIndex + 1} (×${place.toLocaleString()})`
    );
    abacusUpdateDisplay();
}

function abacusToggleEarth(rodIndex, beadIndex) {
    const rod = abacusState.rods[rodIndex];
    if (beadIndex < rod.earth) {
        rod.earth = beadIndex;
    } else {
        rod.earth = beadIndex + 1;
    }
    const val = abacusGetValue();
    abacusState.display = val.toLocaleString();
    const place = Math.pow(10, abacusState.numRods - 1 - rodIndex);
    abacusTraceLog(
        `CALL Abacus.Set(rod${rodIndex + 1}, ${rod.heaven * 5 + rod.earth})`,
        `Earth beads set to ${rod.earth} on rod ${rodIndex + 1} (×${place.toLocaleString()})`
    );
    abacusUpdateDisplay();
}

function abacusClear() {
    abacusInit();
    abacusTraceLog('CALL Abacus.Clear()', 'Reset all rods to zero');
    abacusUpdateDisplay();
}

function abacusUpdateDisplay() {
    abacusRenderDisplay();
}

function abacusRenderDisplay() {
    const container = document.getElementById('abacusContainer');
    if (!container) return;

    const screenVal = container.querySelector('.abacus-readout-value');
    if (screenVal) screenVal.textContent = abacusState.display;

    for (let i = 0; i < abacusState.numRods; i++) {
        const rod = abacusState.rods[i];
        const heavenBead = container.querySelector(`#abacusHeaven${i}`);
        if (heavenBead) {
            heavenBead.classList.toggle('active', rod.heaven === 1);
        }
        for (let j = 0; j < 4; j++) {
            const earthBead = container.querySelector(`#abacusEarth${i}_${j}`);
            if (earthBead) {
                earthBead.classList.toggle('active', j < rod.earth);
            }
        }
    }

    const traceArea = container.querySelector('.abacus-trace-area');
    if (traceArea) {
        traceArea.innerHTML = abacusState.trace.map((t, i) =>
            `<div class="abacus-trace-entry${i === 0 ? ' abacus-trace-latest' : ''}">
                <div class="abacus-trace-lambda">${t.lambda}</div>
                <div class="abacus-trace-desc">${t.desc}</div>
            </div>`
        ).join('');
    }
}

function renderAbacusCalculator() {
    const container = document.getElementById('abacusContainer');
    if (!container) return;

    abacusInit();

    let rodsHTML = '';
    for (let i = 0; i < abacusState.numRods; i++) {
        const placeLabel = Math.pow(10, abacusState.numRods - 1 - i);
        let label = '';
        if (placeLabel >= 1000000000000) label = 'T';
        else if (placeLabel >= 1000000000) label = 'B';
        else if (placeLabel >= 1000000) label = 'M';
        else if (placeLabel >= 1000) label = 'K';
        else label = placeLabel.toString();

        rodsHTML += `
        <div class="abacus-rod">
            <div class="abacus-rod-label">${label}</div>
            <div class="abacus-heaven-zone">
                <div class="abacus-bead abacus-heaven-bead" id="abacusHeaven${i}" onclick="abacusToggleHeaven(${i})"></div>
            </div>
            <div class="abacus-beam-bar"></div>
            <div class="abacus-earth-zone">
                <div class="abacus-bead abacus-earth-bead" id="abacusEarth${i}_3" onclick="abacusToggleEarth(${i}, 3)"></div>
                <div class="abacus-bead abacus-earth-bead" id="abacusEarth${i}_2" onclick="abacusToggleEarth(${i}, 2)"></div>
                <div class="abacus-bead abacus-earth-bead" id="abacusEarth${i}_1" onclick="abacusToggleEarth(${i}, 1)"></div>
                <div class="abacus-bead abacus-earth-bead" id="abacusEarth${i}_0" onclick="abacusToggleEarth(${i}, 0)"></div>
            </div>
        </div>`;
    }

    container.innerHTML = `
    <div class="abacus-tile-grid">
        <div class="abacus-tile-column">
            <div class="abacus-tile abacus-tile-calc">
                <div class="abacus-frame">
                    <div class="abacus-title">
                        <span class="abacus-title-label">SOROBAN</span>
                        <span class="abacus-title-ns">NS[17] \u00b7 Abacus</span>
                    </div>
                    <div class="abacus-readout">
                        <span class="abacus-readout-value">0</span>
                    </div>
                    <div class="abacus-rods-area">
                        ${rodsHTML}
                    </div>
                    <div class="abacus-controls">
                        <button class="abacus-btn" onclick="abacusClear()">Clear</button>
                    </div>
                    <div class="abacus-place-info">Each rod: 1 heaven bead (5) + 4 earth beads (1 each) = 0\u20139 per digit</div>
                </div>
            </div>
            <div class="abacus-tile abacus-tile-trace">
                <div class="abacus-tile-header">Church Machine Trace</div>
                <div class="abacus-trace-area"></div>
            </div>
        </div>


        <div class="abacus-tile abacus-tile-abstraction">
            <div class="abacus-tile-header">The Church Abstraction as a Digital Abacus</div>
            <div class="abacus-abstraction-body">
                <p>A Church Machine <strong>abstraction</strong> is like a digital abacus \u2014 a self-contained block with rods (methods) and beads (data) that only the owner can move.</p>
                <div class="abacus-analogy-grid">
                    <div class="abacus-analogy-row">
                        <span class="abacus-analogy-abacus">Abacus Frame</span>
                        <span class="abacus-analogy-arrow">\u2194</span>
                        <span class="abacus-analogy-church">Abstraction (NS Entry)</span>
                    </div>
                    <div class="abacus-analogy-row">
                        <span class="abacus-analogy-abacus">Rods</span>
                        <span class="abacus-analogy-arrow">\u2194</span>
                        <span class="abacus-analogy-church">Methods (code at offset 0)</span>
                    </div>
                    <div class="abacus-analogy-row">
                        <span class="abacus-analogy-abacus">Beads</span>
                        <span class="abacus-analogy-arrow">\u2194</span>
                        <span class="abacus-analogy-church">Data (within the lump)</span>
                    </div>
                    <div class="abacus-analogy-row">
                        <span class="abacus-analogy-abacus">Heaven Beads (5)</span>
                        <span class="abacus-analogy-arrow">\u2194</span>
                        <span class="abacus-analogy-church">Capabilities (c-list, Church domain)</span>
                    </div>
                    <div class="abacus-analogy-row">
                        <span class="abacus-analogy-abacus">Earth Beads (1 each)</span>
                        <span class="abacus-analogy-arrow">\u2194</span>
                        <span class="abacus-analogy-church">Data words (Turing domain)</span>
                    </div>
                    <div class="abacus-analogy-row">
                        <span class="abacus-analogy-abacus">Beam Bar</span>
                        <span class="abacus-analogy-arrow">\u2194</span>
                        <span class="abacus-analogy-church">Domain purity boundary</span>
                    </div>
                    <div class="abacus-analogy-row">
                        <span class="abacus-analogy-abacus">Place Value (10\u207f)</span>
                        <span class="abacus-analogy-arrow">\u2194</span>
                        <span class="abacus-analogy-church">Abstraction layer (1\u20139)</span>
                    </div>
                </div>
                <div class="abacus-abstraction-section">
                    <div class="abacus-abstraction-title">Why It Matters</div>
                    <p>On a soroban, each rod is independent \u2014 you can only change beads on the rod you\u2019re touching. In the Church Machine, each abstraction works the same way: you can only call its methods through a <strong>Golden Token</strong> with the right permissions. No token, no access.</p>
                </div>
                <div class="abacus-abstraction-section">
                    <div class="abacus-abstraction-title">Structure of a Lump</div>
                    <p class="abacus-lump-diagram"><span class="abacus-lump-code">[Code at offset 0]</span> <span class="abacus-lump-free">[Free space]</span> <span class="abacus-lump-clist">[C-list at end]</span></p>
                    <p>Methods live at the start. The capability list (c-list) lives at the end. Free space grows between them \u2014 just like beads slide along rods.</p>
                </div>
                <div class="abacus-abstraction-section">
                    <div class="abacus-abstraction-title">Functional Methods</div>
                    <p>Each method is a pure function: give it inputs, get outputs. No side effects, no hidden state changes. Just as sliding a bead is a single, visible action \u2014 every method call is explicit and auditable through the trace below.</p>
                </div>
            </div>
        </div>
    </div>`;

    abacusState.rendered = true;
    abacusUpdateDisplay();
}
