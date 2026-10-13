import { useState } from 'react';
import { ArrowRight, Check, FileCode2, GitBranch, LockKeyhole, Search } from 'lucide-react';
import { disassembly, hex, type Artifact, type DemoSnapshot, type Slot } from './model';

export function NamespacePage({ slots, artifacts, selected, onSelect, onEdit, onInspect, onPlace }: {
  slots: Slot[]; artifacts: Artifact[]; selected: string; onSelect: (name: string) => void;
  onEdit: (a: Artifact) => void; onInspect: (a: Artifact) => void; onPlace: (name: string, version: number) => void;
}) {
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Artifact | null>(null);
  const slot = slots.find(s => s.name === selected)!;
  const placed = artifacts.find(a => a.slot === selected && a.version === slot.placed)!;
  const latest = artifacts.filter(a => a.slot === selected).sort((a,b) => b.version-a.version)[0];
  return <>
    <div className="cn-heading"><div><div className="cn-eyebrow">Workspace / Boot.NS</div><h1>Namespace</h1><p>Inspect what is placed. Choose what changes.</p></div><span className="cn-badge"><GitBranch size={12}/> Local demo placement</span></div>
    <div className="cn-split"><section className="cn-panel"><div className="cn-panel-head"><h2>Resident slots <span className="cn-muted">/ 5</span></h2><label className="cn-actions"><Search size={14}/><input aria-label="Filter slots" className="cn-search" placeholder="Filter slots…" value={search} onChange={e => setSearch(e.target.value)} style={{width: 142}}/></label></div>
      <div className="cn-table-wrap"><table><thead><tr><th>Slot / object</th><th>Kind</th><th>Placed</th><th>Latest</th><th>State</th></tr></thead><tbody>{slots.filter(s => s.name.toLowerCase().includes(search.toLowerCase())).map(s => {
        const v = Math.max(...artifacts.filter(a => a.slot === s.name).map(a => a.version));
        return <tr key={s.name} className={selected === s.name ? 'selected' : ''}><td><button className="cn-row-btn" onClick={() => {onSelect(s.name); setPending(null);}}><FileCode2 size={14}/>{s.name}</button></td><td className="cn-muted">{s.kind}</td><td className="cn-mono">v{s.placed}</td><td className="cn-mono">v{v}</td><td><span className={`cn-status ${v !== s.placed ? 'warn' : ''}`}>{v !== s.placed ? 'Update available' : 'Current'}</span></td></tr>;
      })}</tbody></table>{!slots.some(s => s.name.toLowerCase().includes(search.toLowerCase())) && <div className="cn-pad"><h3>No matching slots</h3><p>Try a different object name.</p><button className="cn-btn" onClick={() => setSearch('')}>Clear filter</button></div>}</div>
      <div className="cn-log"><span className="cn-muted">PLACEMENT RULE</span><br/>A newer saved LUMP does not replace a Namespace slot.<br/>Placement changes only after explicit adoption and demo save.</div></section>
      <aside className="cn-panel"><div className="cn-panel-head"><h2 className="cn-mono">{selected}</h2><span className="cn-status">Selected</span></div><div className="cn-pad"><div className="cn-eyebrow">Placed artifact</div><div style={{fontSize: 34, letterSpacing: '-1px', marginTop: 5}}>v{slot.placed} <span className="cn-muted" style={{fontSize: 12}}>saved revision</span></div><dl className="cn-details"><dt>Latest saved</dt><dd>v{latest.version}</dd><dt>Example size</dt><dd>{slot.bytes} B</dd><dt>Authority</dt><dd>Sample only</dd><dt>Placement</dt><dd>Boot.NS / {slots.indexOf(slot).toString().padStart(2,'0')}</dd></dl>
        <button className="cn-btn primary" style={{width:'100%'}} onClick={() => onInspect(placed)}>Inspect selected v{slot.placed}<ArrowRight size={14}/></button>
        <button className="cn-btn" style={{width:'100%',marginTop: 9}} onClick={() => onEdit(latest)}>Edit latest source · v{latest.version}</button>
        <div className="cn-rule"/><h3>Keep placement deliberate</h3><p style={{fontSize:12}}>Editing or saving a new revision leaves this slot unchanged.</p>
        {pending ? <div style={{marginTop:16}}><div className="cn-note">Stage v{pending.version} in {selected}? This changes only the demo Namespace.</div><div className="cn-actions"><button className="cn-btn primary" onClick={() => {onPlace(selected,pending.version);setPending(null);}}>Save demo placement</button><button className="cn-btn" onClick={() => setPending(null)}>Cancel</button></div></div> : <button className="cn-btn" style={{marginTop:16}} disabled={slot.placed === latest.version} onClick={() => setPending(latest)}>Adopt latest v{latest.version}</button>}
      </div></aside></div>
    <div className="cn-flow"><span className="cn-eyebrow">Revision lifecycle</span><span>Source draft</span><ArrowRight size={13}/><span>Demo compile</span><ArrowRight size={13}/><span>Saved LUMP</span><ArrowRight size={13}/><strong style={{color:'var(--accent)'}}>Explicit placement</strong></div>
  </>;
}

