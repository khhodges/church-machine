import { useEffect, useState } from 'react';
import { Boxes, Code2, Columns2, Cpu, ExternalLink, Layers3, RotateCcw, X } from 'lucide-react';
import { BuildPage, EditorPage, InspectPage, NamespacePage } from './_shared/Pages';
import { initialArtifacts, initialSlots, type Artifact, type DemoSnapshot, type Slot, type View } from './_shared/model';
import './_group.css';

const views: {id:View;label:string;icon:typeof Boxes}[] = [
  {id:'namespace',label:'Namespace',icon:Boxes},{id:'codeedit',label:'CodeEdit',icon:Code2},
  {id:'lump',label:'LUMP Side-by-Side',icon:Columns2},{id:'build',label:'Build & Test',icon:Cpu},
];
function getView():View { const v = window.location.hash.replace('#/',''); return views.some(p=>p.id===v) ? v as View : 'namespace'; }
export function Workbench() {
  const [view,setView] = useState<View>(getView);
  const [slots,setSlots] = useState<Slot[]>(() => initialSlots.map(s=>({...s})));
  const [artifacts,setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [selected,setSelected] = useState('SelfTest');
  const [base,setBase] = useState<Artifact>(()=>initialArtifacts().find(a=>a.slot==='SelfTest' && a.version===99)!);
  const [draft,setDraftState] = useState(base.source);
  const [savedDraft,setSavedDraft] = useState(base.source);
  const [compiled,setCompiled] = useState<string|null>(null);
  const [inspected,setInspected] = useState<Artifact>(()=>initialArtifacts().find(a=>a.slot==='SelfTest' && a.version===98)!);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [snapshot,setSnapshot] = useState<DemoSnapshot|null>(null);
  const [stage,setStage] = useState(0);
  const [resetConfirm,setResetConfirm] = useState(false);
  useEffect(()=>{ const handle = ()=>setView(getView()); window.addEventListener('hashchange',handle); return ()=>window.removeEventListener('hashchange',handle); },[]);
  const navigate = (v:View) => {window.location.hash=`/${v}`;setView(v);};
  const edit = (a:Artifact) => {
    if(a.id !== base.id) {
      if(draft !== savedDraft && !window.confirm('Replace this unsaved demo draft with the selected source?')) return;
      setBase(a);setDraftState(a.source);setSavedDraft(a.source);setCompiled(null);setError('');
    }
    navigate('codeedit');
    setNotice(`Editing latest saved source ${a.slot} v${a.version}. Namespace placement is unchanged.`);
  };
  const reset = () => {
    const a = initialArtifacts(); const b = a.find(x=>x.slot==='SelfTest' && x.version===99)!;
    setSlots(initialSlots.map(s=>({...s})));setArtifacts(a);setSelected('SelfTest');setBase(b);
    setDraftState(b.source);setSavedDraft(b.source);setCompiled(null);setError('');
    setInspected(a.find(x=>x.slot==='SelfTest' && x.version===98)!);setSnapshot(null);setStage(0);
    setResetConfirm(false);setNotice('Only this prototype session has been reset.');navigate('namespace');
  };
  return <div className="church-next">
    <header className="cn-top"><a href="#/namespace" className="cn-brand"><span className="cn-mark"><Layers3 size={20}/></span>CHURCH MACHINE <span className="cn-muted" style={{fontSize:11,fontWeight:400,letterSpacing:0}}>workbench</span></a><div className="cn-top-right"><span className="cn-badge">Prototype / sample data / no live writes</span><a href="/simulator/?view=namespace" target="_blank" rel="noopener noreferrer" className="cn-actions">Open original IDE <ExternalLink size={12}/></a><a href={typeof window !== 'undefined' ? window.location.href : '#'} target="_blank" rel="noopener noreferrer" className="cn-actions" title="Open prototype in new tab">Open prototype in new tab <ExternalLink size={12}/></a></div></header>
    <div className="cn-shell"><aside className="cn-sidebar"><div className="cn-eyebrow">Engineering workspace</div>{views.map((v,i)=><a key={v.id} href={`#/${v.id}`} className={`cn-nav ${view===v.id ? 'active' : ''}`} aria-current={view===v.id ? 'page' : undefined}><v.icon size={16}/><span>{v.label}</span><span>0{i+1}</span></a>)}<div className="cn-sidebar-bottom"><div className="cn-eyebrow" style={{padding:0,marginBottom:9}}>Isolated session</div><p>Local sample state.<br/>Nothing leaves this workspace.</p><button className="cn-btn text" style={{marginTop:20}} onClick={()=>setResetConfirm(true)}><RotateCcw size={13}/>Reset demo</button></div></aside>
    <main className="cn-main">
      {resetConfirm && <div className="cn-note"><strong>Reset this demo session?</strong> Drafts, demo revisions, placement, and build results will be cleared.<div className="cn-actions" style={{marginTop:9}}><button className="cn-btn" onClick={reset}>Reset this prototype</button><button className="cn-btn" onClick={()=>setResetConfirm(false)}>Keep working</button></div></div>}
      {notice && <div className="cn-toast" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={()=>setNotice('')}><X size={14}/></button></div>}
      {view==='namespace' && <NamespacePage slots={slots} artifacts={artifacts} selected={selected} onSelect={setSelected} onEdit={edit} onInspect={a=>{setInspected(a);navigate('lump');}} onPlace={(name,version)=>{setSlots(s=>s.map(x=>x.name===name?{...x,placed:version}:x));setNotice(`${name} v${version} adopted and saved in demo placement only.`);}}/>}
      {view==='codeedit' && <EditorPage draft={draft} setDraft={s=>{setDraftState(s);setCompiled(null);setError('');}} base={base} compiled={compiled} savedDraft={savedDraft} onSaveDraft={()=>{setSavedDraft(draft);setNotice('Draft saved in this prototype’s session memory only. No real artifact written.');}} onCompile={()=>{if(!draft.trim()){setError('Source is empty. Add some sample source before compiling.');setCompiled(null);}else{setCompiled(draft);setError('');setNotice('Demo fixture ready. This is not actual assembler output.');}}} onSaveLump={()=>{if(compiled === null)return;const version=Math.max(...artifacts.filter(a=>a.slot===base.slot).map(a=>a.version))+1;const a={slot:base.slot,version,source:compiled,id:`DEMO-${base.slot}-${version}`};setArtifacts(old=>[...old,a]);setBase(a);setSavedDraft(draft);setCompiled(null);setNotice(`Saved ${base.slot} v${version} as a demo revision. Namespace placement has not changed.`);}} error={error}/>}
      {view==='lump' && <InspectPage artifact={inspected} artifacts={artifacts} onChange={setInspected}/>}
      {view==='build' && <BuildPage slots={slots} snapshot={snapshot} stage={stage} setSnapshot={setSnapshot} setStage={n=>{setStage(n);if(n===0)setSnapshot(null);}} notify={setNotice}/>}
      <footer className="cn-footer"><span className="cn-actions"><span style={{width:5,height:5,borderRadius:'50%',background:'var(--accent)'}}/>LOCAL DEMO · NO LIVE CONNECTION</span><span>Draft ≠ saved revision ≠ Namespace placement</span><button className="cn-btn text" style={{fontSize:10}} onClick={()=>setResetConfirm(true)}>Reset demo</button></footer>
    </main></div>
  </div>;
}
