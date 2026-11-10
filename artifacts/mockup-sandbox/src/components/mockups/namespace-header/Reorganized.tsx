import { useId, useState } from 'react';
import { ArrowRight, Check, Copy, CornerDownRight, ExternalLink, Plus, RotateCcw, TriangleAlert } from 'lucide-react';
import './_reorganized.css';

const profiles = [
  { id: 'phase1', name: 'Phase 1' },
  { id: 'ascending', name: 'New Layout' },
  { id: 'legacy', name: 'Original' },
];

const metrics = [
  { label: 'Max', value: 64, className: '', description: 'Slot capacity of this Namespace design; not evidence of the active image.' },
  { label: 'Assigned', value: 21, className: '', description: 'Approved assignments and explicit local drafts; not proof of image installation.' },
  { label: 'Resident policy', value: 21, className: 'nr-resident', description: 'Selected policy or architectural object kind, not proof of installed bytes.' },
  { label: 'Lazy policy', value: 0, className: 'nr-lazy', description: 'Selected next-build policy, not observed hardware state.' },
  { label: 'Garbage', value: 0, className: 'nr-garbage', description: 'Cleared slots: GT cycle count bumped and content zeroed.' },
  { label: 'Free', value: 42, className: 'nr-free', description: 'Slots available for allocation.' },
];

export function Reorganized() {
  const pickerId = useId();
  const titleId = useId();
  const [profile, setProfile] = useState('ascending');
  const [feedback, setFeedback] = useState('Local interactions only. No saves, binding, or hardware transfer.');
  const selected = profiles.find((item) => item.id === profile)!;
  const hasSnapshot = profile === 'ascending';

  function preview(action: string) {
    const messages: Record<string, string> = {
      switch: `Memory Glass would show the saved ${selected.name} Namespace and retain unsaved designer edits. This preview stays here.`,
      reload: `Would reload the saved ${selected.name} design. No file was read and no edits were changed.`,
      duplicate: `Would create an independent copy of ${selected.name}; test and approval status would not be inherited. No copy was created.`,
      bind: `Would save ${selected.name} and open fresh C-list binding results. Nothing was saved or bound here; binding does not activate hardware.`,
      prepare: `Would open the selected saved ${selected.name} Namespace in Prepare & Load FPGA in a new tab. This preview opens no tab, rebinds nothing, and sends nothing.`,
      attention: `Would open a read-only report of flagged issues in saved ${selected.name}. Live issue data is not available in this preview.`,
      add: 'Would open the saved LUMP or name picker for a non-executable design placement. No placement was added.',
      boot: 'Boot entry identifies Boot.Thread.CR0, the first abstraction invoked after boot. In the IDE, drag this control onto a Namespace row to choose it. No rows or boot changes are available in this header preview.',
    };
    setFeedback(messages[action]);
  }

  return (
    <div className="namespace-refined">
      <header className="nr-header" aria-labelledby={titleId}>
        <div className="nr-top">
          <h1 id={titleId}>Namespace Design</h1>
          <button type="button" className="nr-glass" onClick={() => preview('switch')} title="Show the saved Namespace in Memory Glass; unsaved designer edits are retained">
            Switch → Memory Glass
          </button>
        </div>

        <div className="nr-selection">
          <div className="nr-picker">
            <label htmlFor={pickerId}>Namespace</label>
            <select id={pickerId} value={profile} onChange={(event) => {
              setProfile(event.target.value);
              const name = profiles.find((item) => item.id === event.target.value)!.name;
              setFeedback(`${name} selected locally. ${event.target.value === 'ascending' ? 'Showing the supplied saved-design snapshot.' : 'Saved-state evidence and counts for this profile are not supplied.'} No live Namespace changed.`);
            }}>
              {profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div className="nr-state">
            <span className="nr-saved">
              {hasSnapshot && <Check aria-hidden="true" />}
              {hasSnapshot ? 'Saved design' : 'Saved status unknown'}
            </span>
            <span className="nr-state-note">{hasSnapshot ? 'Ascending table / four-word header' : 'No preview snapshot for this profile'}</span>
          </div>
          <div className="nr-file-actions" role="group" aria-label="Saved design actions">
            <button type="button" onClick={() => preview('reload')}><RotateCcw aria-hidden="true" />Reload saved design</button>
            <button type="button" onClick={() => preview('duplicate')}><Copy aria-hidden="true" />Duplicate Namespace</button>
          </div>
        </div>

        <div className="nr-summary">
          <dl aria-label="Namespace design counts, not installed hardware state">
            {metrics.map((metric) => (
              <div key={metric.label} className={metric.className} title={metric.description}>
                <dt>{metric.label}</dt>
                <dd aria-label={hasSnapshot ? undefined : 'Not available in preview'}>{hasSnapshot ? metric.value : '—'}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className="nr-boot" onClick={() => preview('boot')} title="Choose the first abstraction invoked after boot. Preview: show instructions.">
            <CornerDownRight aria-hidden="true" />Boot entry
          </button>
        </div>

        <div className="nr-actions">
          <div className="nr-action-group" role="group" aria-label="Binding and FPGA preparation">
            <button type="button" className="nr-bind" onClick={() => preview('bind')} title="Save the selected design and open fresh C-list binding results; does not activate hardware">
              Bind Namespace Design<ArrowRight aria-hidden="true" />
            </button>
            <button type="button" className="nr-prepare" onClick={() => preview('prepare')} title="Open the selected saved Namespace in Prepare & Load FPGA; does not rebind or send">
              Prepare &amp; Load FPGA<ExternalLink aria-hidden="true" />
            </button>
          </div>
          <div className="nr-action-group" role="group" aria-label="Inspect and edit Namespace">
            <button type="button" className="nr-attention" onClick={() => preview('attention')} title="Read-only report of flagged issues in the saved Namespace">
              <TriangleAlert aria-hidden="true" />Needs attention
            </button>
            <button type="button" onClick={() => preview('add')} title="Select a saved LUMP or name and add a non-executable design placement">
              <Plus aria-hidden="true" />Add to Namespace
            </button>
          </div>
        </div>

        <div className="nr-bottom">
          <div className="nr-footer">
            <p className="nr-feedback" role="status" aria-live="polite" aria-atomic="true">
              <span className="nr-preview">Preview only · </span>{feedback}
            </p>
            <details>
              <summary>Design &amp; binding details</summary>
              <div className="nr-help">
                <p><strong>Saved-state evidence.</strong> New Layout was loaded from a saved design in the source environment. This preview uses that supplied snapshot; it does not check files or hardware.</p>
                <p><strong>Save explicitly.</strong> Bind Namespace Design saves the selected design and opens fresh C-list binding results. Only your view choice is remembered after reload in the IDE; save edits explicitly to keep them.</p>
                <p><strong>Binding is not activation.</strong> Unresolved or unauthenticated references remain blocked. Binding does not activate a simulation or change an installed image.</p>
                <p><strong>FPGA transfer is separate.</strong> Prepare &amp; Load FPGA opens the selected saved Namespace in a new tab. Opening it does not rebind or send to hardware.</p>
                <p><strong>Counts describe the design.</strong> Policy and assignment counts are not evidence of installed bytes. Max includes the Namespace header slot, so assigned and free do not alone sum to capacity.</p>
              </div>
            </details>
          </div>
        </div>
      </header>
    </div>
  );
}

export default Reorganized;
