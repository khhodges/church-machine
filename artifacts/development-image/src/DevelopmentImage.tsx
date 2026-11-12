import "./_group.css";
import "./_kiss.css";
import threadClimber from "./assets/thread-climber.gif";
import threadClimberStill from "./assets/thread-climber-still.png";
import "../../../simulator/namespace-selection.js";
import { useEffect, useRef, useState } from "react";
import { notifyIde, acceptLoadRequest, loadRequestReady } from "./embedding";
import type { LoadRequest } from "./embedding";
import type { CSSProperties } from "react";
import {request, sendAllowed, prepareExact, installExact, receiptState, requireLatestBuild} from "./image-api";
import {connectionStatus, reconnectHelp} from "./connection-status";
import {useBridgeConnection} from "./use-bridge-connection";
import {stopBeforeSend} from "./stop-before-send";
import {inspectChoice, latestChoices, sourceId} from "./latest-image";
import {builtSlots, byteToWord, containingRegion} from "./memory-map";
import type {BoardStatus, CatalogEntry, Inspection, PreparedImage, Receipt, Target} from "./image-api";

export default function DevelopmentImage() {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [namespace, setNamespace] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selectionRefresh, setSelectionRefresh] = useState(0);
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === NamespaceSelection.designKey)
        setSelectionRefresh(value => value + 1);
    };
    window.addEventListener("storage", update);
    const parentUpdate = () => setSelectionRefresh(value => value + 1);
    if (window.parent !== window) window.parent.addEventListener("namespace-selection", parentUpdate);
    return () => {
      window.removeEventListener("storage", update);
      if (window.parent !== window) window.parent.removeEventListener("namespace-selection", parentUpdate);
    };
  }, []);
  const [input, setInput] = useState<Inspection | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [builtImage, setBuiltImage] = useState<PreparedImage | null>(null);
  const [builtRows, setBuiltRows] = useState<Inspection["rows"]>([]);
  const [view, setView] = useState<"saved" | "built">("saved");
  const [address, setAddress] = useState("");
  const [sendStatus, setSendStatus] = useState("");
  const connection = useBridgeConnection();
  const {connected} = connection;
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const sendUnavailable = sending ? "Preparing the image. Please wait." :
    receipt ? "This image has already been submitted." :
    loading ? "Loading the selected image. Please wait." :
    !input ? "Select an available development image first." :
    !sendAllowed(input) ? "This image is for inspection only and cannot be sent." :
    !(builtImage || input.image) ? "Prepare this application image first. Nothing has been sent." :
    !connected ? connection.needsHelp
      ? "The connection has not recovered. Follow the connection help below."
      : "Checking the FPGA connection automatically. Sending will become available when it reconnects." : "";
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
  // Explicit Build Approval "Load development image" handoff (never from URL/reload).
  const [loadRequest, setLoadRequest] = useState<LoadRequest | null>(null);
  const handledLoads = useRef(new Set<string>());
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const accepted = acceptLoadRequest(event, window);
      if (accepted && !handledLoads.current.has(accepted.requestId)) {
        setLoadRequest(accepted);
        notifyIde({type: "development-image:load-accepted", requestId: accepted.requestId});
      }
    };
    window.addEventListener("message", receive);
    notifyIde({type: "development-image:ready"});
    return () => window.removeEventListener("message", receive);
  }, []);
  const busy = useRef(false);
  const slots = view === "built" ? builtRows : input?.layoutRows ?? input?.rows ?? [];
  const addressWord = byteToWord(address);
  const addressRegion = addressWord === null ? undefined : containingRegion(slots, addressWord);
  const sorted = [...slots].sort((a, b) => a.slot - b.slot);
  const selected = slots.find(row => row.slot === selectedSlot);
  const selectedKind = selected?.kind ?? (selected?.filename ? "lump" : selected?.name.includes("DEV") ? "mmio" : selected?.name.includes("Thread") ? "thread" : "namespace");
  const selectedIsMmio = selectedKind === "mmio";
  const selectedIsLump = selectedKind === "lump";
  const selectedIsThread = selectedKind === "thread";
  const selectedIsNamespace = selectedKind === "namespace";
  const selectedIsBoot = selected?.name.startsWith("Boot.") === true || selected?.boot === true;
  const displayLocation = (value: number | null | undefined) =>
    value == null ? "Not recorded" : `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
  const capacity = view === "built" ? (builtImage?.size ?? 0) / 4 : input?.capacityWords;
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
        result.entries = latestChoices(result.entries);
        setEntries(result.entries);
        const linked = NamespaceSelection.current() ??
          new URLSearchParams(location.search).get("namespace") ?? NamespaceSelection.read();
        const choice = linked !== null ? result.entries.find(item => item.id === sourceId(linked) || item.selection_key === linked) :
          result.entries.find(item => item.selection_key === "namespace:ascending") ?? result.entries[0];
        if (!choice) throw Error(linked ? "The linked Namespace is unavailable. Select an exact saved Namespace." : "No saved Namespaces are available. Save a Namespace in the IDE first.");
        setNamespace(choice.selection_key || choice.id);
      }).catch(cause => { if (!controller.signal.aborted) {setError(cause.message); setLoading(false);} });
    return () => controller.abort();
  }, [selectionRefresh]);

  useEffect(() => {
    if (!namespace) return;
    const choice=entries.find(entry=>(entry.selection_key || entry.id)===namespace);
    const exactId=choice?.id || sourceId(namespace);
    NamespaceSelection.remember(exactId);
    const controller = new AbortController();
    setLoading(true); setInput(null); setError("");
    setBuiltImage(null); setBuiltRows([]); setView("saved"); setSelectedSlot(null);
    inspectChoice(exactId, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        if (result.layoutSource === "latest-built-image" && result.image) showBuilt(result.image);
        setInput(choice ? {...result,name:choice.name} : result);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [namespace, refresh, entries]);

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
    if (namespace) notifyIde({type: "development-image:selection", namespace: sourceId(namespace)});
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

  useEffect(() => {
    if (!loadRequest) return;
    const selectedEntry=entries.find(entry=>(entry.selection_key || entry.id)===namespace);
    if ((selectedEntry?.id || namespace) !== loadRequest.namespace) {
      const requested=entries.find(entry=>entry.id===loadRequest.namespace);
      if (requested) void changeNamespace(requested.selection_key || requested.id);
      else if (entries.length) { handledLoads.current.add(loadRequest.requestId); setLoadRequest(null);
        setSendStatus("Not sent — the requested Namespace is not an exact saved Namespace."); }
      return;
    }
    if (loading || !loadRequestReady(loadRequest, input?.id, handledLoads.current)) return;
    handledLoads.current.add(loadRequest.requestId);
    setLoadRequest(null);
    if (!sendAllowed(input)) { setSendStatus("Not sent — inspection only; this evidence is not approved for installation."); return; }
    if (loadRequest.action === "prepare") void prepareInspection();
    else void beginSend(loadRequest.action === "load");
  });

  async function switchToDesigner() {
    const entry=entries.find(item=>(item.selection_key || item.id)===namespace);
    try {
      const host=window.parent as Window & {DevelopmentImageView?: {openDesigner(key:string):Promise<void>}};
      if (!entry?.selection_key || host === window || !host.DevelopmentImageView?.openDesigner)
        throw Error("Select a saved Namespace inside the IDE to open its designer.");
      await host.DevelopmentImageView.openDesigner(entry.selection_key);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function editSelectedObject() {
    if (!selected || !input || busy.current) return;
    const entry=entries.find(item=>(item.selection_key || item.id)===namespace);
    try {
      if (view !== "saved" || !entry?.selection_key || entry.selection_key === "namespace:legacy")
        throw Error("Select a saved editable Namespace before editing this object.");
      const host=window.parent as Window & {NamespaceDesignV1?: {
        openObjectEditor(key:string, fingerprint:string, slot:number):Promise<void>
      }};
      if (host === window || !host.NamespaceDesignV1?.openObjectEditor)
        throw Error("Open Memory Glass inside the IDE to edit this object.");
      if (!input.designFingerprint) throw Error("This historical object is read-only; select its saved Namespace to edit.");
      await host.NamespaceDesignV1.openObjectEditor(entry.selection_key, input.designFingerprint, selected.slot);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function changeNamespace(value: string) {
    if (busy.current) return;
    const entry=entries.find(item=>(item.selection_key || item.id)===value);
    if (entry?.selection_key) {
      try {
        const parent = window.parent as Window & {NamespaceDesignV1?: {selectShared(key:string):Promise<boolean>}};
        if (parent !== window && parent.NamespaceDesignV1)
          await parent.NamespaceDesignV1.selectShared(entry.selection_key);
        NamespaceSelection.select(entry.selection_key);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return;
      }
    }
    setNamespace(value);
    setSelectedSlot(null);
    setBuiltImage(null); setBuiltRows([]); setView("saved"); setAddress("");
    setSendStatus(""); setReceipt(null);
    const url = new URL(location.href); url.searchParams.set("namespace", value);
    history.replaceState(null, "", url);
    notifyIde({type: "development-image:selection", namespace: sourceId(value)});
  }

  function showBuilt(image: PreparedImage) {
    const rows = builtSlots(image);
    setBuiltImage(image); setBuiltRows(rows); setView("built"); setSelectedSlot(null);
  }

  async function prepareInspection() {
    if (busy.current || !input) return;
    busy.current = true; setSending(true);
    setBuiltImage(null); setBuiltRows([]); setView("saved"); setReceipt(null);
    setSendStatus("Preparing latest compilations for inspection only. Nothing will be sent.");
    try {
      const image = await request<PreparedImage>("/api/development-image/prepare", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({id: input.id}),
      });
      if (image.namespace_revision_id !== input.id) throw Error("Prepared Namespace identity changed.");
      requireLatestBuild(image);
      showBuilt(image);
      setSendStatus("Application image prepared. Use Load to review transfer into the existing FPGA; no bitstream was built and nothing was sent.");
    } catch (cause) { setSendStatus("Inspection preparation failed — " + (cause as Error).message); }
    finally { busy.current = false; setSending(false); }
  }

  async function beginSend(preparedOnly = false) {
    if (busy.current || !input || !sendAllowed(input)) return;
    busy.current = true; setSending(true); setSendStatus("");
    try {
      let image = builtImage || input.image;
      if (preparedOnly && !image) throw Error("Prepare this application image first. Load does not build an image.");
      if (!image && input.id.startsWith("design:")) {
        setSendStatus("Compiling the latest source of every LUMP and rebuilding bindings. Nothing has been sent.");
        image = await request<PreparedImage>("/api/development-image/prepare", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({id: input.id}),
        });
        if (image.namespace_revision_id !== input.id)
          throw Error("Prepared Namespace identity changed. Nothing was sent.");
      }
      if (!image) throw Error(input.hardwareError || "No image is available for this selection.");
      if (image.namespace_revision_id !== input.id) throw Error("The prepared image belongs to another Namespace. Prepare this selection again.");
      requireLatestBuild(image);
      if (image.memory_map) showBuilt(image);
      setSendStatus("Image prepared. Checking the connected FPGA; nothing has been sent.");
      const board = await request<BoardStatus>("/hardware/wukong/status");
      const target = board.physical_target;
      if (!target?.live || !target.device_uid || !target.session_id)
        throw Error(connectionStatus(board) + " " + reconnectHelp + " Nothing was sent.");
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
      setSendStatus("Rechecking latest compilations against the confirmed image. Nothing has been sent.");
      const prepared = await prepareExact(frozen.image, token.trim());
      setSendStatus("Stopping the selected board and waiting for its acknowledgement…");
      await stopBeforeSend(frozen.target, token.trim());
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
        <p className="kiss-preview">{builtImage || input?.image ? "Application image prepared — not verified installed" : input?.layoutSource === "saved-design-layout" ? "Saved Namespace — Prepare before Load" : "Saved Namespace — FPGA image unavailable"}</p>
      </header>

      <div className="kiss-heading">
        <div><p className="kiss-subtitle">Review the bound Namespace layout, then send it to the FPGA.</p></div>
        <button type="button" className="kiss-primary" onClick={() => void switchToDesigner()}
          disabled={loading || sending || !entries.find(entry=>(entry.selection_key || entry.id)===namespace)?.selection_key}
          aria-label="Switch to Namespace Designer" title="Return to this Namespace designer without saving or sending">Switch → Namespace Designer</button>
      </div>
      {error && <p className="kiss-api-error" role="alert">{error} No saved data was changed. <a href={location.pathname}>Reload saved Namespaces</a></p>}
      {namespace.startsWith("latest:") && <button type="button" disabled={loading || sending || !!confirmation}
        onClick={() => {setReceipt(null); setSendStatus(""); setRefresh(value => value + 1);}}>Rebuild latest image</button>}
      {loading && <p className="kiss-api-message" role="status">{namespace.startsWith("latest:")
        ? "Building the latest Development Image for inspection. Nothing will be sent…"
        : "Reading the exact saved Namespace…"}</p>}

      <div className="kiss-layout kiss-layout-single">
        <section className="kiss-panel" aria-labelledby="kiss-namespace-title">
          <div className="kiss-slot-visual-row">
          <div className="kiss-slot-column">
          <div className="kiss-panel-head"><h2 id="kiss-namespace-title"><span className="kiss-step">01</span>Namespace Table</h2><span className="kiss-status">{view === "built" ? "Built-image allocations" : "Saved inputs"}</span></div>
          <div className="kiss-selector">
            <label htmlFor="kiss-namespace">Namespace</label>
            <select id="kiss-namespace" value={namespace} disabled={sending || !!confirmation} onChange={event => changeNamespace(event.target.value)}>
              {!namespace && <option value="">Select a saved Namespace</option>}
              <optgroup label="Namespaces">
                {entries.filter(entry=>entry.selection_key).map(entry => <option key={entry.selection_key} value={entry.selection_key}>{entry.name}</option>)}
              </optgroup>
              {!entries.find(entry=>entry.selection_key===namespace) && namespace &&
                <option value={namespace}>{entries.find(entry=>entry.id===namespace)?.name} · Historical inspection</option>}
            </select>
          </div>
          <div className="kiss-selector">
            <label htmlFor="memory-view">Memory view</label>
            <select id="memory-view" value={view} onChange={event => {setView(event.target.value as "saved" | "built"); setSelectedSlot(null);}}>
              <option value="saved">Saved design</option>
              <option value="built" disabled={!builtImage}>Built image — prepared, not installation evidence</option>
            </select>
            <button disabled={sending || loading || !!confirmation || !input?.id.startsWith("design:") || !sendAllowed(input)} onClick={() => void prepareInspection()}>Prepare application image</button>
          </div>
          <p className="kiss-meta">{slots.length} {view === "built" ? "built-image" : "saved"} rows · Select a name to inspect this view’s data.</p>
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
          </div>
          <section className="kiss-water-map" aria-labelledby="kiss-water-title">
                <div className="kiss-water-heading">
                  <div><span className="kiss-step">{view === "built" ? "BUILT-IMAGE LOCATIONS" : "SAVED LOCATIONS"}</span><h4 id="kiss-water-title">Namespace memory glass</h4></div>
                  <span className="kiss-water-caveat">{locatedEntries.length} mapped entries</span>
                </div>
                {view === "built" && <p className="kiss-meta" style={{overflowWrap: "anywhere"}}>Prepared image SHA-256: {builtImage?.artifact_sha256}. Preparation is not installation evidence.</p>}
                <p className="kiss-water-intro">{view === "built"
                  ? "Exact staged allocations in word coordinates. Namespace shows its table, not its enclosing authority range. Threads occupy RAM; MMIO and unallocated lazy LUMPs are not painted. Names come only from this build."
                  : input?.layoutSource === "saved-design-layout"
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
                    <div className="kiss-glass-zero">{locatedEntries.length} {view === "built" ? "built-image" : "saved"} locations shown</div>
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
                    </svg> : selectedIsThread ? <picture className="kiss-device-icon">
                      <source media="(prefers-reduced-motion: reduce)" srcSet={threadClimberStill} />
                      <img src={threadClimber} width="240" height="240" style={{width: "100%", height: "auto", display: "block"}}
                        alt="Thread illustration: a stick figure climbing steps" title="Thread illustration — not live execution status" />
                    </picture> : <svg className="kiss-device-icon kiss-lump-icon" viewBox="0 0 120 120" role="img" aria-label={selectedIsNamespace ? "Namespace icon" : selectedIsBoot ? "Boot entry icon" : "Namespace entry icon"}>
                      <circle cx="60" cy="60" r="43" fill="#172636" stroke={colorForSlot(selected.slot) ?? "#73d7c0"} strokeWidth="3" />
                      {selectedIsNamespace ? <>
                        <path d="M36 42h48v39H36zM44 34h40v39M52 26h32v39" fill="#1d3040" stroke={colorForSlot(selected.slot) ?? "#73d7c0"} strokeWidth="3" strokeLinejoin="round" />
                        <path d="M47 53h25M47 63h25M47 73h17" stroke="#dce9e7" strokeWidth="3" strokeLinecap="round" />
                      </> : <>
                        <path d="M60 28l7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2z" fill="#1d3040" stroke={colorForSlot(selected.slot) ?? "#73d7c0"} strokeWidth="3" strokeLinejoin="round" />
                        <path d="M43 84h34" stroke={colorForSlot(selected.slot) ?? "#73d7c0"} strokeWidth="3" strokeLinecap="round" />
                      </>}
                    </svg>}
                    <span className="kiss-device-kicker">{selectedIsMmio ? "SELECTED MMIO" : selectedIsLump ? "SELECTED LUMP" : selectedIsBoot ? "SELECTED BOOT ENTRY" : selectedIsThread ? "SELECTED THREAD" : "SELECTED NAMESPACE"}</span>
                    <strong>{selected.name.replace(/_DEV$/, "").replaceAll("_", " ")}</strong>
                    <button className="kiss-primary" type="button" onClick={() => void editSelectedObject()}
                      disabled={!input?.designFingerprint || view !== "saved" || !entries.find(entry => (entry.selection_key || entry.id) === namespace)?.selection_key || namespace === "namespace:legacy"}
                      title={view !== "saved" ? "Switch to the saved Namespace to edit" : `Edit ${selected.name}`}
                      aria-label={`Edit ${selected.name} in ${selectedIsLump ? "Code Edit" : selectedIsThread ? "Thread Designer" : selectedIsMmio ? "MMIO Designer" : "Namespace Designer"}`}>EDIT</button>
                    {selectedIsMmio ? <>
                      <span className="kiss-device-type">{selected.name.startsWith("LED") ? "Indicator output" : selected.name.startsWith("BTN") ? "Button input" : selected.name.startsWith("TIMER") ? "Timer peripheral" : selected.name.startsWith("UART") ? "Serial interface" : "Memory-mapped device"}</span>
                      <span className="kiss-device-location">Word address {displayLocation(selected.location)} · byte address {displayLocation(selected.location == null ? null : selected.location * 4)}</span>
                    </> : selectedIsLump ? <dl className="kiss-inline-details">
                      <dt>Artifact</dt><dd>{selected.selection?.filename ?? selected.filename ?? "Not recorded"}</dd>
                      <dt>Size</dt><dd>{selected.geometry ? `${selected.geometry.sizeWords.toLocaleString()} words / ${selected.geometry.sizeBytes.toLocaleString()} bytes` : "Not available"}</dd>
                      <dt>Code size</dt><dd>{selected.geometry ? `${selected.geometry.codeWords.toLocaleString()} words / ${selected.geometry.codeBytes.toLocaleString()} bytes` : "Not available"}</dd>
                      <dt>C-list rows</dt><dd>{selected.geometry?.clistRows ?? "Not available"}</dd>
                      <dt>Revision</dt><dd>{selected.selection?.revision ?? selected.lump_version ?? "Not recorded"}</dd>
                      <dt>Token</dt><dd>{selected.selection?.token ?? selected.token ?? "Not recorded"}</dd>
                      <dt>Policy</dt><dd>{selected.policy ?? selected.load_policy ?? "Not recorded"}</dd>
                      <dt>Word location</dt><dd>{displayLocation(selected.location)}</dd>
                      <dt>Extent</dt><dd>{selected.limit ?? "Not recorded"}</dd>
                    </dl> : <dl className="kiss-inline-details">
                      <dt>Kind</dt><dd>{selectedIsThread ? "Thread" : selectedIsNamespace ? "Namespace" : selectedKind}</dd>
                      <dt>Role</dt><dd>{selectedIsBoot ? "Boot entry" : selectedIsThread ? "Thread entry" : "Namespace entry"}</dd>
                      <dt>Slot</dt><dd>{String(selected.slot).padStart(2, "0")}</dd>
                      <dt>Type</dt><dd>{selected.type ?? selectedKind}</dd>
                      <dt>Policy</dt><dd>{selected.policy ?? selected.load_policy ?? (selected.resident ? "Resident" : "Not recorded")}</dd>
                      <dt>Word location</dt><dd>{displayLocation(selected.location)}</dd>
                      <dt>Extent</dt><dd>{selected.limit ?? "Not recorded"}</dd>
                      <dt>Sequence</dt><dd>{selected.sequence ?? selected.seq ?? "Not recorded"}</dd>
                    </dl>}
                  </aside> : <aside className="kiss-device-card kiss-device-card-idle" aria-live="polite">
                    <span className="kiss-device-kicker">MEMORY LOCATIONS</span>
                    <strong>Select a slot</strong>
                    <span className="kiss-device-type">Regions in this view are dimmed until you choose a row.</span>
                  </aside>}
                </div>
                <label htmlFor="memory-byte-address">FPGA byte address (decimal or 0x hex)</label>
                <input id="memory-byte-address" value={address} onChange={event => setAddress(event.target.value)} placeholder="0x1000" />
                {address && <p role="status">{addressWord === null ? "Enter a valid 32-bit byte address." : <>Word coordinate {addressWord} · {addressRegion ? `${addressRegion.name} (${addressRegion.kind}), NS[${addressRegion.slot}], byte offset ${Number(address) - addressRegion.location! * 4}` : "No containing resident region in this view."}</>}</p>}
                <div className="kiss-water-legend"><span>{view === "built" ? "Digest-bound staged map; not installed-memory readback." : "Saved design only; preparing can change allocations and bindings."}</span><span>Threads and boot entries share the same word scale.</span></div>
          </section>
          </div>
          <details className="kiss-technical">
            <summary>Technical details · {selected?.name ?? "Namespace"}</summary>
            <p className="kiss-muted">{view === "built" ? "Exact built-image allocation; not installation evidence." : "Exact saved row. Kind labels for Original are inferred for display; saved data is unchanged."}</p>
            <pre>{JSON.stringify(view === "built" ? selected : input?.rows.find(row => row.slot === selectedSlot), null, 2)}</pre>
            {view === "saved" && input?.layoutSource === "saved-design-layout" && <>
              <p className="kiss-muted">Displayed design allocation (not installed memory)</p>
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            </>}
            <p className="kiss-muted">Namespace metadata</p>
            <pre>{JSON.stringify(input?.metadata ?? {}, null, 2)}</pre>
            <p>Saved identity: {input?.fingerprint ?? "Unavailable"}</p>
            {input?.capacitySource === "reference" && <p>Total capacity was not recorded. The glass uses a labelled 16,384-word reference scale.</p>}
            {input?.imageSha256 && <p>Retained binary: {input.imageSha256} · {input.imageBytes} bytes</p>}
            {input?.hardwareError && <p>{input.layoutSource === "saved-design-layout"
              ? "Send compiles the latest source of every included LUMP, regenerates Threads and Namespace data, and rebuilds bindings. Older saved selections are not reused."
              : `Not ready to send: ${input.hardwareError}`}</p>}
            <p><a href="/simulator/#namespace" target="_top" onClick={event => { event.preventDefault(); notifyIde({type: "development-image:navigate", view: "namespace"}); }}>Open Namespace editor</a></p>
            {input?.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
          </details>
        </section>

      </div>
      <footer className="kiss-send-footer">
        <div><strong>Load the prepared application into FPGA memory</strong><span>Keeps the existing bitstream. Exact image and latest inputs are rechecked before transfer; explicit confirmation required.</span></div>
        <span className="kiss-send-hint" tabIndex={sendUnavailable ? 0 : undefined} aria-label={sendUnavailable ? "Send build to FPGA unavailable" : undefined} aria-describedby={sendUnavailable ? "send-unavailable-reason" : undefined}>
          <button type="button" className="kiss-primary kiss-send-button" disabled={!!sendUnavailable} onClick={() => void beginSend(true)}>{sending ? "Checking exact image…" : receipt ? "Build submitted" : "Load application image"}</button>
          {sendUnavailable && <span id="send-unavailable-reason" role="tooltip">{sendUnavailable}</span>}
        </span>
        {!sending && !receipt && input && sendAllowed(input) && !connected && (
          <div className="kiss-connection-recovery" role="status" aria-live="polite">
            {!connection.needsHelp ? <p>Checking the connection automatically…</p> : <>
              <p>{connection.issue === "server"
                ? "The IDE connection check could not complete. Check your internet connection; I’ll keep retrying."
                : "The bridge has not reconnected after four checks. If PowerShell shows “IDE registration rejected — HTTP 401”, the IDE is rejecting the bridge’s credentials. Checking again cannot repair that."}</p>
              {connection.issue === "bridge" ? <div>
                <p><strong>For HTTP 401, create a fresh connection:</strong></p>
                <ol>
                  <li>In the bridge’s PowerShell window, press <strong>Ctrl+C</strong>.</li>
                  <li>On the Church Machine page, open <strong>Build Approval → Advanced → Connect bridge → Start a new bridge instead</strong>.</li>
                  <li>Check the serial port and board UID, then click <strong>Create connection command</strong>.</li>
                  <li>Copy the new command into PowerShell, run it, and leave that window open.</li>
                </ol>
                <p>No FPGA rebuild or reflash is needed for this authentication error. Keep credentials out of chat. Send will become available automatically when the connection returns.</p>
                <details><summary>If PowerShell does not show HTTP 401</summary>
                  <p>Check that the FPGA has power, its USB cable is connected, and the bridge is running. If it reports a different error, share that error text without credentials.</p>
                </details>
              </div> : <p>If other pages work, the IDE server may be unavailable or rejecting this request. Try the connection check again after the server is available.</p>}
              <button type="button" onClick={connection.retry}>Check again now</button>
            </>}
          </div>
        )}
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
          {confirmation.image.build_inputs && <details>
            <summary>Latest build inputs ({confirmation.image.build_inputs.length})</summary>
            <p>Every compiled LUMP uses its latest saved source and the current compiler.
              Namespace and Thread bodies are regenerated for this build.</p>
            <ul>{confirmation.image.build_inputs.map(item => <li key={item.slot}>
              <strong>NS[{item.slot}] {item.name}</strong> — {item.origin === "current-definition"
                ? "generated from current definition"
                : `latest source revision ${item.revision}; freshly compiled`}
              {item.binaryHash && <div style={{overflowWrap: "anywhere"}}>SHA-256: {item.binaryHash}</div>}
            </li>)}</ul>
          </details>}
          <p>After confirmation, the IDE stops the board, waits for acknowledgement, then sends this image. Bitstream compatibility is your responsibility. An upload acknowledgement is not memory readback.</p>
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
