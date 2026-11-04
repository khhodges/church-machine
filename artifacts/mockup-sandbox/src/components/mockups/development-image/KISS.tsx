import "./_group.css";
import "./_kiss.css";
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import savedInputs from "./_saved-inputs.json";

type NamespaceName = keyof typeof savedInputs;
type Slot = {
  slot: number; name: string; kind?: string; type?: string; limit?: string | number;
  policy?: string; load_policy?: string; resident?: boolean; token?: string;
  sequence?: number; seq?: number; boot?: boolean; filename?: string;
  location?: string; selection?: { filename?: string; revision?: number; token?: string };
  lump_version?: number;
};

export default function KISS() {
  const [namespace, setNamespace] = useState<NamespaceName>("Original");
  const [selectedSlot, setSelectedSlot] = useState<number>(6);
  const [sendAttempted, setSendAttempted] = useState(false);
  const detailsDialog = useRef<HTMLDialogElement>(null);
  const detailsOpener = useRef<HTMLElement | SVGElement | null>(null);
  const input = savedInputs[namespace];
  const slots: Slot[] = ("rows" in input ? input.rows : input.abstractions);
  const sorted = [...slots].sort((a, b) => a.slot - b.slot);
  const selected = slots.find(row => row.slot === selectedSlot);
  const missing = slots.filter(row => row.kind === "lump" && !row.selection);
  const isNew = namespace === "New Layout";
  const capacity = "capacityWords" in input ? input.capacityWords : undefined;
  const colors = ["#73d7c0", "#9fcb72", "#e9c46a", "#ee9b70", "#e887a5", "#b8a1ee", "#72b8df", "#d4dc7b", "#f1a86c", "#70c8d5", "#d89bcc", "#a8d497", "#e9a5a0", "#9daee8", "#dfc078", "#86d5b4"];
  const glassCapacity = capacity ?? 16384;
  const glassHeight = 420;
  const glassTop = 42;
  const glassBottom = glassTop + glassHeight;
  const wordValue = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" || !value.trim()) return undefined;
    const parsed = /^0x/i.test(value) ? Number.parseInt(value, 16) : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  // The saved table can place LUMPs, Threads, and boot entries in the same
  // address space. Keep only in-range saved locations; never infer placement.
  const locatedEntries = slots.map(row => ({
    row,
    start: wordValue(row.location),
    words: wordValue(row.limit),
  })).filter((item): item is typeof item & { start: number } =>
    item.start !== undefined && item.start >= 0 && item.start < glassCapacity
  );
  const colorForSlot = (slot: number) => {
    const index = locatedEntries.findIndex(item => item.row.slot === slot);
    return index < 0 ? undefined : colors[index % colors.length];
  };

  function changeNamespace(value: NamespaceName) {
    setNamespace(value);
    const nextInput = savedInputs[value];
    const nextSlots: Slot[] = ("rows" in nextInput ? nextInput.rows : nextInput.abstractions);
    setSelectedSlot(nextSlots.find(row => row.kind === "lump" || Boolean(row.filename))?.slot ?? nextSlots[0]?.slot ?? 0);
    setSendAttempted(false);
  }

  function inspectSlot(row: Slot, control: HTMLElement | SVGElement) {
    setSelectedSlot(row.slot);
    detailsOpener.current = control;
    if (!detailsDialog.current?.open) detailsDialog.current?.showModal();
  }

  function restoreDetailsFocus() {
    const opener = detailsOpener.current;
    requestAnimationFrame(() => opener?.focus());
  }

  return (
    <main className="kiss-workbench">
      <header className="kiss-top">
        <div className="kiss-brand"><span className="kiss-mark" aria-hidden="true">λ</span> CHURCH MACHINE <span className="kiss-muted">/ IDE</span></div>
        <p className="kiss-preview">Design preview — FPGA transfer unavailable</p>
      </header>

      <div className="kiss-heading">
        <div><h1>Development image</h1><p className="kiss-subtitle">Review the bound Namespace layout, then send it to the FPGA.</p></div>
        <span className="kiss-local">LOCAL UI SIMULATION</span>
      </div>

      <div className="kiss-layout kiss-layout-single">
        <section className="kiss-panel" aria-labelledby="kiss-namespace-title">
          <div className="kiss-panel-head"><h2 id="kiss-namespace-title"><span className="kiss-step">01</span>Namespace Table</h2><span className="kiss-status">Saved inputs</span></div>
          <div className="kiss-selector">
            <label htmlFor="kiss-namespace">Namespace</label>
            <select id="kiss-namespace" value={namespace} onChange={event => changeNamespace(event.target.value as NamespaceName)}>
              {Object.keys(savedInputs).map(name => <option key={name}>{name}</option>)}
            </select>
          </div>
          <p className="kiss-meta">{slots.length} saved rows{"slotCount" in input ? ` · ${input.slotCount} slots` : " · original slot assignments"} · Select a name to inspect its saved data.</p>
          <div className="kiss-slot-visual-row">
          <div className="kiss-table-scroll" tabIndex={0} role="region" aria-label={`${namespace} saved slot table`}>
            <table>
              <thead><tr><th scope="col">Slot</th><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Policy</th><th scope="col">Rev.</th></tr></thead>
              <tbody>{sorted.map(row => {
                const kind = row.kind ?? (row.filename ? "lump" : row.name.includes("DEV") ? "mmio" : row.name.includes("Thread") ? "thread" : "namespace");
                const policy = row.policy ?? row.load_policy ?? (kind === "mmio" ? "Hardware" : "—");
                return <tr key={row.slot} className={selectedSlot === row.slot ? "kiss-active" : undefined}>
                  <td>{String(row.slot).padStart(2, "0")}</td>
                  <td>{colorForSlot(row.slot) && <span className="kiss-slot-color" style={{ "--kiss-lump-color": colorForSlot(row.slot) } as CSSProperties} aria-hidden="true" />}<button className="kiss-slot-button" style={colorForSlot(row.slot) ? { "--kiss-lump-color": colorForSlot(row.slot) } as CSSProperties : undefined} onClick={event => inspectSlot(row, event.currentTarget)} aria-pressed={selectedSlot === row.slot} aria-label={`Inspect slot ${row.slot}, ${row.name}`}>{row.name}</button>{row.boot || row.name.startsWith("Boot.") ? <span className="kiss-tag">boot</span> : null}{row.name === "ide.Mint" && <span className="kiss-tag">unfinished</span>}</td>
                  <td className="kiss-kind">{kind}</td><td className="kiss-kind">{policy}</td>
                  <td className="kiss-kind">{row.selection?.revision ?? row.lump_version ?? "—"}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <section className="kiss-water-map" aria-labelledby="kiss-water-title">
                <div className="kiss-water-heading">
                  <div><span className="kiss-step">SAVED LOCATIONS</span><h4 id="kiss-water-title">Namespace memory glass</h4></div>
                  <span className="kiss-water-caveat">{locatedEntries.length} mapped entries</span>
                </div>
                <p className="kiss-water-intro">Colored regions use each saved entry’s location and extent, including LUMPs, Threads, and Boot.NS / Boot.Thread. This is the Namespace layout, not a generated binary map.</p>
                <div className="kiss-glass-layout">
                  <div className="kiss-glass-figure">
                    <div className="kiss-glass-capacity">{glassCapacity.toLocaleString()}-word reference scale</div>
                    <svg className="kiss-water-svg" viewBox="0 0 240 500" role="group" aria-label={`Namespace memory locations within a ${glassCapacity.toLocaleString()} word reference address space`}>
                      <defs>
                        <linearGradient id="kiss-empty-glass" x1="0" x2="1">
                          <stop offset="0" stopColor="#b9eee2" stopOpacity=".13" />
                          <stop offset=".16" stopColor="#b9eee2" stopOpacity=".035" />
                          <stop offset=".84" stopColor="#b9eee2" stopOpacity=".035" />
                          <stop offset="1" stopColor="#b9eee2" stopOpacity=".13" />
                        </linearGradient>
                        <clipPath id="kiss-location-clip"><path d={`M49 ${glassTop} H191 L181 ${glassBottom - 10} Q120 ${glassBottom + 17} 59 ${glassBottom - 10} Z`} /></clipPath>
                      </defs>
                      <path d={`M49 ${glassTop} H191 L181 ${glassBottom - 10} Q120 ${glassBottom + 17} 59 ${glassBottom - 10} Z`} fill="url(#kiss-empty-glass)" stroke="#b9eee2" strokeOpacity=".84" strokeWidth="2" />
                      <g clipPath="url(#kiss-location-clip)">
                        {locatedEntries.map(({ row, start, words }, index) => {
                          const hasExtent = words !== undefined && words > 0;
                          const extentHeight = hasExtent ? words / glassCapacity * glassHeight : 0;
                          const y = glassTop + (glassCapacity - start - (hasExtent ? words : 0)) / glassCapacity * glassHeight;
                          const markerY = glassTop + (glassCapacity - start) / glassCapacity * glassHeight;
                          const active = selectedSlot === row.slot;
                          const color = colorForSlot(row.slot) ?? colors[index % colors.length];
                          const kind = row.kind ?? (row.filename ? "lump" : row.name.startsWith("Boot.") ? "boot" : row.name.includes("Thread") ? "thread" : "entry");
                          return <g key={row.slot} role="button" tabIndex={0} aria-label={`Inspect ${row.name}, ${kind}, slot ${row.slot}, location ${row.location}${words === undefined ? ", extent unknown" : `, extent ${words} words`}`} aria-pressed={active} onClick={event => inspectSlot(row, event.currentTarget)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inspectSlot(row, event.currentTarget); } }} className={`kiss-region${active ? " is-selected" : ""}`} style={{ "--kiss-lump-color": color } as CSSProperties}>
                            {hasExtent ? <>
                              <rect x="60" y={y} width="120" height={extentHeight} rx="2" />
                              {extentHeight >= 14 && <text x="120" y={y + Math.min(extentHeight - 3, 12)} textAnchor="middle">{row.name}</text>}
                            </> : <line x1="113" x2="127" y1={markerY} y2={markerY} stroke={colors[index % colors.length]} strokeWidth="3" strokeLinecap="round" />}
                          </g>;
                        })}
                      </g>
                      <path d={`M55 ${glassTop + 7} V${glassBottom - 19}`} stroke="#e7fff8" strokeOpacity=".25" strokeWidth="3" />
                      {[0, .25, .5, .75, 1].map((fraction, index) => {
                        const y = glassTop + fraction * glassHeight;
                        const words = Math.round(glassCapacity * (1 - fraction));
                        return <g key={index}>
                          <line x1="38" x2={index === 0 || index === 4 ? 61 : 70} y1={y} y2={y} stroke="#b9eee2" strokeOpacity=".7" />
                          <text x="32" y={y + 4} textAnchor="end" className="kiss-glass-tick">{words.toLocaleString()}</text>
                        </g>;
                      })}
                      {locatedEntries.length === 0 && <>
                        <text x="120" y="248" textAnchor="middle" className="kiss-glass-empty">NO LOCATIONS</text>
                        <text x="120" y="269" textAnchor="middle" className="kiss-glass-empty-note">Not present in this table</text>
                      </>}
                    </svg>
                    <div className="kiss-glass-zero">{locatedEntries.length} saved locations shown</div>
                  </div>
                </div>
                <div className="kiss-water-legend"><span>Position and extent come directly from Namespace Table fields.</span><span>Threads and boot entries share the same scale. Select a row or region to inspect.</span></div>
          </section>
          </div>
          <details className="kiss-technical">
            <summary>Technical details · {selected?.name ?? "Namespace"}</summary>
            <p className="kiss-muted">Exact saved row. Kind labels for Original are inferred for display; saved data is unchanged.</p>
            <pre>{JSON.stringify(selected, null, 2)}</pre>
            <p className="kiss-muted">Namespace metadata</p>
            <pre>{JSON.stringify(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "rows" && key !== "abstractions")), null, 2)}</pre>
          </details>
        </section>

      </div>
      <footer className="kiss-send-footer">
        <div><strong>Send the bound build to FPGA</strong><span>Uses the existing Namespace binding; no rebind.</span></div>
        <button type="button" className="kiss-primary kiss-send-button" onClick={() => setSendAttempted(true)}>Send build to FPGA</button>
        {sendAttempted && <p className="kiss-send-status" role="status">Not sent — this preview has no accepted bound image or hardware connection. No FPGA action occurred.</p>}
      </footer>
      <dialog
        ref={detailsDialog}
        className="kiss-slot-dialog"
        aria-labelledby="kiss-slot-dialog-title"
        onClose={restoreDetailsFocus}
        onClick={event => {
          if (event.target === event.currentTarget) detailsDialog.current?.close();
        }}
      >
        {selected && (() => {
          const kind = selected.kind ?? (selected.filename ? "lump" : selected.name.includes("DEV") ? "mmio" : selected.name.includes("Thread") ? "thread" : "namespace");
          const value = (field: string | number | undefined) => field === undefined || field === "" ? "Not recorded" : String(field);
          return <>
            <div className="kiss-slot-dialog-head">
              <span className="kiss-slot-dialog-kicker">SAVED SLOT · {String(selected.slot).padStart(2, "0")} · {kind.toUpperCase()}</span>
              <h2 id="kiss-slot-dialog-title">{selected.name}</h2>
            </div>
            <dl className="kiss-slot-dialog-fields">
              <dt>Slot</dt><dd>{selected.slot}</dd>
              <dt>Artifact</dt><dd>{value(selected.selection?.filename ?? selected.filename)}</dd>
              <dt>Revision</dt><dd>{value(selected.selection?.revision ?? selected.lump_version)}</dd>
              <dt>Token</dt><dd>{value(selected.selection?.token ?? selected.token)}</dd>
              <dt>Policy</dt><dd>{value(selected.policy ?? selected.load_policy)}</dd>
              <dt>Location</dt><dd>{value(selected.location)}</dd>
              <dt>Extent</dt><dd>{value(selected.limit)}</dd>
            </dl>
            <details className="kiss-slot-raw">
              <summary>Exact saved row fields</summary>
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            </details>
            <div className="kiss-slot-dialog-actions">
              <button type="button" className="kiss-primary" onClick={() => detailsDialog.current?.close()}>Close</button>
            </div>
          </>;
        })()}
      </dialog>
      <p className="kiss-footer"><span>Namespace edits belong in Namespace Table. This preview leaves every saved input untouched.</span><span>No network · no storage writes · no hardware</span></p>
    </main>
  );
}
