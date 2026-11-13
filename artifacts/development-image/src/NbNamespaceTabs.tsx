import type { CSSProperties } from "react";
import type { GlassLump, LumpMember, LumpPick, Side } from "./nb-association";
import type { InspectionState } from "./use-namespace-inspection";

export const SIDE_COLORS: Record<Side | "AB", string> = {A: "#73d7c0", B: "#b8a1ee", AB: "#e9c46a"};

type Props = {
  tab: Side; onTab: (side: Side) => void;
  names: Record<Side, string>; states: Record<Side, InspectionState>; onRetry: (side: Side) => void;
  members: Record<Side, LumpMember[]>; items: GlassLump[];
  pick: LumpPick | null; onPick: (pick: LumpPick) => void; glassKey: string | null;
};

export default function NbNamespaceTabs({tab, onTab, names, states, onRetry, members, items, pick, onPick, glassKey}: Props) {
  const state = states[tab];
  const rows = members[tab];
  const shared = (m: LumpMember) => items.find(i => i.members.includes(m))?.members.length === 2;
  return (
    <div className="nb-tabs">
      <div className="nb-tablist" role="tablist" aria-label="Namespace alternatives">
        {(["A", "B"] as Side[]).map(side => (
          <button key={side} type="button" role="tab" id={`nb-tab-${side}`} aria-controls="nb-tabpanel"
            aria-selected={tab === side} className={`nb-tab${tab === side ? " is-active" : ""}${pick?.side === side || (glassKey && items.find(i => i.key === glassKey)?.members.some(m => m.side === side)) ? " is-linked" : ""}`}
            style={{"--nb-side": SIDE_COLORS[side]} as CSSProperties} onClick={() => onTab(side)}>
            <b>{side}</b><span>{names[side] || "Unassigned"}</span>
            <em>{states[side].status === "ready" ? members[side].length : states[side].status === "loading" ? "…" : "—"}</em>
          </button>
        ))}
      </div>
      <div id="nb-tabpanel" role="tabpanel" aria-labelledby={`nb-tab-${tab}`}>
        {state.status === "unassigned" && <p className="nb-tab-note">Namespace {tab} is unassigned. Choose a saved Namespace above to list its LUMPs.</p>}
        {state.status === "loading" && <p className="nb-tab-note" role="status">Reading saved Namespace {tab} (read-only)…</p>}
        {state.status === "error" && <p className="nb-tab-note nb-error" role="alert">{state.message} <button type="button" onClick={() => onRetry(tab)}>Retry {tab}</button></p>}
        {state.status === "ready" && (rows.length === 0
          ? <p className="nb-tab-note">This saved Namespace lists no LUMP rows.</p>
          : <div className="kiss-table-scroll" role="region" aria-label={`Namespace ${tab} LUMPs`}>
              <table>
                <thead><tr><th scope="col">Slot</th><th scope="col">LUMP</th><th scope="col">Words</th><th scope="col">Identity</th></tr></thead>
                <tbody>{rows.map(m => {
                  const active = pick?.side === m.side && pick.slot === m.slot;
                  const color = shared(m) ? SIDE_COLORS.AB : SIDE_COLORS[m.side];
                  return <tr key={m.slot} className={active ? "kiss-active" : undefined}>
                    <td>{String(m.slot).padStart(2, "0")}</td>
                    <td><span className="kiss-slot-color" style={{"--kiss-lump-color": color} as CSSProperties} aria-hidden="true" />
                      <button type="button" className="kiss-slot-button" style={{"--kiss-lump-color": color} as CSSProperties}
                        aria-pressed={active} aria-label={`Select ${m.name}, Namespace ${m.side} slot ${m.slot}`}
                        onClick={() => onPick({side: m.side, slot: m.slot})}>{m.name}</button>
                      <span className={`nb-badge nb-badge-${shared(m) ? "AB" : m.side}`}>{shared(m) ? "A+B" : m.side}</span></td>
                    <td className="kiss-kind">{m.words === null ? "unknown" : m.words.toLocaleString()}</td>
                    <td className="kiss-kind" title={m.identity ?? "No exact artifact identity recorded"}>{m.identity ?? "unproven"}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>)}
      </div>
    </div>
  );
}
