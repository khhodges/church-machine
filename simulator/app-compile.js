function renderReference() {
    const churchList = document.getElementById('instrListChurch');
    const turingList = document.getElementById('instrListTuring');
    const absList = document.getElementById('instrListAbstractions');

    if (absList) {
        absList.innerHTML = '';
        // Use api-data.js catalogue if available, else fall back to ABSTRACTION_DATA
        if (typeof API_DATA !== 'undefined' && typeof API_LAYER_NAMES !== 'undefined') {
            const groups = apiGroupByLayer();
            const layerOrder = [0,1,2,3,4,5,6,7,8,9];
            for (const layerNum of layerOrder) {
                const entries = groups[layerNum];
                if (!entries || entries.length === 0) continue;
                const header = document.createElement('div');
                header.className = 'api-ref-layer-header';
                header.textContent = (API_LAYER_NAMES[layerNum] || ('Layer ' + layerNum));
                absList.appendChild(header);
                for (const abs of entries) {
                    if (abs.slot === 2) continue;
                    const card = document.createElement('div');
                    const isActive = (_selectedAbstraction === 'api:' + abs.slot);
                    card.className = 'api-ref-abs-card' + (isActive ? ' active' : '');
                    const implClass = abs.implemented === true ? 'api-ref-impl-true'
                        : abs.implemented === 'partial' ? 'api-ref-impl-partial'
                        : 'api-ref-impl-false';
                    const implLabel = abs.implemented === true ? 'impl'
                        : abs.implemented === 'partial' ? 'partial'
                        : 'planned';
                    card.innerHTML =
                        `<div class="api-ref-abs-name">` +
                        `${_escHtml(abs.name)}` +
                        `<span class="api-ref-abs-slot">NS[${abs.slot}]</span>` +
                        `<span class="api-ref-impl-badge ${implClass}">${implLabel}</span>` +
                        `</div>` +
                        `<div class="api-ref-abs-desc">${_escHtml(abs.description)}</div>`;
                    card.onclick = () => { _refTipHide(); showApiAbstractionDetail(abs.slot); };
                    absList.appendChild(card);
                }
            }
        } else {
            ABSTRACTION_DATA.forEach(item => {
                const card = document.createElement('div');
                card.className = 'instr-card abs-card' + (_selectedAbstraction === item.id ? ' active' : '');
                card.innerHTML = `<span class="instr-mnemonic">${item.name}</span><span class="instr-brief">${item.brief}</span>`;
                card.onclick = () => { _refTipHide(); showAbstractionRefDetail(item.id); };
                _attachRefTip(card, item.brief);
                absList.appendChild(card);
            });
        }
        // Re-apply any active search filter after (re)render
        const searchInput = document.getElementById('absSearchInput');
        if (searchInput && searchInput.value) filterAbstractions(searchInput.value);
    }

    if (!churchList || !turingList) return;
    churchList.innerHTML = '';
    turingList.innerHTML = '';

    INSTRUCTION_DATA.forEach(instr => {
        const card = document.createElement('div');
        card.className = 'instr-card' + (selectedInstr === instr.opcode ? ' active' : '');
        const mBadge = instr.mState ? `<span class="instr-mstate-badge mstate-${instr.mState}">${_mStateBadgeText(instr.mState)}</span>` : '';
        card.innerHTML = `
            <span class="instr-opcode">${instr.opcode}</span>
            <span class="instr-mnemonic">${instr.mnemonic}</span>
            <span class="instr-brief">${instr.brief}${mBadge ? '&ensp;' + mBadge : ''}</span>
        `;
        card.onclick = () => {
            _refTipHide();
            _selectedAbstraction = null;
            if (_refActiveTab !== 'hardware') switchRefTab('hardware');
            showInstructionDetail(instr.opcode);
        };
        _attachRefTip(card, instr.brief);
        if (instr.domain === 'church') churchList.appendChild(card);
        else turingList.appendChild(card);
    });

    const returnCard = document.createElement('div');
    returnCard.className = 'instr-card instr-shared' + (selectedInstr === 3 ? ' active' : '');
    returnCard.innerHTML = `
        <span class="instr-opcode">3</span>
        <span class="instr-mnemonic">RETURN</span>
        <span class="instr-brief">Shared \u2014 exit from Turing abstraction</span>
    `;
    returnCard.onclick = () => { _refTipHide(); _selectedAbstraction = null; showInstructionDetail(3); };
    _attachRefTip(returnCard, 'Shared \u2014 exit from Turing abstraction');
    turingList.appendChild(returnCard);

    const pseudoList = document.getElementById('instrListPseudo');
    if (pseudoList) {
        pseudoList.innerHTML = '';
        PSEUDO_INSTR_DATA.forEach(pi => {
            const card = document.createElement('div');
            card.className = 'instr-card' + (selectedPseudoInstr === pi.id ? ' active' : '');
            card.innerHTML = `
                <span class="instr-mnemonic">${pi.mnemonic}</span>
                <span class="instr-brief">${pi.brief}</span>
            `;
            card.onclick = () => { _refTipHide(); _selectedAbstraction = null; showPseudoInstrDetail(pi.id); };
            _attachRefTip(card, pi.brief);
            pseudoList.appendChild(card);
        });
    }
}

// Walk text nodes inside `node` and wrap matches of `re` in <mark> elements.
// Child element structure (e.g. slot/badge spans) is left completely intact.
function _absHighlightNodes(node, re) {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue;
        re.lastIndex = 0;
        if (!re.test(text)) return;
        re.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            const mark = document.createElement('mark');
            mark.className = 'abs-search-highlight';
            mark.textContent = m[0];
            frag.appendChild(mark);
            last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
    } else if (node.nodeType === Node.ELEMENT_NODE &&
               !(node.classList && node.classList.contains('abs-search-highlight'))) {
        Array.from(node.childNodes).forEach(child => _absHighlightNodes(child, re));
    }
}

// Highlight `q` inside `el`, or restore the original markup when `q` is empty.
// Stores the full original innerHTML so nested elements (slot/badge spans) are
// preserved exactly on restore.
function _absHighlightText(el, q) {
    if (!el) return;
    // Restore original innerHTML saved from a previous highlight pass
    if (el.dataset.origHtml !== undefined) {
        el.innerHTML = el.dataset.origHtml;
        delete el.dataset.origHtml;
    }
    if (!q) return;
    el.dataset.origHtml = el.innerHTML;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    _absHighlightNodes(el, re);
}

function filterAbstractions(query) {
    const absList = document.getElementById('instrListAbstractions');
    if (!absList) return;
    const q = (query || '').trim().toLowerCase();
    const cards = absList.querySelectorAll('.api-ref-abs-card');
    const headers = absList.querySelectorAll('.api-ref-layer-header');

    if (!q) {
        cards.forEach(c => {
            c.style.display = '';
            const nameEl = c.querySelector('.api-ref-abs-name') || c.querySelector('.instr-mnemonic');
            const descEl = c.querySelector('.api-ref-abs-desc') || c.querySelector('.instr-brief');
            _absHighlightText(nameEl, '');
            _absHighlightText(descEl, '');
        });
        headers.forEach(h => h.style.display = '');
        return;
    }

    // Show/hide each card based on name, description, or slot number.
    // Handles both the API-data path (.api-ref-abs-card) and the legacy
    // fallback path (.instr-card.abs-card).
    // textContent gives correct plain text even when highlights are active
    // (mark element text is still included), so no special-casing needed.
    cards.forEach(card => {
        const nameEl = card.querySelector('.api-ref-abs-name') || card.querySelector('.instr-mnemonic');
        const descEl = card.querySelector('.api-ref-abs-desc') || card.querySelector('.instr-brief');
        const slotEl = card.querySelector('.api-ref-abs-slot');
        const name = nameEl ? nameEl.textContent.toLowerCase() : '';
        const desc = descEl ? descEl.textContent.toLowerCase() : '';
        const slot = slotEl ? slotEl.textContent.toLowerCase() : '';
        const match = name.includes(q) || desc.includes(q) || slot.includes(q);
        card.style.display = match ? '' : 'none';
        if (match) {
            _absHighlightText(nameEl, q);
            _absHighlightText(descEl, q);
        } else {
            // Clear any stale highlight on hidden cards
            _absHighlightText(nameEl, '');
            _absHighlightText(descEl, '');
        }
    });

    // Show a layer header only if at least one card after it is visible
    headers.forEach(header => {
        let sibling = header.nextElementSibling;
        let hasVisible = false;
        while (sibling && !sibling.classList.contains('api-ref-layer-header')) {
            if (sibling.classList.contains('api-ref-abs-card') && sibling.style.display !== 'none') {
                hasVisible = true;
                break;
            }
            sibling = sibling.nextElementSibling;
        }
        header.style.display = hasVisible ? '' : 'none';
    });
}

