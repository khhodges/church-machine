import "./_group.css";
import "./_kiss.css";
import { useRef, useState } from "react";
import savedInputs from "./_saved-inputs.json";

type NamespaceName = keyof typeof savedInputs;
type Slot = {
  slot: number; name: string; kind?: string; type?: string;
  policy?: string; load_policy?: string; resident?: boolean;
  sequence?: number; seq?: number; boot?: boolean; filename?: string;
  location?: string; selection?: { filename?: string; revision?: number };
  lump_version?: number;
};

export default function KISS() {
  const [namespace, setNamespace] = useState<NamespaceName>("New Layout");
  const [selectedSlot, setSelectedSlot] = useState<number>(9);
  const [prepared, setPrepared] = useState(false);
  const [example, setExample] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [report, setReport] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = savedInputs[namespace];
  const slots: Slot[] = ("rows" in input ? input.rows : input.abstractions);
  const sorted = [...slots].sort((a, b) => a.slot - b.slot);
  const selected = slots.find(row => row.slot === selectedSlot);
  const missing = slots.filter(row => row.kind === "lump" && !row.selection);
  const isNew = namespace === "New Layout";
  const format = "format" in input ? input.format : "Original saved Namespace format";
  const capacity = "capacityWords" in input ? input.capacityWords : undefined;
  const slotCapacity = "slotCount" in input ? input.slotCount : undefined;
  const codeSelections = slots.filter(row => row.kind === "lump");
  const unselectedCode = codeSelections.filter(row => !row.selection);
  const unfinished = slots.filter(row => row.name === "ide.Mint");

  function changeNamespace(value: NamespaceName) {
    setNamespace(value);
    setSelectedSlot(value === "Original" ? 0 : 9);
    setPrepared(false); setExample(false); setLoaded(false); setReport(false);
    setAcknowledged(false);
  }

  function prepare() {
    setPrepared(true); setLoaded(false); setReport(false);
  }

  return (
    <main className="kiss-workbench">
      <header className="kiss-top">
        <div className="kiss-brand"><span className="kiss-mark" aria-hidden="true">λ</span> CHURCH MACHINE <span className="kiss-muted">/ IDE</span></div>
        <p className="kiss-preview">Design preview — no hardware actions</p>
      </header>

      <div className="kiss-heading">
        <div><h1>Development image</h1><p className="kiss-subtitle">Select a Namespace. Prepare its runtime image. Review before loading.</p></div>
        <span className="kiss-local">LOCAL UI SIMULATION</span>
      </div>

      <div className="kiss-layout">
        <section className="kiss-panel" aria-labelledby="kiss-namespace-title">
          <div className="kiss-panel-head"><h2 id="kiss-namespace-title"><span className="kiss-step">01</span>Namespace Table</h2><span className="kiss-status">Saved inputs</span></div>
          <div className="kiss-selector">
            <label htmlFor="kiss-namespace">Namespace</label>
            <select id="kiss-namespace" value={namespace} onChange={event => changeNamespace(event.target.value as NamespaceName)}>
              {Object.keys(savedInputs).map(name => <option key={name}>{name}</option>)}
            </select>
          </div>
          <p className="kiss-meta">{slots.length} saved rows{"slotCount" in input ? ` · ${input.slotCount} slots` : " · original slot assignments"} · Select a name to inspect its saved data.</p>
          <div className="kiss-table-scroll" tabIndex={0} role="region" aria-label={`${namespace} saved slot table`}>
            <table>
              <thead><tr><th scope="col">Slot</th><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Policy</th><th scope="col">Rev.</th></tr></thead>
              <tbody>{sorted.map(row => {
                const kind = row.kind ?? (row.filename ? "lump" : row.name.includes("DEV") ? "mmio" : row.name.includes("Thread") ? "thread" : "namespace");
                const policy = row.policy ?? row.load_policy ?? (kind === "mmio" ? "Hardware" : "—");
                return <tr key={row.slot} className={selectedSlot === row.slot ? "kiss-active" : undefined}>
                  <td>{String(row.slot).padStart(2, "0")}</td>
                  <td><button className="kiss-slot-button" onClick={() => setSelectedSlot(row.slot)} aria-pressed={selectedSlot === row.slot} aria-label={`Inspect slot ${row.slot}, ${row.name}`}>{row.name}</button>{row.boot && <span className="kiss-tag">boot</span>}{row.name === "ide.Mint" && <span className="kiss-tag">unfinished</span>}</td>
                  <td className="kiss-kind">{kind}</td><td className="kiss-kind">{policy}</td>
                  <td className="kiss-kind">{row.selection?.revision ?? row.lump_version ?? "—"}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <details className="kiss-technical">
            <summary>Technical details · {selected?.name ?? "Namespace"}</summary>
            <p className="kiss-muted">Exact saved row. Kind labels for Original are inferred for display; saved data is unchanged.</p>
            <pre>{JSON.stringify(selected, null, 2)}</pre>
            <p className="kiss-muted">Namespace metadata</p>
            <pre>{JSON.stringify(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "rows" && key !== "abstractions")), null, 2)}</pre>
          </details>
          <section className="kiss-design-review" aria-labelledby="kiss-design-review-title">
            <div className="kiss-review-head">
              <div><span className="kiss-step">REVIEW</span><h3 id="kiss-design-review-title">Binary design &amp; memory layout</h3></div>
              <span className="kiss-review-note">Observations · not a build gate</span>
            </div>
            <div className="kiss-review-grid">
              <article>
                <h4>Binary design</h4>
                <dl>
                  <dt>Saved format</dt><dd>{format}</dd>
                  <dt>Code slots</dt><dd>{codeSelections.length} selected rows · {unselectedCode.length} without a selected artifact</dd>
                  {unfinished.length > 0 && <><dt>Unfinished code</dt><dd>Mint remains in this saved design{unfinished[0].selection ? " with its selected revision retained" : " without a selected artifact"}.</dd></>}
                  <dt>Conversion</dt><dd>{isNew ? "Prior probe produced a 65,536-byte simulator image; Wukong projection rejected it: missing Namespace Header V2 marker." : "Not converted in this design preview. Image format and loader compatibility need a real conversion result."}</dd>
                </dl>
              </article>
              <article>
                <h4>Memory layout</h4>
                <dl>
                  <dt>Namespace capacity</dt><dd>{capacity ? `${capacity.toLocaleString()} words` : "Not recorded in this saved design"}</dd>
                  <dt>Slot-table capacity</dt><dd>{slotCapacity ? `${slotCapacity} slots` : "Original layout fields"}</dd>
                  <dt>Saved rows</dt><dd>{slots.length} logical slot assignments, numbered {Math.min(...slots.map(row => row.slot))}–{Math.max(...slots.map(row => row.slot))}</dd>
                  <dt>Physical word placement</dt><dd>Not present in this design file; must be reported by conversion, not inferred from slot numbers.</dd>
                </dl>
              </article>
            </div>
            <p className="kiss-review-foot">This review does not edit the Namespace or suppress unfinished entries. Preparation findings remain visible and do not prevent further inspection.</p>
          </section>
        </section>

        <aside className="kiss-rail" aria-label="Prepare and load workflow">
          <section className="kiss-panel" aria-labelledby="kiss-prepare-title">
            <div className="kiss-panel-head"><h2 id="kiss-prepare-title"><span className="kiss-step">02</span>Prepare runtime image</h2></div>
            <div className="kiss-content">
              <p className="kiss-muted">Use the saved <strong>{namespace}</strong> rows as-is. Preparation does not edit the Namespace or finish Mint.</p>
              <button className="kiss-primary kiss-wide" onClick={prepare}>{prepared ? "Prepare again (simulated)" : "Prepare image (simulated)"}</button>
              <div aria-live="polite">
                {!prepared ? <p className="kiss-muted" style={{ marginTop: 12 }}>Not prepared. No image has been generated.</p> : <>
                  <div className="kiss-finding">
                    <strong>{isNew ? "Demo finding · loader format mismatch" : missing.length ? "Demo finding · artifacts not selected" : "Demo preparation · compatibility unknown"}</strong>
                    {isNew ? "New Layout uses a saved format that the current loader does not accept. No runtime image was converted." : missing.length ? `${missing.length} lump rows have no selected artifact, including ide.Mint. No runtime image was generated.` : "Saved rows reviewed in this UI only. No converter ran and no loadable image was generated."}
                  </div>
                  {slots.some(row => row.name === "ide.Mint") && <p className="kiss-muted" style={{ marginTop: 10 }}>Mint remains unfinished. {isNew ? "Its saved lazy artifact selection is retained." : "Its empty artifact selection is retained."} All {slots.length} rows are preserved.</p>}
                  <div className="kiss-example">
                    <label className="kiss-check"><input type="checkbox" checked={example} onChange={event => { setExample(event.target.checked); setLoaded(false); setReport(false); }} /><span>Use a synthetic example payload to try the load interaction.</span></label>
                    <p className="kiss-muted" style={{ marginTop: 7 }}>Not a conversion of {namespace}. No supported firmware is asserted.</p>
                  </div>
                </>}
              </div>
              <details style={{ marginTop: 12 }}>
                <summary>Preparation details</summary>
                <pre>{`Mode: local simulation only\nSaved format: ${"format" in input ? input.format : "Original abstractions"}\nConverter executed: no\nRows modified: none\nFirmware compatibility: unverified\nHardware accessed: no`}</pre>
              </details>
            </div>
          </section>

          <section className="kiss-panel" aria-labelledby="kiss-load-title">
            <div className="kiss-panel-head"><h2 id="kiss-load-title"><span className="kiss-step">03</span>Connect & load</h2><span className="kiss-status">{connected ? "Demo connected" : "Disconnected"}</span></div>
            <div className="kiss-content">
              <p className="kiss-muted">Optional FPGA interaction demo. No bridge, serial port, or board is contacted.</p>
              <button className="kiss-wide" onClick={() => { setConnected(!connected); setLoaded(false); setReport(false); }}>{connected ? "Disconnect demo FPGA" : "Connect demo FPGA"}</button>
              {connected && <p className="kiss-muted" style={{ marginTop: 9 }}>Example FPGA connection only · identity unverified</p>}
              <button className="kiss-primary kiss-wide" disabled={!connected || !prepared || !example} onClick={() => { setAcknowledged(false); dialog.current?.showModal(); }}>Load example into demo memory…</button>
              <p className="kiss-muted" style={{ marginTop: 9 }}>{!connected ? "Connect the demo, then choose a synthetic payload." : !example ? "Prepare and select the synthetic example to try loading." : "Loading replaces runtime memory; confirmation required."}</p>
              <div aria-live="polite">
                <div className="kiss-evidence">
                  <strong>{loaded ? "Example receipt · acknowledgement only" : "Contents unverified"}</strong>
                  <dl><dt>Payload</dt><dd>{loaded ? "Synthetic example, not saved Namespace" : "None loaded"}</dd><dt>Transport</dt><dd>{loaded ? "Demo acknowledgement" : "Not tested"}</dd><dt>Full readback</dt><dd>Not performed</dd><dt>Board contents</dt><dd>Unverified · no real board read</dd></dl>
                </div>
              </div>
              <button className="kiss-wide" onClick={() => setReport(!report)}>{report ? "Hide evidence report" : "Show evidence report"}</button>
              {report && <pre aria-label="Demo evidence report">{`DESIGN PREVIEW · EXAMPLE EVIDENCE\nNamespace: ${namespace}\nSaved rows: ${slots.length}; unchanged\nPreparation: ${prepared ? "simulated; no image generated" : "not run"}\nConnection: ${connected ? "demo only" : "none"}\nLoad: ${loaded ? "synthetic example; demo ACK only" : "not performed"}\nFull readback: not performed\nReal board contents: UNVERIFIED\nNo hardware actions occurred.`}</pre>}
            </div>
          </section>
        </aside>
      </div>
      <footer className="kiss-footer"><span>Namespace edits belong in Namespace Table. This preview leaves every saved input untouched.</span><span>No network · no storage writes · no hardware</span></footer>

      <dialog ref={dialog} aria-labelledby="kiss-confirm-title" onCancel={() => setAcknowledged(false)}>
        <h2 id="kiss-confirm-title">Replace runtime memory?</h2>
        <p>On a real FPGA, loading replaces the current runtime image and loses runtime memory, including unsaved state. This demo changes UI state only.</p>
        <p className="kiss-muted">Payload: synthetic example, not {namespace}. An acknowledgement is not full readback; real board contents remain unverified.</p>
        <label className="kiss-check"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>I understand that a real load would lose the current runtime memory.</span></label>
        <div className="kiss-modal-actions"><button onClick={() => dialog.current?.close()}>Cancel</button><button className="kiss-primary" disabled={!acknowledged} onClick={() => { setLoaded(true); setReport(false); dialog.current?.close(); }}>Confirm demo load</button></div>
      </dialog>
    </main>
  );
}
