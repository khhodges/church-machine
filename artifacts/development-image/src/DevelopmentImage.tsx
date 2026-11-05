import "./_group.css";
import "./_kiss.css";
import "../../../simulator/namespace-selection.js";
import { useEffect, useRef, useState } from "react";
import { notifyIde } from "./embedding";
import type { CSSProperties } from "react";
import {request, sendAllowed, prepareExact, installExact, receiptState} from "./image-api";
import type {BoardStatus, CatalogEntry, Inspection, PreparedImage, Receipt, Target} from "./image-api";

export default function DevelopmentImage() {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [namespace, setNamespace] = useState("");
  const [input, setInput] = useState<Inspection | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem("ba_build_token") ?? sessionStorage.getItem("ba_build_token") ?? ""; } catch { return ""; }
  });
  const [confirmation, setConfirmation] = useState<{image: PreparedImage; target: Target} | null>(null);
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === "ba_build_token" && event.storageArea === localStorage) setToken(event.newValue || "");
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const slots = input?.layoutRows ?? input?.rows ?? [];
  const sorted = [...slots].sort((a, b) => a.slot - b.slot);
  const selected = slots.find(row => row.slot === selectedSlot);
  const selectedKind = selected?.kind ?? (selected?.filename ? "lump" : selected?.name.includes("DEV") ? "mmio" : selected?.name.includes("Thread") ? "thread" : "namespace");
  const selectedIsMmio = selectedKind === "mmio";
  const selectedIsLump = selectedKind === "lump";
  const selectedIsThread = selectedKind === "thread" || selected?.name.includes("Thread") === true;
  const selectedIsNamespace = selectedKind === "namespace" || selected?.name === "Boot.NS";
  const selectedIsBoot = selected?.name.startsWith("Boot.") === true || selected?.boot === true;
  const displayLocation = (value: number | null | undefined) =>
    value == null ? "Not recorded" : `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
  const capacity = input?.capacityWords;
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
  // address space. Use the backend's shared Namespace layout, never invent
  // placements or calculate allocation order in the browser.
  const locatedEntries = slots.map(row => ({
    row,
    start: wordValue(row.location),
    words: row.allocationWords ?? undefined,
  })).filter((item): item is typeof item & { start: number } =>
    item.row.kind !== "mmio" && item.start !== undefined && item.start >= 0 && item.start < glassCapacity
  );
  const colorForSlot = (slot: number) => {
    const index = locatedEntries.findIndex(item => item.row.slot === slot);
    return index < 0 ? undefined : colors[index % colors.length];
  };

  useEffect(() => {
    const controller = new AbortController();
    request<{entries: CatalogEntry[]}>("/api/development-image/catalog", {signal: controller.signal})
      .then(result => {
        result.entries = result.entries.map(entry => ({...entry, name: NamespaceSelection.name(entry.id, entry.name)}));
        setEntries(result.entries);
        const linked = new URLSearchParams(location.search).get("namespace") ?? NamespaceSelection.read();
        const choice = linked !== null ? result.entries.find(item => item.id === linked) :
          result.entries.find(item => item.name === "Original") ?? result.entries[0];
        if (!choice) throw Error(linked ? "The linked Namespace is unavailable. Select an exact saved Namespace." : "No saved Namespaces are available. Save a Namespace in the IDE first.");
        setNamespace(choice.id);
      }).catch(cause => { if (!controller.signal.aborted) {setError(cause.message); setLoading(false);} });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!namespace) return;
    NamespaceSelection.remember(namespace);
    const controller = new AbortController();
    setLoading(true); setInput(null); setError("");
    request<Inspection>("/api/development-image/inspect?id=" + encodeURIComponent(namespace), {signal: controller.signal})
      .then(result => { if (!controller.signal.aborted) setInput(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [namespace]);

  useEffect(() => {
    if (!receipt) return;
    let active = true;
    const poll = async () => {
      try {
        const board = await request<BoardStatus>("/hardware/wukong/status");
        if (active) setSendStatus(receiptState(receipt, board));
      } catch {
        if (active) setSendStatus("Delivery status unavailable. Do not assume success or resend; inspect FPGA status.");
      }
    };
    void poll();
    const timer = window.setInterval(poll, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [receipt]);

  useEffect(() => {
    if (namespace) notifyIde({type: "development-image:selection", namespace});
  }, [namespace]);

  useEffect(() => {
    const report = () => notifyIde({type: "development-image:height", height: document.documentElement.scrollHeight});
    const observer = new ResizeObserver(() => requestAnimationFrame(report));
    observer.observe(document.body);
    report();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (confirmation) confirmationDialog.current?.showModal();
    else confirmationDialog.current?.close();
  }, [confirmation]);

  function changeNamespace(value: string) {
    if (busy.current) return;
    setNamespace(value);
    setSelectedSlot(null);
    setSendStatus(""); setReceipt(null);
    const url = new URL(location.href); url.searchParams.set("namespace", value);
    history.replaceState(null, "", url);
    notifyIde({type: "development-image:selection", namespace: value});
  }

  async function beginSend() {
    if (busy.current || !input || !sendAllowed(input)) return;
    busy.current = true; setSending(true); setSendStatus("");
    try {
      let image = input.image;
      if (!image && input.id.startsWith("design:")) {
        setSendStatus("Preparing the complete image from saved binding snapshots. No rebinding or transfer.");
        image = await request<PreparedImage>("/api/development-image/prepare", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({id: input.id}),
        });
        if (image.namespace_revision_id !== input.id)
          throw Error("Prepared Namespace identity changed. Nothing was sent.");
      }
      if (!image) throw Error(input.hardwareError || "No image is available for this selection.");
      setSendStatus("Image prepared. Checking the connected FPGA; nothing has been sent.");
      const board = await request<BoardStatus>("/hardware/wukong/status");
      const target = board.physical_target;
      if (!target?.live || !target.device_uid || !target.session_id)
        throw Error("No live, identified FPGA is connected. Connect the existing bridge and retry. Nothing was sent.");
      setConfirmation({image, target});
    } catch (cause) { setSendStatus("Not sent — " + (cause as Error).message); }
    finally { busy.current = false; setSending(false); }
  }

  async function confirmSend() {
    if (busy.current || !confirmation) return;
    busy.current = true; setSending(true);
    const frozen = confirmation;
    try {
      if (!token.trim()) throw Error("IDE hardware authorization is required. Enter the existing IDE access token; nothing was sent.");
      setSendStatus("Rechecking the exact prepared image. No rebinding.");
      const prepared = await prepareExact(frozen.image, token.trim());
      setSendStatus("Submitting the confirmed image. Do not retry while its delivery is unknown.");
      const result = await installExact(prepared, frozen.target, token.trim());
      setReceipt(result);
      setSendStatus(`Command ${result.id} queued — not yet acknowledged; contents unverified.`);
      setConfirmation(null);
    } catch (cause) { setSendStatus((cause as Error).message); }
    finally { busy.current = false; setSending(false); }
  }

  return (
    <main className="kiss-workbench">
      <header className="kiss-top kiss-top-embedded">
        <p className="kiss-preview">{input?.image ? "Bound Namespace — image ready" : input?.layoutSource === "saved-design-layout" ? "Saved Namespace — image prepared on Send" : "Saved Namespace — FPGA image unavailable"}</p>
      </header>

      <div className="kiss-heading">
        <div><p className="kiss-subtitle">Review the bound Namespace layout, then send it to the FPGA.</p></div>
        <span className="kiss-local">SAVED NAMESPACE</span>
      </div>
      {error && <p className="kiss-api-error" role="alert">{error} No saved data was changed. <a href={location.pathname}>Reload saved Namespaces</a></p>}
      {loading && <p className="kiss-api-message" role="status">Reading the exact saved Namespace…</p>}

      <div className="kiss-layout kiss-layout-single">
        <section className="kiss-panel" aria-labelledby="kiss-namespace-title">
          <div className="kiss-panel-head"><h2 id="kiss-namespace-title"><span className="kiss-step">01</span>Namespace Table</h2><span className="kiss-status">Saved inputs</span></div>
          <div className="kiss-selector">
            <label htmlFor="kiss-namespace">Namespace</label>
            <select id="kiss-namespace" value={namespace} disabled={sending || !!confirmation} onChange={event => changeNamespace(event.target.value)}>
              {!namespace && <option value="">Select a saved Namespace</option>}
              {entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name}{entries.filter(other => other.name === entry.name).length > 1 ? ` · ${entry.id.slice(-12)}` : ""}</option>)}
            </select>
          </div>
          <p className="kiss-meta">{slots.length} saved rows{typeof input?.metadata.slotCount === "number" ? ` · ${input.metadata.slotCount} slots` : input?.name === "Original" ? " · original slot assignments" : ""} · Select a name to inspect its saved data.</p>
          <div className="kiss-slot-visual-row">
          <div className="kiss-table-scroll" tabIndex={0} role="region" aria-label={`${namespace} saved slot table`}>
            <table>
              <thead><tr><th scope="col">Slot</th><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Policy</th><th scope="col">Rev.</th></tr></thead>
              <tbody>{[...sorted].reverse().map(row => {
                const kind = row.kind ?? (row.filename ? "lump" : row.name.includes("DEV") ? "mmio" : row.name.includes("Thread") ? "thread" : "namespace");
                const policy = row.policy ?? row.load_policy ?? (kind === "mmio" ? "Hardware" : "—");
                return <tr key={row.slot} className={selectedSlot === row.slot ? "kiss-active" : undefined}>
                  <td>{String(row.slot).padStart(2, "0")}</td>
                  <td>{colorForSlot(row.slot) && <span className="kiss-slot-color" style={{ "--kiss-lump-color": colorForSlot(row.slot) } as CSSProperties} aria-hidden="true" />}<button className="kiss-slot-button" style={colorForSlot(row.slot) ? { "--kiss-lump-color": colorForSlot(row.slot) } as CSSProperties : undefined} onClick={() => setSelectedSlot(row.slot)} aria-pressed={selectedSlot === row.slot} aria-label={`Show details for slot ${row.slot}, ${row.name}`}>{row.name}</button>{row.boot || row.name.startsWith("Boot.") ? <span className="kiss-tag">boot</span> : null}{row.name === "ide.Mint" && <span className="kiss-tag">unfinished</span>}</td>
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
                <p className="kiss-water-intro">{input?.layoutSource === "saved-design-layout"
                  ? "Colored regions show the saved design’s memory layout, using its exact selected LUMPs and Thread allocations. Lazy entries stay outside resident memory. This is not an installed binary map."
                  : "Colored regions use each saved entry’s location and extent, including LUMPs, Threads, and Boot.NS / Boot.Thread. This is the Namespace layout, not a generated binary map."}</p>
                <div className="kiss-glass-layout">
                  <div className="kiss-glass-figure">
                    <div className="kiss-glass-capacity">{glassCapacity.toLocaleString()}-word {input?.capacitySource === "reference" ? "reference scale" : "address space"}</div>
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
                          return <g key={row.slot} role="button" tabIndex={0} aria-label={`Select ${row.name}, ${kind}, slot ${row.slot}, location ${row.location}${words === undefined ? ", extent unknown" : `, extent ${words} words`}`} aria-pressed={active} onClick={() => setSelectedSlot(row.slot)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedSlot(row.slot); } }} className={`kiss-region${active ? " is-selected" : ""}`} style={{ "--kiss-lump-color": color } as CSSProperties}>
                            {hasExtent ? <>
                              <rect x="60" y={y} width="120" height={extentHeight} rx="2" style={{ opacity: active ? 1 : 0.2 }} />
                              {extentHeight >= 14 && <text x="120" y={y + Math.min(extentHeight - 3, 12)} textAnchor="middle" style={{ opacity: active ? 1 : 0.24 }}>{row.name}</text>}
                            </> : <line x1="113" x2="127" y1={markerY} y2={markerY} stroke={colors[index % colors.length]} strokeWidth={active ? 4 : 3} strokeLinecap="round" style={{ opacity: active ? 1 : 0.2 }} />}
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
                  {selected ? <aside className="kiss-device-card" aria-label={`${selected.name} selected slot details`}>
                    {selectedIsMmio ? <svg className="kiss-device-icon" viewBox="0 0 120 120" role="img" aria-labelledby="kiss-device-title">
                      <title id="kiss-device-title">{selected.name.replace(/_DEV$/, "").replaceAll("_", " ").toLowerCase()} device</title>
                      <circle cx="60" cy="60" r="48" fill="#172636" stroke={colorForSlot(selected.slot) ?? "#73d7c0"} strokeWidth="2" />
                      {selected.name.startsWith("LED") ? <>
                        <path d="M45 63a15 15 0 1 1 30 0c0 6-4 9-6 13H51c-2-4-6-7-6-13Z" fill="#f1cf73" stroke="#fff0b1" strokeWidth="2" />
                        <path d="M52 80h16m-14 5h12m-9 5h6M60 27v-8m24 18 6-6M36 37l-6-6m30 65v7" fill="none" stroke="#f1cf73" strokeWidth="3" strokeLinecap="round" />
                      </> : selected.name.startsWith("BTN") ? <>
                        <path d="M35 72h50v15H35z" fill="#3b5268" stroke="#9db4c8" strokeWidth="2" />
                        <rect x="43" y="43" width="34" height="29" rx="8" fill="#e7a6a0" stroke="#ffe2dd" strokeWidth="2" />
                        <path d="M49 50h22" stroke="#fff1ee" strokeWidth="3" strokeLinecap="round" />
                      </> : selected.name.startsWith("TIMER") ? <>
                        <circle cx="60" cy="61" r="27" fill="#1d3040" stroke="#e9c46a" strokeWidth="3" />
                        <path d="M60 43v19l13 8M52 25h16M60 25v8" fill="none" stroke="#f2d279" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="60" cy="61" r="3" fill="#f2d279" />
                      </> : selected.name.startsWith("UART") ? <>
                        <rect x="36" y="39" width="48" height="42" rx="5" fill="#24394a" stroke="#91d8d0" strokeWidth="2" />
                        <path d="M45 52h10m10 0h10M45 66h10m10 0h10M45 81v8m10-8v8m10-8v8m10-8v8" fill="none" stroke="#91d8d0" strokeWidth="3" strokeLinecap="round" />
                        <path d="M55 53l10 6-10 6" fill="none" stroke="#f1cf73" strokeWidth="2" />
                      </> : <>
                        <rect x="39" y="39" width="42" height="42" rx="6" fill="#25394b" stroke="#e9c46a" strokeWidth="2" />
                        <path d="M51 51h18v18H51zM30 48h9m-9 12h9m-9 12h9m42-24h9m-9 12h9m-9 12h9M48 30v9m12-9v9m12-9v9m-24 42v9m12-9v9m12-9v9" fill="none" stroke="#e9c46a" strokeWidth="2" strokeLinecap="round" />
                      </>}
                    </svg> : selectedIsLump ? <svg className="kiss-device-icon kiss-lump-icon" viewBox="0 0 120 120" role="img" aria-label="LUMP binary artifact">
                      <path d="M34 18h36l18 18v64H34z" fill="#1d3040" stroke={colorForSlot(selected.slot) ?? "#73d7c0"} strokeWidth="3" />
                      <path d="M70 18v20h18M45 56h32M45 68h32M45 80h24" fill="none" stroke={colorForSlot(selected.slot) ?? "#73d7c0"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="46" cy="94" r="3" fill={colorForSlot(selected.slot) ?? "#73d7c0"} />
                    </svg> : <svg className="kiss-device-icon kiss-lump-icon" viewBox="0 0 120 120" role="img" aria-label={selectedIsNamespace ? "Namespace icon" : selectedIsThread ? "Thread icon" : selectedIsBoot ? "Boot entry icon" : "Namespace entry icon"}>
                      <circle cx="60" cy="60" r="43" fill="#172636" stroke={colorForSlot(selected.slot) ?? "#73d7c0"} strokeWidth="3" />
                      {selectedIsThread ? <>
                        <circle cx="60" cy="43" r="10" fill="none" stroke={colorForSlot(selected.slot) ?? "#73d7c0"} strokeWidth="3" />
                        <path d="M38 83c2-14 10-21 22-21s20 7 22 21M28 51h12m40 0h12M34 45l6 6-6 6m52-12-6 6 6 6" fill="none" stroke={colorForSlot(selected.slot) ?? "#73d7c0"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </> : selectedIsNamespace ? <>
                        <path d="M36 42h48v39H36zM44 34h40v39M52 26h32v39" fill="#1d3040" stroke={colorForSlot(selected.slot) ?? "#73d7c0"} strokeWidth="3" strokeLinejoin="round" />
                        <path d="M47 53h25M47 63h25M47 73h17" stroke="#dce9e7" strokeWidth="3" strokeLinecap="round" />
                      </> : <>
                        <path d="M60 28l7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2z" fill="#1d3040" stroke={colorForSlot(selected.slot) ?? "#73d7c0"} strokeWidth="3" strokeLinejoin="round" />
                        <path d="M43 84h34" stroke={colorForSlot(selected.slot) ?? "#73d7c0"} strokeWidth="3" strokeLinecap="round" />
                      </>}
                    </svg>}
                    <span className="kiss-device-kicker">{selectedIsMmio ? "SELECTED MMIO" : selectedIsLump ? "SELECTED LUMP" : selectedIsBoot ? "SELECTED BOOT ENTRY" : selectedIsThread ? "SELECTED THREAD" : "SELECTED NAMESPACE"}</span>
                    <strong>{selected.name.replace(/_DEV$/, "").replaceAll("_", " ")}</strong>
                    {selectedIsMmio ? <>
                      <span className="kiss-device-type">{selected.name.startsWith("LED") ? "Indicator output" : selected.name.startsWith("BTN") ? "Button input" : selected.name.startsWith("TIMER") ? "Timer peripheral" : selected.name.startsWith("UART") ? "Serial interface" : "Memory-mapped device"}</span>
                      <span className="kiss-device-location">Address {displayLocation(selected.location)}</span>
                    </> : selectedIsLump ? <dl className="kiss-inline-details">
                      <dt>Artifact</dt><dd>{selected.selection?.filename ?? selected.filename ?? "Not recorded"}</dd>
                      <dt>Revision</dt><dd>{selected.selection?.revision ?? selected.lump_version ?? "Not recorded"}</dd>
                      <dt>Token</dt><dd>{selected.selection?.token ?? selected.token ?? "Not recorded"}</dd>
                      <dt>Policy</dt><dd>{selected.policy ?? selected.load_policy ?? "Not recorded"}</dd>
                      <dt>Location</dt><dd>{displayLocation(selected.location)}</dd>
                      <dt>Extent</dt><dd>{selected.limit ?? "Not recorded"}</dd>
                    </dl> : <dl className="kiss-inline-details">
                      <dt>Kind</dt><dd>{selectedIsThread ? "Thread" : selectedIsNamespace ? "Namespace" : selectedKind}</dd>
                      <dt>Role</dt><dd>{selectedIsBoot ? "Boot entry" : selectedIsThread ? "Thread entry" : "Namespace entry"}</dd>
                      <dt>Slot</dt><dd>{String(selected.slot).padStart(2, "0")}</dd>
                      <dt>Type</dt><dd>{selected.type ?? selectedKind}</dd>
                      <dt>Policy</dt><dd>{selected.policy ?? selected.load_policy ?? (selected.resident ? "Resident" : "Not recorded")}</dd>
                      <dt>Location</dt><dd>{displayLocation(selected.location)}</dd>
                      <dt>Extent</dt><dd>{selected.limit ?? "Not recorded"}</dd>
                      <dt>Sequence</dt><dd>{selected.sequence ?? selected.seq ?? "Not recorded"}</dd>
                    </dl>}
                  </aside> : <aside className="kiss-device-card kiss-device-card-idle" aria-live="polite">
                    <span className="kiss-device-kicker">MEMORY LOCATIONS</span>
                    <strong>Select a slot</strong>
                    <span className="kiss-device-type">Saved regions are shown dimmed until you choose a row.</span>
                  </aside>}
                </div>
                <div className="kiss-water-legend"><span>{input?.layoutSource === "saved-design-layout" ? "Uses the same read-only layout as Namespace Table. No rebinding." : "Position and extent come directly from Namespace Table fields."}</span><span>Threads and boot entries share the same scale. Select a row or region to inspect.</span></div>
          </section>
          </div>
          <details className="kiss-technical">
            <summary>Technical details · {selected?.name ?? "Namespace"}</summary>
            <p className="kiss-muted">Exact saved row. Kind labels for Original are inferred for display; saved data is unchanged.</p>
            <pre>{JSON.stringify(input?.rows.find(row => row.slot === selectedSlot), null, 2)}</pre>
            {input?.layoutSource === "saved-design-layout" && <>
              <p className="kiss-muted">Displayed design allocation (not installed memory)</p>
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            </>}
            <p className="kiss-muted">Namespace metadata</p>
            <pre>{JSON.stringify(input?.metadata ?? {}, null, 2)}</pre>
            <p>Saved identity: {input?.fingerprint ?? "Unavailable"}</p>
            {input?.capacitySource === "reference" && <p>Total capacity was not recorded. The glass uses a labelled 16,384-word reference scale.</p>}
            {input?.imageSha256 && <p>Retained binary: {input.imageSha256} · {input.imageBytes} bytes</p>}
            {input?.hardwareError && <p>{input.layoutSource === "saved-design-layout"
              ? "Send assembles a complete image from the exact saved binding snapshots, then checks FPGA compatibility. It does not rebind."
              : `Not ready to send: ${input.hardwareError}`}</p>}
            <p><a href="/simulator/#namespace" target="_top" onClick={event => { event.preventDefault(); notifyIde({type: "development-image:navigate", view: "namespace"}); }}>Open Namespace editor</a></p>
            {input?.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
          </details>
        </section>

      </div>
      <footer className="kiss-send-footer">
        <div><strong>Send the bound build to FPGA</strong><span>Uses the existing Namespace binding; no rebind.</span></div>
        <button type="button" className="kiss-primary kiss-send-button" disabled={loading || !input || !sendAllowed(input) || sending || !!receipt} title={input && !sendAllowed(input) ? "Inspection only — not approved for installation" : undefined} onClick={() => void beginSend()}>{sending ? "Checking exact image…" : receipt ? "Build submitted" : "Send build to FPGA"}</button>
        {input && !sendAllowed(input) && <p className="kiss-send-status" role="note">Inspection only — this frozen evidence is not approved for installation. Send is disabled.</p>}
        {sendStatus && <p className="kiss-send-status" role="status" aria-live="polite">{sendStatus}{receipt && <> <a href="/fpga" target="_blank" rel="noreferrer">View FPGA delivery status</a></>}</p>}
      </footer>
      <p className="kiss-footer"><span>Namespace edits belong in Namespace Table. This view leaves every saved input untouched.</span><span>FPGA transfer only on request</span></p>
      <dialog className="kiss-send-dialog" ref={confirmationDialog} onCancel={event => {event.preventDefault(); if (!sending) setConfirmation(null);}}>
        <h2>Send this exact build to FPGA?</h2>
        {confirmation && <>
          <p>This replaces runtime memory, discards Thread progress, and may reboot and execute immediately. It does not program FPGA flash.</p>
          <dl><dt>Namespace</dt><dd>{input?.name}</dd><dt>Board</dt><dd>{confirmation.target.device_uid}</dd>
            <dt>Image SHA-256</dt><dd>{confirmation.image.artifact_sha256}</dd>
            <dt>Required bitstream</dt><dd>{confirmation.image.required_bitstream_sha256}</dd></dl>
          <p>A fresh board-confirmed STOP and matching operator installation evidence are required by the existing installer. An upload acknowledgement is not memory readback.</p>
          <label htmlFor="hardware-token">IDE hardware access token</label>
          <input id="hardware-token" type="password" autoComplete="off" value={token} onChange={event => {
            setToken(event.target.value);
            try { localStorage.setItem("ba_build_token", event.target.value.trim()); }
            catch { setError("Browser storage is blocked. The token cannot be remembered."); }
          }} disabled={sending} />
          {sendStatus && <p role="status">{sendStatus}</p>}
          <div className="kiss-dialog-actions">
            <button disabled={sending} onClick={() => setConfirmation(null)}>Cancel</button>
            <button className="kiss-primary" disabled={sending || !token.trim()} onClick={() => void confirmSend()}>{sending ? "Submitting…" : "Replace runtime memory and send"}</button>
          </div>
        </>}
      </dialog>
    </main>
  );
}