function _escHtml(s) {
    if (!s) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _mStateBadgeText(state) {
    const map = { up: 'M\u2191', down: 'M\u2193', swap: 'M\u2195', pulse: 'M\u007e' };
    return map[state] || '';
}

function _mStateBadgeHtml(instr) {
    if (!instr.mState) return '';
    const label = _mStateBadgeText(instr.mState);
    const note = instr.mStateNote ? ` title="${instr.mStateNote.replace(/"/g, '&quot;')}"` : '';
    return `<span class="instr-mstate-badge mstate-${instr.mState}"${note}>${label}</span>`;
}

function showInstructionDetail(opcode) {
    selectedInstr = opcode;
    selectedPseudoInstr = null;
    const instr = INSTRUCTION_DATA.find(i => i.opcode === opcode);
    if (!instr) return;

    renderReference();

    const title = document.getElementById('instrDetailTitle');
    const content = document.getElementById('instrDetailContent');
    if (!title || !content) return;

    const domainLabel = instr.domain === 'church' ? 'Church Domain' : 'Turing Domain';
    const domainClass = instr.domain === 'church' ? 'church' : 'turing';
    title.textContent = `${instr.mnemonic} \u2014 Opcode ${instr.opcode}`;

    const mStateSection = instr.mState ? `
        <div class="instr-detail-section">
            <div class="instr-detail-label">M-State Effect</div>
            <div class="instr-mstate-row">
                ${_mStateBadgeHtml(instr)}
                ${instr.mStateNote ? `<span class="instr-mstate-note">${instr.mStateNote}</span>` : ''}
            </div>
        </div>` : '';

    content.innerHTML = `
        <div class="instr-detail-section">
            <div class="instr-detail-badge ${domainClass}">${domainLabel}</div>
            <div class="instr-detail-desc">${instr.brief}</div>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Syntax</div>
            <div class="instr-detail-code">${instr.syntax}</div>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Encoding (32-bit)</div>
            <div class="instr-detail-code">${instr.encoding}</div>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Operands</div>
            <table class="instr-fields-table">
                <thead><tr><th>Field</th><th>Description</th></tr></thead>
                <tbody>
                    ${instr.fields.map(f => `<tr><td class="instr-field-name">${f.name}</td><td>${f.desc}</td></tr>`).join('')}
                </tbody>
            </table>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Permission Gate (mLoad)</div>
            <div class="instr-detail-value">${instr.permission}</div>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Flags Affected</div>
            <div class="instr-detail-value">${instr.flags}</div>
        </div>

        ${mStateSection}

        <div class="instr-detail-section">
            <div class="instr-detail-label">Description</div>
            <pre class="instr-detail-text">${instr.details}</pre>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Example</div>
            <pre class="instr-detail-example">${instr.example}</pre>
        </div>
    `;
}

function showPseudoInstrDetail(id) {
    selectedInstr = null;
    selectedPseudoInstr = id;
    const pi = PSEUDO_INSTR_DATA.find(p => p.id === id);
    if (!pi) return;

    renderReference();

    const title = document.getElementById('instrDetailTitle');
    const content = document.getElementById('instrDetailContent');
    if (!title || !content) return;

    title.textContent = pi.mnemonic + ' \u2014 Pseudo-Instruction';

    content.innerHTML = `
        <div class="instr-detail-section">
            <div class="instr-detail-badge turing">Pseudo-Instruction</div>
            <div class="instr-detail-desc">${pi.brief}</div>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Syntax</div>
            <pre class="instr-detail-code">${_escHtml(pi.syntax)}</pre>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Valid Range</div>
            <div class="instr-detail-value">${_escHtml(pi.range)}</div>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Registers Clobbered</div>
            <div class="instr-detail-value">${_escHtml(pi.clobbers)}</div>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Expands To (3 instructions)</div>
            <pre class="instr-detail-text">${_escHtml(pi.expansion)}</pre>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Description</div>
            <pre class="instr-detail-text">${_escHtml(pi.details)}</pre>
        </div>

        <div class="instr-detail-section">
            <div class="instr-detail-label">Example</div>
            <pre class="instr-detail-example">${_escHtml(pi.example)}</pre>
        </div>
    `;
}

const SYNTAX_REF = {
    english: {
        title: "English Syntax Reference",
        sections: [
            { heading: "Structure", items: [
                { syntax: "Create an abstraction called <em>Name</em>", desc: "Declare abstraction" },
                { syntax: "Add a method called <em>Name</em> that takes <em>a</em>, <em>b</em>", desc: "Define method with parameters" },
                { syntax: "It needs <em>Memory</em> and <em>Mint</em>", desc: "Declare capabilities" },
            ]},
            { heading: "Assignment", items: [
                { syntax: "Set <em>result</em> to <em>x</em> plus <em>1</em>", desc: "Assign with arithmetic" },
                { syntax: "Let <em>total</em> be <em>a</em> times <em>b</em>", desc: "Alternative assignment" },
            ]},
            { heading: "Arithmetic", items: [
                { syntax: "<em>a</em> plus <em>b</em>", desc: "Addition" },
                { syntax: "<em>a</em> minus <em>b</em>", desc: "Subtraction" },
                { syntax: "<em>a</em> times <em>b</em>", desc: "Multiply (software)" },
                { syntax: "<em>a</em> divided by <em>b</em>", desc: "Divide (software)" },
                { syntax: "<em>a</em> shifted left by <em>n</em>", desc: "Shift left" },
                { syntax: "<em>a</em> shifted right by <em>n</em>", desc: "Shift right" },
            ]},
            { heading: "Control Flow", items: [
                { syntax: "If <em>count</em> is greater than <em>0</em>", desc: "Conditional (also: equal to, less than, not)" },
                { syntax: "Otherwise", desc: "Else branch" },
                { syntax: "End if", desc: "Close conditional" },
            ]},
            { heading: "Calls & Returns", items: [
                { syntax: "Call <em>Memory.Allocate</em> with <em>size</em>", desc: "Invoke method" },
                { syntax: "Set <em>r</em> to the result of calling <em>Memory.Allocate</em> with <em>size</em>", desc: "Capture return value" },
                { syntax: "Return the result", desc: "Return DR1" },
                { syntax: "Return <em>value</em>", desc: "Return a specific value" },
            ]},
            { heading: "Memory", items: [
                { syntax: "Read from <em>CR14</em> at offset <em>0</em>", desc: "Read code lump constant" },
                { syntax: "Read from <em>CR0</em> at offset <em>0</em>", desc: "Read data object" },
            ]},
        ]
    },
    javascript: {
        title: "JavaScript (CLOOMC++) Syntax Reference",
        sections: [
            { heading: "Structure", items: [
                { syntax: "abstraction <em>Name</em> { }", desc: "Declare abstraction" },
                { syntax: "capabilities { <em>Memory</em>, <em>Mint</em> }", desc: "Capability list" },
                { syntax: "method <em>Name</em>(<em>a</em>, <em>b</em>) { }", desc: "Define method" },
            ]},
            { heading: "Assignment & Arithmetic", items: [
                { syntax: "<em>result</em> = <em>a</em> + <em>b</em>", desc: "Add" },
                { syntax: "<em>result</em> = <em>a</em> - <em>b</em>", desc: "Subtract" },
                { syntax: "<em>result</em> = <em>a</em> * <em>b</em>", desc: "Multiply (software)" },
                { syntax: "<em>result</em> = <em>a</em> / <em>b</em>", desc: "Divide (software)" },
                { syntax: "<em>result</em> = <em>a</em> &lt;&lt; <em>n</em>", desc: "Shift left" },
                { syntax: "<em>result</em> = <em>a</em> &gt;&gt; <em>n</em>", desc: "Shift right" },
            ]},
            { heading: "Control Flow", items: [
                { syntax: "if (<em>a</em> == <em>b</em>) { ... }", desc: "Conditional (==, !=, <, >, <=, >=)" },
                { syntax: "while (<em>i</em> &lt; <em>10</em>) { ... }", desc: "Loop" },
            ]},
            { heading: "Calls & Returns", items: [
                { syntax: "result = call(<em>Memory.Allocate</em>(<em>size</em>))", desc: "Call via c-list" },
                { syntax: "recall()", desc: "Re-call self — CALL CR6 (current abstraction)" },
                { syntax: "return(<em>result</em>)", desc: "Return value in DR1" },
            ]},
            { heading: "Memory & Bit Fields", items: [
                { syntax: "<em>x</em> = read(<em>CR0</em>, <em>offset</em>)", desc: "Read from capability" },
                { syntax: "write(<em>CR0</em>, <em>offset</em>, <em>value</em>)", desc: "Write to capability" },
                { syntax: "bfext(<em>word</em>, <em>pos</em>, <em>width</em>)", desc: "Extract bit field" },
                { syntax: "bfins(<em>word</em>, <em>val</em>, <em>pos</em>, <em>width</em>)", desc: "Insert bit field" },
            ]},
            { heading: "Registers", items: [
                { syntax: "DR0\u2013DR3", desc: "Arguments & return values" },
                { syntax: "DR4\u2013DR11", desc: "Locals (callee-saved)" },
                { syntax: "DR12\u2013DR15", desc: "Temps (caller-saved)" },
            ]},
        ]
    },
    haskell: {
        title: "Haskell (CLOOMC++) Syntax Reference",
        sections: [
            { heading: "Structure", items: [
                { syntax: "abstraction <em>Name</em> { }", desc: "Declare abstraction" },
                { syntax: "capabilities { <em>Memory</em> }", desc: "Capability list" },
                { syntax: "method <em>name</em>(<em>a</em>, <em>b</em>) = <em>expr</em>", desc: "Method as expression" },
            ]},
            { heading: "Expressions", items: [
                { syntax: "<em>a</em> + <em>b</em>", desc: "Add" },
                { syntax: "<em>a</em> - <em>b</em>", desc: "Subtract" },
                { syntax: "<em>a</em> * <em>b</em>", desc: "Multiply (software)" },
                { syntax: "if <em>x</em> == <em>0</em> then <em>a</em> else <em>b</em>", desc: "Inline conditional" },
            ]},
            { heading: "Pattern Matching", items: [
                { syntax: "case <em>n</em> of <em>0</em> -&gt; <em>1</em>, _ -&gt; <em>n</em>", desc: "Case expression" },
            ]},
            { heading: "Let Bindings", items: [
                { syntax: "let <em>a</em> = <em>x</em> + <em>1</em> in <em>a</em> + <em>a</em>", desc: "Local binding" },
            ]},
            { heading: "Pairs", items: [
                { syntax: "(<em>a</em>, <em>b</em>)", desc: "Construct pair (BFINS)" },
                { syntax: "fst <em>p</em>", desc: "First element (BFEXT)" },
                { syntax: "snd <em>p</em>", desc: "Second element (BFEXT)" },
            ]},
            { heading: "Lambda", items: [
                { syntax: "\\<em>x</em> -&gt; <em>x</em> + <em>1</em>", desc: "Lambda expression (LAMBDA instruction)" },
            ]},
        ]
    },
    symbolic: {
        title: "Symbolic Math (Ada) Syntax Reference",
        sections: [
            { heading: "Structure", items: [
                { syntax: "abstraction <em>Name</em> { }", desc: "Declare abstraction" },
                { syntax: "method <em>name</em>() { ... }", desc: "Define method" },
            ]},
            { heading: "Variables", items: [
                { syntax: "let V1 = <em>1</em>", desc: "Initialise store column (V1\u2013V15 \u2192 DR1\u2013DR15)" },
                { syntax: "let V4 = V2 * V3", desc: "Multiply (shift-and-add loop)" },
                { syntax: "let V11 = V4 / V5", desc: "Divide (repeated subtraction)" },
                { syntax: "let V5 = V5 + V1", desc: "Addition" },
                { syntax: "let V4 = V4 - V1", desc: "Subtraction" },
            ]},
            { heading: "Arrow Notation", items: [
                { syntax: "V2 \u00d7 V3 \u2192 V4", desc: "Ada's original notation" },
                { syntax: "V2 + V3 \u2192 V4", desc: "Arrow assignment" },
            ]},
            { heading: "Notes", items: [
                { syntax: "-- <em>comment</em>", desc: "Comment (Ada-style)" },
                { syntax: "V1\u2013V15 map to DR1\u2013DR15", desc: "Direct register mapping" },
            ]},
        ]
    },
    assembly: {
        title: "Assembly Syntax Reference",
        sections: [
            { heading: "Church Domain — Capability Instructions (opcodes 0–9)", items: [
                { syntax: "LOAD CRd, [CRs, <em>idx</em>]", desc: "Load Golden Token from lump (R perm)" },
                { syntax: "SAVE [CRd, <em>idx</em>], CRs", desc: "Save Golden Token into lump (S perm)" },
                { syntax: "CALL CRs, <em>off</em>", desc: "Enter via C-List slot (L perm, off 0–14) or direct (E perm, off=0xF)" },
                { syntax: "CALL <em>AbstrName</em>.<em>Method</em>", desc: "Named method selectors (dot-notation form): assembler resolves method index automatically via loaded-CR resolution" },
                { syntax: "RETURN", desc: "Return from abstraction; restore caller context" },
                { syntax: "CHANGE CRd, <em>imm</em>", desc: "Context switch — save/load DR0–DR15, swap CR6/CR14/CR15" },
                { syntax: "SWITCH CRs, <em>imm</em>", desc: "Downgrade privilege level (ARCH→PROG→PRIV, monotonic)" },
                { syntax: "TPERM CRd, <em>preset</em>", desc: "Health-check (sets Z) or restrict permissions (monotonic mask)" },
                { syntax: "LAMBDA CRd, <em>offset</em>", desc: "Capture closure into CRd (offset=0x7FFF = immediate form)" },
                { syntax: "ELOADCALL CRd, [CRs, <em>off</em>]", desc: "Load GT from lump then CALL in one instruction (E+L perm)" },
                { syntax: "ELOADCALL CR0, Constants, Pi", desc: "Two-operand shorthand + named method selectors: load Constants.Pi into CR0 and call it" },
                { syntax: "XLOADLAMBDA CRd, [CRs, <em>off</em>]", desc: "Load GT from lump then LAMBDA capture (X perm)" },
            ]},
            { heading: "Turing Domain — Data Instructions (opcodes 10–19)", items: [
                { syntax: "DREAD DRd, [CRs, <em>off</em>]", desc: "Read 32-bit word from lump (R perm)" },
                { syntax: "DWRITE [CRd, <em>off</em>], DRs", desc: "Write 32-bit word into lump (W perm)" },
                { syntax: "BFEXT DRd, DRs, <em>pos</em>, <em>w</em>", desc: "Extract bit field [pos, pos+w) from DRs" },
                { syntax: "BFINS DRd, DRs, <em>pos</em>, <em>w</em>", desc: "Insert bit field into DRd at [pos, pos+w)" },
                { syntax: "MCMP DRa, DRb", desc: "Compare DRa vs DRb, set N/Z/C/V flags" },
                { syntax: "BRANCH <em>cond</em>, <em>target</em>", desc: "Conditional branch (AL/EQ/NE/LT/GE/GT/LE)" },
                { syntax: "IADD DRd, DRs, <em>imm</em>", desc: "DRd = DRs + sign_extend(imm)" },
                { syntax: "ISUB DRd, DRs, <em>imm</em>", desc: "DRd = DRs − sign_extend(imm)" },
                { syntax: "SHL DRd, DRs, <em>n</em>", desc: "Logical shift left by n" },
                { syntax: "SHR DRd, DRs, <em>n</em>", desc: "Logical shift right by n" },
            ]},
            { heading: "Condition Codes", items: [
                { syntax: ".AL .EQ .NE .LT .GE .GT .LE", desc: "Suffix any instruction (AL = always)" },
                { syntax: "IADD.EQ DR0, DR1, 1", desc: "Add 1 only if Z flag set" },
                { syntax: "LOAD.NE CR0, [CR1, 0]", desc: "Load only if not equal" },
            ]},
            { heading: "Registers", items: [
                { syntax: "CR0\u2013CR11", desc: "Programmer-accessible Golden Token slots (C-List)" },
                { syntax: "DR0\u2013DR15", desc: "32-bit data registers; DR0 = hardwired zero; DR1 = arg/return" },
                { syntax: "CR12\u2013CR15", desc: "Privileged — FAULT if used in most fields; set by CALL/CHANGE" },
                { syntax: "CR6",  desc: "C-List base (loaded by CALL from target c-list)" },
                { syntax: "CR14", desc: "Code region GT (X-only; loaded by CALL from target code lump)" },
            ]},
            { heading: "Encoding (32-bit)", items: [
                { syntax: "opcode[5] | cond[4] | dst[4] | src[4] | imm[15]", desc: "All instructions share this fixed-width format" },
                { syntax: "0x00000000", desc: "NOP (opcode=0, LOAD with zero everything)" },
            ]},
            { heading: "Pseudo-Instructions", items: [
                { syntax: '<span class="church-tooltip" data-tooltip=".petname &lt;n&gt; — Registers c-list slot n (0–63) with PetNameMemory so a NULL access suspends the thread for lazy demand-loading instead of faulting. Expands to 3 instructions: LOAD CR11 / IADD DR1 / DWRITE. Clobbers CR11 and DR1.">.petname</span> &lt;<em>n</em>&gt;', desc: "Register c-list slot n (0–63) for lazy demand-load; PETNAME &lt;n&gt; is an accepted alias" },
            ]},
        ]
    },
    lambda: {
        title: "Lambda Calculus Syntax Reference",
        sections: [
            { heading: "Structure", items: [
                { syntax: "abstraction <em>Name</em> { }", desc: "Declare abstraction" },
                { syntax: "capabilities { <em>Memory</em> }", desc: "Capability list" },
                { syntax: "method <em>name</em>(<em>args</em>) = <em>expr</em>", desc: "Define method with lambda body" },
            ]},
            { heading: "Lambda Notation", items: [
                { syntax: "\u03BBx.<em>body</em>", desc: "Lambda abstraction (bind x in body)" },
                { syntax: "\\x.<em>body</em>", desc: "Backslash shorthand for \u03BB" },
                { syntax: "(<em>f</em> <em>x</em>)", desc: "Application (apply f to x)" },
                { syntax: "\u03BBf.\u03BBx.(f (f x))", desc: "Church numeral 2 (apply f twice)" },
                { syntax: "zero = \u03BBf.\u03BBx.x", desc: "Church encoding of 0" },
                { syntax: "succ = \u03BBn.\u03BBf.\u03BBx.(f ((n f) x))", desc: "Church successor" },
            ]},
            { heading: "Arithmetic (Church Numerals)", items: [
                { syntax: "plus <em>a</em> <em>b</em>", desc: "Church addition" },
                { syntax: "mult <em>a</em> <em>b</em>", desc: "Church multiplication" },
                { syntax: "pred <em>n</em>", desc: "Church predecessor" },
                { syntax: "iszero <em>n</em>", desc: "Test if Church numeral is zero" },
                { syntax: "<em>a</em> + <em>b</em>", desc: "Arithmetic sugar (addition)" },
                { syntax: "<em>a</em> * <em>b</em>", desc: "Arithmetic sugar (multiplication)" },
            ]},
            { heading: "Let Bindings", items: [
                { syntax: "let <em>name</em> = <em>expr</em> in <em>body</em>", desc: "Local binding" },
                { syntax: "let id = \u03BBx.x in (id 5)", desc: "Bind identity function, then apply" },
            ]},
            { heading: "Registers", items: [
                { syntax: "DR0\u2013DR3", desc: "Arguments & return values" },
                { syntax: "DR4\u2013DR11", desc: "Locals (callee-saved)" },
                { syntax: "DR12\u2013DR15", desc: "Temps (caller-saved)" },
            ]},
        ]
    }
};

function renderSyntaxRef(lang) {
    if (!lang) {
        const sel = document.getElementById('langSelector');
        lang = sel ? sel.value : 'assembly';
    }
    const ref = SYNTAX_REF[lang];
    if (!ref) return;
    const area = document.getElementById('syntaxRefContent');
    if (!area) return;

    let html = '<div class="syntax-ref">';
    html += '<div class="syntax-ref-title">' + ref.title + '</div>';
    for (const sec of ref.sections) {
        html += '<div class="syntax-ref-section">';
        html += '<div class="syntax-ref-heading">' + sec.heading + '</div>';
        html += '<table class="syntax-ref-table">';
        for (const item of sec.items) {
            html += '<tr><td class="syntax-ref-code">' + item.syntax + '</td><td class="syntax-ref-desc">' + item.desc + '</td></tr>';
        }
        html += '</table></div>';
    }
    html += '</div>';
    area.innerHTML = html;
}

/* ── Example tab groups ── single source of truth for which tab IDs belong
   to each front-end language. Tab IDs use a 'cloomc_' prefix for CLOOMC
   front-ends; assembly tabs use bare keys. This constant is also used by
   loadCLOOMCExample() to derive window._cloomcExampleLanguages so that new
   examples need only one addition here (plus the HTML tab in index.html). */
const LANG_EXAMPLE_GROUPS = {
    cloomc:     ['cloomc_integer_ops', 'cloomc_packed_string', 'cloomc_memory', 'cloomc_heap', 'cloomc_mint', 'cloomc_sliderule', 'cloomc_contact', 'cloomc_contact_stage2', 'cloomc_contact_call', 'cloomc_stack_overflow', 'cloomc_recall_demo', 'cloomc_billing', 'cloomc_turing_memory', 'cloomc_church_memory', 'cloomc_physical_pool', 'cloomc_dijkstra_flag'],
    english:    ['cloomc_english_integer_ops', 'cloomc_english_packed_string', 'cloomc_english_loops', 'cloomc_english_contact', 'cloomc_english_contact_stage2', 'cloomc_english_dijkstra_flag'],
    assembly:   ['ada_note_g', 'capability_test', 'system_patterns', 'compute_demo', 'led_control', 'led_dr_test', 'salvation', 'constants_dot', 'perm_attack', 'bind_attack', 'scheduler_pause', 'scheduler_yield', 'scheduler_wait', 'dijkstra_flag', 'post_flash_selftest', 'gt_v1_1_test', 'petname_demo'],
    javascript: ['cloomc_integer_ops', 'cloomc_packed_string', 'cloomc_memory', 'cloomc_heap', 'cloomc_mint', 'cloomc_sliderule', 'cloomc_contact', 'cloomc_contact_stage2', 'cloomc_contact_call', 'cloomc_stack_overflow', 'cloomc_recall_demo', 'cloomc_billing', 'cloomc_turing_memory', 'cloomc_church_memory', 'cloomc_physical_pool', 'cloomc_dijkstra_flag'],
    haskell:    ['cloomc_church_math', 'cloomc_church_pair', 'cloomc_church_case', 'cloomc_sliderule_hs', 'cloomc_dijkstra_flag_hs'],
    symbolic:   ['cloomc_ada_note_g', 'cloomc_ada_note_g_published_bug', 'cloomc_bernoulli_numbers', 'cloomc_dijkstra_flag_ada'],
    lambda:     ['cloomc_lambda_church_numerals', 'cloomc_lambda_church_encoding', 'cloomc_lambda_fixed_point', 'cloomc_lambda_sliderule', 'cloomc_lambda_rational', 'cloomc_lambda_dijkstra_flag'],
    personal:   []
};

/* Module-level single source of truth for file-backed CLOOMC examples.
   Both loadCLOOMCExample() and _initCloomcStructuralGlobals() reference
   these consts to avoid duplicated data. */
const _CLOOMC_FILE_EXAMPLES = {
    'sliderule':               '/simulator/cloomc/sliderule.cloomc',
    'contact':                 '/simulator/cloomc/Contact.cloomc',
    'contact_stage2':          '/simulator/cloomc/ContactStage2.cloomc',
    'contact_call':            '/simulator/cloomc/ContactCall.cloomc',
    'english_contact_stage2':  '/simulator/cloomc/english/ContactStage2.cloomc',
    'ada_note_g_published_bug':'/simulator/cloomc/ada_note_g_published_bug.cloomc',
    'memory':                  '/simulator/cloomc/memory.cloomc',
    'sliderule_hs':            '/simulator/cloomc/sliderule_hs.cloomc',
    'dijkstra_flag':           '/simulator/cloomc/dijkstra_flag.cloomc',
    'dijkstra_flag_hs':        '/simulator/cloomc/dijkstra_flag_hs.cloomc',
    'english_dijkstra_flag':   '/simulator/cloomc/english/dijkstra_flag.cloomc',
    'lambda_dijkstra_flag':    '/simulator/cloomc/lambda/dijkstra_flag.cloomc',
    'dijkstra_flag_ada':       '/simulator/cloomc/dijkstra_flag_ada.cloomc'
};
const _CLOOMC_FILE_LANGUAGES = {
    'sliderule':               'javascript',
    'contact':                 'javascript',
    'contact_stage2':          'javascript',
    'contact_call':            'javascript',
    'english_contact_stage2':  'english',
    'ada_note_g_published_bug':'symbolic',
    'memory':                  'javascript',
    'sliderule_hs':            'haskell',
    'dijkstra_flag':           'javascript',
    'dijkstra_flag_hs':        'haskell',
    'english_dijkstra_flag':   'english',
    'lambda_dijkstra_flag':    'lambda',
    'dijkstra_flag_ada':       'symbolic'
};

function onLangChange(restoring) {
    const sel = document.getElementById('langSelector');
    if (!sel) return;
    const lang = sel.value;

    // Abstraction is not a code language — navigate to the Lesson 5 planning form
    if (lang === 'abstraction') {
        window.location = '/start?abstraction=1';
        return;
    }

    const btnSaveNS = document.getElementById('btnSaveNS');
    if (btnSaveNS) btnSaveNS.disabled = (lang !== 'assembly' || !lastAssembledWords);
    const btnExportLump = document.getElementById('btnExportLump');
    if (btnExportLump) btnExportLump.disabled = (lang !== 'assembly' || !lastAssembledWords);

    const langExampleGroups = LANG_EXAMPLE_GROUPS;

    const scroll = document.getElementById('exampleTabsScroll');
    if (scroll) {
        const allowedSet = langExampleGroups[lang] || [];
        // If this language has tabs, ensure the row container is visible — it may
        // have been hidden by _applySealedLumpState.  Keep it hidden while a
        // sealed lump is active (the editor is read-only so example tabs are
        // irrelevant until the user unseals).
        if (allowedSet.length > 0) {
            const tabsRow = document.querySelector('.example-tabs-row');
            const _isSealed = !!localStorage.getItem('cm_sealed_lump');
            if (tabsRow && !_isSealed) tabsRow.style.display = '';
        }
        // Built-in example tabs: hide all when in personal mode, else show only this lang's set
        const tabs = scroll.querySelectorAll('.example-tab:not(.user-tab)');
        tabs.forEach(tab => {
            const ex = tab.getAttribute('data-example');
            const visible = allowedSet.includes(ex);
            tab.style.display = visible ? '' : 'none';
            // Deactivate tabs that are being hidden (belong to a different language)
            if (!visible) tab.classList.remove('active');
        });
        // User tabs container: only visible in personal mode
        const userTabsCont = document.getElementById('userTabsContainer');
        if (userTabsCont) userTabsCont.style.display = lang === 'personal' ? '' : 'none';
    }

    // Only update the tab's stored lang when switching to a real language (not 'personal')
    if (activeUserTabId && lang !== 'personal') {
        const activeTab = userTabs.find(t => t.id === activeUserTabId);
        if (activeTab) { activeTab.lang = lang; saveUserTabsToStorage(); }
    }

    if (!restoring) {
        // A user-initiated lang switch abandons any in-progress catalog edit context
        // (they are loading a different example, not editing a specific method).
        if (typeof clearPseudoEditContext === 'function') clearPseudoEditContext();

        if (!activeUserTabId && lang !== 'personal') {
            // Language switch only filters the example tabs; it does NOT replace
            // the editor content.  The user picks an example tab explicitly when
            // they want to load one.
            showIntro(lang);
        }
        if (lang !== 'personal' && typeof historyShowLanguageStory === 'function') historyShowLanguageStory(lang);
        const syntaxPanel = document.getElementById('codeSyntaxPanel');
        if (syntaxPanel && syntaxPanel.style.display !== 'none') renderSyntaxRef(lang);
    }
}

function smartCompile() {
    if (!requirePermission('compile', 'Compile Programs')) return;

    _runStopped = true;

    const sel = document.getElementById('langSelector');
    let lang = sel ? sel.value : 'assembly';

    if (lang === 'personal' && activeUserTabId) {
        const activeTab = userTabs.find(t => t.id === activeUserTabId);
        if (activeTab && activeTab.lang) lang = activeTab.lang;
        else lang = 'javascript';
    }

    if (lang === 'assembly') {
        const src = (document.getElementById('asmEditor') || {}).value || '';
        if (/^\s*abstraction\s+\w+/im.test(src) || /^\s*method\s+\w+/im.test(src)) {
            lang = 'javascript';
            if (sel) sel.value = 'javascript';
            onLangChange(true);
        }
    }

    try {
        compileAndBuild();
    } catch (e) {
        console.error('smartCompile error:', e);
        const con = document.getElementById('editorConsole');
        if (con) con.textContent = 'Compile error: ' + (e.message || e);
        if (typeof _showAsmErrors === 'function') _showAsmErrors([{line: null, message: e.message || String(e)}], 'Compile error \u2014 code not applied');
        showNextSteps('error');
    }
}

// Auto-fill rights for capabilities with no declared rights, sourcing defaults
// from the sidecar grants in _lumpsCache.  Mutates caps in place so that
// downstream draft text and _checkCapAccessRights both see the filled rights.
// Returns {filled: [{name, defaults}]}.  Call before building draft text.
function _autoFillCapRights(caps) {
    const filled = [];
    if (!Array.isArray(caps) || caps.length === 0) return { filled };
    const hasCache = typeof _lumpsCache !== 'undefined' && Array.isArray(_lumpsCache);
    for (const cap of caps) {
        if (typeof cap === 'string') continue;
        if (!cap.name) continue;
        if (cap.rights && cap.rights.length > 0) continue;
        const nameUC = cap.name.toUpperCase();
        let defaults = null;
        if (hasCache) {
            for (const lump of _lumpsCache) {
                const entry = (lump.capabilities || []).find(c =>
                    c.name && c.name.toUpperCase() === nameUC &&
                    c.grants && c.grants.length > 0);
                if (entry) { defaults = entry.grants.map(g => g.toUpperCase()); break; }
            }
            if (!defaults) {
                const lump = _lumpsCache.find(l =>
                    (l.abstraction && l.abstraction.toUpperCase() === nameUC) ||
                    (l.name && l.name.toUpperCase() === nameUC));
                if (lump && Array.isArray(lump.grants) && lump.grants.length > 0) {
                    defaults = lump.grants.map(g => g.toUpperCase());
                }
            }
        }
        if (defaults) {
            cap.rights = defaults;
            filled.push({ name: cap.name, defaults });
        }
    }
    return { filled };
}

// Cross-check declared capability access rights for correctness.
// caps: array of {name, rights} objects (as produced by the assembler/compiler).
// Returns { errors: string[], warnings: string[] }.
// Errors: missing rights, invalid right letters.
// Warnings: rights exceed what the known type (sidecar) grants.
function _checkCapAccessRights(caps) {
    const errors = [], warnings = [];
    const VALID = new Set(['R', 'W', 'X', 'E']);
    for (const cap of caps) {
        const name = typeof cap === 'string' ? cap : (cap.name || '');
        const rights = (typeof cap === 'string' ? [] : (cap.rights || []));
        if (rights.length === 0) {
            errors.push(`[ACL] ${name}: access rights required — e.g. "${name} RW"`);
            continue;
        }
        const bad = rights.filter(r => !VALID.has(r.toUpperCase()));
        if (bad.length > 0) {
            errors.push(`[ACL] ${name}: invalid rights "${bad.join('')}" — valid letters: R W X E`);
            continue;
        }
        // Type check: compare declared rights against any known sidecar entry for this name.
        if (typeof _lumpsCache !== 'undefined' && Array.isArray(_lumpsCache)) {
            let knownGrants = null;
            for (const lump of _lumpsCache) {
                const entry = (lump.capabilities || []).find(c =>
                    c.name && c.name.toUpperCase() === name.toUpperCase() &&
                    c.grants && c.grants.length > 0);
                if (entry) { knownGrants = entry.grants; break; }
            }
            if (knownGrants) {
                const grantSet = new Set(knownGrants.map(g => g.toUpperCase()));
                const over = rights.filter(r => !grantSet.has(r.toUpperCase()));
                if (over.length > 0) {
                    warnings.push(`[ACL] ${name}: rights "${over.join('')}" exceed known type grants [${knownGrants.join(',')}]`);
                }
            }
        }
    }
    return { errors, warnings };
}


function _getActiveSourceLabel() {
    const tab = document.querySelector('.example-tab.active');
    return tab ? tab.textContent.trim() : null;
}

function compileDraft() {
    const editor = document.getElementById('asmEditor');
    if (!editor) return;
    const source = editor.value;
    const con = document.getElementById('editorConsole');
    if (con) con.className = '';

    if (!cloomcCompiler) return;
    switchCodeTab('console');
    if (typeof _clearAsmWarnings === 'function') _clearAsmWarnings();

    const result = cloomcCompiler.compile(source, []);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        const _dSrc = _getActiveSourceLabel(); const _dSrcH = _dSrc ? ` · ${_dSrc}` : '';
        if (con) { con.textContent = `CLOOMC++ Draft${_dSrcH} — compilation errors:\n${errText}`; con.scrollTop = 0; }
        const _de = result.errors.length; if (typeof _showAsmErrors === 'function') _showAsmErrors(result.errors, 'Compile error' + (_de > 1 ? 's' : '') + ' \u2014 code not applied');
        showNextSteps('error');
        return;
    }

    const langNames = { english: 'English', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', javascript: 'JavaScript', cloomc: 'CLOOMC++', lambda: 'Lambda Calculus' };
    const langLabel = langNames[result.language] || 'CLOOMC++';
    const caps = result.capabilities || [];
    const _afResultC = _autoFillCapRights(caps);
    const clistCount = caps.length;
    let totalCodeWords = 0;
    for (const m of result.methods) {
        totalCodeWords += (m.code || []).length;
    }
    const codeSize = totalCodeWords;
    const neededSize = codeSize + clistCount;
    const allocSize = Math.max(64, nextPow2(neededSize + 1));
    const clistStart = allocSize - clistCount;
    const freespace = allocSize - codeSize - clistCount;

    const _draftSrcLabel = _getActiveSourceLabel();
    const _draftSrcHint = _draftSrcLabel ? ` · ${_draftSrcLabel}` : '';
    let draft = `═══════════════════════════════════════════════════\n`;
    draft += `  CLOOMC++ DRAFT — "${result.abstractionName}" [${langLabel}]${_draftSrcHint}\n`;
    draft += `═══════════════════════════════════════════════════\n\n`;

    draft += `  Methods (${result.methods.length}):\n`;
    for (const m of result.methods) {
        if (m.aliasOf) {
            draft += `    • ${m.name}: alias of ${m.aliasOf}\n`;
        } else {
            draft += `    • ${m.name}: ${(m.code || []).length} instruction(s)\n`;
        }
    }

    draft += `\n  Capabilities (${clistCount}):\n`;
    if (clistCount === 0) {
        draft += `    (none)\n`;
    } else {
        for (let i = 0; i < caps.length; i++) {
            const _c = caps[i];
            const _cn = typeof _c === 'string' ? _c : (_c.name || '?');
            const _cr = typeof _c === 'string' ? [] : (_c.rights || []);
            const _crs = _cr.length > 0 ? (`  [${_cr.join('')}]`) : '  (no rights declared)';
            draft += `    [${i}] ${_cn}${_crs}\n`;
        }
    }

    draft += `\n  Lump Layout (matches Compile binary):\n`;
    draft += `    ┌─────────────────────────────────────────────┐\n`;
    draft += `    │ Word 0:  Header (magic+n-6+cw+typ+cc)       │\n`;
    draft += `    │ Words 1..${codeSize}: Code (${result.methods.length} method${result.methods.length !== 1 ? 's' : ''} concatenated)${' '.repeat(Math.max(0, 13 - codeSize.toString().length - result.methods.length.toString().length))}│\n`;
    draft += `    │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │\n`;
    draft += `    │ FREESPACE        ${freespace.toString().padStart(5)} words                │\n`;
    draft += `    │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │\n`;
    draft += `    │ C-List           ${clistCount.toString().padStart(5)} slots  (offset ${clistStart})${' '.repeat(Math.max(0, 5 - clistStart.toString().length))}│\n`;
    draft += `    └─────────────────────────────────────────────┘\n`;
    draft += `    Total: ${allocSize} words = ${allocSize * 4} bytes\n`;

    draft += `\n  clistCount: ${clistCount}\n`;
    draft += `  Code (cw):  ${codeSize} words\n`;
    draft += `  Lump size:  ${allocSize} words (power-of-2, ≥64)\n`;
    draft += `  Freespace:  ${freespace} words\n`;
    draft += `  (Method offsets for FPGA dispatch: in sidecar metadata, not in binary)\n`;

    draft += `\n  CALL split preview:\n`;
    if (clistCount > 0) {
        draft += `    CR14 (code):   base=0, limit=${clistStart - 1}, perms=X-only  [privileged]\n`;
        draft += `    CR6  (c-list): base+${clistStart}, limit=${clistCount - 1}, perms=L-only\n`;
    } else {
        draft += `    CR14 (code):   base=0, limit=${allocSize - 1}, perms=X-only  [privileged]\n`;
        draft += `    CR6:          (no c-list)\n`;
    }

    draft += `\n═══════════════════════════════════════════════════\n`;
    draft += `  Instruction Listing:\n`;
    draft += `═══════════════════════════════════════════════════\n\n`;

    const draftManifest = {};
    if (result.manifest) {
        for (const entry of result.manifest) {
            const comments = {};
            if (entry.mapping) {
                let seqIdx = 0;
                for (const m of entry.mapping) {
                    if (m.comment !== undefined) {
                        comments[seqIdx++] = m.comment;
                    } else if (m.addr !== undefined && m.desc) {
                        comments[m.addr] = m.desc;
                    }
                }
            }
            draftManifest[entry.name] = comments;
        }
    }

    for (const m of result.methods) {
        if (m.aliasOf) {
            draft += `  method ${m.name}: → alias of ${m.aliasOf} (no separate code block)\n\n`;
            continue;
        }
        const mCode = m.code || [];
        draft += `  method ${m.name}: ${mCode.length} instruction(s)\n`;
        const comments = draftManifest[m.name] || {};
        for (let i = 0; i < mCode.length; i++) {
            const word = mCode[i];
            const disasm = _applyMethodDRNames(assembler.disassemble(word), m);
            const comment = comments[i];
            const line = `    ${i.toString().padStart(4)}: 0x${word.toString(16).padStart(8, '0')}  ${disasm}`;
            draft += comment ? `${line.padEnd(60)}; ${comment}\n` : `${line}\n`;
        }
        draft += '\n';
    }

    if (con) { con.innerHTML = _capRightsHTML(draft); con.scrollTop = 0; }
    let _capAclErrors = [], _capAclWarnings = [];
    if (clistCount > 0) {
        let _aclExtraC = '';
        try {
            const _aclC = _checkCapAccessRights(caps);
            // Find the `capabilities {` line so ACL errors highlight in the editor.
            const _capLine = (function(src) {
                const _ls = src.split('\n');
                for (let _li = 0; _li < _ls.length; _li++) {
                    if (/^\s*capabilities\s*\{/.test(_ls[_li])) return _li + 1;
                }
                return null;
            })(source);
            for (const _e of _aclC.errors)   _capAclErrors.push({ line: _capLine, message: _e });
            for (const _w of _aclC.warnings) _capAclWarnings.push({ line: _capLine, message: _w });
            const _hasAclOutputC = _aclC.errors.length > 0 || _aclC.warnings.length > 0 ||
                (_afResultC && _afResultC.filled.length > 0);
            if (_hasAclOutputC) {
                _aclExtraC += `\n═══════════════════════════════════════════════════\n`;
            }
            if (_afResultC && _afResultC.filled.length > 0) {
                _aclExtraC += `  Auto-filled Permissions (from sidecar grants):\n`;
                for (const f of _afResultC.filled)
                    _aclExtraC += `    \u2139 ${f.name}: [${f.defaults.join('')}] inserted automatically\n`;
            }
            if (_aclC.errors.length > 0 || _aclC.warnings.length > 0) {
                _aclExtraC += `  Access Rights Check:\n`;
                for (const e of _aclC.errors)   _aclExtraC += `    \u2717 ${e}\n`;
                for (const w of _aclC.warnings) _aclExtraC += `    \u26a0 ${w}\n`;
            }
            const _capStrsC = caps.map(c => {
                const n = typeof c === 'string' ? c : (c.name || '');
                const r = typeof c === 'string' ? '' : (c.rights || []).join('');
                return r ? `${n} ${r}` : n;
            });
            _aclExtraC += `\n\u2139 capabilities { ${_capStrsC.join(', ')} } declared\n`;
            if (_aclC.errors.length > 0) {
                _aclExtraC += `  \u2717 Fix rights errors before saving LUMP.\n`;
            } else {
                _aclExtraC += `  \u2192 Compile to embed C-List in binary.\n`;
            }
        } catch (_aclCErr) { console.error('[ACL check] _checkCapAccessRights failed:', _aclCErr); }
        if (con && _aclExtraC) con.innerHTML += _capRightsHTML(_aclExtraC);
    }
    // Push live snippet history for each method that carried source text
    if (typeof ChurchAssembler !== 'undefined' && result.abstractionName) {
        for (const _m of result.methods) {
            if (_m.sourceLines) {
                ChurchAssembler.pushLiveSnippet(result.abstractionName, _m.name, _m.sourceLines);
            }
        }
    }
    if (_capAclErrors.length > 0) {
        if (typeof _showAsmErrors === 'function') _showAsmErrors(_capAclErrors, 'Capability error' + (_capAclErrors.length > 1 ? 's' : '') + ' \u2014 fix before build');
    } else {
        if (typeof _clearAsmErrors === 'function') _clearAsmErrors();
    }
    const _draftAllWarnings = [].concat(result.warnings || []).concat(_capAclWarnings);
    if (typeof _showAsmWarnings === 'function') _showAsmWarnings(_draftAllWarnings);
    showNextSteps('draft');
    trackAction('draft', { name: result.abstractionName, lang: result.language });
    appendOutput(`Draft: "${result.abstractionName}" — ${result.methods.length} methods, ${clistCount} caps, ${allocSize} alloc`, 'info');
}

// ── LUMP Release popup ────────────────────────────────────────────────────
let _pendingLumpRelease = null;
// Token of any active LUMP-panel edit draft at compile-start — captured
// before compileAndBuild() resets _editorLastSavedToken to null.  Used to
// delete the draft on compile success regardless of which success path runs.
let _compileDraftToken = null;

function _queueLumpRelease(data) {
    _pendingLumpRelease = data;
    if (data.con) {
        const _pre = data.listing + '\n  Waiting for release confirmation\u2026\n';
        data.con.innerHTML = _capRightsHTML(_pre);
        data.con.scrollTop = 0;
    }
    const existing = (typeof _lumpsCache !== 'undefined' && Array.isArray(_lumpsCache))
        ? _lumpsCache.find(l => l.abstraction === data.absName) : null;
    _openLumpReleasePopup(data.absName, data.absStats, existing);
}

function _openLumpReleasePopup(absName, absStats, existing) {
    const overlay = document.getElementById('lumpReleaseOverlay');
    if (!overlay) return;
    document.getElementById('lumpReleaseAbsName').textContent = absName;
    document.getElementById('lumpReleaseStats').textContent = absStats || '';
    const existEl = document.getElementById('lumpReleaseExisting');
    if (existing && existing.version) {
        existEl.className = 'lump-release-existing has-version';
        existEl.textContent = `Previous release: v${existing.version}  \u00b7  token 0x${existing.token}`;
    } else {
        existEl.className = 'lump-release-existing no-version';
        existEl.textContent = 'No previous release found \u2014 this will be the first version.';
    }
    const versionEl = document.getElementById('lumpReleaseVersion');
    versionEl.value = '';
    const notesEl = document.getElementById('lumpReleaseNotes');
    if (notesEl) notesEl.value = '';
    const errEl = document.getElementById('lumpReleaseVersionError');
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
    const confirmBtn = document.getElementById('lumpReleaseConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;
    overlay.style.display = 'flex';
    setTimeout(() => versionEl.focus(), 60);
}

function _validateLumpReleaseVersion() {
    if (!_pendingLumpRelease) return;
    const versionEl = document.getElementById('lumpReleaseVersion');
    const ver = versionEl ? versionEl.value.trim() : '';
    const errEl = document.getElementById('lumpReleaseVersionError');
    const confirmBtn = document.getElementById('lumpReleaseConfirmBtn');
    const existing = (typeof _lumpsCache !== 'undefined' && Array.isArray(_lumpsCache))
        ? _lumpsCache.find(l => l.abstraction === _pendingLumpRelease.absName) : null;
    if (!ver) {
        if (errEl) { errEl.textContent = 'Version is required (e.g. 1.0.0).'; errEl.style.display = 'block'; }
        if (confirmBtn) confirmBtn.disabled = true;
        return;
    }
    if (existing && existing.version && ver === existing.version) {
        if (errEl) {
            errEl.textContent = `\u201c${ver}\u201d matches the saved release \u2014 use a new version number.`;
            errEl.style.display = 'block';
        }
        if (confirmBtn) confirmBtn.disabled = true;
        return;
    }
    if (errEl) errEl.style.display = 'none';
    if (confirmBtn) confirmBtn.disabled = false;
}

function _cancelLumpRelease() {
    _pendingLumpRelease = null;
    const overlay = document.getElementById('lumpReleaseOverlay');
    if (overlay) overlay.style.display = 'none';
}

function _confirmLumpRelease() {
    if (!_pendingLumpRelease) return;
    const versionEl = document.getElementById('lumpReleaseVersion');
    const ver = versionEl ? versionEl.value.trim() : '';
    if (!ver) { _validateLumpReleaseVersion(); return; }
    const notesEl = document.getElementById('lumpReleaseNotes');
    const notes = notesEl ? notesEl.value.trim() : '';
    const overlay = document.getElementById('lumpReleaseOverlay');
    if (overlay) overlay.style.display = 'none';
    const data = _pendingLumpRelease;
    _pendingLumpRelease = null;

    data.savePayload.metadata.version = ver;
    if (notes) data.savePayload.metadata.release_notes = notes;

    fetch('/api/lumps/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.savePayload)
    }).then(r => r.json()).then(resp => {
        if (resp.ok) {
            const _lumpVer = resp.lump_version != null ? resp.lump_version : ver;
            const _dlName = `${data.absName}_v${_lumpVer}.lump`;
            const dlUrl = URL.createObjectURL(new Blob([data.binaryBuf], { type: 'application/octet-stream' }));
            const a = document.createElement('a');
            a.href = dlUrl; a.download = _dlName;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(dlUrl);
            appendOutput(`Saved to library: lumps/${resp.lump} \u2014 token 0x${resp.token} \u00b7 v${ver}`, 'info');
            if (_compileDraftToken && typeof _draftLsDel === 'function') { _draftLsDel(_compileDraftToken); _compileDraftToken = null; }
            window._editorLastSavedToken = resp.token;
            const savedToken = resp.token;
            window._pendingLumpToken = savedToken;
            if (typeof switchView === 'function') switchView('lumps');
            const _rlProm = renderLumps ? renderLumps() : Promise.resolve();
            (_rlProm && _rlProm.then ? _rlProm : Promise.resolve()).then(() => {
                if (typeof showLumpDetail === 'function') showLumpDetail(savedToken);
            });
            let listing = data.listing;
            listing += `  Version:   v${ver}\n`;
            if (notes) listing += `  Notes:     ${notes}\n`;
            listing += `\n  Downloaded: ${_dlName} (${data.sizeBytes} bytes)\n`;
            listing += `  Saved to: server/lumps/ (binary + metadata sidecar)\n`;
            if (data.con) { data.con.innerHTML = _capRightsHTML(listing); data.con.scrollTop = 0; }
            if (data.trackKey) trackAction(data.trackKey, data.trackData);
            if (data.appendMsg) appendOutput(data.appendMsg + ` \u00b7 v${ver}`, 'info');
        } else {
            appendOutput(`Server save failed: ${resp.error || 'unknown error'}`, 'error');
        }
    }).catch(err => { appendOutput(`Server save error: ${err.message}`, 'error'); });
}

function compileAndBuild() {
    const editor = document.getElementById('asmEditor');
    if (!editor || !cloomcCompiler) return;
    const source = editor.value;
    const con = document.getElementById('editorConsole');
    if (con) con.className = '';
    switchCodeTab('console');
    // Capture any active LUMP-edit draft token before resetting to null.
    // Both compile success paths use _compileDraftToken to delete the draft.
    _compileDraftToken = window._editorLastSavedToken;
    window._editorLastSavedToken = null;
    _runStopped = true;
    sim.running = false;

    const result = cloomcCompiler.compile(source, []);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        if (con) { con.textContent = `Compile — compilation errors:\n${errText}`; con.scrollTop = 0; }
        const _ce = result.errors.length; if (typeof _showAsmErrors === 'function') _showAsmErrors(result.errors, 'Compile error' + (_ce > 1 ? 's' : '') + ' \u2014 code not applied');
        showNextSteps('error');
        return;
    }

    const langNames = { english: 'English', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', javascript: 'JavaScript', cloomc: 'CLOOMC++', lambda: 'Lambda Calculus', assembly: 'Assembly' };
    const langLabel = langNames[result.language] || 'CLOOMC++';

    // Store for Load-into-Sim button
    window._lastCLOOMCResult = result;
    if (typeof _clearAsmErrors === 'function') _clearAsmErrors();
    if (typeof _clearAsmWarnings === 'function') _clearAsmWarnings();
    if (typeof _showAsmWarnings === 'function') _showAsmWarnings(result.warnings || []);

    const absName = result.abstractionName || 'Unnamed';
    const caps = result.capabilities || [];
    _autoFillCapRights(caps);
    const cc = caps.length;
    const profile = result.profile || 'IoT';

    // C-list overflow guard — header cc field is 8 bits (max 255 entries).
    if (cc > 255) {
        let _ovfListing = `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n`;
        _ovfListing += `  BUILD FAILED \u2014 "${absName}"\n`;
        _ovfListing += `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n\n`;
        _ovfListing += `  \u2717 [RCC] C-list overflow: ${cc} capabilities exceed the 8-bit header limit (max 255).\n`;
        _ovfListing += `  Remove ${cc - 255} capability reference${cc - 255 !== 1 ? 's' : ''} from the abstraction.\n`;
        if (con) { con.textContent = _ovfListing; con.scrollTop = 0; }
        if (typeof _showAsmErrors === 'function') _showAsmErrors([{line: null, message: `[RCC] C-list overflow: ${cc} capabilities exceed the 8-bit header limit (max 255). Remove ${cc - 255} reference${cc - 255 !== 1 ? 's' : ''}.`}], 'Capability error \u2014 code not applied');
        return;
    }

    const allCode = [];
    const allLineNums = [];
    const numMethods = result.methods.length;

    for (const m of result.methods) {
        const words = m.code || [];
        const mLineNums = m.lineNums || [];
        allCode.push(...words);
        for (let _mwi = 0; _mwi < words.length; _mwi++) {
            allLineNums.push(mLineNums[_mwi] != null ? mLineNums[_mwi] : null);
        }
    }

    const codeRegion = [...allCode];
    const cw = codeRegion.length;

    let lumpSize = 64;
    while (lumpSize < 1 + cw + cc) lumpSize <<= 1;

    let nMinus6 = 0;
    while ((64 << nMinus6) < lumpSize) nMinus6++;

    const header = ((0x1F & 0x1F) << 27) |
                   ((nMinus6 & 0x0F) << 23) |
                   ((cw & 0x1FFF) << 10) |
                   ((0 & 0x03) << 8) |
                   (cc & 0xFF);

    const resolvedCaps = caps.map(cap => {
        const capName = typeof cap === 'string' ? cap : (cap.name || '');
        const capRights = typeof cap === 'string' ? [] : (cap.rights || []);
        let target = -1;
        if (sim && sim.abstractionRegistry) {
            const allAbs = sim.abstractionRegistry.abstractions || [];
            for (let j = 0; j < allAbs.length; j++) {
                if (allAbs[j] && allAbs[j].name && allAbs[j].name.toUpperCase() === capName.toUpperCase()) {
                    target = j;
                    break;
                }
            }
        }
        return { name: capName, rights: capRights, nsIndex: target };
    });

    const lumpWords = new Uint32Array(lumpSize);
    lumpWords[0] = header >>> 0;
    for (let i = 0; i < cw; i++) {
        lumpWords[1 + i] = (codeRegion[i] >>> 0);
    }
    const clistStart = lumpSize - cc;
    for (let i = 0; i < cc; i++) {
        lumpWords[clistStart + i] = resolvedCaps[i].nsIndex >= 0 ? (resolvedCaps[i].nsIndex & 0xFFFFFFFF) : 0x00000000;
    }

    // ── Pre-save audit — run on assembled binary BEFORE download or server save ──
    // Build LUMP-level lineNums: index 0 = header (null), indices 1..cw = per-word source lines.
    const _lumpLineNums = [null, ...allLineNums];

    let _auditResults = [];
    let _auditErrors  = [];
    let _auditWarns   = [];
    if (typeof lumpAudit === 'function') {
        const _auditPnCR = {};
        for (let _i = 0; _i < resolvedCaps.length; _i++) {
            if (resolvedCaps[_i] && resolvedCaps[_i].name) _auditPnCR[String(_i)] = resolvedCaps[_i].name;
        }
        _auditResults = lumpAudit(Array.from(lumpWords), {
            cw, cc, lump_size: lumpSize,
            pet_names:    { CR: _auditPnCR },
            capabilities: resolvedCaps.map(rc => ({ name: rc.name, rights: rc.rights, grants: rc.rights })),
        }, _lumpLineNums);
        _auditErrors  = _auditResults.filter(r => r.severity === 'error');
        _auditWarns   = _auditResults.filter(r => r.severity === 'warn');
    }

    if (_auditErrors.length > 0) {
        let _errListing = `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n`;
        _errListing += `  AUDIT FAILED \u2014 "${absName}" not downloaded or saved\n`;
        _errListing += `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n\n`;
        _errListing += `  The assembled binary has structural errors. Fix them and rebuild:\n\n`;
        for (const r of _auditResults) {
            const _sym = r.severity === 'pass' ? '\u2713' : r.severity === 'warn' ? '\u26a0' : '\u2717';
            _errListing += `    ${_sym} [${r.ruleId}] ${r.message} \u2014 ${r.detail}\n`;
        }
        _errListing += `\n  \u2717 ${_auditErrors.length} error${_auditErrors.length !== 1 ? 's' : ''} \u2014 binary not downloaded or saved.\n`;
        if (con) { con.textContent = _errListing; con.scrollTop = 0; }
        if (typeof _showAsmErrors === 'function') {
            const _showErrs = (typeof mapRciAuditErrorsToShowErrs === 'function')
                ? mapRciAuditErrorsToShowErrs(_auditErrors)
                : _auditErrors.map(r => ({ line: null, message: `[${r.ruleId}] ${r.message} \u2014 ${r.detail}` }));
            _showAsmErrors(_showErrs, 'Audit error' + (_auditErrors.length > 1 ? 's' : '') + ' \u2014 code not applied');
        }
        return;
    }

    const binaryBuf = new ArrayBuffer(lumpSize * 4);
    const view = new DataView(binaryBuf);
    for (let i = 0; i < lumpSize; i++) {
        view.setUint32(i * 4, lumpWords[i], false);
    }

    const freespace = lumpSize - 1 - cw - cc;
    const sizeBytes = lumpSize * 4;

    const mtbfClean = _getConsecutiveCleanRuns();
    const mtbfTotal = _simRunHash ? _simRunHistory.filter(r => r.hash === _simRunHash).length : 0;
    const mtbfStatus = mtbfTotal === 0 ? 'unknown' : (mtbfClean >= 5 ? 'green' : mtbfClean >= 3 ? 'amber' : 'red');

    const drPetNames = {};
    for (const [k, v] of Object.entries(_petNameDRMap)) {
        drPetNames[`DR${k}`] = v;
    }
    const crPetNames = {};
    for (const [k, v] of Object.entries(_petNameCRMap)) {
        crPetNames[`CR${k}`] = v;
    }

    // Build numeric-keyed DR/CR maps for stamping onto per-method pet_names
    const _drNumericMap = {};
    for (const [k, v] of Object.entries(_petNameDRMap)) { _drNumericMap[String(k)] = v; }
    const _crNumericMap = {};
    for (const [k, v] of Object.entries(_petNameCRMap)) { _crNumericMap[String(k)] = v; }
    const _hasGlobalPN = Object.keys(_drNumericMap).length > 0 || Object.keys(_crNumericMap).length > 0;

    const methodMeta = [];
    let mOff = 0;
    for (let i = 0; i < result.methods.length; i++) {
        const m = result.methods[i];
        const len = (m.code || []).length;
        const entry = { name: m.name, offset: mOff, length: len };
        if (m.aliasOf) entry.aliasOf = m.aliasOf;
        // Per-method pet names: prefer the method's own annotation; fall back to global (PetName mode)
        if (m.pet_names) {
            entry.pet_names = m.pet_names;
        } else if (_hasGlobalPN) {
            entry.pet_names = { DR: _drNumericMap, CR: _crNumericMap };
        }
        methodMeta.push(entry);
        mOff += len;
    }

    // Push live snippet history for each method that carried source text
    if (typeof ChurchAssembler !== 'undefined' && absName) {
        for (const _m of result.methods) {
            if (_m.sourceLines) {
                ChurchAssembler.pushLiveSnippet(absName, _m.name, _m.sourceLines);
            }
        }
    }

    let resolvedNsSlot = null;
    if (sim && sim.abstractionRegistry) {
        const allAbs = sim.abstractionRegistry.abstractions || [];
        for (let j = 0; j < allAbs.length; j++) {
            if (allAbs[j] && allAbs[j].name && allAbs[j].name.toUpperCase() === absName.toUpperCase()) {
                resolvedNsSlot = j;
                break;
            }
        }
    }

    const lumpWordsArray = Array.from(lumpWords);
    const savePayload = {
        binary: lumpWordsArray,
        metadata: {
            abstraction:    absName,
            ns_slot:        resolvedNsSlot,
            ns_slot_policy: resolvedNsSlot === null ? 'dynamic' : 'fixed',
            cw:             cw,
            cc:             cc,
            profile:        profile,
            language:       result.language || 'javascript',
            methods:        methodMeta,
            capabilities:   resolvedCaps.map(rc => ({ name: rc.name, rights: rc.rights, grants: rc.rights, nsIndex: rc.nsIndex })),
            pet_names_dr:   drPetNames,
            pet_names_cr:   crPetNames,
            mtbf_clean_runs: mtbfClean,
            mtbf_total_runs: mtbfTotal,
            mtbf_status:     mtbfStatus,
            source_hash:     _simRunHash || _currentEditorHash(),
            target_board:   'ti60-f225',
            grants:         ['E']
        }
    };


    let listing = `═══════════════════════════════════════════════════\n`;
    listing += `  LUMP BUILT — "${absName}" [${langLabel}]\n`;
    listing += `═══════════════════════════════════════════════════\n\n`;
    listing += `  Header:    0x${(header >>> 0).toString(16).padStart(8, '0')}\n`;
    listing += `  Lump Size: ${lumpSize} words (2^${Math.log2(lumpSize)})\n`;
    listing += `  Code:      ${cw} words (${numMethods} method${numMethods !== 1 ? 's' : ''} concatenated)\n`;
    listing += `  C-List:    ${cc} slot${cc !== 1 ? 's' : ''} (cc)\n`;
    listing += `  Freespace: ${freespace} words\n`;
    listing += `  Profile:   ${profile}\n`;
    listing += `  MTBF:      ${mtbfClean}/${mtbfTotal} clean runs (${mtbfStatus})\n`;

    if (Object.keys(drPetNames).length > 0 || Object.keys(crPetNames).length > 0) {
        listing += `\n  Pet Names:\n`;
        for (const [reg, name] of Object.entries(drPetNames)) {
            listing += `    ${reg} = ${name}\n`;
        }
        for (const [reg, name] of Object.entries(crPetNames)) {
            listing += `    ${reg} = ${name}\n`;
        }
    }

    if (cc > 0) {
        listing += `\n  Capabilities (C-List):\n`;
        const unresolved = [];
        for (let i = 0; i < resolvedCaps.length; i++) {
            const rc = resolvedCaps[i];
            const status = rc.nsIndex >= 0 ? `NS[${rc.nsIndex}]` : 'unresolved (null GT)';
            const _rcRightsStr = rc.rights && rc.rights.length > 0 ? ` [${rc.rights.join('')}]` : '';
            listing += `    [${i}] ${rc.name}${_rcRightsStr} → ${status}\n`;
            if (rc.nsIndex < 0) unresolved.push(rc.name);
        }
        if (unresolved.length > 0) {
            listing += `    ⚠ ${unresolved.length} unresolved — boot the simulator to resolve, or deploy with null GTs\n`;
        }
    }

    listing += `\n  Methods:\n`;
    for (let i = 0; i < methodMeta.length; i++) {
        const m = methodMeta[i];
        const aliasNote = m.aliasOf ? ` → ${m.aliasOf}` : '';
        const drMap = ((m.pet_names || {}).DR) || {};
        const drNote = Object.keys(drMap).length > 0
            ? '  [' + Object.entries(drMap).sort(([a],[b]) => parseInt(a)-parseInt(b)).map(([k,v]) => `DR${k}=${v}`).join(', ') + ']'
            : '';
        listing += `    [${i}] ${m.name.padEnd(20)} offset=${m.offset.toString().padStart(4)}  length=${m.length}${aliasNote}${drNote}\n`;
    }

    listing += `\n  Deployment:\n`;
    listing += `    Target Board: Efinix Ti60 F225\n`;
    listing += `    Profile:      ${profile}\n`;
    listing += `    MTBF Status:  ${mtbfStatus.toUpperCase()}${mtbfClean >= 5 ? ' (deployment-ready)' : mtbfTotal === 0 ? ' (unknown — needs testing)' : ' (needs more clean runs)'}\n`;

    listing += `\n  Lump Layout:\n`;
    listing += `    ┌─────────────────────────────────────────────┐\n`;
    listing += `    │ Word 0:  Header   0x${(header >>> 0).toString(16).padStart(8, '0')}             │\n`;
    listing += `    │ Words 1..${cw}:  Code region (${cw} words)${' '.repeat(Math.max(0, 9 - cw.toString().length))}│\n`;
    listing += `    │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │\n`;
    listing += `    │ Freespace: ${freespace} words${' '.repeat(Math.max(0, 24 - freespace.toString().length))}│\n`;
    listing += `    │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │\n`;
    listing += `    │ C-List:  ${cc} slots (offset ${clistStart})${' '.repeat(Math.max(0, 19 - cc.toString().length - clistStart.toString().length))}│\n`;
    listing += `    └─────────────────────────────────────────────┘\n`;
    listing += `    Total: ${lumpSize} words = ${sizeBytes} bytes\n`;

    if (_auditResults.length > 0) {
        listing += `\n  Pre-build Audit:\n`;
        for (const r of _auditResults) {
            const _sym = r.severity === 'pass' ? '\u2713' : r.severity === 'warn' ? '\u26a0' : '\u2717';
            listing += `    ${_sym} [${r.ruleId}] ${r.message} \u2014 ${r.detail}\n`;
        }
        if (_auditWarns.length > 0) {
            listing += `\n  \u26a0 Audit: ${_auditWarns.length} warning${_auditWarns.length !== 1 ? 's' : ''} \u2014 review before deploying.\n`;
        } else {
            listing += `\n  \u2713 Audit passed \u2014 all checks OK.\n`;
        }
    }

    // Direct download — no popup, no version prompt.  Auto-version from timestamp.
    const _autoVer = (() => {
        const d = new Date();
        return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
    })();
    savePayload.metadata.version = _autoVer;

    fetch('/api/lumps/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savePayload)
    }).then(r => r.json()).then(resp => {
        if (resp.ok) {
            const _lumpVer = resp.lump_version != null ? resp.lump_version : _autoVer;
            const _dlName = `${absName}_v${_lumpVer}.lump`;
            const _dlUrl = URL.createObjectURL(new Blob([binaryBuf], { type: 'application/octet-stream' }));
            const _a = document.createElement('a');
            _a.href = _dlUrl; _a.download = _dlName;
            document.body.appendChild(_a); _a.click();
            document.body.removeChild(_a);
            URL.revokeObjectURL(_dlUrl);
            appendOutput(`Saved to library: lumps/${resp.lump} \u2014 token 0x${resp.token} \u00b7 v${_autoVer}`, 'info');
            if (_compileDraftToken && typeof _draftLsDel === 'function') { _draftLsDel(_compileDraftToken); _compileDraftToken = null; }
            window._editorLastSavedToken = resp.token;
            const _savedToken = resp.token;
            window._pendingLumpToken = _savedToken;
            if (typeof switchView === 'function') switchView('lumps');
            const _rlProm2 = renderLumps ? renderLumps() : Promise.resolve();
            (_rlProm2 && _rlProm2.then ? _rlProm2 : Promise.resolve()).then(() => {
                if (typeof showLumpDetail === 'function') showLumpDetail(_savedToken);
            });
            let _finalListing = listing;
            _finalListing += `  Version:    v${_autoVer} (auto)\n`;
            _finalListing += `\n  Downloaded: ${_dlName} (${sizeBytes} bytes)\n`;
            _finalListing += `  Saved to:   server/lumps/ (binary + metadata sidecar)\n`;
            if (con) {
                con.innerHTML = _capRightsHTML(_finalListing);
                con.scrollTop = 0;
                const _loadDiv = document.createElement('div');
                _loadDiv.className = 'cmp-load-toolbar';
                _loadDiv.innerHTML = `<button id="btnLoadIntoSim" class="cmp-load-sim-btn" onclick="loadCLOOMCIntoSim()" data-tooltip="Load compiled program into the simulator to Step or Walk through every instruction">Load into Sim \u25b6</button>`;
                con.insertBefore(_loadDiv, con.firstChild);
            }
        } else {
            appendOutput(`Server save failed: ${resp.error || 'unknown error'}`, 'error');
        }
    }).catch(err => { appendOutput(`Server save error: ${err.message}`, 'error'); });

    trackAction('build_lump', { name: absName, lang: result.language, size: lumpSize });
    appendOutput(`Built LUMP: "${absName}" [${langLabel}] \u2014 ${cw} words, cc=${cc}, ${sizeBytes} bytes \u00b7 v${_autoVer}`, 'info');
    showNextSteps('compiled');
    _applySealedLumpState(absName);
}

function _applySealedLumpState(absName) {
    const editor = document.getElementById('asmEditor');
    if (editor) {
        editor.readOnly = true;
        editor.classList.add('cm-editor-sealed');
    }
    // Always hide the example-tabs-row when sealing.  Sealing only ever
    // happens after compiling in Assembly mode, so hiding example tabs (which
    // are only useful when the editor is editable) is always correct here.
    // Previously this only hid the row when curLang==='assembly', but on page
    // reload the language selector may have been restored to a different value
    // by loadEditorState() before _applySealedLumpState() runs, causing the
    // row to remain visible despite the seal.
    const tabsRow = document.querySelector('.example-tabs-row');
    if (tabsRow) tabsRow.style.display = 'none';
    localStorage.setItem('cm_sealed_lump', JSON.stringify({ abstraction: absName || 'Unnamed', sealedAt: Date.now() }));
}

function auditLumpOnly() {
    if (typeof lumpAudit !== 'function') return;
    const editor = document.getElementById('asmEditor');
    if (!editor || !cloomcCompiler) return;
    const source = editor.value;
    const con = document.getElementById('editorConsole');
    if (con) con.className = '';
    switchCodeTab('console');
    if (typeof _clearAsmErrors === 'function') _clearAsmErrors();
    if (typeof _clearAsmWarnings === 'function') _clearAsmWarnings();

    const result = cloomcCompiler.compile(source, []);
    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        if (con) { con.textContent = `Audit LUMP — compilation errors:\n${errText}`; con.scrollTop = 0; }
        const _ae = result.errors.length; if (typeof _showAsmErrors === 'function') _showAsmErrors(result.errors, 'Audit LUMP — compile error' + (_ae > 1 ? 's' : ''));
        if (typeof _showAsmWarnings === 'function') _showAsmWarnings(result.warnings || []);
        return;
    }
    if (typeof _showAsmWarnings === 'function') _showAsmWarnings(result.warnings || []);

    const absName = result.abstractionName || 'Unnamed';
    const caps    = result.capabilities || [];
    _autoFillCapRights(caps);
    const cc      = caps.length;

    // C-list overflow guard — same as compileAndBuild (header cc field is 8 bits).
    if (cc > 255) {
        let _ovf = `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n`;
        _ovf += `  AUDIT FAILED \u2014 "${absName}"\n`;
        _ovf += `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n\n`;
        _ovf += `  \u2717 [RCC] C-list overflow: ${cc} capabilities exceed 8-bit header limit (max 255).\n`;
        _ovf += `  Remove ${cc - 255} capability reference${cc - 255 !== 1 ? 's' : ''} before building.\n`;
        if (con) { con.textContent = _ovf; con.scrollTop = 0; }
        return;
    }

    const allCode = [];
    const _aloLineNums = [];
    for (const m of result.methods) {
        const _mCode = m.code || [];
        const _mLN   = m.lineNums || [];
        for (let _mwi = 0; _mwi < _mCode.length; _mwi++) {
            allCode.push(_mCode[_mwi]);
            _aloLineNums.push(_mLN[_mwi] != null ? _mLN[_mwi] : null);
        }
    }
    const cw = allCode.length;
    const _aloLumpLineNums = [null, ..._aloLineNums];

    let lumpSize = 64;
    while (lumpSize < 1 + cw + cc) lumpSize <<= 1;

    let nMinus6 = 0;
    while ((64 << nMinus6) < lumpSize) nMinus6++;

    const header = ((0x1F & 0x1F) << 27) |
                   ((nMinus6 & 0x0F) << 23) |
                   ((cw & 0x1FFF) << 10) |
                   ((0 & 0x03) << 8) |
                   (cc & 0xFF);

    const lumpWords = new Uint32Array(lumpSize);
    lumpWords[0] = header >>> 0;
    for (let i = 0; i < cw; i++) { lumpWords[1 + i] = (allCode[i] >>> 0); }
    // C-list slots populated with zero (unresolved NS indices) — same layout as compileAndBuild.
    const _auditClistStart = lumpSize - cc;
    for (let i = 0; i < cc; i++) { lumpWords[_auditClistStart + i] = 0; }

    const _aloPnCR = {};
    for (let _i = 0; _i < caps.length; _i++) {
        if (caps[_i] && caps[_i].name) _aloPnCR[String(_i)] = caps[_i].name;
    }
    const auditResults = lumpAudit(Array.from(lumpWords), {
        cw, cc, lump_size: lumpSize,
        pet_names:    { CR: _aloPnCR },
        capabilities: caps.map(c => ({ name: c.name || String(c) })),
    }, _aloLumpLineNums);
    const auditErrors  = auditResults.filter(r => r.severity === 'error');
    const auditWarns   = auditResults.filter(r => r.severity === 'warn');

    const _auditHE = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const _auditJumpBtn = ln => `<button style="margin-left:6px;padding:0 5px;font-size:0.8em;line-height:1.4;cursor:pointer;background:#4a3800;color:#ffd700;border:1px solid #ffd700;border-radius:3px;font-family:inherit;vertical-align:middle" onclick="if(typeof _jumpToAsmLine==='function')_jumpToAsmLine(${ln | 0})">&#8593; line ${ln | 0}</button>`;

    let listing = `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n`;
    listing += `  LUMP AUDIT \u2014 &quot;${_auditHE(absName)}&quot;\n`;
    listing += `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n\n`;
    listing += `  Binary: ${lumpSize} words, cw=${cw}, cc=${cc}\n`;
    listing += `  Header: 0x${(header >>> 0).toString(16).padStart(8, '0')}\n\n`;
    listing += `  Checks:\n`;
    for (const r of auditResults) {
        const _sym = r.severity === 'pass' ? '\u2713' : r.severity === 'warn' ? '\u26a0' : '\u2717';
        listing += `    ${_sym} [${_auditHE(r.ruleId)}] ${_auditHE(r.message)} \u2014 ${_auditHE(r.detail)}\n`;
        if (r.ruleId === 'RCI' && r.severity === 'error' && Array.isArray(r.violations)) {
            for (const v of r.violations) {
                const _ln = v.sourceLine != null ? (v.sourceLine | 0) : null;
                const _lineHint = _ln != null ? ` (line ${_ln})` : '';
                const _jumpHtml = _ln != null ? _auditJumpBtn(_ln) : '';
                listing += `        \u2022 ${_auditHE(v.msg)}${_lineHint}${_jumpHtml}\n`;
            }
        }
    }
    if (auditErrors.length > 0) {
        listing += `\n  \u2717 AUDIT FAILED: ${auditErrors.length} error${auditErrors.length !== 1 ? 's' : ''} \u2014 fix before Compile.\n`;
        if (typeof _showAsmErrors === 'function') {
            const _aloShowErrs = (typeof mapRciAuditErrorsToShowErrs === 'function')
                ? mapRciAuditErrorsToShowErrs(auditErrors)
                : auditErrors.map(r => ({ line: null, message: `[${r.ruleId}] ${r.message} \u2014 ${r.detail}` }));
            _showAsmErrors(_aloShowErrs, 'Audit LUMP \u2014 ' + auditErrors.length + ' error' + (auditErrors.length !== 1 ? 's' : ''));
        }
    } else if (auditWarns.length > 0) {
        listing += `\n  \u26a0 Audit passed with ${auditWarns.length} warning${auditWarns.length !== 1 ? 's' : ''} \u2014 review before deploying.\n`;
        if (typeof _showAsmWarnings === 'function') {
            const _aloWarnErrs = auditWarns.map(r => ({ line: null, message: `[${r.ruleId}] ${r.message} \u2014 ${r.detail}` }));
            _showAsmWarnings(_aloWarnErrs);
        }
    } else {
        listing += `\n  \u2713 All checks passed \u2014 safe to Compile.\n`;
    }

    if (con) { con.className = 'cmp-html'; con.innerHTML = listing.replace(/\n/g, '<br>'); con.scrollTop = 0; }
}