export function EditorPage({ draft, setDraft, base, compiled, savedDraft, onSaveDraft, onCompile, onSaveLump, error }: {
  draft: string; setDraft: (s:string) => void; base: Artifact; compiled: string | null; savedDraft: string;
  onSaveDraft: () => void; onCompile: () => void; onSaveLump: () => void; error: string;
}) {
  return <><div className="cn-heading"><div><div className="cn-eyebrow">Workspace / Source</div><h1>CodeEdit</h1><p>A working draft, separate from every saved LUMP.</p></div><div className="cn-actions"><button className="cn-btn" onClick={onSaveDraft}>Save Draft · local</button><button className="cn-btn primary" onClick={onCompile}>Compile · demo</button></div></div>
    <div className="cn-split"><section className="cn-panel"><div className="cn-panel-head"><div className="cn-actions"><FileCode2 size={16}/><strong className="cn-mono">{base.slot}.source</strong><span className="cn-status warn">{draft === savedDraft ? 'Draft saved locally' : 'Unsaved draft'}</span></div><span className="cn-mono cn-muted">base v{base.version}</span></div>
      <div className="cn-editor"><div className="cn-lines cn-mono" aria-hidden="true">{draft.split('\n').map((_,i) => i+1).join('\n')}</div><textarea aria-label={`${base.slot} draft source`} className="cn-source cn-mono" spellCheck={false} value={draft} onChange={e => setDraft(e.target.value)}/></div>
      <div className="cn-log cn-mono" role="status">{error ? <><strong style={{color:'var(--copper)'}}>DEMO CHECK FAILED</strong><br/>{error} Edit source and retry Compile.</> : compiled !== null ? <><strong>DEMO RESULT READY</strong><br/>Illustrative fixture prepared from this draft.<br/>No assembler executed. No binary validity established.</> : <>DEMO COMPILER / idle<br/>Editing invalidates the previous result. Compile to prepare a sample fixture.</>}</div></section>
      <aside className="cn-panel"><div className="cn-panel-head"><h2>Draft → artifact</h2></div><div className="cn-pad"><div className="cn-note">Compile is a simulated action, not a real assembler. All binary content is illustrative.</div><dl className="cn-details"><dt>Source base</dt><dd>{base.slot} v{base.version}</dd><dt>Draft storage</dt><dd>Session memory</dd><dt>Compile state</dt><dd>{compiled !== null ? 'Demo ready' : 'Not compiled'}</dd><dt>Namespace effect</dt><dd>None</dd></dl><button className="cn-btn primary" style={{width:'100%'}} disabled={compiled === null} onClick={onSaveLump}>Save LUMP · demo revision</button><p style={{marginTop:12,fontSize:12}}>Creates a new local sample revision. It will not replace the placed Namespace artifact.</p><div className="cn-rule"/><h3>Your draft stays here</h3><p style={{fontSize:12}}>Navigate between pages without losing this draft. Reloading or resetting clears the prototype session.</p></div></aside></div>
  </>;
}

