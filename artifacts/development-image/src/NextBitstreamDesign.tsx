import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { request } from "./image-api";
import type { CatalogEntry } from "./image-api";
import { latestChoices } from "./latest-image";
import { checkDraft, REGION_LABELS } from "./next-bitstream";
import type { DraftInputs, DraftRegionKey } from "./next-bitstream";
import NamespacePicker from "./NamespacePicker";
import { readPlanningDraft, rememberPlanningDraft } from "./next-bitstream-draft";

const COLORS: Record<DraftRegionKey, string> = {namespaceA: "#73d7c0", namespaceB: "#b8a1ee", lumpZone: "#e9c46a"};
const EMPTY: DraftInputs = {total: "", namespaceA: "", namespaceB: "", lumpZone: ""};

type Props = {returnKey: string; hidden?: boolean; onReturned?: () => void};

export default function NextBitstreamDesign({returnKey, hidden, onReturned}: Props) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [initialDraft] = useState(readPlanningDraft);
  const [refA, setRefA] = useState(initialDraft.refA);
  const [refB, setRefB] = useState(initialDraft.refB);
  const [draft, setDraft] = useState<DraftInputs>(initialDraft.draft);
  useEffect(() => { rememberPlanningDraft({refA, refB, draft}); }, [refA, refB, draft]);
  const [selected, setSelected] = useState<DraftRegionKey | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setCatalogLoading(true); setCatalogError("");
    request<{entries: CatalogEntry[]}>("/api/development-image/catalog", {signal: controller.signal})
      .then(result => {
        const named = result.entries.map(entry => ({...entry, name: NamespaceSelection.name(entry.id, entry.name)}));
        setEntries(latestChoices(named).filter(entry => entry.selection_key));
      })
      .catch(cause => { if (!controller.signal.aborted) setCatalogError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [catalogRefresh]);

  const check = checkDraft(draft);
  const nameOf = (key: string) => entries.find(entry => entry.selection_key === key)?.name;
  const refFor: Partial<Record<DraftRegionKey, string>> = {namespaceA: refA, namespaceB: refB};
  const regionName = (key: DraftRegionKey) => (refFor[key] && nameOf(refFor[key]!)) || REGION_LABELS[key];
  const sameRef = refA && refA === refB;

  async function switchToDesigner() {
    try {
      const host = window.parent as Window & {DevelopmentImageView?: {openDesigner(key: string): Promise<void>}};
      if (!returnKey || host === window || !host.DevelopmentImageView?.openDesigner)
        throw Error("Select a saved Namespace in Image Development inside the IDE to return to its designer.");
      await host.DevelopmentImageView.openDesigner(returnKey);
      setError("");
      onReturned?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  const glassHeight = 420, glassTop = 42, glassBottom = glassTop + glassHeight;
  const scale = check.scaleWords;
  const drawn = check.regions.filter(r => r.words !== null && r.start !== null && scale > 0);
  const shape = `M49 ${glassTop} H191 L181 ${glassBottom - 10} Q120 ${glassBottom + 17} 59 ${glassBottom - 10} Z`;
  const set = (key: keyof DraftInputs) => (value: string) => setDraft(prev => ({...prev, [key]: value}));

  return (
    <main className="kiss-workbench" hidden={hidden}>
      <header className="kiss-top kiss-top-embedded">
        <p className="kiss-preview">Next Bitstream Design — planning draft only. Nothing is saved, compiled, built, or sent.</p>
      </header>

      <div className="kiss-heading">
        <div className="kiss-heading-controls">
          <div className="kiss-selector kiss-heading-selector">
            <label htmlFor="nb-ref-a">Namespace A</label>
            <NamespacePicker id="nb-ref-a" label="Namespace A" value={refA} onChange={setRefA}
              loading={catalogLoading} options={entries.map(entry => ({value: entry.selection_key!, label: entry.name}))} />
          </div>
          <div className="kiss-selector kiss-heading-selector">
            <label htmlFor="nb-ref-b">Namespace B</label>
            <NamespacePicker id="nb-ref-b" label="Namespace B" value={refB} onChange={setRefB}
              loading={catalogLoading} options={entries.map(entry => ({value: entry.selection_key!, label: entry.name}))} />
          </div>
        </div>
        <button type="button" className="kiss-primary" onClick={() => void switchToDesigner()} disabled={!returnKey}
          aria-label="Switch to Namespace Designer" title="Return to the shared Namespace designer; this draft stays here">Switch → Namespace Designer</button>
      </div>
      {error && <p className="kiss-api-error" role="alert">{error} No saved data was changed.</p>}
      {catalogError && <p className="kiss-api-error" role="alert">{catalogError} References are read-only. <button type="button" onClick={() => setCatalogRefresh(v => v + 1)}>Retry catalog</button></p>}
      {catalogLoading && <p className="kiss-api-message" role="status">Reading saved Namespace references…</p>}
      {sameRef && <p className="kiss-api-message" role="status">Namespace A and B reference the same saved Namespace. Allowed in a draft, but they would be two resident copies.</p>}

      <div className="kiss-layout kiss-layout-single">
        <section className="kiss-panel" aria-labelledby="nb-title">
          <div className="kiss-slot-visual-row">
            <div className="kiss-slot-column">
              <div className="kiss-panel-head"><h2 id="nb-title"><span className="kiss-step">01</span>Proposed memory zones</h2><span className="kiss-status">Unapproved draft</span></div>
              <p className="kiss-meta">Word counts, decimal or 0x hex. Leave blank to keep a size unspecified; no defaults are assumed.</p>
              <div className="kiss-table-scroll" role="region" aria-label="Proposed zone sizes">
                <table>
                  <thead><tr><th scope="col">Zone</th><th scope="col">Reference</th><th scope="col">Proposed words</th><th scope="col">Start</th></tr></thead>
                  <tbody>
                    <tr>
                      <td>ALL</td><td className="kiss-kind">Proposed total memory</td>
                      <td><input className="nb-input" aria-label="Proposed total memory in words" placeholder="unspecified" value={draft.total} onChange={e => set("total")(e.target.value)} /></td>
                      <td className="kiss-kind">—</td>
                    </tr>
                    {check.regions.map((region, i) => (
                      <tr key={region.key} className={selected === region.key ? "kiss-active" : undefined}>
                        <td>{String(i + 1).padStart(2, "0")}</td>
                        <td><span className="kiss-slot-color" style={{"--kiss-lump-color": COLORS[region.key]} as CSSProperties} aria-hidden="true" />
                          <button className="kiss-slot-button" style={{"--kiss-lump-color": COLORS[region.key]} as CSSProperties} aria-pressed={selected === region.key} onClick={() => setSelected(region.key)}>{regionName(region.key)}</button>
                          <span className="kiss-tag">proposed</span></td>
                        <td><input className="nb-input" aria-label={`${region.label} size in words`} placeholder="unspecified" value={draft[region.key]} onChange={e => set(region.key)(e.target.value)} onFocus={() => setSelected(region.key)} /></td>
                        <td className="kiss-kind">{region.start === null ? "—" : `0x${region.start.toString(16).toUpperCase().padStart(8, "0")}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="nb-check" aria-live="polite">
                {check.errors.map(msg => <p key={msg} className="nb-error">{msg}</p>)}
                {check.notes.map(msg => <p key={msg}>{msg}</p>)}
                <dl>
                  <dt>Specified</dt><dd>{check.specifiedWords.toLocaleString()} words</dd>
                  <dt>Proposed total</dt><dd>{check.total === null ? "Unspecified" : `${check.total.toLocaleString()} words`}</dd>
                  <dt>Unallocated</dt><dd>{check.remainingWords === null ? "Not assessed" : `${check.remainingWords.toLocaleString()} words (arithmetic only, not a fit claim)`}</dd>
                </dl>
                <div className="kiss-dialog-actions" style={{justifyContent: "flex-start", marginTop: 8}}>
                  <button type="button" onClick={() => { setDraft(EMPTY); setSelected(null); }}>Clear sizes</button>
                </div>
              </div>
            </div>

            <section className="kiss-water-map" aria-labelledby="nb-glass-title">
              <div className="kiss-water-heading">
                <div><span className="kiss-step">PROPOSED LAYOUT</span><h4 id="nb-glass-title">Next bitstream memory glass</h4></div>
                <span className="kiss-water-caveat">{drawn.length} proposed zones</span>
              </div>
              <p className="kiss-water-intro">Two resident Namespace regions and one common zone for individual LUMPs, stacked in entry order. Proposed sizes only; not a synthesized, compiled, or verified map.</p>
              <div className="kiss-glass-layout">
                <div className="kiss-glass-figure">
                  <div className="kiss-glass-capacity">{check.scaleSource === "proposed-total" ? `${scale.toLocaleString()}-word proposed total` : check.scaleSource === "sum-of-regions" ? "Scale: sum of proposed zones (no total)" : "No proposed sizes"}</div>
                  <svg className="kiss-water-svg" viewBox="0 0 240 500" role="group" aria-label="Proposed next bitstream memory zones">
                    <defs>
                      <linearGradient id="nb-empty-glass" x1="0" x2="1">
                        <stop offset="0" stopColor="#b9eee2" stopOpacity=".13" />
                        <stop offset=".16" stopColor="#b9eee2" stopOpacity=".035" />
                        <stop offset=".84" stopColor="#b9eee2" stopOpacity=".035" />
                        <stop offset="1" stopColor="#b9eee2" stopOpacity=".13" />
                      </linearGradient>
                      <clipPath id="nb-location-clip"><path d={shape} /></clipPath>
                    </defs>
                    <path d={shape} fill="url(#nb-empty-glass)" stroke={check.errors.length ? "#ee9b70" : "#b9eee2"} strokeOpacity=".84" strokeWidth="2" />
                    <g clipPath="url(#nb-location-clip)">
                      {drawn.map(region => {
                        const words = Math.min(region.words!, Math.max(0, scale - region.start!));
                        const h = words / scale * glassHeight;
                        const y = glassTop + (scale - region.start! - words) / scale * glassHeight;
                        const active = selected === region.key;
                        return <g key={region.key} role="button" tabIndex={0} aria-pressed={active}
                          aria-label={`Select ${regionName(region.key)}, proposed ${region.words} words at word ${region.start}`}
                          onClick={() => setSelected(region.key)}
                          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(region.key); } }}
                          className={`kiss-region${active ? " is-selected" : ""}`} style={{"--kiss-lump-color": COLORS[region.key]} as CSSProperties}>
                          <rect x="60" y={y} width="120" height={h} rx="2" style={{opacity: active || !selected ? .85 : .3}} />
                          {h >= 14 && <text x="120" y={y + Math.min(h - 3, 12)} textAnchor="middle">PROPOSED · {region.key === "lumpZone" ? "LUMP ZONE" : region.key === "namespaceA" ? "NS A" : "NS B"}</text>}
                        </g>;
                      })}
                    </g>
                    <path d={`M55 ${glassTop + 7} V${glassBottom - 19}`} stroke="#e7fff8" strokeOpacity=".25" strokeWidth="3" />
                    {scale > 0 && [0, .25, .5, .75, 1].map((fraction, index) => {
                      const y = glassTop + fraction * glassHeight;
                      return <g key={index}>
                        <line x1="38" x2={index === 0 || index === 4 ? 61 : 70} y1={y} y2={y} stroke="#b9eee2" strokeOpacity=".7" />
                        <text x="32" y={y + 4} textAnchor="end" className="kiss-glass-tick">{Math.round(scale * (1 - fraction)).toLocaleString()}</text>
                      </g>;
                    })}
                    {drawn.length === 0 && <>
                      <text x="120" y="248" textAnchor="middle" className="kiss-glass-empty">UNSPECIFIED</text>
                      <text x="120" y="269" textAnchor="middle" className="kiss-glass-empty-note">Enter proposed sizes to draw zones</text>
                    </>}
                  </svg>
                  <div className="kiss-glass-zero">{check.errors.length ? "Draft has validation errors" : "Proposed — no fit claim"}</div>
                </div>
                <aside className="kiss-device-card" aria-label="Selected proposed zone">
                  {selected ? (() => {
                    const region = check.regions.find(r => r.key === selected)!;
                    return <>
                      <span className="kiss-device-kicker">PROPOSED ZONE</span>
                      <strong style={{color: COLORS[selected]}}>{regionName(selected)}</strong>
                      <span className="kiss-device-type">{selected === "lumpZone" ? "Shared by both Namespaces for individually placed LUMPs" : refFor[selected] ? `References saved Namespace (read-only)` : "No saved Namespace referenced"}</span>
                      <dl className="kiss-inline-details">
                        <dt>Size</dt><dd>{region.words === null ? "Unspecified" : `${region.words.toLocaleString()} words`}</dd>
                        <dt>Start</dt><dd>{region.start === null ? "Not placed" : `word ${region.start.toLocaleString()}`}</dd>
                        <dt>Status</dt><dd>Draft, unapproved</dd>
                      </dl>
                    </>;
                  })() : <>
                    <span className="kiss-device-kicker">NEXT BITSTREAM</span>
                    <span className="kiss-device-type">Select a zone in the table or glass to review its proposed size.</span>
                  </>}
                </aside>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