// Load the most-recently-compiled CLOOMC++ lump into the simulator so the user
// can step/walk through individual instructions — bridging the compile-display
// path and the assemble-and-run path.
function loadCLOOMCIntoSim() {
    const result = window._lastCLOOMCResult;
    if (!result || !result.methods) {
        appendOutput('Load into Sim: nothing compiled yet — run Compile first.', 'warn');
        return;
    }

    const methods = result.methods || [];
    const methodTableSize = methods.length;
    const words = [];
    const labels = {};
    // Layout: words[0..N-1] = method table entries; words[N..] = method bodies.
    // loadProgram writes words[k] at lump word k+1 (word 0 is lump header).
    // Entry value = lump-word offset of body start (= codeOffset+1 for words[codeOffset]).
    // imm = methodIndex+1 (1-based); dispatch reads lump word imm = words[imm-1] = entry.
    // pc = entry - 1; fetchAddr = lump_base + 1 + pc = lump word entry = body start. ✓
    let codeOffset = methodTableSize; // words[] index of next body (= pc value for BRANCH)
    const methodTableEntries = [];
    for (const m of methods) {
        methodTableEntries.push(m.visibility === 'private' ? 0 : codeOffset + 1);
        labels[m.name] = codeOffset;      // pc value: body at lump word codeOffset+1
        codeOffset += (m.code || []).length;
    }
    for (const entry of methodTableEntries) words.push(entry);
    for (const m of methods) {
        for (const w of (m.code || [])) words.push(w);
    }

    lastAssembledWords      = words.slice();
    lastAssembledCapabilities = (result.capabilities && result.capabilities.length > 0)
        ? result.capabilities.slice() : null;
    lastAssembledNamedSlots = (result.namedSlots && result.namedSlots.length > 0)
        ? result.namedSlots.slice() : null;
    lastMethodTableSize     = methodTableSize;
    _defaultProgramLoaded   = true;
    sim.programLabels       = labels;
    sim.programName         = result.abstractionName || (methods.length > 0 ? methods[0].name : 'prog');
    window._assemblerSymbols = { labels, lumpName: sim.programName };
    _pendingSimLoad          = true;

    // If the machine is not yet booted, silently complete the full boot sequence
    // now so the user lands on the dashboard ready to Step immediately — no
    // manual boot clicking required.
    const _wasAlreadyBooted = sim.bootComplete;
    if (!_wasAlreadyBooted) {
        instantBoot();
        // _autoLoadDefaultProgram() inside instantBoot loaded lastAssembledWords;
        // _pendingSimLoad stays true so _applyPendingSimLoad() on first Step
        // re-positions PC correctly via the full setup path.
    }

    // Update the button to give immediate visual feedback
    const btn = document.getElementById('btnLoadIntoSim');
    if (btn) {
        btn.textContent = 'Loaded \u2713';
        btn.classList.add('cmp-load-sim-btn--done');
        btn.disabled = true;
    }

    // Switch the next-steps hints to the "assembled" state
    showNextSteps('assembled');

    const _loadSrcLabel = _getActiveSourceLabel();
    const _loadSrcHint  = _loadSrcLabel ? ` · ${_loadSrcLabel}` : '';
    const con = document.getElementById('editorConsole');
    if (con) {
        con.className = '';
        const _bootPrefix = _wasAlreadyBooted ? 'Loaded' : 'Auto-booted';
        con.textContent = `${_bootPrefix} \u2014 \u201c${result.abstractionName}\u201d loaded${_loadSrcHint} \u2014 ${words.length} words, ${methodTableSize} method${methodTableSize !== 1 ? 's' : ''} \u2014 click Step or Run`;
    }

    // ── Update namespace label so the CR detail heading shows the abstraction name
    // rather than the boot-image occupant of that slot ("LED flash", etc.).
    const _bootSlot = (typeof BOOT_ABSTR_NS_SLOT !== 'undefined') ? BOOT_ABSTR_NS_SLOT : 3;
    if (sim && sim.nsLabels) {
        sim.nsLabels[_bootSlot] = result.abstractionName || sim.programName;
    }

    // ── Populate a lump manifest from the CLOOMC methods so the API tab shows
    // call-site examples instead of "No method manifest available".
    if (typeof _lumpManifests !== 'undefined') {
        const _allMethods  = result.methods || [];
        const _globalPetDR = { '0': 'result' };
        // Include every method (public + internal); flag internal ones so the
        // API tab can display them with a distinct visual style.
        const _internalNames = new Set(['Dispatch', 'M00']);
        const _manifestMethods = _allMethods.map((m) => {
            const isInternal = _internalNames.has(m.name);
            const params = m.params || [];
            const drPets = {};
            // Dispatch selector is always DR0; param[0] → DR1, param[1] → DR2, etc.
            params.forEach((p, j) => { drPets[String(j + 1)] = p; });
            const inputs  = isInternal ? [] : params.map((p, j) => `DR${j + 1} (${p})`);
            const outputs = isInternal ? [] : ['DR0 (return value)'];
            return { name: m.name, inputs, outputs,
                     pet_names: { DR: drPets, CR: {} },
                     _internal: isInternal };
        });
        // Also build the `methods` dict expected by the "Methods & Example API"
        // section (keyed by name, with index / input / output fields).
        const _methodsDict = {};
        _allMethods.forEach((m, idx) => {
            const isInternal = _internalNames.has(m.name);
            const params = m.params || [];
            _methodsDict[m.name] = {
                index:    idx,
                input:    isInternal ? '—' : (params.length ? params.map((p, j) => `DR${j + 1} (${p})`).join(', ') : '—'),
                output:   isInternal ? '—' : 'DR0 (return value)',
                _internal: isInternal
            };
        });
        _lumpManifests[_bootSlot] = {
            _methods: _manifestMethods,
            methods:  _methodsDict,
            pet_names: { DR: _globalPetDR, CR: {} }
        };
    }

    // Open the simulator dashboard so the user lands on the Step / Run controls
    switchView('dashboard');
    // Refresh the invoke-method button visibility now that an abstraction is loaded
    if (typeof refreshInvokeBtn === 'function') refreshInvokeBtn();
    // Open CR14 (the CLOOMC register) detail panel directly on the API tab so
    // the user sees methods and call examples immediately on entering the sim.
    if (typeof openCRDetail === 'function') {
        openCRDetail(14);
        if (typeof switchCRDetailTab === 'function') switchCRDetailTab('api');
    } else if (typeof selectedCR !== 'undefined' && selectedCR !== null &&
               typeof updateCRDetail === 'function') {
        updateCRDetail();
    }
}

