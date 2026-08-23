import { useEffect } from 'react';

const resources = [
  { label: 'Open the IDE', href: '/simulator/', detail: 'Run the guided loop' },
  { label: 'Startup sequence', href: '/docs/StartupCM.md', detail: 'FPGA boot + bridge boundary' },
  {
    label: 'Namespace vocabulary',
    href: '/docs/namespace-vocabulary-tutorial.md',
    detail: 'From registers to abstractions',
  },
  { label: 'Namespace JSON', href: '/docs/namespace-json.md', detail: 'Inspect the map' },
];

export default function Handout() {
  useEffect(() => {
    document.title = 'Church Machine IDE · Facilitator Handout';
    return () => {
      document.title = 'Church Machine IDE — Introduction';
    };
  }, []);

  return (
    <main className="facilitator-handout">
      <button className="print-handout" type="button" onClick={() => window.print()}>
        Print handout
      </button>

      <header className="handout-header">
        <div>
          <div className="handout-kicker">
            <span className="handout-lambda">λ</span> CHURCH MACHINE <span className="handout-muted">/ IDE</span>
          </div>
          <h1>First run, made repeatable.</h1>
          <p className="handout-lede">
            A one-page guide for helping learners move from a tiny program to a
            trustworthy machine map—and know when the FPGA begins.
          </p>
        </div>
        <div className="handout-stamp">
          <span>FACILITATOR</span>
          <strong>QUICK REFERENCE</strong>
          <small>INTRODUCTION · 01</small>
        </div>
      </header>

      <div className="handout-rule" />

      <section className="handout-workflow">
        <div className="handout-section-heading">
          <span>01</span>
          <div>
            <h2>The first-run loop</h2>
            <p>Keep the first success small enough to explain.</p>
          </div>
        </div>
        <div className="handout-steps">
          {[
            ['OPEN', 'Programs / Editor', 'Start with the 2 + 3 example.'],
            ['CHOOSE', 'Assembly', 'Use the concrete path first.'],
            ['RUN', 'Assemble & Run', 'Ask learners to predict 5.'],
            ['INSPECT', 'Output + trace', 'Separate result from evidence.'],
            ['EXPLAIN', 'Capability + Namespace', 'Name where the machine got authority.'],
          ].map(([verb, title, text], index) => (
            <div className="handout-step" key={verb}>
              <span className="handout-step-number">0{index + 1}</span>
              <div>
                <b>{verb}</b>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="handout-columns">
        <section className="handout-panel vocabulary-panel">
          <div className="handout-section-heading">
            <span>02</span>
            <div>
              <h2>Vocabulary to keep handy</h2>
              <p>Permission and packaging are part of the program’s language.</p>
            </div>
          </div>
          <dl className="vocabulary-list">
            <div>
              <dt>Capability</dt>
              <dd>A handle that carries both an object reference and authority.</dd>
            </div>
            <div>
              <dt>R / W / X / E</dt>
              <dd>Read, write, execute, and enter permissions. Ask: “what may this handle do?”</dd>
            </div>
            <div>
              <dt>C-List</dt>
              <dd>The bounded vocabulary available to a program: its capability entries.</dd>
            </div>
            <div>
              <dt>LUMP</dt>
              <dd>A packaged implementation and data bundle, with identity and metadata.</dd>
            </div>
          </dl>
          <div className="facilitator-prompt">
            <span>ASK</span>
            <p>“Is this a location, a permission, or a named operation?”</p>
          </div>
        </section>

        <section className="handout-panel namespace-panel">
          <div className="handout-section-heading">
            <span>03</span>
            <div>
              <h2>Follow the Namespace path</h2>
              <p>Move from a visible result to the named layout behind it.</p>
            </div>
          </div>
          <div className="namespace-path">
            <div className="namespace-node node-bootstrap"><b>BOOTSTRAP</b><span>entry point</span></div>
            <i>↓</i>
            <div className="namespace-node node-resident"><b>RESIDENT</b><span>platform abstractions</span></div>
            <i>↓</i>
            <div className="namespace-node node-table"><b>NS TABLE</b><span>named slots you can inspect</span></div>
          </div>
          <ol className="namespace-checklist">
            <li><b>Open</b> Builder → Namespace (or the Namespace tutorial).</li>
            <li><b>Locate</b> the abstraction or slot involved in the run.</li>
            <li><b>Connect</b> the name to the C-List entry and its authority.</li>
          </ol>
          <div className="facilitator-prompt cyan-prompt">
            <span>LISTEN FOR</span>
            <p>“The Namespace is a readable machine layout—not just a glossary.”</p>
          </div>
        </section>
      </div>

      <section className="exercise-strip">
        <div className="exercise-title">
          <span>04</span>
          <h2>Exercise: 2 + 3</h2>
          <small>7 MIN · PAIRS</small>
        </div>
        <div className="exercise-items">
          <div><b>01</b><span>Run 2 + 3, then change one operand.</span></div>
          <div><b>02</b><span>Report the output and one trace observation.</span></div>
          <div><b>03</b><span>Name the capability or Namespace view you would inspect after a fault.</span></div>
        </div>
        <div className="report-line"><b>Report back:</b> result <i>·</i> trace clue <i>·</i> next place to look</div>
      </section>

      <section className="fpga-boundary">
        <div className="handout-section-heading">
          <span>05</span>
          <div>
            <h2>FPGA handoff boundary</h2>
            <p>Make this distinction explicit before anyone connects hardware.</p>
          </div>
        </div>
        <div className="boundary-flow">
          <div className="boundary-phase baked-phase">
            <span className="phase-label">PHASE A · BEFORE POWER-ON</span>
            <strong>Synthesis / bitstream</strong>
            <p>Boot ROM, DMEM init data, Namespace table, boot lumps, and C-List are baked into the bitstream.</p>
          </div>
          <div className="boundary-arrow">→</div>
          <div className="boundary-phase bridge-phase">
            <span className="phase-label">PHASE B · AFTER BOOT</span>
            <strong>Bridge / live control</strong>
            <p>Trace observation, step, run, halt, and breakpoints. The bridge does <em>not</em> load the boot image.</p>
          </div>
        </div>
      </section>

      <footer className="handout-footer">
        <div>
          <span className="footer-label">START HERE</span>
          <div className="resource-links">
            {resources.map((resource) => (
              <a href={resource.href} key={resource.href}>
                <b>{resource.label}</b><small>{resource.detail}</small>
              </a>
            ))}
          </div>
        </div>
        <div className="footer-note">Simulator first.<br /><strong>Namespace next.</strong><br />Hardware when ready.</div>
      </footer>
    </main>
  );
}