import "./_group.css";
import "./_kiss.css";
import { useState } from "react";
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
  const [namespace, setNamespace] = useState<NamespaceName>("New Layout");
  const [selectedSlot, setSelectedSlot] = useState<number>(9);
  const [sendAttempted, setSendAttempted] = useState(false);
  const input = savedInputs[namespace];
  const slots: Slot[] = ("rows" in input ? input.rows : input.abstractions);
  const sorted = [...slots].sort((a, b) => a.slot - b.slot);
  const selected = slots.find(row => row.slot === selectedSlot);
  const missing = slots.filter(row => row.kind === "lump" && !row.selection);
  const isNew = namespace === "New Layout";
  const capacity = "capacityWords" in input ? input.capacityWords : undefined;
  const lumps = slots
    .filter(row => row.kind === "lump" || Boolean(row.filename))
    .sort((a, b) => a.slot - b.slot);
  const colors = ["#73d7c0", "#9fcb72", "#e9c46a", "#ee9b70", "#e887a5", "#b8a1ee", "#72b8df", "#d4dc7b", "#f1a86c", "#70c8d5", "#d89bcc", "#a8d497", "#e9a5a0", "#9daee8", "#dfc078", "#86d5b4"];
  const glassCapacity = capacity ?? 16384;
  const glassHeight = 420;
  const glassTop = 42;
  const glassBottom = glassTop + glassHeight;
  const selectedLump = lumps.find(row => row.slot === selectedSlot);
  const wordValue = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" || !value.trim()) return undefined;
    const parsed = /^0x/i.test(value) ? Number.parseInt(value, 16) : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const locatedLumps = lumps.map(row => ({
    row,
    start: wordValue(row.location),
    words: wordValue(row.limit),
  })).filter((item): item is typeof item & { start: number } =>
    item.start !== undefined && item.start >= 0 && item.start < glassCapacity
  );

  function changeNamespace(value: NamespaceName) {
    setNamespace(value);
    setSelectedSlot(value === "Original" ? 0 : 9);
    setSendAttempted(false);
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
          <section className="kiss-water-map" aria-labelledby="kiss-water-title">
                <div className="kiss-water-heading">
                  <div><span className="kiss-step">SAVED LOCATIONS</span><h4 id="kiss-water-title">Namespace memory glass</h4></div>
                  <span className="kiss-water-caveat">{locatedLumps.length} mapped LUMPs</span>
                </div>
                <p className="kiss-water-intro">Colored regions use each LUMP’s location and extent from the Namespace Table. This is the saved Namespace layout, not a claim that a converted binary has been generated.</p>
                <div className="kiss-glass-layout">
                  <div className="kiss-glass-figure">
                    <div className="kiss-glass-capacity">{glassCapacity.toLocaleString()}-word reference scale</div>
                    <svg className="kiss-water-svg" viewBox="0 0 240 500" role="group" aria-label={`Namespace LUMP locations within a ${glassCapacity.toLocaleString()} word reference address space`}>
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
                        {locatedLumps.map(({ row, start, words }, index) => {
                          const hasExtent = words !== undefined && words > 0;
                          const extentHeight = hasExtent ? words / glassCapacity * glassHeight : 0;
                          const y = glassTop + (glassCapacity - start - (hasExtent ? words : 0)) / glassCapacity * glassHeight;
                          const markerY = glassTop + (glassCapacity - start) / glassCapacity * glassHeight;
                          const active = selectedSlot === row.slot;
                          return <g key={row.slot} role="button" tabIndex={0} aria-label={`Select ${row.name}, slot ${row.slot}, location ${row.location}${words === undefined ? ", extent unknown" : `, extent ${words} words`}`} aria-pressed={active} onClick={() => setSelectedSlot(row.slot)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedSlot(row.slot); } }} className={`kiss-region${active ? " is-selected" : ""}`} style={{ "--kiss-lump-color": colors[index % colors.length] } as CSSProperties}>
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
                      {locatedLumps.length === 0 && <>
                        <text x="120" y="248" textAnchor="middle" className="kiss-glass-empty">NO LOCATIONS</text>
                        <text x="120" y="269" textAnchor="middle" className="kiss-glass-empty-note">Not present in this table</text>
                      </>}
                    </svg>
                    <div className="kiss-glass-zero">{locatedLumps.length} table locations shown</div>
                  </div>
                  <div className="kiss-lump-review">
                    {selectedLump ? <section className="kiss-lump-details" aria-live="polite" aria-labelledby="kiss-lump-detail-title">
                      <div className="kiss-lump-detail-head"><span className="kiss-lump-detail-dot" style={{ "--kiss-lump-color": colors[Math.max(0, lumps.findIndex(row => row.slot === selectedLump.slot)) % colors.length] } as CSSProperties} /><div><span>SELECTED LUMP · SLOT {String(selectedLump.slot).padStart(2, "0")}</span><h5 id="kiss-lump-detail-title">{selectedLump.name}</h5></div></div>
                      <dl>
                        <dt>Bound artifact</dt><dd>{selectedLump.selection?.filename ?? selectedLump.filename ?? "None selected"}</dd>
                        <dt>Revision</dt><dd>{selectedLump.selection?.revision ?? selectedLump.lump_version ?? "—"}</dd>
                        <dt>Token</dt><dd>{selectedLump.selection?.token ?? selectedLump.token ?? "—"}</dd>
                        <dt>Policy</dt><dd>{selectedLump.policy ?? selectedLump.load_policy ?? "Not recorded"}</dd>
                        <dt>Table location</dt><dd>{selectedLump.location ?? "Not recorded"}</dd>
                        <dt>Table extent</dt><dd>{selectedLump.limit ?? "Not recorded"}</dd>
                      </dl>
                    </section> : <div className="kiss-lump-details kiss-no-lump">Select a LUMP slot in the Namespace Table to highlight its location and inspect the saved row.</div>}
                  </div>
                </div>
                <div className="kiss-water-legend"><span>Position and extent come directly from Namespace Table fields.</span><span>Select a table row or region to inspect.</span></div>
          </section>
        </section>

      </div>
      <footer className="kiss-send-footer">
        <div><strong>Send the bound build to FPGA</strong><span>Uses the existing Namespace binding; no rebind.</span></div>
        <button type="button" className="kiss-primary kiss-send-button" onClick={() => setSendAttempted(true)}>Send build to FPGA</button>
        {sendAttempted && <p className="kiss-send-status" role="status">Not sent — this preview has no accepted bound image or hardware connection. No FPGA action occurred.</p>}
      </footer>
      <p className="kiss-footer"><span>Namespace edits belong in Namespace Table. This preview leaves every saved input untouched.</span><span>No network · no storage writes · no hardware</span></p>
    </main>
  );
}