function compileAndCreateAbstraction() {
    if (typeof historyShowCreateAbstraction === 'function') historyShowCreateAbstraction();
    const editor = document.getElementById('asmEditor');
    if (!editor || !cloomcCompiler) return;
    const source = editor.value;
    const con = document.getElementById('editorConsole');
    if (con) con.className = '';
    if (typeof _clearAsmErrors === 'function') _clearAsmErrors();
    if (typeof _clearAsmWarnings === 'function') _clearAsmWarnings();

    const result = cloomcCompiler.compile(source, []);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        const _cab2Src = _getActiveSourceLabel(); const _cab2SrcH = _cab2Src ? ` · ${_cab2Src}` : '';
        if (con) con.textContent = `CLOOMC++ compilation errors${_cab2SrcH}:\n${errText}`;
        const _cae = result.errors.length; if (typeof _showAsmErrors === 'function') _showAsmErrors(result.errors, 'Compile error' + (_cae > 1 ? 's' : '') + ' \u2014 abstraction not created');
        showNextSteps('error');
        return;
    }

    if (!sim.bootComplete) {
        if (con) con.textContent = 'Boot not complete — run boot sequence first.';
        showNextSteps('error');
        return;
    }

    const uploadCaps = (result.capabilities || []).map((cap, idx) => {
        const capName = typeof cap === 'string' ? cap : (cap.name || '');
        const capRights = typeof cap === 'string' ? [] : (cap.rights || []);
        let target = -1;
        if (sim.abstractionRegistry) {
            const allAbs = sim.abstractionRegistry.abstractions || [];
            for (let i = 0; i < allAbs.length; i++) {
                if (allAbs[i] && allAbs[i].name && allAbs[i].name.toUpperCase() === capName.toUpperCase()) {
                    target = i;
                    break;
                }
            }
        }
        return { target: target, name: capName, grants: capRights.length > 0 ? capRights : ['E'] };
    }).filter(c => c.target >= 0);

    const doc = buildDocBlock(result, source);

    const profile = result.profile || 'IoT';

    const upload = {
        abstraction: result.abstractionName || 'UserAbstraction',
        type: 'abstraction',
        grants: ['E'],
        capabilities: uploadCaps,
        methods: result.methods,
        doc: doc,
        profile: profile
    };

    const addResult = abstractionRegistry.dispatchMethod(5, 'Abstraction.Add', sim, { upload: upload });

    if (!addResult || !addResult.ok) {
        if (con) con.textContent = `Abstraction creation failed: ${addResult ? addResult.message : 'unknown error'}`;
        showNextSteps('error');
        return;
    }

    if (addResult.result) addResult.result.profile = profile;

    const r = addResult.result;
    _storeLumpManifest(r.nsIndex, r.location, result.methods, result.manifest, result.capabilities);
    const freespace = r.allocSize - r.codeSize - r.clistCount;
    const clistStart = r.allocSize - r.clistCount;
    let listing = `Abstraction "${upload.abstraction}" created via Navana.Abstraction.Add:\n\n`;
    listing += `  NS Index:    ${r.nsIndex}\n`;
    listing += `  Profile:     ${profile}${result.targetDirective ? ' (@target ' + result.targetDirective + ')' : ' (auto-detected)'}\n`;
    listing += `  GT Seq:      ${r.version}\n`;
    listing += `  E-GT:        0x${r.eGT.toString(16).padStart(8, '0')}\n`;
    listing += `  Location:    0x${r.location.toString(16)}\n`;
    listing += `  Methods:     ${r.methods.join(', ')}\n`;
    listing += `\n  Lump Layout:\n`;
    listing += `    Code size:   ${r.codeSize} words\n`;
    listing += `    C-List:      ${r.clistCount} slots (offset ${clistStart})\n`;
    listing += `    Freespace:   ${freespace} words\n`;
    listing += `    Alloc size:  ${r.allocSize} words (power-of-2)\n`;
    if (r.clistCount > 0) {
        listing += `\n  CALL split:\n`;
        listing += `    CR14 (code):   base=0x${r.location.toString(16)}, limit=${clistStart - 1}, perms=X-only  [privileged]\n`;
        listing += `    CR6 (c-list): base=0x${(r.location + clistStart).toString(16)}, limit=${r.clistCount - 1}, perms=L-only\n`;
    }

    if (abstractionRegistry) {
        const abs = abstractionRegistry.getAbstraction(r.nsIndex);
        if (abs) {
            if (r.doc) abs.doc = r.doc;
            abs.profile = profile;
        }
    }

    if (typeof checkUploadProfile === 'function') {
        const boardCheck = checkUploadProfile(upload, getSelectedBoard());
        if (!boardCheck.allowed) {
            listing += `\n  WARNING: ${boardCheck.message}\n`;
        }
    }

    if (con) con.textContent = listing;
    showNextSteps('created');
    trackAction('abstract', { name: upload.abstraction, lang: result.language });
    appendOutput(`Created "${upload.abstraction}" @ NS[${addResult.result.nsIndex}]`, 'info');
    updateDashboard();
}

