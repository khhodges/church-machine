import { useRef } from "react";

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  loading: boolean;
  options: {value: string; label: string}[];
};

// Native disclosure, ordinary buttons, and in-flow content: no popup layer,
// focus transfer on opening, or blur handlers that can swallow a choice click.
export default function NamespacePicker({id, label, value, onChange, loading, options}: Props) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const items = [{value: "", label: "Unassigned"}, ...options];
  function close() {
    if (disclosure.current) disclosure.current.open = false;
    summary.current?.focus();
  }
  return <details ref={disclosure} className="nb-picker" onKeyDown={event => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); close();
    }
  }}>
    <summary ref={summary} id={id} aria-label={`Choose ${label}`} className="nb-picker-trigger">
      <span>{loading ? "Loading Namespaces…" : items.find(option => option.value === value)?.label || "Unassigned"}</span>
      <span className="nb-picker-action">Choose</span>
    </summary>
    <div id={`${id}-list`} role="group" aria-label={`${label} choices`} className="nb-picker-list">
      {loading ? <p role="status">Loading saved Namespaces…</p> :
        items.map(option => <button type="button" key={option.value}
          aria-pressed={option.value === value} className="nb-picker-option"
          onClick={() => { onChange(option.value); close(); }}>
          <span>{option.label}</span>
          {option.value === value && <span aria-hidden="true">✓</span>}
        </button>)}
      {!loading && !options.length && <p role="status">No saved Namespaces are available. Check the catalog message below.</p>}
    </div>
  </details>;
}