export function InspectPage({ artifact, artifacts, onChange }: {artifact: Artifact; artifacts: Artifact[]; onChange:(a:Artifact)=>void}) {
  const [tab,setTab] = useState('Disassembly');
  const [line,setLine] = useState<number | null>(null);
  return <><div className="cn-heading"><div><div className="cn-eyebrow">Workspace / Saved artifact</div><h1>LUMP Side-by-Side</h1><p>Saved source and sample binary views for one selected artifact.</p></div><select aria-label="Select saved artifact" className="cn-btn cn-mono" value={artifact.id} onChange={e => onChange(artifacts.find(a => a.id === e.target.value)!)}>{artifacts.map(a => <option key={a.id} value={a.id}>{a.slot} · v{a.version}</option>)}</select></div>
    <div className="cn-note"><strong>Illustrative binary, not actual compiler output.</strong> These fixed example bytes and operations are attached to {artifact.id} for UI exploration only. They do not encode its source.</div>
    <div className="cn-inspect"><section className="cn-panel"><div className="cn-panel-head"><h2>Saved source</h2><span className="cn-status">Read only · v{artifact.version}</span></div><pre className="cn-code cn-mono" style={{minHeight:430}}>{artifact.source}</pre></section>
      <section className="cn-panel"><div className="cn-panel-head"><h2>DEMO artifact views</h2><span className="cn-mono cn-muted">v{artifact.version}</span></div><div className="cn-tabs" role="tablist" aria-label="Artifact views">{['Disassembly','Hex','C-list','API'].map(t => <button key={t} role="tab" aria-selected={tab === t} className={`cn-tab ${t === tab ? 'active' : ''}`} onClick={() => {setTab(t);setLine(null);}}>{t}</button>)}</div>
      {tab === 'Disassembly' ? <><pre className="cn-code cn-mono">{disassembly}</pre><div className="cn-pad"><label className="cn-actions cn-muted">Explain example operation<select aria-label="Explain example operation" className="cn-btn" value={line ?? ''} onChange={e => setLine(e.target.value === '' ? null : Number(e.target.value))}><option value="">Select address</option><option value="0">0000 · LOAD</option><option value="4">0004 · CALL</option><option value="8">0008 · CHECK</option><option value="12">000C · RETURN</option></select></label>{line !== null && <p style={{marginTop:12}}>{({0:'Loads an illustrative immediate into r1.',4:'Calls a sample console capability. No authority is resolved.',8:'Shows an example execute-permission check.',12:'Shows an example successful return.'} as Record<number,string>)[line]}</p>}</div></> : tab === 'Hex' ? <pre className="cn-code cn-mono">{hex}</pre> : tab === 'C-list' ? <div className="cn-pad"><table><thead><tr><th>Ref</th><th>Sample target</th><th>Intent</th></tr></thead><tbody><tr><td>c2</td><td>UART_DEV</td><td>Write</td></tr><tr><td>c3</td><td>Boot.Thread</td><td>Execute</td></tr></tbody></table><p style={{marginTop:20}}>Unresolved sample capability references. No real authority or verified encoding.</p></div> : <div className="cn-pad"><h3 className="cn-mono">main() → success</h3><p>Example entry-point description only.</p><div className="cn-rule"/><h3 className="cn-mono">console.write(value)</h3><p>Illustrative call intent. This is not a verified CALL API or compiler-generated interface.</p></div>}
      </section></div><div className="cn-footer"><span className="cn-mono">{artifact.id}</span><span>Both panels reference the same saved demo revision. Never the unsaved draft.</span></div>
  </>;
}

