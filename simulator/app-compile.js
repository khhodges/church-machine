function renderReference() {
    const churchList = document.getElementById('instrListChurch');
    const turingList = document.getElementById('instrListTuring');
    const absList = document.getElementById('instrListAbstractions');

    if (absList) {
        absList.innerHTML = '';
        ABSTRACTION_DATA.forEach(item => {
            const card = document.createElement('div');
            card.className = 'instr-card abs-card' + (_selectedAbstraction === item.id ? ' active' : '');
            card.innerHTML = `<span class="instr-mnemonic">${item.name}</span><span class="instr-brief">${item.brief}</span>`;
            card.onclick = () => { _refTipHide(); showAbstractionRefDetail(item.id); };
            _attachRefTip(card, item.brief);
            absList.appendChild(card);
        });
    }

    if (!churchList || !turingList) return;
    churchList.innerHTML = '';
    turingList.innerHTML = '';

    INSTRUCTION_DATA.forEach(instr => {
        const card = document.createElement('div');
        card.className = 'instr-card' + (selectedInstr === instr.opcode ? ' active' : '');
        card.innerHTML = `
            <span class="instr-opcode">${instr.opcode}</span>
            <span class="instr-mnemonic">${instr.mnemonic}</span>
            <span class="instr-brief">${instr.brief}</span>
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
}

function showInstructionDetail(opcode) {
    selectedInstr = opcode;
    const instr = INSTRUCTION_DATA.find(i => i.opcode === opcode);
    if (!instr) return;

    renderReference();

    const title = document.getElementById('instrDetailTitle');
    const content = document.getElementById('instrDetailContent');
    if (!title || !content) return;

    const domainLabel = instr.domain === 'church' ? 'Church Domain' : 'Turing Domain';
    const domainClass = instr.domain === 'church' ? 'church' : 'turing';
    title.textContent = `${instr.mnemonic} \u2014 Opcode ${instr.opcode}`;

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
                { syntax: "RETURN", desc: "Return from abstraction; restore caller context" },
                { syntax: "CHANGE CRd, <em>imm</em>", desc: "Context switch — save/load DR0–DR15, swap CR6/CR14/CR15" },
                { syntax: "SWITCH CRs, <em>imm</em>", desc: "Downgrade privilege level (ARCH→PROG→PRIV, monotonic)" },
                { syntax: "TPERM CRd, <em>preset</em>", desc: "Health-check (sets Z) or restrict permissions (monotonic mask)" },
                { syntax: "LAMBDA CRd, <em>offset</em>", desc: "Capture closure into CRd (offset=0x7FFF = immediate form)" },
                { syntax: "ELOADCALL CRd, [CRs, <em>off</em>]", desc: "Load GT from lump then CALL in one instruction (E+L perm)" },
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

function onLangChange(restoring) {
    const sel = document.getElementById('langSelector');
    if (!sel) return;
    const lang = sel.value;
    const btnSaveNS = document.getElementById('btnSaveNS');
    if (btnSaveNS) btnSaveNS.disabled = (lang !== 'assembly' || !lastAssembledWords);
    const btnBuildLump = document.getElementById('btnBuildLump');
    if (btnBuildLump) btnBuildLump.disabled = (lang === 'assembly');
    const btnBuildLumpMenu = document.getElementById('btnBuildLumpMenu');
    if (btnBuildLumpMenu) btnBuildLumpMenu.disabled = (lang === 'assembly');

    const langExampleGroups = {
        english: ['cloomc_english_hello', 'cloomc_english_counter', 'cloomc_english_string', 'cloomc_english_loops', 'cloomc_english_contact', 'cloomc_english_contact_stage2'],
        assembly: ['ada_note_g', 'selftest', 'load_save', 'bernoulli', 'conditional', 'gc_test', 'turing_test', 'led_turing_full', 'led_blink', 'salvation', 'perm_attack', 'bind_attack', 'tperm_halt'],
        javascript: ['cloomc_hello', 'cloomc_string', 'cloomc_memory', 'cloomc_heap', 'cloomc_counter', 'cloomc_sliderule', 'cloomc_contact', 'cloomc_contact_stage2', 'cloomc_contact_call', 'cloomc_stack_overflow', 'cloomc_recall_demo', 'cloomc_billing', 'cloomc_turing_memory', 'cloomc_church_memory', 'cloomc_physical_pool'],
        haskell: ['cloomc_church_math', 'cloomc_church_pair', 'cloomc_church_case', 'cloomc_church_lambda', 'cloomc_sliderule_hs'],
        symbolic: ['cloomc_ada_note_g', 'cloomc_ada_note_g_published_bug', 'cloomc_bernoulli_numbers'],
        lambda: ['cloomc_lambda_church_vs_compiled', 'cloomc_lambda_church', 'cloomc_lambda_booleans', 'cloomc_lambda_pairs', 'cloomc_lambda_ycomb', 'cloomc_lambda_sliderule', 'cloomc_lambda_fixedpoint', 'cloomc_lambda_rational'],
        personal: []
    };

    const scroll = document.getElementById('exampleTabsScroll');
    if (scroll) {
        // Built-in example tabs: hide all when in personal mode, else show only this lang's set
        const tabs = scroll.querySelectorAll('.example-tab:not(.user-tab)');
        const allowedSet = langExampleGroups[lang] || [];
        tabs.forEach(tab => {
            const ex = tab.getAttribute('data-example');
            tab.style.display = allowedSet.includes(ex) ? '' : 'none';
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
        if (!activeUserTabId && lang !== 'personal') {
            const defaults = {
                english: 'english_hello',
                assembly: 'selftest',
                javascript: 'hello',
                haskell: 'church_math',
                symbolic: 'ada_note_g',
                lambda: 'lambda_church'
            };
            const defaultExample = defaults[lang];
            if (defaultExample) {
                if (lang === 'assembly') {
                    loadExample(defaultExample);
                } else {
                    loadCLOOMCExample(defaultExample);
                }
            }
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
        if (/^\s*abstraction\s+\w+/m.test(src) || /^\s*method\s+\w+/m.test(src)) {
            lang = 'javascript';
            if (sel) sel.value = 'javascript';
            onLangChange(true);
        }
    }

    try {
        if (lang === 'assembly') {
            assembleAndLoad();
        } else {
            compileCLOOMC();
        }
    } catch (e) {
        console.error('smartCompile error:', e);
        const con = document.getElementById('editorConsole');
        if (con) con.textContent = 'Compile error: ' + (e.message || e);
        showNextSteps('error');
    }
}

function compileDraftAssembly(source, con) {
    if (con) con.className = '';
    switchCodeTab('console');
    if (!source || !source.trim()) {
        if (con) { con.textContent = 'Draft — no code to draft. Enter assembly code first.'; con.scrollTop = 0; }
        return;
    }
    if (/^\s*const\s+\w+\s*=\s*[\[{]/m.test(source) ||
        /^\s*(?:export\s+)?(?:default\s+)?class\s+\w+/m.test(source)) {
        if (con) {
            con.textContent =
                'This looks like a JavaScript source file, not Church assembly.\n\n' +
                'To write a CLOOMC++ abstraction, use the JavaScript format:\n\n' +
                '  abstraction Name {\n' +
                '      method MethodName() {\n' +
                '          instruction\n' +
                '      }\n' +
                '  }\n\n' +
                'Or use the English format:\n\n' +
                '  Create an abstraction called Name\n' +
                '  Add a method called MethodName\n' +
                '    Write 1 to the output register';
            con.scrollTop = 0;
        }
        return;
    }
    const result = assembler.assemble(source);
    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
        const _asmSrc = _getActiveSourceLabel(); const _asmSrcH = _asmSrc ? ` · ${_asmSrc}` : '';
        if (con) { con.textContent = `Assembly Draft${_asmSrcH} — errors:\n${errText}`; con.scrollTop = 0; }
        if (typeof _showAsmErrors === 'function') _showAsmErrors(result.errors);
        showNextSteps('error');
        return;
    }
    if (typeof _clearAsmErrors === 'function') _clearAsmErrors();
    const words = result.words;
    const codeSize = words.length;
    const allocSize = Math.max(32, nextPow2(codeSize));
    const freespace = allocSize - codeSize;

    let draft = `═══════════════════════════════════════════════════\n`;
    draft += `  ASSEMBLY DRAFT — ${codeSize} instruction(s) [Machine Code]\n`;
    draft += `═══════════════════════════════════════════════════\n\n`;

    draft += `  Lump Layout:\n`;
    draft += `    ┌─────────────────────────────────────────┐\n`;
    draft += `    │ Code             ${codeSize.toString().padStart(5)} words  (offset 0)  │\n`;
    draft += `    │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │\n`;
    draft += `    │ FREESPACE        ${freespace.toString().padStart(5)} words              │\n`;
    draft += `    └─────────────────────────────────────────┘\n`;
    draft += `    Total alloc: ${allocSize} words (power-of-2)\n\n`;

    draft += `═══════════════════════════════════════════════════\n`;
    draft += `  Instruction Listing:\n`;
    draft += `═══════════════════════════════════════════════════\n\n`;

    for (let i = 0; i < words.length; i++) {
        const hex = '0x' + words[i].toString(16).padStart(8, '0');
        const dis = assembler.disassemble(words[i]);
        draft += `  ${i.toString().padStart(4)}: ${hex}  ${dis}\n`;
    }

    draft += `\n═══════════════════════════════════════════════════\n`;

    if (con) { con.textContent = draft; con.scrollTop = 0; }
    showNextSteps('draft');
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

    const isHighLevel = cloomcCompiler._detectPetName(source) ||
                        cloomcCompiler._detectEnglish(source) ||
                        cloomcCompiler._detectHaskell(source) ||
                        cloomcCompiler._detectSymbolic(source) ||
                        /^\s*abstraction\s+\w+/m.test(source);
    if (!isHighLevel) {
        return compileDraftAssembly(source, con);
    }

    const result = cloomcCompiler.compile(source, []);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        const _dSrc = _getActiveSourceLabel(); const _dSrcH = _dSrc ? ` · ${_dSrc}` : '';
        if (con) { con.textContent = `CLOOMC++ Draft${_dSrcH} — compilation errors:\n${errText}`; con.scrollTop = 0; }
        showNextSteps('error');
        return;
    }

    const langNames = { english: 'English', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', javascript: 'JavaScript', lambda: 'Lambda Calculus' };
    const langLabel = langNames[result.language] || 'JavaScript';
    const caps = result.capabilities || [];
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
            draft += `    [${i}] ${caps[i]}\n`;
        }
    }

    draft += `\n  Lump Layout (matches Build LUMP binary):\n`;
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

    if (con) { con.textContent = draft; con.scrollTop = 0; }
    showNextSteps('draft');
    trackAction('draft', { name: result.abstractionName, lang: result.language });
    appendOutput(`Draft: "${result.abstractionName}" — ${result.methods.length} methods, ${clistCount} caps, ${allocSize} alloc`, 'info');
}

function buildAndDownloadLump() {
    const editor = document.getElementById('asmEditor');
    if (!editor || !cloomcCompiler) return;
    const source = editor.value;
    const con = document.getElementById('editorConsole');
    if (con) con.className = '';
    switchCodeTab('console');

    const isHighLevel = cloomcCompiler._detectPetName(source) ||
                        cloomcCompiler._detectEnglish(source) ||
                        cloomcCompiler._detectHaskell(source) ||
                        cloomcCompiler._detectSymbolic(source) ||
                        /^\s*abstraction\s+\w+/m.test(source);
    if (!isHighLevel) {
        if (con) con.textContent = 'Build LUMP requires a CLOOMC++ abstraction (JavaScript, Haskell, English, Lambda, or Symbolic).\nAssembly programs cannot be packaged as lumps — use Save to NS instead.';
        return;
    }

    const result = cloomcCompiler.compile(source, []);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        if (con) { con.textContent = `Build LUMP — compilation errors:\n${errText}`; con.scrollTop = 0; }
        showNextSteps('error');
        return;
    }

    const langNames = { english: 'English', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', javascript: 'JavaScript', lambda: 'Lambda Calculus' };
    const langLabel = langNames[result.language] || 'JavaScript';
    const absName = result.abstractionName || 'Unnamed';
    const caps = result.capabilities || [];
    const cc = caps.length;
    const profile = result.profile || 'IoT';

    const allCode = [];
    const numMethods = result.methods.length;

    for (const m of result.methods) {
        const words = m.code || [];
        allCode.push(...words);
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

    const resolvedCaps = caps.map(capName => {
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
        return { name: capName, nsIndex: target };
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

    const binaryBuf = new ArrayBuffer(lumpSize * 4);
    const view = new DataView(binaryBuf);
    for (let i = 0; i < lumpSize; i++) {
        view.setUint32(i * 4, lumpWords[i], false);
    }

    const blob = new Blob([binaryBuf], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = absName + '.lump';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

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
            cw:             cw,
            cc:             cc,
            profile:        profile,
            language:       result.language || 'javascript',
            methods:        methodMeta,
            capabilities:   resolvedCaps.map(rc => ({ name: rc.name, nsIndex: rc.nsIndex })),
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

    fetch('/api/lumps/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savePayload)
    }).then(r => r.json()).then(resp => {
        if (resp.ok) {
            appendOutput(`Saved to library: lumps/${resp.lump} — token 0x${resp.token} · MTBF: UNKNOWN (needs testing)`, 'info');
            renderLumps();
            const savedToken = resp.token;
            setTimeout(() => {
                const listEl = document.getElementById('lumpsListContent');
                if (listEl && savedToken) {
                    const item = listEl.querySelector(`.lump-item[data-token="${savedToken}"]`);
                    if (item) {
                        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        showLumpDetail(savedToken);
                    }
                }
            }, 400);
        } else {
            appendOutput(`Server save failed: ${resp.error || 'unknown error'}`, 'error');
        }
    }).catch(err => {
        appendOutput(`Server save error: ${err.message}`, 'error');
    });

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
            listing += `    [${i}] ${rc.name} → ${status}\n`;
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

    listing += `\n  Downloaded: ${absName}.lump (${sizeBytes} bytes)\n`;
    listing += `  Saved to: server/lumps/ (binary + metadata sidecar)\n`;

    if (con) { con.textContent = listing; con.scrollTop = 0; }
    trackAction('build_lump', { name: absName, lang: result.language, size: lumpSize });
    appendOutput(`Built LUMP: "${absName}" — ${result.methods.length} methods, ${lumpSize} words, ${sizeBytes} bytes`, 'info');
}

function compileCLOOMC() {
    const editor = document.getElementById('asmEditor');
    if (!editor || !cloomcCompiler) return;
    const source = editor.value;
    const con = document.getElementById('editorConsole');
    if (con) con.className = '';
    switchCodeTab('console');

    _runStopped = true;
    sim.running = false;

    const capabilities = [];
    const result = cloomcCompiler.compile(source, capabilities);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        const _cmpSrc = _getActiveSourceLabel(); const _cmpSrcH = _cmpSrc ? ` · ${_cmpSrc}` : '';
        if (con) { con.textContent = `CLOOMC++ compilation errors${_cmpSrcH}:\n${errText}`; con.scrollTop = 0; }
        if (typeof _showAsmErrors === 'function') _showAsmErrors(result.errors);
        showNextSteps('error');
        return;
    }

    const langNames2 = { english: 'English', haskell: 'Haskell', symbolic: 'Symbolic Math (Ada)', javascript: 'JavaScript', lambda: 'Lambda Calculus' };
    const lang = langNames2[result.language] || 'JavaScript';
    const _compileSrcLabel = _getActiveSourceLabel();
    const _compileSrcHint = _compileSrcLabel ? ` · ${_compileSrcLabel}` : '';

    const _ec = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const _methodConv = m => {
        if (m.name === 'Dispatch' || m.name === 'M00') return 'DR1\u202f=\u202fselector';
        const ps = (m.params || []).slice(0, 3);
        if (!ps.length) return '\u2192\u202fDR1';
        return ps.map((p, i) => `DR${i+1}\u202f=\u202f${p}`).join(', ') + '\u2002\u2192\u202fDR1';
    };

    const manifestByMethod = {};
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
            manifestByMethod[entry.name] = comments;
        }
    }

    // Store early so the Load button works even before innerHTML is committed.
    window._lastCLOOMCResult = result;

    // "Load into Sim" button sits at the TOP so it is immediately visible
    // regardless of how many methods the listing contains (con.scrollTop = 0
    // would otherwise hide a bottom-placed button under the fold).
    let html = `<div class="cmp-load-toolbar"><button id="btnLoadIntoSim" class="cmp-load-sim-btn" onclick="loadCLOOMCIntoSim()" data-tooltip="Load this compiled lump into the simulator so you can Step or Walk through every instruction">Load into Sim \u25b6</button></div>`
        + `<div class="cmp-file-hdr">; CLOOMC++ [${_ec(lang)}] compiled \u201c${_ec(result.abstractionName)}\u201d${_ec(_compileSrcHint)} \u2014 ${result.methods.length} method${result.methods.length !== 1 ? 's' : ''}</div>`;

    for (const m of result.methods) {
        const visBadge = m.visibility === 'private' ? '<span class="cmp-priv">private</span> ' : '';
        if (m.aliasOf) {
            html += `<div class="cmp-method-alias">\u25c6 method ${visBadge}${_ec(m.name)} \u2192 alias of ${_ec(m.aliasOf)}</div>`;
            continue;
        }
        const conv = _methodConv(m);
        const mCode = m.code || [];
        const comments = manifestByMethod[m.name] || {};
        let bodyTxt = '';
        for (let i = 0; i < mCode.length; i++) {
            const word = mCode[i];
            const mnem = _applyMethodDRNames(word === 0 ? 'NOP' : assembler.disassemble(word), m);
            const comment = comments[i];
            bodyTxt += _ec(comment ? `${mnem.padEnd(40)}; ${comment}` : mnem) + '\n';
        }
        html += `<details class="cmp-method" open>`
            + `<summary class="cmp-method-hdr">\u25c6 method ${visBadge}${_ec(m.name)}<span class="cmp-conv"> \u2014 ${_ec(conv)}</span></summary>`
            + `<pre class="cmp-body">${bodyTxt}</pre>`
            + `</details>`;
    }

    // appendOutput uses textContent += which destroys child elements — call it
    // BEFORE setting innerHTML so the HTML (including the Load into Sim button)
    // is the final write to the console and is never clobbered.
    const _outSrcLabel = _getActiveSourceLabel();
    const _outSrcHint = _outSrcLabel ? ` · ${_outSrcLabel}` : '';
    appendOutput(`CLOOMC++ compiled "${result.abstractionName}"${_outSrcHint} — ${result.methods.length} methods`, 'info');
    trackAction('compile', { name: result.abstractionName, lang: result.language });

    if (con) { con.className = 'cmp-html'; con.innerHTML = html; con.scrollTop = 0; }
    showNextSteps('compiled');
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
    let codeOffset = methodTableSize;
    const methodTableEntries = [];
    for (const m of methods) {
        methodTableEntries.push(codeOffset);
        labels[m.name] = codeOffset;
        codeOffset += (m.code || []).length;
    }
    for (const entry of methodTableEntries) words.push(entry);
    for (const m of methods) {
        for (const w of (m.code || [])) words.push(w);
    }

    lastAssembledWords      = words.slice();
    lastAssembledCapabilities = (result.capabilities && result.capabilities.length > 0)
        ? result.capabilities.slice() : null;
    lastMethodTableSize     = methodTableSize;
    _defaultProgramLoaded   = true;
    sim.programLabels       = labels;
    sim.programName         = result.abstractionName || (methods.length > 0 ? methods[0].name : 'prog');
    window._assemblerSymbols = { labels, lumpName: sim.programName };
    _pendingSimLoad          = true;

    // Update the button to give immediate visual feedback
    const btn = document.getElementById('btnLoadIntoSim');
    if (btn) {
        btn.textContent = 'Loaded \u2014 click Step \u25b6';
        btn.classList.add('cmp-load-sim-btn--done');
        btn.disabled = true;
    }

    // Switch the next-steps hints to the "assembled" state so the user sees
    // "click Step to execute one instruction at a time"
    showNextSteps('assembled');

    const _loadSrcLabel = _getActiveSourceLabel();
    const _loadSrcHint  = _loadSrcLabel ? ` · ${_loadSrcLabel}` : '';
    appendOutput(`Loaded \u201c${result.abstractionName}\u201d${_loadSrcHint} into simulator \u2014 ${words.length} words, ${methodTableSize} method${methodTableSize !== 1 ? 's' : ''} \u2014 click Step or Run`, 'info');
}

function compileAndCreateAbstraction() {
    if (typeof historyShowCreateAbstraction === 'function') historyShowCreateAbstraction();
    const editor = document.getElementById('asmEditor');
    if (!editor || !cloomcCompiler) return;
    const source = editor.value;
    const con = document.getElementById('editorConsole');
    if (con) con.className = '';

    const result = cloomcCompiler.compile(source, []);

    if (result.errors.length > 0) {
        const errText = result.errors.map(e => `Line ${e.line || '?'}: ${e.message}`).join('\n');
        const _cab2Src = _getActiveSourceLabel(); const _cab2SrcH = _cab2Src ? ` · ${_cab2Src}` : '';
        if (con) con.textContent = `CLOOMC++ compilation errors${_cab2SrcH}:\n${errText}`;
        showNextSteps('error');
        return;
    }

    if (!sim.bootComplete) {
        if (con) con.textContent = 'Boot not complete — run boot sequence first.';
        showNextSteps('error');
        return;
    }

    const uploadCaps = (result.capabilities || []).map((capName, idx) => {
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
        return { target: target, name: capName, grants: ['E'] };
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
    const editor = document.getElementById('asmEditor');
    if (!editor) return;
    _editorCREditActive = false;
    _editorCREditCR = null;
    _editorCREditNS = null;
    _updateEditorPatchBar();
    if (activeUserTabId && userTabDirty) saveActiveUserTab();
    activeUserTabId = null;
    userTabDirty = false;
    renderUserTabs();
    updateSaveUserTabBtn();

    const fileExamples = {
        'sliderule': '/simulator/cloomc/sliderule.cloomc',
        'contact': '/simulator/cloomc/Contact.cloomc',
        'contact_stage2': '/simulator/cloomc/ContactStage2.cloomc',
        'contact_call': '/simulator/cloomc/ContactCall.cloomc',
        'english_contact_stage2': '/simulator/cloomc/english/ContactStage2.cloomc',
        'ada_note_g_published_bug': '/simulator/cloomc/ada_note_g_published_bug.cloomc'
    };
    if (fileExamples[name]) {
        fetch(fileExamples[name])
            .then(r => r.ok ? r.text() : Promise.reject('File not found'))
            .then(code => {
                editor.value = code;
                saveEditorState();
                updateLineNumbers();
                document.querySelectorAll('.example-tab').forEach(t => {
                    t.classList.toggle('active', t.dataset.example === name);
                });
                const sel = document.getElementById('langSelector');
                if (sel) sel.value = 'cloomc';
                if (typeof historySetCodeExample === 'function') historySetCodeExample(name);
                const nb = document.getElementById('presetNoticeBar');
                if (nb) nb.style.display = 'none';
            })
            .catch(err => console.error('Failed to load example:', err));
        return;
    }

    const examples = {
        'memory': `// ── Memory Allocator using CR5 Instance Data ──
// Base abstractions are shared code — they hold no
// state themselves. Instance state lives in CR5,
// the private instance data register.
//
// CR5 is a thread register — installed by CHANGE from
// the incoming thread's Zone ④ bounds (derived from
// the lump header's heapWords field). All abstractions
// on a thread share the same CR5, so software must not
// rely on CR5 being private across CALL boundaries.
//
// CR5 points to a region where this instance keeps
// its bookkeeping (here: the current heap offset).
// The read/write operations go through CR5's Golden
// Token, so access is hardware-enforced.
//
// TPERM is a flag-setting instruction — it checks
// permissions, validity, and bounds in one cycle,
// then sets the Z flag. It never traps. Subsequent
// instructions carry EQ/NE suffixes for zero-cost
// try-catch: the happy path runs as if errors don't
// exist, and the hardware silently skips instructions
// when TPERM failed.

abstraction Memory {
    capabilities {
    }

    // Allocate: reserve 'size' bytes of memory.
    // Rounds up to 256-byte alignment (>> 8, << 8).
    // Returns (location, actual_size) on success,
    // or (0, 0) if CR5 lacks permissions or space.
    method Allocate(size) {
        // TPERM checks R+W perms, valid, and offset 0
        // in one instruction. Z=1 if all pass.
        TPERM CR5, RW, 0

        // happy path (EQ = fires only when Z=1)
        readEQ location, CR5, 0
        neededEQ = size + 255
        neededEQ = neededEQ >> 8
        neededEQ = neededEQ << 8
        TPERMEQ CR5, RW, location + needed
        writeEQ CR5, 0, location + needed
        returnEQ(location, needed)

        // catch path (NE = fires only when Z=0)
        // TPERM set Z=0 → every EQ was skipped
        MOVNE DR1, 0
        MOVNE DR2, 0
        returnNE(DR1, DR2)
    }

    // Free: placeholder — bump allocators don't free.
    // A real deallocator would be a separate abstraction.
    method Free(location) {
        return(0)
    }
}`,
        'mint': `// ── Mint: Creating New Golden Tokens ──
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
        'hello': `// ── Church Machine: Anatomy of an Abstraction ──
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
}`,
        'string': `// ── Building Strings on Integer Hardware ──
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
        'heap': `// ── Heap: A Capability-Controlled Typed Array ──
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
        'counter': `abstraction Counter {\n    capabilities {\n    }\n    method Increment(value) {\n        result = value + 1\n        return(result)\n    }\n    method Add(a, b) {\n        result = a + b\n        return(result)\n    }\n}`,
        'church_math': `-- Church Machine Lambda Calculus\n-- Haskell front-end proves universal target\n\nabstraction ChurchMath {\n    capabilities {\n    }\n\n    -- Church successor: n + 1\n    method successor(n) = n + 1\n\n    -- Church addition: a + b\n    method add(a, b) = a + b\n\n    -- Church multiplication\n    method multiply(a, b) = a * b\n\n    -- Predecessor: max(0, n-1)\n    method predecessor(n) = if n > 0 then n - 1 else 0\n\n    -- isZero: 1 if n==0, else 0\n    method isZero(n) = if n == 0 then 1 else 0\n}`,
        'church_pair': `-- Church Pairs — Haskell front-end\n-- Pairs pack two 16-bit values\n\nabstraction ChurchPair {\n    capabilities {\n    }\n\n    -- Construct a pair from two values\n    method makePair(a, b) = (a, b)\n\n    -- Extract first element\n    method first(p) = fst p\n\n    -- Extract second element  \n    method second(p) = snd p\n\n    -- Swap pair elements\n    method swap(p) = (snd p, fst p)\n}`,
        'church_case': `-- Church Case Expressions — Haskell front-end\n-- Pattern matching compiles to MCMP + BRANCH chains\n\nabstraction ChurchCase {\n    capabilities {\n    }\n\n    -- Factorial via case\n    method factorial(n) = case n of 0 -> 1, _ -> n * (n - 1)\n\n    -- Classify a number\n    method classify(n) = case n of 0 -> 100, 1 -> 200, _ -> n + 300\n\n    -- Absolute value\n    method abs(n) = if n < 0 then 0 - n else n\n}`,
        'church_lambda': `-- Church Lambda Expressions — Haskell front-end\n-- Lambda calculus on Church Machine hardware\n\nabstraction ChurchLambda {\n    capabilities {\n    }\n\n    -- Identity function\n    method identity(x) = x\n\n    -- Constant function (returns first arg)\n    method constant(x, y) = x\n\n    -- Apply successor twice\n    method double_succ(n) = succ (succ n)\n\n    -- Let binding example\n    method letExample(x) = let a = x + 1 in a + a\n}`,
        'ada_note_g': `-- Ada Lovelace — Note G (1843)\n-- The First Computer Program\n-- Computes B7 (Bernoulli number = -1/30)\n-- Written in Symbolic Mathematics notation\n\nabstraction NoteG {\n    capabilities {\n    }\n\n    method compute() {\n        -- Initialize Ada's Store columns\n        let V1 = 1\n        let V2 = 2\n        let V3 = 4\n\n        -- Operation 1: V4 = 2n = 8\n        let V4, V5, V6 = V2 * V3\n\n        -- Operation 2: 2n-1 = 7\n        let V4 = V4 - V1\n\n        -- Operation 3: 2n+1 = 9\n        let V5 = V5 + V1\n\n        -- Operation 4: (2n-1)/(2n+1) — CORRECTED per Bromley (1990)\n        let V11 = V4 / V5\n\n        -- Operation 5: divide coefficient by 2\n        let V11 = V11 / V2\n\n        -- Operation 6: accumulator\n        let V13 = 0\n        let V13 = V13 - V11\n\n        -- Operation 7: loop counter = n-1 = 3\n        let V10 = V3 - V1\n\n        -- Operation 8: denominator counter\n        let V7 = V2\n\n        -- Operation 9: 2n / counter\n        let V11 = V6 / V7\n\n        -- Operation 10: B1 * coefficient\n        let V15 = 1\n        let V12 = V15 * V11\n\n        -- Operation 11: accumulate\n        let V13 = V12 + V13\n\n        -- Operation 12: decrement loop\n        let V10 = V10 - V1\n\n        -- Operations 13-23: loop body\n        repeat V10 as V10\n            let V6 = V6 - V1\n            let V7 = V1 + V7\n            let V8 = V6 / V7\n            let V11 = V8 * V11\n            let V6 = V6 - V1\n            let V7 = V1 + V7\n            let V9 = V6 / V7\n            let V11 = V9 * V11\n            let V15 = 1\n            let V12 = V15 * V11\n            let V13 = V12 + V13\n        end\n\n        -- Operation 24: B7 = -sum\n        let V15 = 0\n        let V15 = V15 - V13\n\n        -- Operation 25: increment n\n        let V3 = V1 + V3\n\n        halt\n    }\n}`,
        'bernoulli_numbers': `-- Bernoulli Numbers via SlideRule\n-- One CALL per number — no loops, no algorithm.\n-- Ada needed 25 operations; the SlideRule does it in 1.\n--\n-- SlideRule.Bernoulli(n) returns numerator in DR(dst),\n-- denominator in DR(dst+1). Both are machine-accessible.\n-- B(0)=1/1, B(1)=-1/2, B(2)=1/6, B(4)=-1/30,\n-- B(6)=1/42, B(8)=-1/30, B(10)=5/66, B(12)=-691/2730\n\nabstraction BernoulliNumbers {\n    capabilities {\n    }\n\n    method compute() {\n        -- Compute Bernoulli numbers using shorthand syntax\n        -- bernoulli(x) compiles to SlideRule.Bernoulli(x)\n\n        let V1 = bernoulli(0)\n\n        let V2 = 2\n        let V2 = bernoulli(V2)\n\n        let V3 = 4\n        let V3 = bernoulli(V3)\n\n        -- Also supports explicit SlideRule.Bernoulli() form\n        let V4 = 6\n        let V4 = SlideRule.Bernoulli(V4)\n\n        let V5 = 8\n        let V5 = SlideRule.Bernoulli(V5)\n\n        let V6 = 10\n        let V6 = bernoulli(V6)\n\n        let V7 = 12\n        let V7 = bernoulli(V7)\n\n        -- After each call: DR(n) = numerator, DR(n+1) = denominator\n        -- V1=1/1, V2=1/6, V3=-1/30, V4=1/42,\n        -- V5=-1/30, V6=5/66, V7=-691/2730\n\n        halt\n    }\n}`,
        'sliderule_hs': `-- SlideRule — Haskell front-end\n-- Integer arithmetic on Church Machine hardware\n-- Proves both languages compile to the same 20-instruction target\n\nabstraction SlideRuleHS {\n    capabilities { Constants }\n\n    -- Basic arithmetic\n    method Add(a, b) = a + b\n\n    method Sub(a, b) = a - b\n\n    method Mul(a, b) = a * b\n\n    -- Integer square root via conditional lookup (floor)\n    method Sqrt(n) = if n < 1 then 0 else if n < 4 then 1 else if n < 9 then 2 else if n < 16 then 3 else if n < 25 then 4 else if n < 36 then 5 else if n < 49 then 6 else if n < 64 then 7 else if n < 81 then 8 else if n < 100 then 9 else 10\n\n    -- Power of 2 via conditional lookup\n    method Pow2(exp) = if exp == 0 then 1 else if exp == 1 then 2 else if exp == 2 then 4 else if exp == 3 then 8 else if exp == 4 then 16 else if exp == 5 then 32 else if exp == 6 then 64 else if exp == 7 then 128 else 256\n\n    -- Absolute value\n    method Abs(n) = if n < 0 then 0 - n else n\n\n    -- Signum: -1, 0, or 1\n    method Signum(n) = if n == 0 then 0 else if n > 0 then 1 else 0 - 1\n\n    -- Max of two values\n    method Max(a, b) = if a > b then a else b\n\n    -- Min of two values\n    method Min(a, b) = if a < b then a else b\n\n    -- Clamp value between lo and hi\n    method Clamp(x, lo, hi) = if x < lo then lo else if x > hi then hi else x\n}`,
        'english_contact': `-- ENGLISH: Contact — Stage 3 Application-Level Abstraction
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
        'english_hello': `Create an abstraction called Hello\n\nAdd a method called Greet that takes who\nSet result to who plus 1\nReturn the result`,
        'english_counter': `Create an abstraction called Counter\n\nAdd a method called Increment that takes value\nSet result to value plus 1\nReturn the result\n\nAdd a method called Add that takes a and b\nSet result to a plus b\nReturn the result\n\nAdd a method called Double that takes x\nSet result to x plus x\nReturn the result`,
        'english_loops': `-- ENGLISH: Loops — Three Ways to Iterate
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
        'english_string': `-- ENGLISH: String Operations
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
        'lambda_church': `-- LAMBDA CALCULUS
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
}`,
        'lambda_church_vs_compiled': `-- LAMBDA CALCULUS
-- Church vs Compiled \u2014 control flow by CALL vs BRANCH
-- \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
--
-- COMPILED PATH (if/then/else):
--   Each conditional compiles to:
--     MCMP \u2192 BRANCH \u2192 then-body \u2192 MOV \u2192 BRANCH \u2192 else-body \u2192 MOV
--   = 7+ instructions per conditional, branch misprediction risk
--
-- CHURCH PATH (\u03BB-application as selector):
--   A Church boolean IS the if/then/else. It is a function:
--     TRUE  = \u03BBx.\u03BBy.x  \u2192 CALL TRUE(a)(b) returns a
--     FALSE = \u03BBx.\u03BBy.y  \u2192 CALL FALSE(a)(b) returns b
--   Selection is two CALL instructions \u2014 no compare, no branch.
--   Avoids branch misprediction; more predictable control flow.
--   (Arithmetic still uses SlideRule / hardware FPU when needed.)
--
-- Each pair solves the same problem:
--   compiled_X uses if/then/else  \u2192 MCMP + BRANCH
--   church_X   uses \u03BB-application \u2192 CALL + CALL
--
-- Press Assemble to see the instruction-count comparison!
--
-- \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501

abstraction ChurchVsCompiled {
    capabilities { }

    -- \u2500\u2500 COMPILED PATH \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    -- Uses if/then/else \u2192 generates MCMP + BRANCH

    -- Select a or b based on flag (1=a, 0=b)
    method compiled_select(flag, a, b) =
        if flag == 0 then b else a

    -- Guarded add: add x+y only when flag is set
    method compiled_guard(flag, x, y) =
        if flag == 0 then x else x + y

    -- Nested conditional: three-way branch
    method compiled_classify(n) =
        if n == 0 then 0
        else if n == 1 then 10
        else 20

    -- Double conditional: sign function
    method compiled_sign(n, pos, neg) =
        if n == 0 then 0
        else if n > 0 then pos
        else neg

    -- \u2500\u2500 CHURCH PATH \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    -- Uses \u03BB-application as control flow. Each selector
    -- is a function applied to two choices via CALL.
    -- selector a b \u2192 CALL(CALL(selector, a), b)
    -- No MCMP, no BRANCH, constant-time execution.

    -- Select a or b: apply the selector to both choices
    -- selector = TRUE(\u03BBx.\u03BBy.x) returns a, FALSE(\u03BBx.\u03BBy.y) returns b
    method church_select(selector, a, b) =
        selector a b

    -- Guarded add: apply selector to choose x or x+y
    -- selector(x + y)(x) picks the right outcome
    method church_guard(selector, x, y) =
        selector (x + y) x

    -- Classify: chain two selectors for three-way choice
    -- s1 picks between 0 and (s2 picks between 10 and 20)
    method church_classify(s1, s2) =
        s1 0 (s2 10 20)

    -- Sign: chain two selectors for three outcomes
    method church_sign(s1, s2, pos, neg) =
        s1 0 (s2 pos neg)
}`,
        'lambda_booleans': `-- LAMBDA CALCULUS
-- Church Booleans \u2014 logic as pure functions
-- TRUE  = \u03BBx.\u03BBy.x  (select first)
-- FALSE = \u03BBx.\u03BBy.y  (select second)

abstraction ChurchBooleans {
    capabilities { }

    -- Church TRUE: \u03BBx.\u03BBy.x
    method true_(x, y) = x

    -- Church FALSE: \u03BBx.\u03BBy.y
    method false_(x, y) = y

    -- AND: \u03BBp.\u03BBq.p q p
    method and_(p, q) = if p == 0 then 0 else q

    -- OR: \u03BBp.\u03BBq.p p q
    method or_(p, q) = if p == 0 then q else p

    -- NOT: \u03BBp.p FALSE TRUE
    method not_(p) = if p == 0 then 1 else 0

    -- IF-THEN-ELSE: \u03BBp.\u03BBa.\u03BBb.p a b
    method ifthenelse(p, a, b) = if p == 0 then b else a
}`,
        'lambda_pairs': `-- LAMBDA CALCULUS
-- Church Pairs \u2014 data structures as pure functions
-- PAIR  = \u03BBx.\u03BBy.\u03BBf.f x y
-- FST   = \u03BBp.p (\u03BBx.\u03BBy.x)
-- SND   = \u03BBp.p (\u03BBx.\u03BBy.y)

abstraction ChurchPairs {
    capabilities { }

    -- Make a pair from two values
    method pair(a, b) = (a, b)

    -- First element
    method fst_(p) = fst p

    -- Second element
    method snd_(p) = snd p

    -- Swap elements
    method swap(p) = (snd p, fst p)

    -- Apply function to both elements
    method mapBoth(p, n) = (fst p + n, snd p + n)
}`,
        'lambda_ycomb': `-- LAMBDA CALCULUS
-- Y Combinator \u2014 recursion from pure functions
-- Y = \u03BBf.(\u03BBx.f (x x)) (\u03BBx.f (x x))
-- The Y combinator enables recursion without self-reference

abstraction YCombinator {
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
}`,
        'lambda_sliderule': `-- LAMBDA CALCULUS
-- Slide Rule \u2014 logarithmic computation as pure functions
-- A slide rule computes via log identities:
--   log(a \u00d7 b) = log(a) + log(b)
--   log(a / b) = log(a) - log(b)
--   log(\u221aa)   = log(a) / 2
--   log(\u00b3\u221aa)  = log(a) / 3

abstraction SlideRule {
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
        'lambda_fixedpoint': `-- LAMBDA CALCULUS
-- Fixed-Point Arithmetic \u2014 decimal precision on integer hardware
-- Scale factor = 100 (two decimal places)
-- 3.14 is stored as 314, 0.5 as 50, 1.0 as 100
-- All operations maintain the scale invariant

abstraction FixedPointMath {
    capabilities { Constants }

    -- Convert integer to fixed-point: n \u2192 n * 100
    -- \u03BBn.n \u00d7 100
    method toFixed(n) = n * 100

    -- Convert fixed-point back to integer (truncates): f \u2192 f / 100
    -- \u03BBf.f \u00f7 100
    method fromFixed(f) = f / 100

    -- Add two fixed-point values (both already scaled)
    -- \u03BBa.\u03BBb.a + b  (scale preserved)
    method addFixed(a, b) = a + b

    -- Subtract two fixed-point values
    -- \u03BBa.\u03BBb.a - b  (scale preserved)
    method subFixed(a, b) = a - b

    -- Multiply fixed-point: (a * b) / 100
    -- Rescale after multiply to avoid double-scaling
    -- \u03BBa.\u03BBb.(a \u00d7 b) / scale
    method mulFixed(a, b) = (a * b) / 100

    -- Divide fixed-point: (a * 100) / b
    -- Pre-scale numerator to preserve precision
    -- \u03BBa.\u03BBb.(a \u00d7 scale) / b
    method divFixed(a, b) =
        if b == 0 then 0
        else (a * 100) / b

    -- Percentage: what is pct% of whole?
    -- \u03BBw.\u03BBp.(w \u00d7 p) / 100
    method percent(whole, pct) = (whole * pct) / 100

    -- Round fixed-point to nearest integer
    -- \u03BBf.(f + 50) / 100  (banker\u2019s rounding approx)
    method roundFixed(f) = (f + 50) / 100
}`,
        'lambda_rational': `-- LAMBDA CALCULUS
-- Rational Arithmetic \u2014 exact fractions on integer hardware
-- A fraction is (numerator, denominator)
-- 1/3 + 1/6 = (1\u00d76 + 1\u00d73) / (3\u00d76) = 9/18 = 1/2
-- No precision loss \u2014 every result is exact

abstraction RationalArith {
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
        'stack_overflow': `// ── Stack Overflow Experiment ──
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

        'recall_demo': `// ── recall() — Re-call self via CR6 ──
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

        'billing': `// ── Billing (NS 47): Capability-Based Memory Quota ──
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

        'turing_memory': `// ── TuringMemory (NS 48): Code-Region Allocation ──
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

abstraction CodeLoader {
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

        'church_memory': `// ── ChurchMemory (NS 49): Namespace Slot Handles ──
// Every abstraction on the Church Machine lives at a
// namespace slot (NS[n]). ChurchMemory (NS 49) manages
// the lifetime of those slots — it provides reference-
// counted handles so the system knows when a slot is
// still in use.
//
// AllocAbstract(ns_slot) → handle   (selector 0)
//   Claims a handle for ns_slot. The first claim
//   creates the tracking entry; subsequent claims
//   increment a reference count. The handle value
//   IS the ns_slot number — it doubles as a pointer.
//
// Free(ns_slot)                      (selector 1)
//   Decrements the reference count. When it reaches
//   zero, the slot is marked free. Any GT pointing
//   into that slot will then fail TPERM — hardware
//   enforces the lifetime automatically.
//
// This is capability revocation without a kernel:
// once every holder has freed its handle, the NS
// entry is gone. No revocation table, no scan.
//
// AbstractionLifecycle wraps ChurchMemory to show
// single-slot acquire/release and a range-acquire
// that claims a contiguous block of slots.

abstraction AbstractionLifecycle {
    capabilities {
        ChurchMemory
    }

    // Acquire: register interest in ns_slot.
    // Returns the handle (same as ns_slot).
    // Multiple callers may Acquire the same slot —
    // the reference count tracks them all.
    method Acquire(ns_slot) {
        handle = call(ChurchMemory.AllocAbstract(ns_slot))
        return(handle)
    }

    // Release: decrement the reference count for ns_slot.
    // When the count reaches zero the slot is freed.
    method Release(ns_slot) {
        ok = call(ChurchMemory.Free(ns_slot))
        return(ok)
    }

    // AcquireRange: claim 'count' consecutive slots
    // starting at 'first'. Returns first on success.
    method AcquireRange(first, count) {
        i = 0
        while (i < count) {
            call(ChurchMemory.AllocAbstract(first + i))
            i = i + 1
        }
        return(first)
    }

    // ReleaseRange: free 'count' consecutive slots
    // starting at 'first'.
    method ReleaseRange(first, count) {
        i = 0
        while (i < count) {
            call(ChurchMemory.Free(first + i))
            i = i + 1
        }
        return(0)
    }
}`,

        'physical_pool': `// ── Memory (NS 7): Raw Physical Word Allocation ──
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

    editor.value = examples[name] || examples['hello'];
    updateLineNumbers();
    saveEditorState();

    document.querySelectorAll('.example-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.example === 'cloomc_' + name);
    });

    const sel = document.getElementById('langSelector');
    if (sel) {
        const isHaskell = ['church_math','church_pair','church_case','church_lambda','sliderule_hs'].includes(name);
        const isSymbolic = ['ada_note_g', 'ada_note_g_published_bug', 'bernoulli_numbers'].includes(name);
        const isEnglish = ['english_hello','english_counter','english_string','english_loops','english_contact','english_contact_stage2'].includes(name);
        const isLambda = ['lambda_church','lambda_booleans','lambda_pairs','lambda_ycomb','lambda_sliderule','lambda_fixedpoint','lambda_rational','lambda_church_vs_compiled'].includes(name);
        sel.value = isLambda ? 'lambda' : isEnglish ? 'english' : isSymbolic ? 'symbolic' : isHaskell ? 'haskell' : 'javascript';
    }

    if (typeof historySetCodeExample === 'function') historySetCodeExample(name);
    const noticeBar = document.getElementById('presetNoticeBar');
    if (noticeBar) noticeBar.style.display = 'none';
}