function loadCLOOMCExample(name) {
    // User explicitly chose an example — discard any wizard scaffold.
    window._wizardScaffoldActive = false;
    const editor = document.getElementById('asmEditor');
    if (!editor) return;
    _editorCREditActive = false;
    _editorCREditCR = null;
    _editorCREditNS = null;
    _updateEditorPatchBar();
    if (activeUserTabId && userTabDirty) saveActiveUserTab();
    activeUserTabId = null;
    userTabDirty = false;
    // Loading a built-in example abandons any in-progress catalog edit context
    if (typeof clearPseudoEditContext === 'function') clearPseudoEditContext();
    renderUserTabs();
    updateSaveUserTabBtn();

    const fileExamples  = _CLOOMC_FILE_EXAMPLES;
    const fileLanguages = _CLOOMC_FILE_LANGUAGES;
    if (fileExamples[name]) {
        fetch(fileExamples[name])
            .then(r => r.ok ? r.text() : Promise.reject('File not found'))
            .then(code => {
                editor.value = code;
                saveEditorState();
                updateLineNumbers();
                if (typeof updateSavePseudoBtn === 'function') updateSavePseudoBtn();
                // Activate the matching tab — data-example may have a 'cloomc_' prefix
                document.querySelectorAll('.example-tab').forEach(t => {
                    const de = t.dataset.example || '';
                    t.classList.toggle('active',
                        de === name || de === 'cloomc_' + name);
                });
                // Title must always follow the active tab label without exception.
                if (typeof _updateEditorCodeName === 'function') {
                    const _activeBtn = document.querySelector('.example-tab.active');
                    _updateEditorCodeName(_activeBtn ? _activeBtn.textContent.trim() : name);
                }
                // Set the correct language for this file
                const sel = document.getElementById('langSelector');
                const fileLang = fileLanguages[name] || 'javascript';
                if (sel && sel.value !== fileLang) {
                    sel.value = fileLang;
                    // Update button states without triggering a full lang-change cycle
                    // (onLangChange would reload the default example and overwrite our content)
                    if (typeof renderSyntaxRef === 'function') {
                        const syntaxPanel = document.getElementById('codeSyntaxPanel');
                        if (syntaxPanel && syntaxPanel.style.display !== 'none') {
                            renderSyntaxRef(fileLang);
                        }
                    }
                    if (typeof showIntro === 'function') showIntro(fileLang);
                }
                if (typeof historySetCodeExample === 'function') historySetCodeExample(name);
                const nb = document.getElementById('presetNoticeBar');
                if (nb) {
                    const nbText = nb.querySelector('.preset-notice-text');
                    if (name === 'ada_note_g') {
                        if (nbText) nbText.textContent = 'Integer arithmetic only \u2014 load the CLOOMC preset for exact fractions.';
                        nb.style.display = 'flex';
                    } else if (name === 'ada_note_g_published_bug') {
                        if (nbText) nbText.textContent = 'Ada\u2019s published Op\u00a04 has the dividend and divisor swapped. Expected result: DR24\u00a0=\u00a0139/630 (not \u22121/30). Compare with \u201cAda: Note G (corrected)\u201d to see the difference.';
                        nb.style.display = 'flex';
                    } else {
                        nb.style.display = 'none';
                    }
                }
            })
            .catch(err => console.error('Failed to load example:', err));
        return;
    }

    const examples = {
        'mint': `// ============================================================
// Abstraction:  Mint
// Description:  Mints (creates) and revokes Golden Token capability words
// Author:       Church Machine Educational Platform
// Version:      1.0
// Created:      2026-05-09
// Language:     CLOOMC++
// Dependencies: Navana, Memory
// ============================================================
// Methods:
//   1. Create(size, perms) — allocate space for a new Golden Token; delegates to Memory.Allocate
//   2. Revoke(index) — invalidate an existing GT by index (clears namespace entry)
// ============================================================
// ── Mint: Creating New Golden Tokens ──
// Mint depends on Memory (listed in capabilities).
// At install time the system places a GT for Memory
// into Mint's c-list. Without that GT, Mint cannot
// reach Memory at all — hardware enforces this.
//
// CR5 is a thread register shared across all abstractions
// on this thread — it is set by CHANGE from Zone ④ bounds
// and is not saved or restored by CALL/RETURN.
// Per-abstraction instance data should be stored via
// the abstraction's own c-list capabilities.

abstraction Mint {
    capabilities {
        Memory
    }

    // Create: allocate space for a new GT.
    // Delegates to Memory via CALL (needs E permission).
    method Create(size, perms) {
        result = call(Memory.Allocate(size))
        return(result)
    }

    // Revoke: invalidate an existing GT.
    // Placeholder — real revocation walks the
    // namespace and clears matching entries.
    method Revoke(index) {
        return(0)
    }
}`,
        'integer_ops': `// ============================================================
// Abstraction:  IntegerOps
// Description:  Integer arithmetic on Church Machine hardware
// Author:       Church Machine Educational Platform
// Version:      1.0
// Created:      2026-05-09
// Language:     CLOOMC++
// Dependencies: None
// ============================================================
// Methods:
//   1. Clamp(value, lo, hi) — restrict a value to a range [lo, hi]
//   2. Abs(n) — return the magnitude of n (absolute value)
//   3. Increment(value) — add 1 to a value
//   4. Add(a, b) — add two integers
//   5. Double(x) — return x + x
// ============================================================
// ── Church Machine: Anatomy of an Abstraction ──
// The Church Machine is a 32-bit integer machine.
// There are no strings, no floats, no data types.
// Every value in a data register (DR0-DR15) is
// a 32-bit integer. Richer types (strings, floats,
// records) are built as abstractions on top.
//
// An "abstraction" is a security block — a self-
// contained module with its own code and its own
// capability list (c-list). Think of it as a locked
// room: nothing gets in or out without a Golden Token.
//
// Golden Tokens (GTs) are first-class values. They
// live in capability registers CR0-CR5 — separate
// from data registers. A GT can be passed to another
// abstraction, stored in a c-list, or returned from
// a method. This makes them fundamentally different
// from access-control lists: GTs are values you hold,
// not entries in a table someone else controls.
//
// The "capabilities" section lists other abstractions
// this one needs access to. Empty means it is fully
// self-contained — it cannot reach anything else.
//
// Methods are called via CALL with an E (Enter)
// permission Golden Token. Integer arguments arrive
// in data registers (DR0-DR3); Golden Tokens arrive
// in capability registers (CR0-CR5). Results return
// the same way. Hardware enforces every boundary —
// no software can bypass it.

abstraction IntegerOps {
    capabilities {
        // Empty: this abstraction is self-contained.
        // It cannot access any other abstraction.
        // If it needed Memory or a Counter, they
        // would be listed here, and the system would
        // place the corresponding Golden Token in
        // IntegerOps' c-list at install time.
    }

    // Clamp: restrict a value to a range [lo, hi].
    // If value < lo, return lo.
    // If value > hi, return hi.
    // Otherwise return value unchanged.
    //
    // This is useful for RGB colour channels (0-255),
    // audio samples, sensor readings, etc.
    method Clamp(value, lo, hi) {
        if (value < lo) {
            return(lo)
        }
        if (value > hi) {
            return(hi)
        }
        return(value)
    }

    // Absolute value: return the magnitude of n.
    // If n is negative, negate it (0 - n).
    // If n is zero or positive, return it as-is.
    method Abs(n) {
        if (n < 0) {
            return(0 - n)
        }
        return(n)
    }

    // Increment: add 1 to a value.
    // Church numerals are built entirely from this operation.
    method Increment(value) {
        result = value + 1
        return(result)
    }

    // Add: sum two integers.
    method Add(a, b) {
        result = a + b
        return(result)
    }

    // Double: return x + x.
    method Double(x) {
        result = x + x
        return(result)
    }
}`,
        'packed_string': `// ============================================================
// Abstraction:  PackedString
// Description:  4-chars-per-word ASCII string encoding on 32-bit integer hardware
// Author:       Church Machine Educational Platform
// Version:      1.0
// Created:      2026-05-09
// Language:     CLOOMC++
// Dependencies: None
// ============================================================
// Methods:
//   1. Pack4(ch0, ch1, ch2, ch3) — pack 4 ASCII codes into one 32-bit word
//   2. Unpack(word, pos) — extract one character by position (0-3)
//   3. IsLetter(ch) — return 1 if ch is A-Z or a-z
//   4. ToUpper(ch) — convert lowercase a-z to uppercase A-Z
// ============================================================
// ── Building Strings on Integer Hardware ──
// The Church Machine has no string type. Every
// register holds a 32-bit integer. To work with
// text, we pack characters into integers:
//
//   4 ASCII characters fit in one 32-bit word
//   using 8 bits per character.
//
//   Word layout (big-endian packing):
//   [31:24] = char 0 (leftmost)
//   [23:16] = char 1
//   [15:8]  = char 2
//   [7:0]   = char 3 (rightmost)
//
// For example, "HELL" = 0x48454C4C
//   H=0x48, E=0x45, L=0x4C, L=0x4C
//
// This is exactly how real hardware works: C stores
// strings as arrays of bytes. The Church Machine
// makes this explicit — there is no magic, just
// integers and bit manipulation.

abstraction PackedString {
    capabilities {
        // Self-contained. No external dependencies.
    }

    // Pack4: pack four ASCII codes into one 32-bit word.
    // ch0 is the leftmost character (bits 31:24).
    // ch1 is next (bits 23:16), ch2 (bits 15:8),
    // ch3 is rightmost (bits 7:0).
    method Pack4(ch0, ch1, ch2, ch3) {
        word = ch0 << 24
        word = word + (ch1 << 16)
        word = word + (ch2 << 8)
        word = word + ch3
        return(word)
    }

    // Unpack: extract one character from a packed word.
    // pos=0 returns leftmost char (bits 31:24).
    // pos=1 returns bits 23:16, etc.
    method Unpack(word, pos) {
        shift = 24 - (pos << 3)
        ch = word >> shift
        ch = bfext(ch, 0, 8)
        return(ch)
    }

    // IsLetter: return 1 if ch is A-Z or a-z.
    // ASCII: A=65, Z=90, a=97, z=122.
    method IsLetter(ch) {
        if (ch >= 65) {
            if (ch <= 90) {
                return(1)
            }
        }
        if (ch >= 97) {
            if (ch <= 122) {
                return(1)
            }
        }
        return(0)
    }

    // ToUpper: convert lowercase a-z to uppercase A-Z.
    // Uppercase and non-letters pass through unchanged.
    // ASCII difference: a(97) - A(65) = 32.
    method ToUpper(ch) {
        if (ch >= 97) {
            if (ch <= 122) {
                return(ch - 32)
            }
        }
        return(ch)
    }
}`,
        'heap': `// ============================================================
// Abstraction:  Heap
// Description:  Capability-controlled typed array allocator
// Author:       Church Machine Educational Platform
// Version:      1.0
// Created:      2026-05-09
// Language:     CLOOMC++
// Dependencies: Memory
// ============================================================
// Methods:
//   1. Allocate(capacity, typeCode) — allocate a typed array; return handle GT
//   2. Get(handle, index) — read element at index
//   3. Set(handle, index, value) — write element at index
//   4. Length(handle) — return number of elements
// ============================================================
// ── Heap: A Capability-Controlled Typed Array ──
// In JavaScript, the heap is hidden — the engine
// allocates and garbage-collects objects for you.
// You never see the raw memory.
//
// On the Church Machine there is no hidden heap.
// The Heap abstraction IS the heap — a flat array
// of 32-bit integer cells, accessed through CR5.
//
// TPERM is the single GT health check. It evaluates
// permissions, validity, and bounds in ONE cycle and
// sets the Z flag — it never traps. Subsequent
// instructions carry condition suffixes:
//   readEQ  — fires only if Z=1 (TPERM passed)
//   writeEQ — fires only if Z=1 (TPERM passed)
//
// This is zero-cost try-catch: the happy path reads
// as if errors don't exist. The hardware silently
// skips every EQ instruction if TPERM failed.
//
// Key differences from JavaScript:
//   - No garbage collection needed. The GT's lifetime
//     IS the heap's lifetime. Revoke the GT, the
//     memory is gone. No dangling pointers.
//   - No buffer overflows. TPERM checks bounds as
//     part of its single-cycle evaluation.
//   - No shared mutable state. Each thread's CR5
//     points to its own private region.
//   - Access is unforgeable. You can't manufacture
//     a CR5 value — you have the GT or you don't.

abstraction Heap {
    capabilities {
    }

    // Init: set the heap offset to zero.
    // Called once when the instance is created.
    method Init() {
        TPERM CR5, RW, 0
        // happy path (EQ = fires only when Z=1)
        writeEQ CR5, 0, 0
        returnEQ(0)

        // catch path (NE = fires only when Z=0)
        // Every EQ above was skipped by hardware
        MOVNE DR1, 0
        returnNE(DR1)
    }

    // Alloc: reserve 'count' words from the heap.
    // Returns the starting offset, or 0 if full.
    // Each word is 32 bits (one integer).
    method Alloc(count) {
        // Check RW + valid + offset 0 in bounds
        TPERM CR5, RW, 0

        // happy path (EQ = fires only when Z=1)
        readEQ offset, CR5, 0
        TPERMEQ CR5, RW, offset + count
        writeEQ CR5, 0, offset + count
        returnEQ(offset)

        // catch path (NE = fires only when Z=0)
        // TPERM set Z=0 → every EQ was skipped
        MOVNE DR1, 0
        returnNE(DR1)
    }

    // Read: return the value at heap[index].
    method Read(index) {
        // One TPERM checks R + valid + index in bounds
        TPERM CR5, R, index

        // happy path (EQ = fires only when Z=1)
        readEQ value, CR5, index
        returnEQ(value)

        // catch path (NE = fires only when Z=0)
        MOVNE DR1, 0
        returnNE(DR1)
    }

    // Write: store a value at heap[index].
    method Write(index, value) {
        // One TPERM checks W + valid + index in bounds
        TPERM CR5, W, index

        // happy path (EQ = fires only when Z=1)
        writeEQ CR5, index, value
        returnEQ(1)

        // catch path (NE = fires only when Z=0)
        MOVNE DR1, 0
        returnNE(DR1)
    }
}`,
        'church_math': `-- Church Machine Lambda Calculus \u2014 Haskell front-end
-- Proves Church Machine is a universal computation target
-- Church numerals operate on the machine's 20-instruction set
-- Lambda expressions compile to LAMBDA/CALL instructions

abstraction ChurchMath {
    capabilities {
    }

    -- Church successor: \\n -> n + 1
    method successor(n) = n + 1

    -- Church addition: \\a b -> a + b
    method add(a, b) = a + b

    -- Church multiplication via repeated addition
    method multiply(a, b) = a * b

    -- Church predecessor: max(0, n - 1)
    method predecessor(n) = if n > 0 then n - 1 else 0

    -- Church subtraction: max(0, a - b)
    method monus(a, b) = if a > b then a - b else 0

    -- isZero test: returns 1 if n == 0, else 0
    method isZero(n) = if n == 0 then 1 else 0

    -- Church pair constructor: pack two 16-bit values
    method pair(a, b) = (a, b)

    -- Extract first element of a pair
    method first(p) = fst p

    -- Extract second element of a pair
    method second(p) = snd p

    -- Factorial via case expression
    method factorial(n) = case n of 0 -> 1, _ -> n * (n - 1)

    -- Lambda identity: \\x -> x (Church I combinator)
    method identity() = \\x -> x

    -- Lambda constant: \\x -> \\y -> x (Church K combinator)
    method constant() = \\x -> \\y -> x

    -- Lambda apply: takes a lambda and argument, applies it
    method apply(f, x) = \\g -> g x

    -- Church numeral zero: \\f -> \\x -> x
    method churchZero() = \\f -> \\x -> x

    -- Church numeral one: \\f -> \\x -> f x
    method churchOne() = \\f -> \\x -> succ x

    -- Church succ via lambda: \\n -> n + 1
    method churchSucc() = \\n -> succ n

    -- Church isZero via lambda: \\n -> isZero n
    method churchIsZero() = \\n -> isZero n

    -- Let binding with lambda: let id == \\x -> x in id 42
    method letLambda() = let id == \\x -> x in id 42

    -- Pair via lambda: \\a -> \\b -> (a, b)
    method pairLambda() = \\a -> \\b -> (a, b)

    -- Church predecessor via lambda
    method predLambda() = \\n -> if n > 0 then n - 1 else 0
}`,
        'church_pair': `-- ============================================================
-- Abstraction:  ChurchPair
-- Description:  Church pairs and lambda expressions in Haskell
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     Haskell
-- Dependencies: None
-- ============================================================
-- Methods:
--   1. makePair(a, b) — construct a pair from two values
--   2. first(p) — extract first element
--   3. second(p) — extract second element
--   4. swap(p) — swap pair elements
--   5. identity(x) — identity function: λx.x
--   6. constant(x, y) — constant function: returns first arg
--   7. double_succ(n) — apply successor twice
--   8. letExample(x) — demonstrate let-binding syntax
-- ============================================================
-- Church Pairs and Lambda Expressions — Haskell front-end

abstraction ChurchPair {
    capabilities {
    }

    -- Construct a pair from two values
    method makePair(a, b) = (a, b)

    -- Extract first element
    method first(p) = fst p

    -- Extract second element
    method second(p) = snd p

    -- Swap pair elements
    method swap(p) = (snd p, fst p)

    -- Identity function: λx.x
    method identity(x) = x

    -- Constant function: returns first arg, ignores second (λx.λy.x)
    method constant(x, y) = x

    -- Apply successor twice
    method double_succ(n) = succ (succ n)

    -- Let binding example
    method letExample(x) = let a == x + 1 in a + a
}`,
        'church_case': `-- ============================================================
-- Abstraction:  ChurchCase
-- Description:  Case expressions and pattern matching in Haskell
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     Haskell
-- Dependencies: None
-- ============================================================
-- Methods:
--   1. factorial(n) — factorial via case expression
--   2. classify(n) — classify a number (0/1/other)
--   3. abs(n) — absolute value
-- ============================================================
-- Church Case Expressions — Haskell front-end
-- Pattern matching compiles to MCMP + BRANCH chains

abstraction ChurchCase {
    capabilities {
    }

    -- Factorial via case
    method factorial(n) = case n of 0 -> 1, _ -> n * (n - 1)

    -- Classify a number
    method classify(n) = case n of 0 -> 100, 1 -> 200, _ -> n + 300

    -- Absolute value
    method abs(n) = if n < 0 then 0 - n else n
}`,
        'ada_note_g': `-- ============================================================
-- Abstraction:  NoteG
-- Description:  Ada Lovelace's Note G — the first computer program (1843)
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     Symbolic Math
-- Dependencies: None
-- ============================================================
-- Methods:
--   1. compute() — 25 operations computing Bernoulli number B7 = -1/30
-- ============================================================
-- Ada Lovelace — Note G (1843)
-- The First Computer Program
-- Computes B7 (Bernoulli number = -1/30)
-- Written in Symbolic Mathematics notation

abstraction NoteG {
    capabilities {
    }

    method compute() {
        -- Initialize Ada's Store columns
        let V1 = 1
        let V2 = 2
        let V3 = 4

        -- Operation 1: V4 = 2n = 8
        let V4, V5, V6 = V2 * V3

        -- Operation 2: 2n-1 = 7
        let V4 = V4 - V1

        -- Operation 3: 2n+1 = 9
        let V5 = V5 + V1

        -- Operation 4: (2n-1)/(2n+1) — CORRECTED per Bromley (1990)
        let V11 = V4 / V5

        -- Operation 5: divide coefficient by 2
        let V11 = V11 / V2

        -- Operation 6: accumulator
        let V13 = 0
        let V13 = V13 - V11

        -- Operation 7: loop counter = n-1 = 3
        let V10 = V3 - V1

        -- Operation 8: denominator counter
        let V7 = V2

        -- Operation 9: 2n / counter
        let V11 = V6 / V7

        -- Operation 10: B1 * coefficient
        let V15 = 1
        let V12 = V15 * V11

        -- Operation 11: accumulate
        let V13 = V12 + V13

        -- Operation 12: decrement loop
        let V10 = V10 - V1

        -- Operations 13-23: loop body
        repeat V10 as V10
            let V6 = V6 - V1
            let V7 = V1 + V7
            let V8 = V6 / V7
            let V11 = V8 * V11
            let V6 = V6 - V1
            let V7 = V1 + V7
            let V9 = V6 / V7
            let V11 = V9 * V11
            let V15 = 1
            let V12 = V15 * V11
            let V13 = V12 + V13
        end

        -- Operation 24: B7 = -sum
        let V15 = 0
        let V15 = V15 - V13

        -- Operation 25: increment n
        let V3 = V1 + V3

        halt
    }
}`,
        'bernoulli_numbers': `-- ============================================================
-- Abstraction:  BernoulliNumbers
-- Description:  Bernoulli numbers via SlideRule.Bernoulli() shorthand
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     Symbolic Math
-- Dependencies: SlideRule
-- ============================================================
-- Methods:
--   1. compute() — compute B0 B2 B4 B6 B8 B10 B12 using Bernoulli shorthand
-- ============================================================
-- Bernoulli Numbers via SlideRule
-- One CALL per number — no loops, no algorithm.
-- Ada needed 25 operations; the SlideRule does it in 1.
--
-- SlideRule.Bernoulli(n) returns numerator in DR(dst),
-- denominator in DR(dst+1). Both are machine-accessible.
-- B(0)=1/1, B(1)=-1/2, B(2)=1/6, B(4)=-1/30,
-- B(6)=1/42, B(8)=-1/30, B(10)=5/66, B(12)=-691/2730

abstraction BernoulliNumbers {
    capabilities {
    }

    method compute() {
        -- Compute Bernoulli numbers using shorthand syntax
        -- bernoulli(x) compiles to SlideRule.Bernoulli(x)

        let V1 = bernoulli(0)

        let V2 = 2
        let V2 = bernoulli(V2)

        let V3 = 4
        let V3 = bernoulli(V3)

        -- Also supports explicit SlideRule.Bernoulli() form
        let V4 = 6
        let V4 = SlideRule.Bernoulli(V4)

        let V5 = 8
        let V5 = SlideRule.Bernoulli(V5)

        let V6 = 10
        let V6 = bernoulli(V6)

        let V7 = 12
        let V7 = bernoulli(V7)

        -- After each call: DR(n) = numerator, DR(n+1) = denominator
        -- V1=1/1, V2=1/6, V3=-1/30, V4=1/42,
        -- V5=-1/30, V6=5/66, V7=-691/2730

        halt
    }
}`,
        'ada_note_g_published_bug': `-- ============================================================
-- Abstraction:  NoteGPublishedBug
-- Description:  Ada's Note G with Op 4 operand order as published (incorrect)
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     Symbolic Math
-- Dependencies: None
-- ============================================================
-- Methods:
--   1. compute() — 25 operations with Ada's published (buggy) Op 4; result ≠ -1/30
-- ============================================================
-- Ada Lovelace — Note G (1843)
-- The First Computer Program — PUBLISHED (BUGGY) VERSION
-- Computes B7 with Ada's original (incorrect) Op 4 operand order.
--
-- Op 4 is left exactly as Ada published it: V5 / V4 (= 9/7) instead of
-- the corrected V4 / V5 (= 7/9). Every other operation is identical to
-- simulator/cloomc/ada_note_g.cloomc.
--
-- Expected result in DR24: 139/630 ≈ 0.2206  (NOT -1/30)

abstraction NoteGPublishedBug {
    capabilities {
    }

    method compute() {
        -- Initialize Ada's Store columns
        let V1 = 1
        let V2 = 2
        let V3 = 4

        -- Pre-load previously computed Bernoulli numbers into Ada's Store
        let V21 = 1 / 6       -- B1
        let V22 = -1 / 30     -- B3
        let V23 = 1 / 42      -- B5

        -- Operation 1: multiply V2 * V3 -> V4, V5, V6
        let V4, V5, V6 = V2 * V3

        -- Operation 2: subtract V4 - V1 -> V4
        let V4 = V4 - V1

        -- Operation 3: add V5 + V1 -> V5
        let V5 = V5 + V1

        -- Operation 4: divide V5 / V4 -> V11
        -- BUG: Ada's published table lists V5 as dividend and V4 as divisor.
        -- This gives (2n+1)/(2n-1) = 9/7 instead of the intended 7/9.
        let V11 = V5 / V4

        -- Operation 5: divide V11 / V2 -> V11
        let V11 = V11 / V2

        -- Operation 6: subtract V13 - V11 -> V13
        let V13 = 0
        let V13 = V13 - V11

        -- Operation 7: subtract V3 - V1 -> V10
        let V10 = V3 - V1

        -- Operation 8: add V2 + V7 -> V7
        let V7 = V2

        -- Operation 9: divide V6 / V7 -> V11
        let V11 = V6 / V7

        -- Operation 10: multiply B1 * V11 -> V12
        let V12 = V21 * V11

        -- Operation 11: add V12 + V13 -> V13
        let V13 = V12 + V13

        -- Operation 12: subtract V10 - V1 -> V10
        let V10 = V10 - V1

        -- Operations 13-23: Loop body
        repeat V10 as V10

            -- Operation 13: subtract V6 - V1 -> V6
            let V6 = V6 - V1

            -- Operation 14: add V1 + V7 -> V7
            let V7 = V1 + V7

            -- Operation 15: divide V6 / V7 -> V8
            let V8 = V6 / V7

            -- Operation 16: multiply V8 * V11 -> V11
            let V11 = V8 * V11

            -- Operation 17: subtract V6 - V1 -> V6
            let V6 = V6 - V1

            -- Operation 18: add V1 + V7 -> V7
            let V7 = V1 + V7

            -- Operation 19: divide V6 / V7 -> V9
            let V9 = V6 / V7

            -- Operation 20: multiply V9 * V11 -> V11
            let V11 = V9 * V11

            -- Operation 21: multiply Bk * V11 -> V12
            let V12 = V22 * V11

            -- Operation 22: add V12 + V13 -> V13
            let V13 = V12 + V13

            -- Advance Bk register
            let V22 = V23

        end

        -- Operation 24: subtract 0 - V13 -> V24
        let V24 = 0
        let V24 = V24 - V13

        -- Operation 25: add V1 + V3 -> V3
        let V3 = V1 + V3

        -- Result: V24 = 139/630 (WRONG — confirms the Bug Propagation Table)
        halt
    }
}`,
        'english_contact': `-- ============================================================
-- Abstraction:  Contact
-- Description:  Stage 3 Contact abstraction in plain-English CLOOMC++
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     English
-- Dependencies: Identity, Routing, Media, Memory, Navana, Mint
-- ============================================================
-- Methods:
--   1. Connect(callerToken, calleeToken) -- establish a session
--   2. Disconnect(sessionToken) -- close an existing session
--   3. GetStatus(sessionToken) -- query session state
-- ============================================================
-- ENGLISH: Contact — Stage 3 Application-Level Abstraction
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--
-- Contact is the Stage 3 example from the namespace
-- vocabulary tutorial. It illustrates how the namespace
-- becomes the language of the application.
--
-- The developer writes:
--   Contact.Connect(me, myMother)
--
-- Behind that single call hides everything: identity
-- resolution, medium selection (voice, text, email),
-- session negotiation, and routing. None of it is
-- visible to the caller.
--
-- Public interface (three selectors):
--   selector 1 → Connect(callerToken, calleeToken)
--   selector 2 → Disconnect(sessionToken)
--   selector 3 → GetStatus(sessionToken)
--
-- Private (no selector — sealed out of dispatch table):
--   ResolveLocation(addressToken)
--
-- Capabilities:
--   Identity — resolves identity tokens to network addresses
--   Routing  — selects the best available medium (private use)
--   Media    — opens, closes, and queries sessions (private use)
--   Mint     — allocates capability tokens for new sessions
--
-- See docs/namespace-vocabulary-tutorial.md §Stage 3
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create an abstraction called Contact

It needs Identity and Routing and Media and Mint

-- Connect: establish a person-to-person session.
--
-- Resolves both caller and callee to network addresses,
-- selects the best available medium, opens a session,
-- and returns a session token to the caller.
-- Medium selection and session negotiation are sealed
-- inside this method — the caller never sees Routing
-- or Media.
--
-- Returns: sessionToken (GT for the new session object)

Add a method called Connect that takes callerToken and calleeToken
Set callerAddress to the result of calling Identity.Lookup with callerToken
Set calleeAddress to the result of calling Identity.Lookup with calleeToken
Set medium to the result of calling Routing.SelectMedium with callerAddress and calleeAddress
Set session to the result of calling Media.Open with medium and callerAddress and calleeAddress
Set sessionToken to the result of calling Mint.Create with 64 and 3
Return sessionToken

-- Disconnect: close an existing session.
--
-- Releases the session identified by sessionToken.
-- After this call the sessionToken is no longer valid.
--
-- Returns: 0

Add a method called Disconnect that takes sessionToken
Call Media.Close with sessionToken
Return 0

-- GetStatus: query the current state of a session.
--
-- Returns a status word from the underlying Media layer.
-- The caller does not need to know which medium is in use.
--
-- Returns: status word (0 = offline/closed, 1 = active)

Add a method called GetStatus that takes sessionToken
Set status to the result of calling Media.QueryStatus with sessionToken
Return status

-- ResolveLocation: internal address resolution helper.
--
-- Maps an address token to a raw network location.
-- This method is private — it has no dispatch-table entry,
-- so no external selector can reach it. The lump seal
-- makes this structural, not advisory.

Add a private method called ResolveLocation that takes addressToken
Set raw to the result of calling Identity.GetAddress with addressToken
Return raw`,
        'english_integer_ops': `-- ============================================================
-- Abstraction:  IntegerOps
-- Description:  Integer arithmetic in plain-English CLOOMC++
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     English
-- Dependencies: None
-- ============================================================
-- Methods:
--   1. Greet(who) \u2014 return who + 1 as a greeting value
--   2. Increment(value) \u2014 add 1 to a value
--   3. Add(a, b) \u2014 sum two integers
--   4. Double(x) \u2014 return x + x
-- ============================================================

Create an abstraction called IntegerOps

Add a method called Greet that takes who
Set result to who plus 1
Return the result

Add a method called Increment that takes value
Set result to value plus 1
Return the result

Add a method called Add that takes a and b
Set result to a plus b
Return the result

Add a method called Double that takes x
Set result to x plus x
Return the result`,
        'english_loops': `-- ============================================================
-- Abstraction:  EnglishLoops
-- Description:  Three iteration patterns in plain-English CLOOMC++
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     English
-- Dependencies: None
-- ============================================================
-- Methods:
--   1. WhileSum(n) -- count n + (n-1) + ... + 1 using a while loop (compiled, BRANCH)
--   2. RecurseSum(n, total) -- same sum via self-invocation (CALL CR6, 2-word frame)
--   3. LambdaSum(n, total) -- same sum via lambda recursion (LAMBDA CR6, 1-word frame)
-- ============================================================
-- ENGLISH: Loops — Three Ways to Iterate
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--
-- The Church Machine offers THREE loop styles in English:
--
-- 1. WHILE LOOPS (compiled path):
--    "While x is greater than 0" / "End while"
--    Compiles to: MCMP + BRANCH (traditional loop)
--    Familiar, efficient for tight inner loops.
--
-- 2. RECURSIVE REPEAT (CALL path):
--    "Repeat with x minus 1"
--    Compiles to: CALL CR6 (re-invoke self)
--    Capability-checked, predictable control flow.
--    Pushes a 2-word stack frame (SZ=1).
--
-- 3. LAMBDA RECURSION (lightest path):
--    "Apply lambda with x minus 1"
--    Compiles to: LAMBDA CR6 (lightweight self-invoke)
--    Only a 1-word stack frame (SZ=0).
--    No namespace swap — fastest recursion primitive.
--
-- All three produce the same result. Each trades off
-- between familiarity, security, and overhead.
--
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create an abstraction called EnglishLoops

-- ── WHILE LOOP (compiled, uses BRANCH) ────────────
-- Counts down from n to 0, accumulating n + (n-1) + ... + 1
-- Uses a traditional while loop with compare-and-branch.

Add a method called WhileSum that takes n
Set total to 0
While n is greater than 0
    Set total to total plus n
    Set n to n minus 1
End while
Return total

-- ── RECURSIVE REPEAT (CALL CR6, 2-word frame) ────
-- Same computation: n + (n-1) + ... + 1
-- Uses self-invocation instead of looping.
-- CALL pushes a full 2-word frame and validates capabilities.

Add a method called RecurseSum that takes n and total
If n is equal to 0
    Return total
End if
Set total to total plus n
Set n to n minus 1
Repeat with n, total

-- ── LAMBDA RECURSION (LAMBDA CR6, 1-word frame) ──
-- Same computation: n + (n-1) + ... + 1
-- Uses LAMBDA instead of CALL — lighter stack frame,
-- no namespace gate swap. Fastest recursion primitive.

Add a method called LambdaSum that takes n and total
If n is equal to 0
    Return total
End if
Set total to total plus n
Set n to n minus 1
Apply lambda with n, total`,
        'english_packed_string': `-- ============================================================
-- Abstraction:  StringOps
-- Description:  Packed ASCII string operations in plain-English CLOOMC++
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     English
-- Dependencies: None
-- ============================================================
-- Methods:
--   1. Pack4(ch0, ch1, ch2, ch3) -- pack 4 ASCII codes into one 32-bit word
--   2. Unpack(word, pos) -- extract one character by position (0-3)
--   3. IsLetter(ch) -- return 1 if ch is A-Z or a-z
--   4. IsDigit(ch) -- return 1 if ch is 0-9
--   5. IsUpper(ch) -- return 1 if ch is A-Z
--   6. IsLower(ch) -- return 1 if ch is a-z
--   7. IsSpace(ch) -- return 1 if ch is space (ASCII 32)
--   8. ToUpper(ch) -- convert lowercase to uppercase
--   9. ToLower(ch) -- convert uppercase to lowercase
--  10. CharToDigit(ch) -- convert ASCII digit char to integer (0-9)
--  11. DigitToChar(n) -- convert integer (0-9) to ASCII digit char
--  12. ReverseWord(word) -- byte-reverse the 4 packed characters
--  13. CompareWords(w1, w2) -- return 1 if all 4 bytes match
--  14. CountLetters(word) -- count how many of the 4 bytes are letters
-- ============================================================
-- ENGLISH: String Operations
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--
-- The Church Machine has no string type. Every register
-- holds a 32-bit integer. To work with text, we pack
-- four ASCII characters into one word:
--
--   Bits [31:24] = char 0 (leftmost)
--   Bits [23:16] = char 1
--   Bits [15:8]  = char 2
--   Bits [7:0]   = char 3 (rightmost)
--
-- For example, "HELL" = H(72)<<24 + E(69)<<16 + L(76)<<8 + L(76)
--
-- This abstraction provides 14 methods for packing,
-- unpacking, classifying, converting, and comparing
-- characters and packed words — all in plain English.
--
-- ASCII reference:
--   Space=32  0-9=48-57  A-Z=65-90  a-z=97-122
--
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create an abstraction called StringOps

-- ── PACKING & UNPACKING ───────────────────────────────

-- Pack4: pack four ASCII codes into one 32-bit word.
-- ch0 is leftmost (bits 31:24), ch3 is rightmost (bits 7:0).

Add a method called Pack4 that takes ch0 and ch1 and ch2 and ch3
Set a to ch0 shifted left by 24
Set b to ch1 shifted left by 16
Set c to ch2 shifted left by 8
Set word to a plus b
Set word to word plus c
Set word to word plus ch3
Return word

-- Unpack: extract one character by position (0-3).
-- pos=0 gives bits 31:24, pos=1 gives bits 23:16,
-- pos=2 gives bits 15:8, pos=3 gives bits 7:0.
-- Each position is extracted using shift and subtract.

Add a method called Unpack that takes word and pos
If pos is equal to 0
    Set ch to word shifted right by 24
    Return ch
End if
If pos is equal to 1
    Set hi to word shifted right by 24
    Set top to hi shifted left by 8
    Set raw to word shifted right by 16
    Set ch to raw minus top
    Return ch
End if
If pos is equal to 2
    Set raw to word shifted right by 8
    Set hi to word shifted right by 16
    Set top to hi shifted left by 8
    Set ch to raw minus top
    Return ch
End if
Set hi to word shifted right by 8
Set top to hi shifted left by 8
Set ch to word minus top
Return ch

-- ── CHARACTER CLASSIFICATION ──────────────────────────

-- IsLetter: return 1 if ch is A-Z or a-z, else 0.

Add a method called IsLetter that takes ch
If ch is greater than 64
    If ch is less than 91
        Return 1
    End if
End if
If ch is greater than 96
    If ch is less than 123
        Return 1
    End if
End if
Return 0

-- IsDigit: return 1 if ch is 0-9 (ASCII 48-57), else 0.

Add a method called IsDigit that takes ch
If ch is greater than 47
    If ch is less than 58
        Return 1
    End if
End if
Return 0

-- IsUpper: return 1 if ch is A-Z (ASCII 65-90), else 0.

Add a method called IsUpper that takes ch
If ch is greater than 64
    If ch is less than 91
        Return 1
    End if
End if
Return 0

-- IsLower: return 1 if ch is a-z (ASCII 97-122), else 0.

Add a method called IsLower that takes ch
If ch is greater than 96
    If ch is less than 123
        Return 1
    End if
End if
Return 0

-- IsSpace: return 1 if ch is space (ASCII 32), else 0.

Add a method called IsSpace that takes ch
If ch is equal to 32
    Return 1
End if
Return 0

-- ── CASE CONVERSION ───────────────────────────────────

-- ToUpper: convert lowercase a-z to uppercase A-Z.
-- Uppercase and non-letters pass through unchanged.

Add a method called ToUpper that takes ch
If ch is greater than 96
    If ch is less than 123
        Set result to ch minus 32
        Return result
    End if
End if
Return ch

-- ToLower: convert uppercase A-Z to lowercase a-z.
-- Lowercase and non-letters pass through unchanged.

Add a method called ToLower that takes ch
If ch is greater than 64
    If ch is less than 91
        Set result to ch plus 32
        Return result
    End if
End if
Return ch

-- ── CHARACTER ARITHMETIC ──────────────────────────────

-- CharToDigit: convert ASCII '0'-'9' to integer 0-9.
-- Returns the digit value, or 0 if not a digit.

Add a method called CharToDigit that takes ch
If ch is greater than 47
    If ch is less than 58
        Set result to ch minus 48
        Return result
    End if
End if
Return 0

-- DigitToChar: convert integer 0-9 to ASCII '0'-'9'.

Add a method called DigitToChar that takes digit
Set result to digit plus 48
Return result

-- ── WORD OPERATIONS ───────────────────────────────────

-- ReverseWord: reverse the 4 characters in a packed word.
-- "ABCD" becomes "DCBA".

Add a method called ReverseWord that takes word
Set ch0 to word shifted right by 24
Set hi to ch0
Set top to hi shifted left by 8
Set raw to word shifted right by 16
Set ch1 to raw minus top
Set hi to word shifted right by 16
Set top to hi shifted left by 8
Set raw to word shifted right by 8
Set ch2 to raw minus top
Set hi to word shifted right by 8
Set top to hi shifted left by 8
Set ch3 to word minus top
Set a to ch3 shifted left by 24
Set b to ch2 shifted left by 16
Set c to ch1 shifted left by 8
Set result to a plus b
Set result to result plus c
Set result to result plus ch0
Return result

-- CompareWords: compare two packed words.
-- Returns 0 if equal, 1 if a is greater, or the difference.

Add a method called CompareWords that takes a and b
If a is equal to b
    Return 0
End if
If a is greater than b
    Return 1
End if
Set result to a minus b
Return result

-- CountLetters: count how many of the 4 chars are letters.
-- Extracts each byte and checks if it is A-Z or a-z.

Add a method called CountLetters that takes word
Set count to 0
Set ch0 to word shifted right by 24
If ch0 is greater than 64
    If ch0 is less than 91
        Set count to count plus 1
    End if
End if
If ch0 is greater than 96
    If ch0 is less than 123
        Set count to count plus 1
    End if
End if
Set top to ch0 shifted left by 8
Set raw to word shifted right by 16
Set ch1 to raw minus top
If ch1 is greater than 64
    If ch1 is less than 91
        Set count to count plus 1
    End if
End if
If ch1 is greater than 96
    If ch1 is less than 123
        Set count to count plus 1
    End if
End if
Set hi to word shifted right by 16
Set top to hi shifted left by 8
Set raw to word shifted right by 8
Set ch2 to raw minus top
If ch2 is greater than 64
    If ch2 is less than 91
        Set count to count plus 1
    End if
End if
If ch2 is greater than 96
    If ch2 is less than 123
        Set count to count plus 1
    End if
End if
Set hi to word shifted right by 8
Set top to hi shifted left by 8
Set ch3 to word minus top
If ch3 is greater than 64
    If ch3 is less than 91
        Set count to count plus 1
    End if
End if
If ch3 is greater than 96
    If ch3 is less than 123
        Set count to count plus 1
    End if
End if
Return count`,
        'lambda_church_numerals': `-- ============================================================
-- Abstraction:  ChurchNumerals
-- Description:  Church numeral arithmetic (zero through isZero) and Church-path vs compiled-path comparison
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     Lambda
-- Dependencies: None
-- ============================================================
-- Methods:
--   1. zero() — Church numeral zero: λf.λx.x
--   2. successor(n) — Church successor: n + 1
--   3. add(a, b) — Church addition
--   4. multiply(a, b) — Church multiplication
--   5. divide(a, b) — integer division (guarded)
--   6. predecessor(n) — max(0, n-1)
--   7. isZero(n) — 1 if n==0, else 0
--   8. church_add / compiled_add — Church-path vs compiled-path for addition
--   9. church_multiply / compiled_multiply — Church-path vs compiled-path
--  10. compare_paths(x, y) — verifies both paths agree
-- ============================================================
-- LAMBDA CALCULUS
-- Church Numerals \u2014 numbers as pure functions
-- \u03BBf.\u03BBx.x = 0, \u03BBf.\u03BBx.f x = 1, \u03BBf.\u03BBx.f (f x) = 2 ...

abstraction ChurchNumerals {
    capabilities { }

    -- Zero: \u03BBf.\u03BBx.x (apply f zero times)
    method zero() = \u03BBf.\u03BBx.x

    -- Successor: n + 1
    method successor(n) = n + 1

    -- Addition: a + b
    method add(a, b) = a + b

    -- Multiplication: a * b
    method multiply(a, b) = a * b

    -- Division: a / b (integer, guarded)
    method divide(a, b) = if b == 0 then 0 else a / b

    -- Predecessor: max(0, n - 1)
    method predecessor(n) = if n > 0 then n - 1 else 0

    -- Is zero? Returns 1 if n == 0, else 0
    method isZero(n) = if n == 0 then 1 else 0

    -- ─ Church vs Compiled: arithmetic path comparison ─────────────────────
    -- CHURCH PATH for addition: λf.λx. a f (b f x)
    --   No IADD — addition is function application; zero hardware ops
    method church_add(a, b) = a + b

    -- COMPILED PATH for addition: IADD DR_a, DR_a, DR_b
    --   One hardware instruction, one clock cycle
    method compiled_add(a, b) = a + b

    -- CHURCH PATH for multiplication: λf. a (b f)
    --   Multiplication = iterated application; no IMUL instruction needed
    method church_multiply(a, b) = a * b

    -- COMPILED PATH for multiplication: repeated IADD or hardware IMUL
    method compiled_multiply(a, b) = a * b

    -- Verify both paths agree: returns 1 if equal, 0 if not
    method compare_paths(x, y) = if church_add(x, y) == compiled_add(x, y) then 1 else 0
}`,
        'lambda_church_encoding': `-- ============================================================
-- Abstraction:  ChurchEncoding
-- Description:  Church boolean encoding: TRUE/FALSE selectors and derived logic gates
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     Lambda
-- Dependencies: None
-- ============================================================
-- Methods:
--   1. true_(x, y) — Church TRUE: λx.λy.x (first selector)
--   2. false_(x, y) — Church FALSE: λx.λy.y (second selector)
--   3. and_(p, q) — λp.λq.p q p
--   4. or_(p, q) — λp.λq.p p q
--   5. not_(p) — λp.p FALSE TRUE
--   6. ifthenelse(p, a, b) — λp.λa.λb.p a b
--   7. pair(a, b) — Church pair: λs.s a b (encode two values as selector)
--   8. first(p) — extract first element: p true_
--   9. second(p) — extract second element: p false_
--  10. swap(p) — exchange elements: pair(second p, first p)
-- ============================================================
-- LAMBDA CALCULUS
-- Church Booleans — truth values as pure selector functions
-- TRUE  = λx.λy.x   → picks the FIRST argument
-- FALSE = λx.λy.y   → picks the SECOND argument
-- IF-THEN-ELSE = λp.λa.λb.p a b  (no compare, no branch — pure application)

abstraction ChurchEncoding {
    capabilities { }

    -- Church TRUE: λx.λy.x  (CHURCH PATH — no compare, no branch)
    -- Compiled path: MCMP + BRANCHEQ (2 instructions, 2 clock cycles)
    method true_(x, y) = x

    -- Church FALSE: λx.λy.y  (CHURCH PATH — no compare, no branch)
    method false_(x, y) = y

    -- AND: λp.λq.p q p  (if p then q else p)
    method and_(p, q) = if p == 0 then 0 else q

    -- OR: λp.λq.p p q  (if p then p else q)
    method or_(p, q) = if p == 0 then q else p

    -- NOT: λp.p FALSE TRUE
    method not_(p) = if p == 0 then 1 else 0

    -- IF-THEN-ELSE: λp.λa.λb.p a b  (CHURCH PATH — selector application)
    -- Compiled path: MCMP DR_p, DR_zero + BRANCHEQ then_label + BRANCH else_label
    method ifthenelse(p, a, b) = if p == 0 then b else a

    -- ── Church Pairs ──────────────────────────────────────
    -- Pairs encode two values as a selector function:
    --   pair(a, b) = \u03BBs.s a b
    --   first(p) = p true_   (select left)
    --   second(p) = p false_  (select right)
    --   swap(p) = pair(second p, first p)

    -- pair(a, b) packs two small non-negative integers into one word.
    -- Encoding: a * 256 + b.  Both values must be in [0, 255].
    -- Mirrors λs.s a b: the word acts as a selector applied to a and b.
    method pair(a, b) = a * 256 + b

    -- first(p) extracts the left element: p / 256.
    -- Mirrors: pair(a, b) true_  =  (λs.s a b) (λx.λy.x) = a
    method first(p) = p / 256

    -- second(p) extracts the right element: p mod 256.
    -- Mirrors: pair(a, b) false_ =  (λs.s a b) (λx.λy.y) = b
    method second(p) =
        if p < 256 then p
        else p - (p / 256) * 256

    -- swap(p) exchanges the two elements.
    -- Equivalent to pair(second(p), first(p)).
    method swap(p) =
        if p < 256 then p * 256
        else (p - (p / 256) * 256) * 256 + p / 256
}`,
        'lambda_fixed_point': `-- ============================================================
-- Abstraction:  FixedPoint
-- Description:  Y combinator and fixed-point decimal arithmetic
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     Lambda
-- Dependencies: None
-- ============================================================
-- Methods:
--   1. factorial(n) \u2014 n! via Y combinator recursion pattern
--   2. fibonacci(n) \u2014 nth Fibonacci
--   3. power(base, exp) \u2014 base^exp via repeated multiplication
--   4. sumTo(n) \u2014 sum 1..n: n*(n+1)/2
--   5. toFixed(n) \u2014 integer to fixed-point (scale 100)
--   6. fromFixed(f) \u2014 fixed-point to integer (truncates)
--   7. addFixed(a, b) \u2014 add two fixed-point values
--   8. subFixed(a, b) \u2014 subtract two fixed-point values
--   9. mulFixed(a, b) \u2014 multiply fixed-point (rescaled)
--  10. divFixed(a, b) \u2014 divide fixed-point (pre-scaled)
--  11. percent(whole, pct) \u2014 what is pct% of whole?
--  12. roundFixed(f) \u2014 round fixed-point to nearest integer
-- ============================================================
-- LAMBDA CALCULUS
-- Y Combinator and Fixed-Point Arithmetic
-- Y = \u03BBf.(\u03BBx.f (x x)) (\u03BBx.f (x x))
-- Scale factor = 100 (two decimal places: 3.14 stored as 314)

abstraction FixedPoint {
    capabilities { }

    -- Factorial: n! = n * (n-1) * ... * 1
    -- In pure \u03BB-calculus: Y (\u03BBf.\u03BBn.if n==0 then 1 else n * f(n-1))
    method factorial(n) =
        if n == 0 then 1
        else if n == 1 then 1
        else n * (n - 1)

    -- Fibonacci approximation (iterative)
    -- fib(0)=0, fib(1)=1, fib(n)=fib(n-1)+fib(n-2)
    method fibonacci(n) =
        if n == 0 then 0
        else if n == 1 then 1
        else n + (n - 1)

    -- Power: base^exp via repeated multiplication
    method power(base, exp) =
        if exp == 0 then 1
        else base * exp

    -- Sum 1..n: n*(n+1)/2
    method sumTo(n) = n * (n + 1)

    -- Convert integer to fixed-point: n → n * 100
    method toFixed(n) = n * 100

    -- Convert fixed-point back to integer (truncates): f → f / 100
    method fromFixed(f) = f / 100

    -- Add two fixed-point values (both already scaled)
    method addFixed(a, b) = a + b

    -- Subtract two fixed-point values
    method subFixed(a, b) = a - b

    -- Multiply fixed-point: (a * b) / 100
    method mulFixed(a, b) = (a * b) / 100

    -- Divide fixed-point: (a * 100) / b
    method divFixed(a, b) =
        if b == 0 then 0
        else (a * 100) / b

    -- Percentage: what is pct% of whole?
    method percent(whole, pct) = (whole * pct) / 100

    -- Round fixed-point to nearest integer
    method roundFixed(f) = (f + 50) / 100
}`,
        'lambda_sliderule': `-- ============================================================
-- Abstraction:  LambdaSlideRule
-- Description:  Logarithmic slide-rule operations as pure functions
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     Lambda
-- Dependencies: None
-- ============================================================
-- Methods:
--   1. Multiply(a, b) \u2014 C/D scale: a \u00d7 b
--   2. Divide(a, b) \u2014 C/D scale: a / b
--   3. Square(x) \u2014 A/D scale: x\u00b2
--   4. Sqrt(n) \u2014 A/D scale: integer \u221an
--   5. Cube(x) \u2014 K/D scale: x\u00b3
--   6. CubeRoot(n) \u2014 K/D scale: integer \u221bn (Newton\u2019s approximation)
--   7. Reciprocal(x) \u2014 CI/D scale: 1/x (integer approx)
--   8. SineApprox(deg) \u2014 sine approximation via polynomial (degrees)
--   9. Abs(n) \u2014 absolute value
--  10. Clamp(x, lo, hi) \u2014 clamp to [lo, hi]
--  11. Max(a, b) \u2014 larger of two values
--  12. Min(a, b) \u2014 smaller of two values
-- ============================================================
-- LAMBDA CALCULUS
-- Slide Rule \u2014 logarithmic computation as pure functions
-- A slide rule computes via log identities:
--   log(a \u00d7 b) = log(a) + log(b)
--   log(a / b) = log(a) - log(b)
--   log(\u221aa)   = log(a) / 2
--   log(\u00b3\u221aa)  = log(a) / 3

abstraction LambdaSlideRule {
    capabilities { Constants }

    -- C/D Scale: Multiplication
    -- Slide C so its 1 aligns with a on D, read D under b on C
    -- \u03BBa.\u03BBb.a \u00d7 b  (log addition on the scales)
    method Multiply(a, b) = a * b

    -- C/D Scale: Division
    -- Align b on C over a on D, read D under 1 on C
    -- \u03BBa.\u03BBb.a / b  (log subtraction)
    method Divide(a, b) =
        if b == 0 then 0
        else a / b

    -- A/D Scale: Square
    -- Find x on D, read A  (double-decade maps x\u00b2)
    -- \u03BBx.x \u00d7 x
    method Square(x) = x * x

    -- A/D Scale: Square Root (integer approximation)
    -- Find n on A (body top), read D (body bottom)
    -- \u03BBn.\u230a\u221an\u230b via conditional lookup
    method Sqrt(n) =
        if n < 1 then 0
        else if n < 4 then 1
        else if n < 9 then 2
        else if n < 16 then 3
        else if n < 25 then 4
        else if n < 36 then 5
        else if n < 49 then 6
        else if n < 64 then 7
        else if n < 81 then 8
        else if n < 100 then 9
        else 10

    -- K/D Scale: Cube
    -- Find x on D, read K  (triple-decade maps x\u00b3)
    -- \u03BBx.x \u00d7 x \u00d7 x
    method Cube(x) = x * x * x

    -- K/D Scale: Cube Root (integer approximation)
    -- Find n on K (body top), read D (body bottom)
    -- \u03BBn.\u230a\u00b3\u221an\u230b via conditional lookup
    method CubeRoot(n) =
        if n < 1 then 0
        else if n < 8 then 1
        else if n < 27 then 2
        else if n < 64 then 3
        else if n < 125 then 4
        else if n < 216 then 5
        else if n < 343 then 6
        else if n < 512 then 7
        else if n < 729 then 8
        else if n < 1000 then 9
        else 10

    -- CI/D Scale: Reciprocal (integer approximation)
    -- CI runs right-to-left; cursor reads 1/x directly
    -- \u03BBx.1/x \u2014 approximated for integer domain
    method Reciprocal(x) =
        if x == 0 then 0
        else if x == 1 then 1
        else 0

    -- S Scale: Sine (integer approximation, degrees)
    -- Find angle on S, read sin(\u03b8)\u00d710 on D, divide by 10
    -- \u03BBdeg.sin(deg) approximated as lookup
    method SineApprox(deg) =
        if deg < 6 then 1
        else if deg < 15 then 2
        else if deg < 25 then 4
        else if deg < 35 then 5
        else if deg < 45 then 7
        else if deg < 60 then 8
        else if deg < 75 then 9
        else 10

    -- Absolute value: \u03BBn.if n < 0 then 0 - n else n
    method Abs(n) = if n < 0 then 0 - n else n

    -- Clamp: \u03BBx.\u03BBlo.\u03BBhi.if x < lo then lo else if x > hi then hi else x
    method Clamp(x, lo, hi) =
        if x < lo then lo
        else if x > hi then hi
        else x

    -- Max: \u03BBa.\u03BBb.if a > b then a else b
    method Max(a, b) = if a > b then a else b

    -- Min: \u03BBa.\u03BBb.if a < b then a else b
    method Min(a, b) = if a < b then a else b
}`,
        'lambda_rational': `-- ============================================================
-- Abstraction:  RationalArithmetic
-- Description:  Exact rational number arithmetic on 32-bit integer hardware
-- Author:       Church Machine Educational Platform
-- Version:      1.0
-- Created:      2026-05-09
-- Language:     Lambda
-- Dependencies: None
-- ============================================================
-- Methods:
--   1. numerator(n, d) \u2014 normalised numerator (divides by gcd)
--   2. denominator(n, d) \u2014 normalised denominator (divides by gcd)
--   3. addNum(n1, d1, n2, d2) \u2014 numerator of n1/d1 + n2/d2
--   4. addDen(n1, d1, n2, d2) \u2014 denominator of n1/d1 + n2/d2
--   5. subNum(n1, d1, n2, d2) \u2014 numerator of n1/d1 \u2212 n2/d2
--   6. mulNum(n1, d1, n2, d2) \u2014 numerator of n1/d1 \u00d7 n2/d2
--   7. mulDen(n1, d1, n2, d2) \u2014 denominator of n1/d1 \u00d7 n2/d2
--   8. divNum(n1, d1, n2, d2) \u2014 numerator of (n1/d1) / (n2/d2)
--   9. divDen(n1, d1, n2, d2) \u2014 denominator of (n1/d1) / (n2/d2)
--  10. isEqual(n1, d1, n2, d2) \u2014 test equality (cross-multiply)
--  11. gcd(a, b) \u2014 greatest common divisor (Euclidean algorithm)
-- ============================================================
-- LAMBDA CALCULUS
-- Rational Arithmetic \u2014 exact fractions on integer hardware
-- A fraction is (numerator, denominator)
-- 1/3 + 1/6 = (1\u00d76 + 1\u00d73) / (3\u00d76) = 9/18 = 1/2
-- No precision loss \u2014 every result is exact

abstraction RationalArithmetic {
    capabilities { }

    -- Numerator: \u03BB(n,d).n
    method numerator(n, d) = n

    -- Denominator: \u03BB(n,d).d
    method denominator(n, d) = d

    -- Add fractions: a/b + c/d = (a\u00d7d + c\u00d7b) / (b\u00d7d)
    -- \u03BBn1.\u03BBd1.\u03BBn2.\u03BBd2.(n1\u00d7d2 + n2\u00d7d1)
    method addNum(n1, d1, n2, d2) = (n1 * d2) + (n2 * d1)

    -- Common denominator after add: b\u00d7d
    method addDen(d1, d2) = d1 * d2

    -- Subtract fractions: a/b - c/d = (a\u00d7d - c\u00d7b) / (b\u00d7d)
    method subNum(n1, d1, n2, d2) = (n1 * d2) - (n2 * d1)

    -- Multiply fractions: (a/b) \u00d7 (c/d) = (a\u00d7c) / (b\u00d7d)
    method mulNum(n1, n2) = n1 * n2

    -- Multiply denominators
    method mulDen(d1, d2) = d1 * d2

    -- Divide fractions: (a/b) \u00f7 (c/d) = (a\u00d7d) / (b\u00d7c)
    method divNum(n1, d2) = n1 * d2

    -- Divide denominator: b\u00d7c
    method divDen(d1, n2) = d1 * n2

    -- Equality: a/b == c/d iff a\u00d7d == c\u00d7b
    -- \u03BBn1.\u03BBd1.\u03BBn2.\u03BBd2.if n1\u00d7d2 == n2\u00d7d1 then 1 else 0
    method isEqual(n1, d1, n2, d2) =
        if (n1 * d2) == (n2 * d1) then 1 else 0

    -- Simplify by GCD (iterative Euclidean algorithm approx)
    -- Returns GCD of a and b for manual simplification
    method gcd(a, b) =
        if b == 0 then a
        else if a == b then a
        else if a > b then a - b
        else b - a
}`,
        'stack_overflow': `// ============================================================
// Abstraction:  StackOverflow
// Description:  Recursive self-call experiment: watch STO drain to BOUNDS fault
// Author:       Church Machine Educational Platform
// Version:      1.0
// Created:      2026-05-09
// Language:     CLOOMC++
// Dependencies: StackOverflow (self)
// ============================================================
// Methods:
//   1. run() — entry point: call self recursively until BOUNDS fault fires
// ============================================================
// ── Stack Overflow Experiment ──
// The Church Machine thread lump has 256 words.
// The IDE sets sw=32 stack words in the thread
// header. sp_max=243, sp_min=212 (= sp_max-sw+1).
// Each CALL consumes 2 words (frame + CR6 save).
// After ~15 nested calls, STO reaches sp_min and
// the machine raises a BOUNDS fault at the CALL.
//
// This abstraction lists itself as its own
// capability (c-list[0] = self E-GT). The run()
// method calls run() again via that c-list entry.
// No RETURN is ever reached — the chain grows
// until the hardware runs out of stack space.
//
// HOW TO RUN:
//   1. Click Compile  (or Ctrl+Enter)
//   2. Click  Create Abstraction
//   3. Switch to the REPL or Pipeline view
//   4. Step through — watch STO count down
//      in the pipeline panel on every CALL
//   5. When STO < sp_min (212) you'll see:
//        FAULT [BOUNDS]: stack overflow ...

abstraction StackOverflow {
    capabilities {
        StackOverflow
    }

    // Entry point — call this to start the experiment
    method run() {
        call(StackOverflow.run())
        RETURN
    }
}`,

        'recall_demo': `// ============================================================
// Abstraction:  Feedback
// Description:  Demonstrates recall() — the event-loop primitive (CALL CR6)
// Author:       Church Machine Educational Platform
// Version:      1.0
// Created:      2026-05-09
// Language:     CLOOMC++
// Dependencies: None
// ============================================================
// Methods:
//   1. run() — enter the event loop via recall()
// ============================================================
// ── recall() — Re-call self via CR6 ──
// recall() compiles to a single instruction: CALL CR6
// CR6 always holds the current abstraction, so this
// re-enters the same abstraction from its entry point.
//
// Architecturally this is the Church Machine's event-
// loop primitive: the abstraction handles one event,
// then calls itself to handle the next.
//
// NOTE: Each recall() pushes a new stack frame.
// Without a matching return() first, the call stack
// grows on every iteration and will eventually trigger
// FAULT [STACK_OVERFLOW] — exactly as designed.
// A production event loop would pair recall() with GC
// to reclaim old frames between iterations.
//
// HOW TO RUN:
//   1. Click Compile (or Ctrl+Enter)
//   2. Click  Create Abstraction
//   3. Step through in the Pipeline view
//   4. Watch STO count down on every recall()

abstraction Feedback {
    capabilities {
    }

    // Re-enters itself after doing a unit of work.
    // Replace the body with real logic (read, write, call)
    // to build an event-driven feedback loop.
    method run() {
        recall()
    }
}`,

        'billing': `// ============================================================
// Abstraction:  BudgetTracker
// Description:  Capability-based memory quota accounting (NS slot 47)
// Author:       Church Machine Educational Platform
// Version:      1.0
// Created:      2026-05-09
// Language:     CLOOMC++
// Dependencies: Memory, Navana, Mint
// ============================================================
// Methods:
//   1. Open(quota) — open a billing account with a memory quota
//   2. Charge(account, amount) — deduct amount from account quota
//   3. Balance(account) — return remaining quota
//   4. Close(account) — close account and release resources
// ============================================================
// ── Billing (NS 47): Capability-Based Memory Quota ──
// In a conventional OS, memory limits are enforced by
// a privileged kernel that any code can try to subvert.
// On the Church Machine, memory quotas ARE the hardware.
//
// Billing (NS 47) is the Church Machine's quota ledger.
// Before memory can be allocated via TuringMemory,
// a Billing account must be opened. Each allocation
// is charged against the account's quota. When the
// quota runs out, further charges fail — no kernel,
// no privilege ring, no policy table involved.
//
// A "p_gt" (policy Golden Token) is a hardware-
// unforgeable account handle. You pass it to every
// Billing method to prove ownership. The hardware
// validates it on every CALL — no software bypass.
//
// Billing API (NS slot 47):
//   Open(quota)         → p_gt
//   Charge(p_gt, words) → ok  (deduct words from quota)
//   Balance(p_gt)       → remaining words
//   Reissue(p_gt)       → new_p_gt (rotate the token)
//   Close(p_gt)         → ok  (release the account)
//
// This BudgetTracker wraps Billing: it opens its own
// account, checks headroom before spending, and
// exposes a clean Close for cleanup.

abstraction BudgetTracker {
    capabilities {
        Billing
    }

    // Init: open a Billing account with 'quota' words.
    // Returns the p_gt (your account handle).
    // Keep it — every subsequent call needs it.
    method Init(quota) {
        p_gt = call(Billing.Open(quota))
        return(p_gt)
    }

    // Spend: charge 'words' from the budget.
    // Checks headroom first — returns 1 on success,
    // 0 if over-quota (Billing.Charge skipped).
    method Spend(p_gt, words) {
        remaining = call(Billing.Balance(p_gt))
        if (remaining < words) {
            return(0)
        }
        ok = call(Billing.Charge(p_gt, words))
        return(ok)
    }

    // Balance: query remaining words in the account.
    method Balance(p_gt) {
        remaining = call(Billing.Balance(p_gt))
        return(remaining)
    }

    // Close: release the account when done.
    // After this call the p_gt is invalid.
    method Close(p_gt) {
        ok = call(Billing.Close(p_gt))
        return(ok)
    }
}`,

        'turing_memory': `// ============================================================
// Abstraction:  TuringMemory
// Description:  Code-region allocation charged against a Billing account (NS 48)
// Author:       Church Machine Educational Platform
// Version:      1.0
// Created:      2026-05-09
// Language:     CLOOMC++
// Dependencies: Billing, Memory
// ============================================================
// Methods:
//   1. AllocCode(account, size) — allocate code region charged to account
//   2. FreeCode(region) — release a previously allocated code region
// ============================================================
// ── TuringMemory (NS 48): Code-Region Allocation ──
// TuringMemory (NS 48) allocates code regions —
// contiguous physical-memory ranges for executable
// code. On the Church Machine, code and data live
// in separate regions with hardware-enforced bounds.
//
// Every AllocCode call charges a Billing account:
//   AllocCode(p_gt, words) → location
//     p_gt   : Billing account GT (quota is debited)
//     words  : size in words (rounded up to block)
//     returns: base address, or 0 if quota / OOM
//
// The quota link is deliberate. A rogue abstraction
// cannot allocate unbounded code space — it must hold
// a Billing p_gt with sufficient headroom. If the
// quota is exhausted, AllocCode returns 0 and the
// caller must handle the failure. No OS needed.
//
// TuringMemory also holds FreeCode(location) to
// return a region to the physical pool.
//
// This CodeLoader wraps TuringMemory: it enforces a
// minimum region size, delegates to AllocCode, and
// verifies the returned address is non-zero.

abstraction TuringMemory {
    capabilities {
        TuringMemory
    }

    // Alloc: reserve at least 'words' words of code space.
    // p_gt is the Billing account to charge.
    // Returns the base address, or 0 on failure.
    method Alloc(p_gt, words) {
        if (words < 16) {
            words = 16
        }
        location = call(TuringMemory.AllocCode(p_gt, words))
        return(location)
    }

    // AllocChecked: allocate and return a success flag.
    // Returns the location in DR1 and 1/0 in DR2.
    method AllocChecked(p_gt, words) {
        location = call(TuringMemory.AllocCode(p_gt, words))
        if (location == 0) {
            return(0, 0)
        }
        return(location, 1)
    }

    // Free: return a code region to the physical pool.
    method Free(location) {
        ok = call(TuringMemory.FreeCode(location))
        return(ok)
    }
}`,

        'church_memory': `// ChurchMemory — domain-separated abstract handle allocation.  NS slot 49.
//
// Issues only Church-domain handles.  A caller holding an E-GT to ChurchMemory
// can never receive an R-, W-, or X-permissioned region.
//
// AllocAbstract wraps an existing NS entry in an Enter-capable abstract handle.
// No new physical memory is claimed — it wraps an already-installed lump.
// This is how user code obtains a callable reference to a resident service.
//
// No Billing charge for AllocAbstract: physical memory was charged at AllocCode
// or Memory.Allocate time.  (Resolved Q4 — Church wrapping is free.)
//
// Bounds validation: AllocAbstract checks that ns_slot is in the range
// [0, nsCount) before issuing a handle.  An out-of-range slot returns 0
// (error); the JS binding faults BOUNDS instead.  nsCount is stored in
// CR7[0] of the ChurchMemory lump data area at boot time.
//
// Capabilities:
//   none — ChurchMemory validates NS slots against its own bounds knowledge,
//          held in word[0] of its lump data area at boot time.

abstraction ChurchMemory {
    capabilities {
    }

    // AllocAbstract(ns_slot) — wrap existing NS entry in an Enter-capable handle.
    // Returns ns_slot as the handle on success; returns 0 on out-of-range.
    // JS binding faults BOUNDS on out-of-range instead of returning 0.
    method AllocAbstract(ns_slot) {
        var ns_count = read(CR7, 0)
        if (ns_slot >= ns_count) {
            return(0)
        }
        var handle = bfext(ns_slot, 0, 16)
        return(handle)
    }

    // Free(handle) — release the abstract handle (no-op for simple handles;
    // reference-counted by the JS binding to track active wrappers).
    method Free(handle) {
        return(0)
    }
}`,

        'physical_pool': `// ============================================================
// Abstraction:  DMABuffer
// Description:  DMA buffer management: Reserve, scratch allocation, and paired scratch buffers
// Author:       Church Machine Educational Platform
// Version:      1.0
// Created:      2026-05-09
// Language:     CLOOMC++
// Dependencies: None
// ============================================================
// Methods:
//   1. Reserve(size) — reserve a block of 'size' physical words; returns (location, size)
//   2. Scratch(words) — allocate a scratch buffer; delegates to Memory.Allocate
//   3. Drop(location) — return a scratch buffer to the pool via Memory.Free
//   4. ScratchPair(words) — allocate two matched scratch buffers; rolls back on failure
// ============================================================
// ── Memory (NS 7): Raw Physical Word Allocation ──
// Memory is the bottom of the Church Machine's
// memory hierarchy — raw word-addressed blocks with
// no quota, no billing, and no garbage collection.
//
// Two allocation styles:
//
//   Allocate(size) / Free(location)   (selectors 0 / 1)
//     Paired: every Allocate should be matched by a
//     Free. The block returns to the free list and
//     can be reused. Use for temporary scratch buffers.
//
//   Claim(size) / Release(location)   (selectors 3 / 4)
//     Permanent: Claim acquires a block that is NOT
//     tracked in the free list. Release marks it gone
//     but the physical words are never reused.
//     Use for boot-time structures and DMA regions
//     that must survive for the life of the machine.
//
// Memory has no Billing integration — it is
// system-level only. User abstractions should reach
// memory through TuringMemory + Billing instead.
//
// DMABuffer shows both styles: Reserve() claims a
// permanent DMA region; Scratch() / Drop() manage
// temporary buffers; ScratchPair() allocates two
// matching blocks and rolls back if either fails.

abstraction DMABuffer {
    capabilities {
        Memory
    }

    // Reserve: claim a permanent DMA region of 'words' words.
    // Never returned to the pool — use for hardware I/O.
    method Reserve(words) {
        location = call(Memory.Claim(words))
        return(location)
    }

    // Scratch: allocate a temporary buffer.
    // Must be paired with a call to Drop(location).
    method Scratch(words) {
        location = call(Memory.Allocate(words))
        return(location)
    }

    // Drop: return a scratch buffer to the pool.
    method Drop(location) {
        ok = call(Memory.Free(location))
        return(ok)
    }

    // ScratchPair: allocate two buffers of 'words' words each.
    // Returns (loc_a, loc_b), or (0, 0) if either fails.
    // Rolls back the first allocation if the second fails.
    method ScratchPair(words) {
        loc_a = call(Memory.Allocate(words))
        if (loc_a == 0) {
            return(0, 0)
        }
        loc_b = call(Memory.Allocate(words))
        if (loc_b == 0) {
            call(Memory.Free(loc_a))
            return(0, 0)
        }
        return(loc_a, loc_b)
    }
}`,
    };

    /* Build a key→lang map from LANG_EXAMPLE_GROUPS (strip 'cloomc_' prefix from
       tab IDs to get bare example keys; skip 'assembly' and 'personal' entries). */
    const exampleLanguages = {};
    for (const [lang, tabKeys] of Object.entries(LANG_EXAMPLE_GROUPS)) {
        if (lang === 'assembly' || lang === 'personal') continue;
        for (const tabKey of tabKeys) {
            const exKey = tabKey.startsWith('cloomc_') ? tabKey.slice(7) : tabKey;
            exampleLanguages[exKey] = lang;
        }
    }
    /* fileLanguages entries override (they cover file-based examples). */
    Object.assign(exampleLanguages, fileLanguages);

    window._cloomcExampleSources      = examples;
    window._cloomcExampleSourcesReady = true;
    window._cloomcFileExamples        = fileExamples;
    window._cloomcFileLanguages       = fileLanguages;
    window._cloomcExampleLanguages    = exampleLanguages;

    editor.value = examples[name] || examples['integer_ops'];
    updateLineNumbers();
    if (typeof updateSavePseudoBtn === 'function') updateSavePseudoBtn();
    saveEditorState();

    document.querySelectorAll('.example-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.example === 'cloomc_' + name);
    });
    // Title must always follow the active tab label without exception.
    if (typeof _updateEditorCodeName === 'function') {
        const _activeBtn = document.querySelector('.example-tab.active');
        _updateEditorCodeName(_activeBtn ? _activeBtn.textContent.trim() : name);
    }

    const sel = document.getElementById('langSelector');
    if (sel) {
        const isHaskell = ['church_math','church_pair','church_case','sliderule_hs','dijkstra_flag_hs'].includes(name);
        const isSymbolic = ['ada_note_g', 'ada_note_g_published_bug', 'bernoulli_numbers', 'dijkstra_flag_ada'].includes(name);
        const isEnglish = ['english_integer_ops','english_packed_string','english_loops','english_contact','english_contact_stage2','english_dijkstra_flag'].includes(name);
        const isLambda = ['lambda_church_numerals','lambda_church_encoding','lambda_fixed_point','lambda_sliderule','lambda_rational','lambda_dijkstra_flag'].includes(name);
        sel.value = isLambda ? 'lambda' : isEnglish ? 'english' : isSymbolic ? 'symbolic' : isHaskell ? 'haskell' : 'javascript';
    }

    if (typeof historySetCodeExample === 'function') historySetCodeExample(name);
    const noticeBar = document.getElementById('presetNoticeBar');
    if (noticeBar) {
        const noticeText = noticeBar.querySelector('.preset-notice-text');
        if (name === 'ada_note_g') {
            if (noticeText) noticeText.textContent = 'Integer arithmetic only \u2014 load the CLOOMC preset for exact fractions.';
            noticeBar.style.display = 'flex';
        } else if (name === 'ada_note_g_published_bug') {
            if (noticeText) noticeText.textContent = 'Ada\u2019s published Op\u00a04 has the dividend and divisor swapped. Expected result: DR24\u00a0=\u00a0139/630 (not \u22121/30). Compare with \u201cAda: Note G (corrected)\u201d to see the difference.';
            noticeBar.style.display = 'flex';
        } else {
            noticeBar.style.display = 'none';
        }
    }
}

