import { Fragment, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { request } from "./image-api";
import type { CatalogEntry } from "./image-api";
import { latestChoices } from "./latest-image";
import { parseWords, REGION_LABELS } from "./next-bitstream";
import type { DraftInputs } from "./next-bitstream";
import NamespacePicker from "./NamespacePicker";
import { readPlanningDraft, rememberPlanningDraft } from "./next-bitstream-draft";
import { associate, glassKeyFor, lumpMembers } from "./nb-association";
import type { LumpPick, Side } from "./nb-association";
import { hexWord } from "./nb-geometry";
import { planCoResidency } from "./nb-plan";
import type { PlanItem, Zone } from "./nb-plan";
import { useNamespaceInspection } from "./use-namespace-inspection";
import NbNamespaceTabs, { SIDE_COLORS } from "./NbNamespaceTabs";
import NbPlanGlass from "./NbPlanGlass";

const ZONE_COLORS: Record<Zone, string> = {namespaceA: SIDE_COLORS.A, namespaceB: SIDE_COLORS.B, lumpZone: "#e9c46a"};
const EMPTY: DraftInputs = {total: "", namespaceA: "", namespaceB: "", lumpZone: ""};
const STATUS_TEXT = {
  empty: "No resident entries", unresolved: "Unresolved — no fit claim", overflow: "Invalid — address overflow",
  insufficient: "Does not fit proposed total", "required-only": "Required span only", fits: "Fits proposed total (arithmetic)",
};

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
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Side>("A");
  const [pick, setPick] = useState<LumpPick | null>(null);
  const inspA = useNamespaceInspection(refA, entries);
  const inspB = useNamespaceInspection(refB, entries);
  useEffect(() => { setPick(prev => prev?.side === "A" ? null : prev); }, [refA]);
  useEffect(() => { setPick(prev => prev?.side === "B" ? null : prev); }, [refB]);

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

  // Saved inspections are read-only inputs; the plan works on its own copies.
  const ready = (st: typeof inspA.state) => st.status === "ready" ? st.inspection : null;
  const inA = ready(inspA.state), inB = ready(inspB.state);
  const rowsA = inA ? (inA.layoutRows ?? inA.rows) : [], rowsB = inB ? (inB.layoutRows ?? inB.rows) : [];
  const members = {A: lumpMembers("A", rowsA), B: lumpMembers("B", rowsB)};
  const lumpItems = associate(members.A, members.B);
  const glassKey = glassKeyFor(lumpItems, pick);
  const relation = lumpItems.find(item => item.key === glassKey);

  const parsedTotal = parseWords(draft.total);
  const totalError = typeof parsedTotal === "string" ? `Proposed total memory ${parsedTotal}.` : "";
  const total = typeof parsedTotal === "number" ? parsedTotal : null;
  const plan = planCoResidency([
    ...(inA ? [{side: "A" as Side, rows: rowsA, layoutSource: inA.layoutSource}] : []),
    ...(inB ? [{side: "B" as Side, rows: rowsB, layoutSource: inB.layoutSource}] : []),
  ], total);
  const placed = plan.items.filter(i => i.start !== null);
  const scale = Math.max(plan.status === "fits" && total ? total : 0, plan.requiredWords ?? placed.reduce((n, i) => Math.max(n, i.start! + i.words!), 0));
  const scaleLabel = plan.status === "fits" ? `${scale.toLocaleString()}-word proposed total`
    : plan.status === "insufficient" ? `${scale.toLocaleString()}-word required span (exceeds proposed total)`
    : plan.status === "required-only" ? `${scale.toLocaleString()}-word required span — not hardware capacity`
    : scale ? `${scale.toLocaleString()} words placed before first unresolved entry` : "Nothing placed";

  const nameOf = (key: string) => entries.find(entry => entry.selection_key === key)?.name;
  const sameRef = refA && refA === refB;
  const isRelated = (item: PlanItem) => !!relation && relation.members.some(m => m.side === item.side && m.slot === item.slot);
  const colorFor = (item: PlanItem) => SIDE_COLORS[item.side];
  const findItem = (p: LumpPick | null) => p ? [...plan.items, ...plan.notProvisioned, ...plan.external].find(i => i.side === p.side && i.slot === p.slot) : undefined;
  const picked = findItem(pick);
  const detailItems = relation && relation.members.length > 1
    ? relation.members.map(m => findItem({side: m.side, slot: m.slot})).filter((i): i is PlanItem => !!i)
    : picked ? [picked] : [];
  const selectItem = (item: PlanItem) => { setTab(item.side); setPick({side: item.side, slot: item.slot}); };
  const offGlass = [...plan.items.filter(i => i.start === null)];
  const zoneLabel = (zone: Zone) => zone === "lumpZone" ? "Individual LUMPs (A and B copies)" :
    `${zone === "namespaceA" ? "A" : "B"}: ${nameOf(zone === "namespaceA" ? refA : refB) ?? REGION_LABELS[zone]} — table + Threads`;

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
  const shape = `M49 ${glassTop} H191 L181 ${glassBottom - 10} Q120 ${glassBottom + 17} 59 ${glassBottom - 10} Z`;
  const bad = plan.status === "unresolved" || plan.status === "overflow" || plan.status === "insufficient" || !!totalError;

  return (
    <main className="kiss-workbench" hidden={hidden}>
      <header className="kiss-top kiss-top-embedded">
        <p className="kiss-preview">Next Bitstream Design — co-residency layout draft only. Proposed addresses; nothing is relocated, rebound, built, saved, or sent.</p>
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
      {sameRef && <p className="kiss-api-message" role="status">Namespace A and B reference the same saved Namespace. They are planned as two separate resident copies with disjoint memory.</p>}

      <div className="kiss-layout kiss-layout-single">
        <section className="kiss-panel" aria-labelledby="nb-title">
          <div className="kiss-slot-visual-row">
            <div className="kiss-slot-column">
              <div className="kiss-panel-head"><h2 id="nb-title"><span className="kiss-step">01</span>Co-resident memory plan</h2><span className="kiss-status">Unapproved draft</span></div>
              <p className="kiss-meta">Zones are derived from saved allocations and cannot be edited, so they can never disagree with planned ranges. Only the proposed total is yours to set (decimal or 0x hex words).</p>
              <div className="kiss-table-scroll" role="region" aria-label="Planned zones">
                <table>
                  <thead><tr><th scope="col">Zone</th><th scope="col">Contents</th><th scope="col">Words</th><th scope="col">Proposed start</th></tr></thead>
                  <tbody>
                    <tr>
                      <td>ALL</td><td className="kiss-kind">Proposed total memory</td>
                      <td><input className="nb-input" aria-label="Proposed total memory in words" placeholder="unspecified" value={draft.total} onChange={e => setDraft(prev => ({...prev, total: e.target.value}))} /></td>
                      <td className="kiss-kind">0x00000000</td>
                    </tr>
                    {(["namespaceA", "namespaceB", "lumpZone"] as Zone[]).map((zone, i) => {
                      const first = plan.items.find(item => item.zone === zone);
                      return <tr key={zone}>
                        <td>{String(i + 1).padStart(2, "0")}</td>
                        <td><span className="kiss-slot-color" style={{"--kiss-lump-color": ZONE_COLORS[zone]} as CSSProperties} aria-hidden="true" />{zoneLabel(zone)}<span className="kiss-tag">derived</span></td>
                        <td className="kiss-kind">{plan.zoneWords[zone] === null ? "unresolved" : plan.zoneWords[zone]!.toLocaleString()}</td>
                        <td className="kiss-kind">{first?.start == null ? "—" : hexWord(first.start)}</td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <div className="nb-check" aria-live="polite">
                {totalError && <p className="nb-error">{totalError}</p>}
                {plan.messages.map(msg => <p key={msg} className={bad ? "nb-error" : undefined}>{msg}</p>)}
                <dl>
                  <dt>Plan status</dt><dd>{STATUS_TEXT[plan.status]}</dd>
                  <dt>Required</dt><dd>{plan.requiredWords === null ? "Unresolved" : `${plan.requiredWords.toLocaleString()} words`}</dd>
                  <dt>Proposed total</dt><dd>{total === null ? "Unspecified" : `${total.toLocaleString()} words`}</dd>
                  <dt>Unallocated</dt><dd>{plan.status === "fits" ? `${(total! - plan.requiredWords!).toLocaleString()} words (arithmetic only)` : "Not assessed"}</dd>
                  <dt>Not provisioned</dt><dd>{plan.notProvisioned.length} lazy/unresident LUMPs</dd>
                  <dt>External MMIO</dt><dd>{plan.external.length} (outside RAM plan)</dd>
                </dl>
                <div className="kiss-dialog-actions" style={{justifyContent: "flex-start", marginTop: 8}}>
                  <button type="button" onClick={() => setDraft(EMPTY)}>Clear total</button>
                </div>
              </div>
              <div className="kiss-panel-head nb-alt-head"><h2><span className="kiss-step">02</span>Namespace alternatives</h2><span className="kiss-status">Read-only saved LUMPs</span></div>
              <NbNamespaceTabs tab={tab} onTab={setTab}
                names={{A: refA ? nameOf(refA) ?? "" : "", B: refB ? nameOf(refB) ?? "" : ""}}
                states={{A: inspA.state, B: inspB.state}} onRetry={side => (side === "A" ? inspA : inspB).retry()}
                members={members} items={lumpItems} pick={pick} glassKey={glassKey} onPick={setPick} />
            </div>

            <section className="kiss-water-map" aria-labelledby="nb-glass-title">
              <div className="kiss-water-heading">
                <div><span className="kiss-step">PROPOSED CO-RESIDENT LAYOUT</span><h4 id="nb-glass-title">Next bitstream memory glass</h4></div>
                <span className="kiss-water-caveat">{placed.length} placed · {offGlass.length} unresolved</span>
              </div>
              <p className="kiss-water-intro">A and B stay resident together and run sequentially with no memory replacement, so every Namespace table, Thread and LUMP copy has its own non-overlapping proposed range, sized from its saved allocation. Proposed addresses only — executables are not rebound or relocated, and no image is generated.</p>
              <div className="nb-legend" aria-label="Legend">
                <span><i style={{background: SIDE_COLORS.A}} />Namespace A</span><span><i style={{background: SIDE_COLORS.B}} />Namespace B</span><span><i className="nb-legend-rel" />same exact identity (separate copies)</span>
              </div>
              <div className="kiss-glass-layout">
                <div className="kiss-glass-figure">
                  <div className="kiss-glass-capacity">{scaleLabel}</div>
                  <svg className="kiss-water-svg" viewBox="0 0 240 500" role="group" aria-label={`Proposed co-resident layout, ${scaleLabel}`}>
                    <defs>
                      <linearGradient id="nb-empty-glass" x1="0" x2="1">
                        <stop offset="0" stopColor="#b9eee2" stopOpacity=".13" />
                        <stop offset=".16" stopColor="#b9eee2" stopOpacity=".035" />
                        <stop offset=".84" stopColor="#b9eee2" stopOpacity=".035" />
                        <stop offset="1" stopColor="#b9eee2" stopOpacity=".13" />
                      </linearGradient>
                      <clipPath id="nb-location-clip"><path d={shape} /></clipPath>
                    </defs>
                    <path d={shape} fill="url(#nb-empty-glass)" stroke={bad ? "#ee9b70" : "#b9eee2"} strokeOpacity=".84" strokeWidth="2" />
                    {scale > 0 && <g clipPath="url(#nb-location-clip)">
                      <NbPlanGlass items={placed} scaleWords={scale} capacityWords={plan.status === "insufficient" ? total : null}
                        top={glassTop} height={glassHeight} colorFor={colorFor} pick={pick} related={isRelated} onSelect={selectItem} />
                    </g>}
                    {scale > 0 && [0, .25, .5, .75, 1].map((fraction, index) => {
                      const y = glassTop + fraction * glassHeight;
                      return <g key={index}>
                        <line x1="38" x2={index === 0 || index === 4 ? 61 : 70} y1={y} y2={y} stroke="#b9eee2" strokeOpacity=".7" />
                        <text x="32" y={y + 4} textAnchor="end" className="kiss-glass-tick">{Math.round(scale * (1 - fraction)).toLocaleString()}</text>
                      </g>;
                    })}
                    {placed.length === 0 && <>
                      <text x="120" y="248" textAnchor="middle" className="kiss-glass-empty">{plan.status === "empty" ? "NO ENTRIES" : "UNRESOLVED"}</text>
                      <text x="120" y="269" textAnchor="middle" className="kiss-glass-empty-note">{refA || refB ? "No resident entry has an established size" : "Choose Namespace A or B"}</text>
                    </>}
                  </svg>
                  <div className="kiss-glass-zero">word 0 · {STATUS_TEXT[plan.status]}</div>
                  {(offGlass.length > 0 || plan.notProvisioned.length > 0 || plan.external.length > 0) &&
                    <ul className="nb-unplaced" aria-label="Entries not placed">
                      {[...offGlass, ...plan.notProvisioned, ...plan.external].map(item => <li key={`${item.side}:${item.slot}`}>
                        <button type="button" className="kiss-slot-button" aria-pressed={pick?.side === item.side && pick.slot === item.slot}
                          style={{"--kiss-lump-color": SIDE_COLORS[item.side]} as CSSProperties} onClick={() => selectItem(item)}>{item.side} · {item.name}</button>
                        <span>{item.kind === "mmio" ? "external MMIO" : plan.notProvisioned.includes(item) ? "lazy — not provisioned" : item.problem ? "size unresolved" : "blocked by earlier unresolved"}</span>
                      </li>)}
                    </ul>}
                </div>
                <aside className="kiss-device-card" aria-label="Selected entry details">
                  {picked ? <>
                    <span className="kiss-device-kicker">{picked.kind.toUpperCase()} · NAMESPACE {picked.side}{detailItems.length > 1 ? " · SAME IDENTITY IN A+B" : ""}</span>
                    <strong style={{color: SIDE_COLORS[picked.side]}}>{picked.name}</strong>
                    {relation && <span className="kiss-device-type">{relation.identity ? `Identity ${relation.identity}. Copies are allocated separately; no state is shared.` : "No exact artifact identity recorded."}</span>}
                    <dl className="kiss-inline-details">
                      {detailItems.map(item => <Fragment key={item.side}>
                        <dt>{item.side} slot</dt><dd>{item.slot}</dd>
                        <dt>{item.side} proposed</dt><dd>{item.start === null || item.words === null ? "Not placed" : `${hexWord(item.start)}–${hexWord(item.start + item.words - 1)}`}</dd>
                        <dt>{item.side} size</dt><dd>{item.words === null ? "Unknown" : `${item.words.toLocaleString()} words`}</dd>
                        <dt>{item.side} saved at</dt><dd>{item.sourceStart === null ? "Not recorded" : `${hexWord(item.sourceStart)} (source)`}</dd>
                        {item.problem && <><dt>{item.side} issue</dt><dd>{item.problem}</dd></>}
                      </Fragment>)}
                      <dt>Binary</dt><dd>Not relocated or rebound</dd>
                    </dl>
                  </> : <>
                    <span className="kiss-device-kicker">NEXT BITSTREAM</span>
                    <span className="kiss-device-type">Select a LUMP row or a block in the glass to see its proposed range and saved source address.</span>
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
