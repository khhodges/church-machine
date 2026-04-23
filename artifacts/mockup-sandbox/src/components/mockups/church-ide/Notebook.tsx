import React from "react";
import { 
  Play, 
  GripVertical, 
  Plus, 
  Save, 
  FileCode, 
  AlignLeft, 
  Cpu, 
  ListOrdered, 
  CheckCircle2,
  MoreHorizontal,
  ChevronDown,
  TerminalSquare,
  Activity
} from "lucide-react";

export function Notebook() {
  return (
    <div className="w-full h-screen bg-[#1a1a2e] text-[#eaeaea] font-sans flex flex-col overflow-hidden selection:bg-[#e94560]/30 selection:text-white">
      {/* Top Toolbar */}
      <header className="h-14 bg-[#0f0f23] border-b border-slate-800 flex items-center justify-between px-4 shrink-0 z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[#fbbf24] font-bold text-xl tracking-wider select-none">λ</span>
            <span className="text-slate-300 font-semibold tracking-wide text-sm">CHURCH</span>
          </div>
          <div className="h-4 w-px bg-slate-800"></div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">experiments /</span>
            <span className="text-white font-medium flex items-center gap-2 cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition-colors">
              Boot Sequence.cmb
              <ChevronDown size={14} className="text-slate-500" />
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-[#1a1a2e] rounded-md border border-slate-800 p-1">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors">
              <Plus size={14} />
              Add Cell
              <ChevronDown size={12} className="ml-1 opacity-70" />
            </button>
            <div className="w-px h-4 bg-slate-800 mx-1"></div>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#e94560]/10 text-[#e94560] hover:bg-[#e94560]/20 rounded transition-colors">
              <Play size={14} fill="currentColor" />
              Run All
            </button>
          </div>
          
          <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors" title="Save">
            <Save size={18} />
          </button>
        </div>
      </header>

      {/* Main Notebook Area */}
      <div className="flex-1 overflow-y-auto pb-48 custom-scrollbar">
        <div className="max-w-[860px] mx-auto w-full pt-12 flex flex-col gap-6 px-8">
          
          {/* Cell 1: Markdown */}
          <div className="group flex relative">
            <div className="w-12 shrink-0 flex flex-col items-center pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <GripVertical size={16} className="text-slate-600 cursor-grab hover:text-slate-300" />
            </div>
            <div className="flex-1 py-2 px-4">
              <h1 className="text-3xl font-semibold tracking-tight text-white mb-4">
                Boot Sequence — Step 1: Namespace Setup
              </h1>
              <p className="text-slate-400 leading-relaxed text-sm">
                In this experiment, we initialize the core capability registers required to establish the root namespace. 
                The Church Machine boots entirely empty, so we must manually construct the <code className="bg-[#0f0f23] px-1.5 py-0.5 rounded text-[#fbbf24] border border-slate-800">Boot.NS</code> gate 
                and map the initial instruction memory into <code className="bg-[#0f0f23] px-1.5 py-0.5 rounded text-[#e94560] border border-slate-800">CR0</code>.
              </p>
            </div>
          </div>

          {/* Cell 2: Code */}
          <div className="group flex relative">
            <div className="w-12 shrink-0 flex flex-col items-center pt-3 opacity-0 group-hover:opacity-100 transition-opacity gap-3">
              <GripVertical size={16} className="text-slate-600 cursor-grab hover:text-slate-300" />
              <FileCode size={16} className="text-[#fbbf24]" />
            </div>
            <div className="flex-1 bg-[#0f0f23] rounded-lg border border-slate-800/80 shadow-md overflow-hidden flex flex-col focus-within:border-[#fbbf24]/50 transition-colors">
              <div className="flex justify-between items-center px-4 py-2 border-b border-slate-800/50 bg-[#151525]">
                <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">Clooc Assembly</span>
                <div className="flex gap-2">
                  <button className="text-slate-500 hover:text-white transition-colors"><MoreHorizontal size={16} /></button>
                </div>
              </div>
              <div className="p-4 font-mono text-sm leading-relaxed relative group/code">
                <div className="absolute top-4 right-4 opacity-0 group-hover/code:opacity-100 transition-opacity">
                   <button className="flex items-center justify-center w-8 h-8 rounded-full bg-[#1a1a2e] border border-slate-700 text-[#fbbf24] hover:bg-[#fbbf24] hover:text-[#0f0f23] transition-all shadow-lg shadow-black/20">
                     <Play size={14} fill="currentColor" className="ml-0.5" />
                   </button>
                </div>
                <div className="flex text-slate-600 select-none">
                  <div className="w-8 text-right pr-4 border-r border-slate-800 mr-4 flex flex-col">
                    <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
                  </div>
                  <div className="flex-1 text-slate-300">
                    <div><span className="text-slate-500 italic"># Initialize CR0 with root memory capability</span></div>
                    <div><span className="text-[#fbbf24]">LOADI</span>  <span className="text-[#e94560]">CR0</span>,  <span className="text-[#60a5fa]">0x00000000</span></div>
                    <div><span className="text-[#fbbf24]">SETLIM</span> <span className="text-[#e94560]">CR0</span>,  <span className="text-[#60a5fa]">0x0000FFFF</span></div>
                    <div><span className="text-[#fbbf24]">SETPRM</span> <span className="text-[#e94560]">CR0</span>,  <span className="text-[#60a5fa]">0b1111</span>  <span className="text-slate-500 italic"># R|W|X|E</span></div>
                    <div><span className="text-[#fbbf24]">JMP</span>    <span className="text-[#e94560]">CR0</span>,  <span className="text-[#60a5fa]">0x0004</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Cell 3: Output */}
          <div className="group flex relative">
            <div className="w-12 shrink-0 flex flex-col items-center pt-3 opacity-0 group-hover:opacity-100 transition-opacity gap-3">
              <GripVertical size={16} className="text-slate-600 cursor-grab hover:text-slate-300" />
              <TerminalSquare size={16} className="text-emerald-500" />
            </div>
            <div className="flex-1 bg-[#151525] rounded-lg border border-emerald-900/30 overflow-hidden shadow-sm">
              <div className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-3">
                  <CheckCircle2 size={16} className="text-emerald-500" />
                  <span className="text-sm font-medium text-emerald-400">Execution successful</span>
                  <span className="text-slate-500 text-xs font-mono px-2 py-0.5 bg-[#0f0f23] rounded">12 cycles</span>
                  <span className="text-slate-500 text-xs font-mono px-2 py-0.5 bg-[#0f0f23] rounded">PC: 0x00400048</span>
                  <span className="text-slate-500 text-xs font-mono px-2 py-0.5 bg-[#0f0f23] rounded">0 faults</span>
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-1 font-mono">
                  View State <ChevronDown size={14} />
                </div>
              </div>
            </div>
          </div>

          {/* Cell 4: Code */}
          <div className="group flex relative">
            <div className="w-12 shrink-0 flex flex-col items-center pt-3 opacity-0 group-hover:opacity-100 transition-opacity gap-3">
              <GripVertical size={16} className="text-slate-600 cursor-grab hover:text-slate-300" />
              <FileCode size={16} className="text-[#fbbf24]" />
            </div>
            <div className="flex-1 bg-[#0f0f23] rounded-lg border border-slate-800/80 shadow-md overflow-hidden flex flex-col focus-within:border-[#fbbf24]/50 transition-colors">
              <div className="flex justify-between items-center px-4 py-2 border-b border-slate-800/50 bg-[#151525]">
                <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">Clooc Assembly</span>
                <div className="flex gap-2">
                  <button className="text-slate-500 hover:text-white transition-colors"><MoreHorizontal size={16} /></button>
                </div>
              </div>
              <div className="p-4 font-mono text-sm leading-relaxed relative group/code">
                <div className="absolute top-4 right-4 opacity-0 group-hover/code:opacity-100 transition-opacity">
                   <button className="flex items-center justify-center w-8 h-8 rounded-full bg-[#1a1a2e] border border-slate-700 text-[#fbbf24] hover:bg-[#fbbf24] hover:text-[#0f0f23] transition-all shadow-lg shadow-black/20">
                     <Play size={14} fill="currentColor" className="ml-0.5" />
                   </button>
                </div>
                <div className="flex text-slate-600 select-none">
                  <div className="w-8 text-right pr-4 border-r border-slate-800 mr-4 flex flex-col">
                    <span>1</span><span>2</span><span>3</span>
                  </div>
                  <div className="flex-1 text-slate-300">
                    <div><span className="text-slate-500 italic"># Verify Gate construction</span></div>
                    <div><span className="text-[#fbbf24]">INSPECT</span>  <span className="text-[#e94560]">CR1</span></div>
                    <div><span className="text-[#fbbf24]">DUMP</span>     <span className="text-[#60a5fa]">REGISTERS</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Cell 5: Register Dump */}
          <div className="group flex relative">
            <div className="w-12 shrink-0 flex flex-col items-center pt-3 opacity-0 group-hover:opacity-100 transition-opacity gap-3">
              <GripVertical size={16} className="text-slate-600 cursor-grab hover:text-slate-300" />
              <ListOrdered size={16} className="text-blue-400" />
            </div>
            <div className="flex-1 bg-[#0f0f23] rounded-lg border border-slate-800 shadow-md overflow-hidden">
              <div className="flex justify-between items-center px-4 py-2 border-b border-slate-800/50 bg-[#151525]">
                <span className="text-xs font-mono text-slate-500 uppercase tracking-wider flex items-center gap-2">
                  <Activity size={12} className="text-blue-400" />
                  Machine State Snapshot
                </span>
                <span className="text-xs text-slate-500 font-mono">T=12</span>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs">
                  {/* Left Column CR0-CR7 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center py-1 border-b border-slate-800/50">
                      <span className="w-10 text-[#e94560] font-semibold">CR0</span>
                      <span className="w-6 text-slate-500">V</span>
                      <span className="flex-1 text-[#60a5fa] truncate" title="[ROOT_MEM] 0x00000000..0x0000FFFF (RWXE)">[ROOT_MEM] 0x00000000..0x0000FFFF (RWXE)</span>
                    </div>
                    <div className="flex items-center py-1 border-b border-slate-800/50">
                      <span className="w-10 text-[#e94560] font-semibold">CR1</span>
                      <span className="w-6 text-slate-500">V</span>
                      <span className="flex-1 text-[#fbbf24] truncate" title="[GATE] Boot.NS -> 0x0400">[GATE] Boot.NS {"->"} 0x0400</span>
                    </div>
                    <div className="flex items-center py-1 border-b border-slate-800/50 opacity-40">
                      <span className="w-10 text-[#e94560]">CR2</span>
                      <span className="w-6 text-slate-600">-</span>
                      <span className="flex-1 text-slate-500">NULL</span>
                    </div>
                    <div className="flex items-center py-1 border-b border-slate-800/50 opacity-40">
                      <span className="w-10 text-[#e94560]">CR3</span>
                      <span className="w-6 text-slate-600">-</span>
                      <span className="flex-1 text-slate-500">NULL</span>
                    </div>
                  </div>
                  
                  {/* Right Column DR0-DR7 */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center py-1 border-b border-slate-800/50">
                      <span className="w-10 text-emerald-400 font-semibold">DR0</span>
                      <span className="w-6 text-slate-500"></span>
                      <span className="flex-1 text-slate-300">0x00000000_00000000</span>
                    </div>
                    <div className="flex items-center py-1 border-b border-slate-800/50">
                      <span className="w-10 text-emerald-400 font-semibold">DR1</span>
                      <span className="w-6 text-slate-500"></span>
                      <span className="flex-1 text-slate-300">0x00000000_00000004</span>
                    </div>
                    <div className="flex items-center py-1 border-b border-slate-800/50">
                      <span className="w-10 text-emerald-400 font-semibold">DR2</span>
                      <span className="w-6 text-slate-500"></span>
                      <span className="flex-1 text-slate-300">0x00000000_0000FFFF</span>
                    </div>
                    <div className="flex items-center py-1 border-b border-slate-800/50">
                      <span className="w-10 text-emerald-400 font-semibold">DR3</span>
                      <span className="w-6 text-slate-500"></span>
                      <span className="flex-1 text-slate-300">0x00000000_0000000F</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Cell 6: Pipeline Trace */}
          <div className="group flex relative">
            <div className="w-12 shrink-0 flex flex-col items-center pt-3 opacity-0 group-hover:opacity-100 transition-opacity gap-3">
              <GripVertical size={16} className="text-slate-600 cursor-grab hover:text-slate-300" />
              <Cpu size={16} className="text-purple-400" />
            </div>
            <div className="flex-1 bg-[#0f0f23] rounded-lg border border-slate-800 shadow-md overflow-hidden">
              <div className="flex justify-between items-center px-4 py-2 border-b border-slate-800/50 bg-[#151525]">
                <span className="text-xs font-mono text-slate-500 uppercase tracking-wider flex items-center gap-2">
                  <Activity size={12} className="text-purple-400" />
                  Pipeline Trace
                </span>
                <span className="text-xs text-slate-500 font-mono">Cycles 8-12</span>
              </div>
              <div className="p-4 overflow-x-auto custom-scrollbar">
                <div className="min-w-[600px] font-mono text-[11px]">
                  {/* Header */}
                  <div className="flex text-slate-500 mb-2 border-b border-slate-800/50 pb-2">
                    <div className="w-16">Cycle</div>
                    <div className="flex-1 grid grid-cols-4 gap-2">
                      <div>FETCH</div>
                      <div>DECODE</div>
                      <div>READ</div>
                      <div>EXECUTE</div>
                    </div>
                  </div>
                  
                  {/* Rows */}
                  <div className="flex items-center py-1.5 hover:bg-white/[0.02]">
                    <div className="w-16 text-slate-400">08</div>
                    <div className="flex-1 grid grid-cols-4 gap-2">
                      <div className="bg-slate-800/50 text-slate-300 px-2 py-0.5 rounded border border-slate-700/50">0x0040: LOADI</div>
                      <div className="bg-slate-800/30 text-slate-500 px-2 py-0.5 rounded">-</div>
                      <div className="bg-slate-800/30 text-slate-500 px-2 py-0.5 rounded">-</div>
                      <div className="bg-slate-800/30 text-slate-500 px-2 py-0.5 rounded">-</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center py-1.5 hover:bg-white/[0.02]">
                    <div className="w-16 text-slate-400">09</div>
                    <div className="flex-1 grid grid-cols-4 gap-2">
                      <div className="bg-slate-800/50 text-slate-300 px-2 py-0.5 rounded border border-slate-700/50">0x0044: SETLIM</div>
                      <div className="bg-blue-900/20 text-blue-400 px-2 py-0.5 rounded border border-blue-900/50">LOADI CR0, 0</div>
                      <div className="bg-slate-800/30 text-slate-500 px-2 py-0.5 rounded">-</div>
                      <div className="bg-slate-800/30 text-slate-500 px-2 py-0.5 rounded">-</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center py-1.5 hover:bg-white/[0.02]">
                    <div className="w-16 text-slate-400">10</div>
                    <div className="flex-1 grid grid-cols-4 gap-2">
                      <div className="bg-slate-800/50 text-slate-300 px-2 py-0.5 rounded border border-slate-700/50">0x0048: SETPRM</div>
                      <div className="bg-blue-900/20 text-blue-400 px-2 py-0.5 rounded border border-blue-900/50">SETLIM CR0...</div>
                      <div className="bg-emerald-900/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-900/50">CR0 {"->"} REG</div>
                      <div className="bg-[#fbbf24]/10 text-[#fbbf24] px-2 py-0.5 rounded border border-[#fbbf24]/30">EX: LOADI</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Add Cell Helper */}
          <div className="flex justify-center py-8 opacity-0 hover:opacity-100 transition-opacity">
            <button className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 rounded-full text-sm font-medium transition-colors shadow-lg shadow-black/20">
              <Plus size={16} />
              Add Cell
            </button>
          </div>

        </div>
      </div>

      {/* Global styles for this mockup */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #1a1a2e;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
      `}} />
    </div>
  );
}