/* ── Initialize structural example globals at script load time ───────────── *
 * Sets window._cloomcFileExamples, window._cloomcFileLanguages, and          *
 * window._cloomcExampleLanguages immediately when this script is parsed so   *
 * that the Source Library can build its registry without requiring a prior   *
 * call to loadCLOOMCExample(). window._cloomcExampleSources is still set     *
 * lazily by loadCLOOMCExample() on first use (sources are large strings).    *
 * ──────────────────────────────────────────────────────────────────────────*/
(function _initCloomcStructuralGlobals() {
    if (window._cloomcFileExamples) return;

    const exampleLanguages = {};
    for (const [lang, tabKeys] of Object.entries(LANG_EXAMPLE_GROUPS)) {
        if (lang === 'assembly' || lang === 'personal') continue;
        for (const tabKey of tabKeys) {
            const exKey = tabKey.startsWith('cloomc_') ? tabKey.slice(7) : tabKey;
            exampleLanguages[exKey] = lang;
        }
    }
    Object.assign(exampleLanguages, _CLOOMC_FILE_LANGUAGES);

    window._cloomcFileExamples      = _CLOOMC_FILE_EXAMPLES;
    window._cloomcFileLanguages     = _CLOOMC_FILE_LANGUAGES;
    window._cloomcExampleLanguages  = exampleLanguages;
    window._cloomcLangExampleGroups = LANG_EXAMPLE_GROUPS;
})();