export function BuildPage({ slots, snapshot, stage, setSnapshot, setStage, notify }: {
  slots:Slot[]; snapshot:DemoSnapshot|null; stage:number; setSnapshot:(s:DemoSnapshot)=>void; setStage:(n:number)=>void; notify:(s:string)=>void;
}) {
  const [target,setTarget] = useState('Wukong · sample profile');
  const [clock,setClock] = useState('48');
  const [fail,setFail] = useState(false);
  const [failed,setFailed] = useState(false);
  const stages = [
    ['Freeze inputs','Capture current demo placement and configuration.','Freeze snapshot'],
    ['Create image','Assemble a simulated image from the frozen snapshot.','Create demo image'],
    ['Generate bitstream','Prepare a simulated FPGA bitstream result.','Simulate bitstream'],
    ['Run tests','Run illustrative capability and boot checks.','Run simulated tests'],
    ['Approve result','Record a local demo approval, not a deployment.','Approve demo result'],
  ];
  function advance(i:number) {
    if(i === 0) { setSnapshot({id:`SNAP-${Date.now().toString().slice(-6)}`,slots:slots.map(s=>({...s})),target,clock});setFailed(false);setStage(1);notify('Frozen demo snapshot created. Later Namespace edits will not change these inputs.'); }
    else if(i === 3 && fail) {setFailed(true);notify('Simulated test failure. Clear “Inject test failure” and retry.');}
    else {setFailed(false);setStage(i+1);notify(i === 4 ? 'Demo result approved locally. No hardware has been programmed.' : `${stages[i][0]} completed — simulated only.`);}
  }
  return <><div className="cn-heading"><div><div className="cn-eyebrow">Workspace / Reproducible flow</div><h1>Build &amp; Test</h1><p>Frozen inputs first. Every output has a visible provenance.</p></div><span className="cn-badge">Simulation only</span></div>
    <div className="cn-note green">No FPGA tools, hardware connections, or live writes. Image, bitstream, tests, and approval are all simulated local results.</div>
    <div className="cn-split"><section className="cn-panel"><div className="cn-panel-head"><h2>Build pipeline</h2><span className="cn-mono cn-muted">{stage}/5 complete</span></div>{stages.map((s,i) => <div key={s[0]} className={`cn-step ${stage > i ? 'done' : ''}`}><div className="cn-step-number">{stage > i ? <Check size={13}/> : i+1}</div><div><strong>{s[0]}</strong><p>{s[1]}</p>{stage > i && <span className="cn-status">{i === 0 ? snapshot?.id : i === 4 ? 'Approved · demo only' : 'Complete · simulated'}</span>}{i === 3 && failed && <span className="cn-status warn">Failed · simulated • Retry available</span>}</div><button className="cn-btn" disabled={stage !== i} onClick={() => advance(i)}>{s[2]}</button></div>)}
      <div className="cn-log cn-mono">{snapshot ? <>{snapshot.id} / frozen inputs<br/>IMAGE: {stage >= 2 ? 'DEMO image ready' : 'pending'} · BITSTREAM: {stage >= 3 ? 'DEMO ready' : 'pending'}<br/>TESTS: {failed ? 'simulated failure; retry required' : stage >= 4 ? '6 example checks passed' : 'not run'} · APPROVAL: {stage === 5 ? 'local demo approved' : 'not approved'}</> : <>No snapshot yet.<br/>Freeze inputs to begin this simulated pipeline.</>}</div></section>
    <aside className="cn-panel"><div className="cn-panel-head"><h2>{snapshot ? 'Frozen input snapshot' : 'Input configuration'}</h2><LockKeyhole size={14}/></div><div className="cn-pad">{snapshot ? <><span className="cn-mono">{snapshot.id}</span><dl className="cn-details"><dt>Target</dt><dd>{snapshot.target.split(' ·')[0]}</dd><dt>Clock</dt><dd>{snapshot.clock} MHz</dd>{snapshot.slots.map(s => <div key={s.name} style={{display:'contents'}}><dt className="cn-mono">{s.name}</dt><dd>v{s.placed}</dd></div>)}</dl><p style={{fontSize:12}}>Locked at freeze time. New revisions and placement changes do not alter this snapshot.</p><button className="cn-btn" style={{marginTop:14}} onClick={() => {setStage(0);setFailed(false);notify('Pipeline restarted. Freeze again to capture current inputs.');}}>Start a new demo build</button></> : <><p>Choose an illustrative target profile.</p><label className="cn-field">Target<select value={target} onChange={e=>setTarget(e.target.value)}><option>Wukong · sample profile</option><option>Ti60 · sample profile</option></select></label><label className="cn-field">Clock · sample MHz<select value={clock} onChange={e=>setClock(e.target.value)}><option>48</option><option>24</option><option>72</option></select></label></>}
      <label className="cn-check"><input type="checkbox" checked={fail} onChange={e=>setFail(e.target.checked)}/>Inject test failure · demo</label><div className="cn-rule"/><button className="cn-btn" disabled style={{width:'100%'}}><LockKeyhole size={13}/>Program hardware</button><p style={{fontSize:11,marginTop:10}}>Unavailable in this prototype. Approval does not enable hardware programming.</p></div></aside></div></>;
}
