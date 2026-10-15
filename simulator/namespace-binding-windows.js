(function(root){
    'use strict';
    var layer=null, bar=null, wins=[], z=10, STEP=28;
    function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=String(text);return e;}
    function hex(v){
        if(typeof v==='number'&&Number.isFinite(v)) return '0x'+(v>>>0).toString(16).toUpperCase().padStart(8,'0');
        return null;
    }
    function gtCell(v,unresolvedLabel){
        var h=hex(v); if(h) return el('td',null,h);
        if(v==null) return el('td','nsbw-unres',unresolvedLabel);
        return el('td',null,String(v));
    }
    function shortFp(fp){fp=fp==null?'':String(fp);return fp.length>12?fp.slice(0,12)+'…':fp||'(none)';}
    function front(w){
        wins.forEach(function(x){x.classList.remove('nsbw-front');});
        w.style.zIndex=String(++z); w.classList.add('nsbw-front');
    }
    function clamp(w){
        var vw=root.innerWidth||1024, maxX=Math.max(0,vw-w.getBoundingClientRect().width-8);
        var x=Math.min(Math.max(0,parseFloat(w.style.left)||0),maxX);
        var y=Math.min(Math.max(0,parseFloat(w.style.top)||0),
            Math.max(0,(root.innerHeight||768)-48));
        w.style.left=x+'px'; w.style.top=y+'px';
    }
    function cascade(){
        var vh=root.innerHeight||768, vw=root.innerWidth||1024;
        wins.forEach(function(w,i){
            var maxX=Math.max(0,vw-Math.min(560,vw-24)-12);
            var x=Math.min(12+i*STEP,maxX), y=12+i*STEP;
            w.style.left=x+'px'; w.style.top=y+'px';
            w.style.zIndex=String(++z); w.classList.remove('nsbw-front');
        });
        if(wins.length) front(wins[wins.length-1]);
        void vh;
    }
    function drag(w,handle){
        handle.addEventListener('pointerdown',function(ev){
            if(ev.target.closest('button,a,input,select,textarea')) return;
            if(ev.button!=null&&ev.button>0) return;
            front(w);
            var sx=ev.clientX, sy=ev.clientY, ox=parseFloat(w.style.left)||0, oy=parseFloat(w.style.top)||0;
            try{handle.setPointerCapture(ev.pointerId);}catch(e){}
            function mv(e){w.style.left=(ox+e.clientX-sx)+'px';w.style.top=(oy+e.clientY-sy)+'px';}
            function up(){handle.removeEventListener('pointermove',mv);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);clamp(w);}
            handle.addEventListener('pointermove',mv);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);
            ev.preventDefault();
        });
    }
    function close(w){
        var i=wins.indexOf(w); if(i<0) return;
        wins.splice(i,1); w.remove();
        if(wins.length){var t=wins[wins.length-1];front(t);t.focus();}
        else closeAll();
    }
    function makeWin(list,i){
        var id='nsbw-'+i, st=list&&list.status==='bound'?'bound':'blocked';
        var w=el('div','nsbw-win'); w.setAttribute('role','dialog'); w.setAttribute('aria-modal','false');
        w.setAttribute('aria-labelledby',id+'-t'); w.tabIndex=-1;
        var t=el('div','nsbw-title'); var h=el('h2',null,'C-list slot '+(list.slot==null?'?':list.slot)+' — '+(list.name||list.filename||'(unnamed)'));
        h.id=id+'-t'; t.appendChild(h); t.appendChild(el('span','nsbw-badge nsbw-'+st,st));
        var x=el('button','nsbw-btn','Close'); x.type='button'; x.setAttribute('aria-label','Close '+h.textContent);
        x.addEventListener('click',function(){close(w);}); t.appendChild(x); w.appendChild(t);
        var b=el('div','nsbw-body');
        if(list.filename) b.appendChild(el('p','nsbw-meta','File: '+list.filename));
        if(list.reason) b.appendChild(el('p','nsbw-reason',list.reason));
        var rows=Array.isArray(list.rows)?list.rows:[];
        if(!rows.length) b.appendChild(el('p','nsbw-meta','No binding rows. No artifact was produced for this entry.'));
        else{
            var tb=el('table','nsbw-table'), hr=el('tr');
            ['#','Name','Previous GT','','New GT','Target slot','Permissions','Status / error'].forEach(function(s){hr.appendChild(el('th',null,s));});
            var th=el('thead');th.appendChild(hr);tb.appendChild(th);var bd=el('tbody');
            rows.forEach(function(r){
                var tr=el('tr',r.status==='bound'?'':'nsbw-row-blocked');
                tr.appendChild(el('td',null,r.index==null?'':r.index));
                tr.appendChild(el('td',null,r.name||''));
                tr.appendChild(gtCell(r.previousGT,'none'));
                tr.appendChild(el('td',null,'→'));
                tr.appendChild(gtCell(r.newGT,'unresolved'));
                tr.appendChild(el('td',null,r.targetSlot==null?'—':r.targetSlot));
                tr.appendChild(el('td',null,r.permissions==null?'':r.permissions));
                tr.appendChild(el('td',null,(r.status||'blocked')+(r.reason?': '+r.reason:'')));
                bd.appendChild(tr);
            });
            tb.appendChild(bd);b.appendChild(tb);
        }
        w.appendChild(b);
        w.addEventListener('pointerdown',function(){front(w);});
        w.addEventListener('focusin',function(){front(w);});
        w.addEventListener('keydown',function(e){if(e.key==='Escape'){e.stopPropagation();close(w);}});
        drag(w,t);
        return w;
    }
    function closeAll(){
        wins.forEach(function(w){w.remove();}); wins=[];
        if(layer){layer.remove();layer=null;} if(bar){bar.remove();bar=null;}
    }
    function show(report){
        closeAll(); report=report||{};
        layer=el('div','nsbw-layer'); layer.setAttribute('aria-label','Namespace binding results');
        bar=el('div','nsbw-bar'); bar.setAttribute('role','region'); bar.setAttribute('aria-label','Binding results controls');
        bar.appendChild(el('strong',null,'Design binding results — not activated'));
        bar.appendChild(el('span',null,'Status: '+(report.status==='complete'?'complete':'blocked')+(report.installed?'':' · not installed')));
        var fp=el('code',null,shortFp(report.fingerprint)); fp.title=String(report.fingerprint||''); bar.appendChild(fp);
        var c=el('button','nsbw-btn','Cascade'); c.type='button'; c.addEventListener('click',cascade);
        var a=el('button','nsbw-btn','Close all'); a.type='button'; a.addEventListener('click',closeAll);
        bar.appendChild(c); bar.appendChild(a);
        var lists=Array.isArray(report.lists)?report.lists:[];
        lists.forEach(function(l,i){var w=makeWin(l||{},i);wins.push(w);layer.appendChild(w);});
        document.body.appendChild(layer); document.body.appendChild(bar);
        cascade();
        if(wins.length) wins[wins.length-1].focus(); else bar.appendChild(el('span',null,'No C-lists in report.'));
        return wins.length;
    }
    root.NamespaceBindingWindows={show:show,closeAll:closeAll,cascade:cascade,_hex:hex};
    if(root.addEventListener) root.addEventListener('resize',function(){if(wins.length)cascade();});
})(typeof window!=='undefined'?window:globalThis);