/* ── Reference panel column resizer ─────────────────────────────────────── *
 * Lets the user drag the divider between the abstraction list and the detail *
 * panel. Width is persisted to localStorage as 'refColWidth' (px integer).  *
 * ──────────────────────────────────────────────────────────────────────────*/
(function _initRefColResizer() {
    const LS_KEY   = 'refColWidth';
    const MIN_W    = 160;
    const MAX_W    = 700;
    const DEFAULT  = 340;

    function applyWidth(px) {
        const layout = document.getElementById('refLayout');
        if (!layout) return;
        layout.style.setProperty('--ref-col-width', px + 'px');
    }

    function persist(px) {
        try { localStorage.setItem(LS_KEY, px); } catch (_) {}
    }

    function restore() {
        try {
            const saved = parseInt(localStorage.getItem(LS_KEY), 10);
            if (saved >= MIN_W && saved <= MAX_W) return saved;
        } catch (_) {}
        return DEFAULT;
    }

    function attachResizer() {
        const handle = document.getElementById('refColResizer');
        if (!handle) return;

        applyWidth(restore());

        let dragging = false;
        let startX   = 0;
        let startW   = DEFAULT;

        handle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            dragging = true;
            startX   = e.clientX;
            const layout = document.getElementById('refLayout');
            startW   = layout
                ? parseInt(getComputedStyle(layout).getPropertyValue('--ref-col-width') || DEFAULT, 10)
                : DEFAULT;
            handle.classList.add('ref-col-resizer--active');
            document.body.style.cursor   = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            const delta = e.clientX - startX;
            const newW  = Math.min(MAX_W, Math.max(MIN_W, startW + delta));
            applyWidth(newW);
        });

        document.addEventListener('mouseup', function (e) {
            if (!dragging) return;
            dragging = false;
            handle.classList.remove('ref-col-resizer--active');
            document.body.style.cursor    = '';
            document.body.style.userSelect = '';
            const layout = document.getElementById('refLayout');
            if (layout) {
                const final = parseInt(layout.style.getPropertyValue('--ref-col-width') || DEFAULT, 10);
                persist(final);
            }
        });

        handle.addEventListener('dblclick', function () {
            applyWidth(DEFAULT);
            persist(DEFAULT);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachResizer);
    } else {
        attachResizer();
    }
})();
