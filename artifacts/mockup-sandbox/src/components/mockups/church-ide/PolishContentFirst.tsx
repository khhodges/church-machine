import React, { useState } from 'react';
import {
  Play,
  Square,
  Pause,
  StepForward,
  ChevronDown,
  Activity,
  Zap,
  Code2,
  Cpu,
  Layers,
  Box,
  Database,
  Settings,
  HardDrive,
  Download,
  BookOpen,
  FileText,
  ArrowRight
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const PIPELINE_STAGES = [
  { id: 'FETCH',   label: 'FETCH',   pc: '0x00400078', active: false, stalled: false },
  { id: 'DECODE',  label: 'DECODE',  pc: '0x00400074', active: false, stalled: false },
  { id: 'EXECUTE', label: 'EXECUTE', pc: '0x00400070', active: true,  stalled: false },
  { id: 'COMMIT',  label: 'COMMIT',  pc: '0x0040006C', active: false, stalled: false },
  { id: 'RETIRE',  label: 'RETIRE',  pc: '0x00400068', active: false, stalled: false },
];

const MEMORY_ROWS = [
  { addr: '0x003FFFE0', words: '00000000 00000000 00000000 00000000', isPC: false },
  { addr: '0x003FFFF0', words: '00000000 00000000 00000000 00000000', isPC: false },
  { addr: '0x00400000', words: 'A93F0024 10004567 89AB0001 FFFFFFFF', isPC: false },
  { addr: '0x00400010', words: '00000002 00000004 00000008 00000010', isPC: false },
  { addr: '0x00400060', words: '1F000000 C0004800 00000003 00000007', isPC: false },
  { addr: '0x00400070', words: 'C8004800 00000000 C0004810 00000005', isPC: false },
  { addr: '0x00400078', words: 'A0001800 00000009 00000000 00000000', isPC: true  },
  { addr: '0x00400088', words: '00000000 00000000 00000000 00000000', isPC: false },
];

export function PolishContentFirst() {
  const [activeTab, setActiveTab] = useState('Create');
  const [machineState, setMachineState] = useState<'running' | 'paused' | 'fault'>('running');
  const [cycleCount] = useState(148092);
  const pc = '0x00400078';

  const tabs = [
    { id: 'Create',    icon: Code2    },
    { id: 'Simulator', icon: Activity },
    { id: 'Pipeline',  icon: Layers   },
    { id: 'Registers', icon: Box      },
    { id: 'Namespace', icon: Database },
  ];

  return (
    <div className="w-full h-screen flex flex-col font-sans overflow-hidden text-[#eaeaea]" style={{ backgroundColor: '#1a1a2e' }}>
      {/* 36px Toolbar */}
      <header
        className="h-[36px] flex items-center justify-between px-3 border-b-2"
        style={{
          background: 'linear-gradient(to right, #0f0f23, #1a1a2e)',
          borderBottomColor: '#e94560'
        }}
      >
        <div className="flex items-center space-x-6 h-full">
          {/* Logo */}
          <div className="flex items-center space-x-2 text-[#fbbf24]">
            <span className="font-bold text-lg leading-none mt-[2px]">λ</span>
            <span className="font-semibold text-[1rem] tracking-[1px] uppercase">Church Machine</span>
          </div>

          {/* Tab Strip */}
          <nav className="flex items-center h-full">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`h-full px-4 flex items-center space-x-1.5 text-sm transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'text-[#fbbf24] border-[#fbbf24]'
                    : 'text-[#a0a0a0] border-transparent hover:text-[#eaeaea]'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span>{tab.id}</span>
              </button>
            ))}

            {/* More Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className="h-full px-4 flex items-center space-x-1 text-sm text-[#a0a0a0] hover:text-[#eaeaea] border-b-2 border-transparent outline-none">
                <span>More</span>
                <ChevronDown className="w-3 h-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 bg-[#16213e] border-[#2d3748] text-[#eaeaea] rounded-none">
                <DropdownMenuLabel className="text-[#a0a0a0] text-xs uppercase">Review</DropdownMenuLabel>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><BookOpen className="w-4 h-4 mr-2" /> Abstractions</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><FileText className="w-4 h-4 mr-2" /> Tutorial</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><FileText className="w-4 h-4 mr-2" /> Reference</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><BookOpen className="w-4 h-4 mr-2" /> Docs</DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[#2d3748]" />
                <DropdownMenuLabel className="text-[#a0a0a0] text-xs uppercase">Hardware</DropdownMenuLabel>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><Cpu className="w-4 h-4 mr-2" /> Efinix Ti60 F225</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><Cpu className="w-4 h-4 mr-2" /> Tang Nano 20K</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><Cpu className="w-4 h-4 mr-2" /> Tang Nano 20K IoT</DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[#2d3748]" />
                <DropdownMenuLabel className="text-[#a0a0a0] text-xs uppercase">Configure &amp; Install</DropdownMenuLabel>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><Settings className="w-4 h-4 mr-2" /> Devices</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><Settings className="w-4 h-4 mr-2" /> GitHub</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><HardDrive className="w-4 h-4 mr-2" /> Builder</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><HardDrive className="w-4 h-4 mr-2" /> Lumps</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><Download className="w-4 h-4 mr-2" /> Import LUMP</DropdownMenuItem>
                <DropdownMenuItem className="focus:bg-[#0f3460] focus:text-white cursor-pointer"><HardDrive className="w-4 h-4 mr-2" /> Bitstreams</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>

        {/* Machine State Pill — always shows RUNNING/PAUSED/FAULT + PC + cycles */}
        <div className="flex items-center space-x-3">
          <div
            className="flex items-center space-x-2 px-2 py-0.5 rounded border border-[#2d3748] bg-[#0f0f23] cursor-pointer hover:bg-[#16213e] transition-colors"
            onClick={() => setMachineState(s => s === 'running' ? 'paused' : s === 'paused' ? 'fault' : 'running')}
          >
            {machineState === 'running' && (
              <>
                <div className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse shadow-[0_0_8px_#4ade80]" />
                <span className="text-[10px] font-bold text-[#4ade80] tracking-wider">RUNNING</span>
              </>
            )}
            {machineState === 'paused' && (
              <>
                <div className="w-2 h-2 rounded-full bg-[#fbbf24]" />
                <span className="text-[10px] font-bold text-[#fbbf24] tracking-wider">PAUSED</span>
              </>
            )}
            {machineState === 'fault' && (
              <>
                <div className="w-2 h-2 rounded-full bg-[#e94560] animate-pulse shadow-[0_0_8px_#e94560]" />
                <span className="text-[10px] font-bold text-[#e94560] tracking-wider">FAULT</span>
              </>
            )}
            <div className="h-3 w-px bg-[#2d3748] mx-0.5" />
            <span className="text-xs font-mono text-[#fbbf24]">{pc}</span>
            <div className="h-3 w-px bg-[#2d3748] mx-0.5" />
            <span className="text-xs font-mono text-[#a0a0a0] w-[8ch] text-right">
              {cycleCount.toLocaleString()}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-h-0 bg-[#16213e]">
        {/* 32px Contextual Panel Header */}
        <div className="h-[32px] bg-[#1e2a3a] border-b border-[#2d3748] flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center space-x-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#fbbf24]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[#eaeaea]">
              {activeTab}
            </span>
          </div>

          {/* Contextual controls */}
          <div className="flex items-center space-x-1">
            {activeTab === 'Create' && (
              <>
                <button className="px-3 h-6 flex items-center space-x-1.5 bg-[#0f3460] hover:bg-[#1a4a8a] text-white text-xs rounded transition-colors border border-[#2d3748]">
                  <Download className="w-3 h-3" />
                  <span>Build</span>
                </button>
                <button className="px-3 h-6 flex items-center space-x-1.5 bg-[#e94560] hover:bg-[#ff5a75] text-white text-xs rounded transition-colors ml-2 shadow-[0_0_10px_rgba(233,69,96,0.3)]">
                  <Play className="w-3 h-3" />
                  <span>Deploy to Simulator</span>
                </button>
              </>
            )}
            {activeTab === 'Simulator' && (
              <>
                <button className="w-7 h-6 flex items-center justify-center text-[#a0a0a0] hover:text-white hover:bg-[#2d3748] rounded transition-colors">
                  <Play className="w-3.5 h-3.5" />
                </button>
                <button className="w-7 h-6 flex items-center justify-center text-[#a0a0a0] hover:text-white hover:bg-[#2d3748] rounded transition-colors">
                  <Pause className="w-3.5 h-3.5" />
                </button>
                <button className="w-7 h-6 flex items-center justify-center text-[#a0a0a0] hover:text-white hover:bg-[#2d3748] rounded transition-colors">
                  <StepForward className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-[#2d3748] mx-1" />
                <button className="w-7 h-6 flex items-center justify-center text-[#e94560] hover:bg-[#2d3748] rounded transition-colors">
                  <Zap className="w-3.5 h-3.5" />
                </button>
                <button className="w-7 h-6 flex items-center justify-center text-[#a0a0a0] hover:text-white hover:bg-[#2d3748] rounded transition-colors">
                  <Square className="w-3 h-3" />
                </button>
              </>
            )}
            {activeTab === 'Pipeline' && (
              <span className="text-[10px] font-mono text-[#a0a0a0] tracking-wider">EXECUTE stage active — 0 stalls</span>
            )}
          </div>
        </div>

        {/* Panel Content */}
        <div className="flex-1 overflow-hidden p-4 relative">

          {/* ── CREATE TAB — enriched assembly editor ── */}
          {activeTab === 'Create' && (
            <div className="absolute inset-4 bg-[#0f3460] border border-[#2d3748] rounded shadow-inner font-mono text-sm overflow-hidden flex flex-col">
              {/* File tabs */}
              <div className="h-8 bg-[#0a2548] border-b border-[#2d3748] flex items-center px-4 text-xs text-[#a0a0a0] space-x-4 shrink-0">
                <span className="text-[#eaeaea] border-b border-[#fbbf24] h-full flex items-center pt-px">boot.cloomc</span>
                <span className="hover:text-[#eaeaea] cursor-pointer transition-colors">init.cloomc</span>
                <span className="hover:text-[#eaeaea] cursor-pointer transition-colors">math.cloomc</span>
              </div>
              {/* Code body */}
              <div className="flex-1 overflow-auto p-4 leading-relaxed text-xs">
                <div className="flex">
                  {/* Line numbers */}
                  <div className="w-8 text-right pr-4 text-[#2d3748] select-none leading-[1.65rem]">
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(n => (
                      <div key={n}>{n}</div>
                    ))}
                  </div>
                  {/* Code */}
                  <div className="flex-1 whitespace-pre leading-[1.65rem]">
                    <span className="text-[#a0a0a0] italic">; Church Machine Boot Sequence — System.Boot namespace</span>{'\n'}
                    <span className="text-[#a0a0a0] italic">; Initializes root namespace, mounts LUMP 0, enters init thread</span>{'\n'}
                    {'\n'}
                    <span className="text-[#60a5fa] font-bold">.namespace</span> <span className="text-[#eaeaea]">System.Boot</span>{'\n'}
                    <span className="text-[#60a5fa] font-bold">.entry</span>     <span className="text-[#eaeaea]">start</span>{'\n'}
                    {'\n'}
                    <span className="text-[#eaeaea]">start:</span>{'\n'}
                    {'    '}<span className="text-[#60a5fa]">LOAD</span>   <span className="text-[#eaeaea]">DR0</span>, <span className="text-[#fbbf24]">0x00000000</span>        <span className="text-[#a0a0a0] italic">; base of boot ROM</span>{'\n'}
                    {'    '}<span className="text-[#60a5fa]">LOAD</span>   <span className="text-[#eaeaea]">DR1</span>, [<span className="text-[#eaeaea]">DR0</span>+<span className="text-[#4ade80]">4</span>]            <span className="text-[#a0a0a0] italic">; lump count word</span>{'\n'}
                    {'    '}<span className="text-[#60a5fa]">CMP</span>    <span className="text-[#eaeaea]">DR1</span>, <span className="text-[#4ade80]">0</span>                 <span className="text-[#a0a0a0] italic">; any LUMPs present?</span>{'\n'}
                    {'    '}<span className="text-[#60a5fa]">JEQ</span>    <span className="text-[#eaeaea]">fault_no_lump</span>            <span className="text-[#a0a0a0] italic">; halt if none found</span>{'\n'}
                    {'\n'}
                    {'    '}<span className="text-[#a0a0a0] italic">; Create root namespace — stores capability in CR0</span>{'\n'}
                    {'    '}<span className="text-[#60a5fa]">CALL</span>   <span className="text-[#eaeaea]">System.Namespace.Create</span>{'\n'}
                    {'    '}<span className="text-[#60a5fa]">SAVE</span>   <span className="text-[#eaeaea]">CR0</span>, <span className="text-[#eaeaea]">DR2</span>                <span className="text-[#a0a0a0] italic">; CR0 = root ns cap</span>{'\n'}
                    {'\n'}
                    {'    '}<span className="text-[#a0a0a0] italic">; Mount LUMP 0 into root namespace slot 0</span>{'\n'}
                    {'    '}<span className="text-[#60a5fa]">LOAD</span>   <span className="text-[#eaeaea]">DR2</span>, <span className="text-[#4ade80]">0</span>                 <span className="text-[#a0a0a0] italic">; slot index</span>{'\n'}
                    {'    '}<span className="text-[#60a5fa]">MLOAD</span>  <span className="text-[#eaeaea]">CR0</span>, <span className="text-[#eaeaea]">DR0</span>, <span className="text-[#eaeaea]">DR2</span>            <span className="text-[#a0a0a0] italic">; mLoad lump → ns slot</span>{'\n'}
                    {'    '}<span className="text-[#60a5fa]">SAVE</span>   <span className="text-[#eaeaea]">CR1</span>, <span className="text-[#eaeaea]">DR3</span>                <span className="text-[#a0a0a0] italic">; CR1 = lump cap</span>{'\n'}
                    {'\n'}
                    {'    '}<span className="text-[#a0a0a0] italic">; Allocate initial stack frame — CR5 = stack cap</span>{'\n'}
                    {'    '}<span className="text-[#60a5fa]">LOAD</span>   <span className="text-[#eaeaea]">DR4</span>, <span className="text-[#fbbf24]">0x00002000</span>        <span className="text-[#a0a0a0] italic">; 8 KiB stack</span>{'\n'}
                    {'    '}<span className="text-[#60a5fa]">ALLOC</span>  <span className="text-[#eaeaea]">CR0</span>, <span className="text-[#eaeaea]">DR4</span>               <span className="text-[#a0a0a0] italic">; alloc in root ns</span>{'\n'}
                    {'    '}<span className="text-[#60a5fa]">SAVE</span>   <span className="text-[#eaeaea]">CR5</span>, <span className="text-[#eaeaea]">DR5</span>                <span className="text-[#a0a0a0] italic">; CR5 = stack cap</span>{'\n'}
                    {'\n'}
                    {'    '}<span className="text-[#60a5fa]">JMP</span>    <span className="text-[#eaeaea]">System.Init.Enter</span>        <span className="text-[#a0a0a0] italic">; hand off to init thread</span>{'\n'}
                    {'\n'}
                    <span className="text-[#eaeaea]">fault_no_lump:</span>{'\n'}
                    {'    '}<span className="text-[#e94560]">FAULT</span>  <span className="text-[#4ade80]">0x01</span>                  <span className="text-[#a0a0a0] italic">; ERR_NO_BOOT_LUMP</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── SIMULATOR TAB — two-column run state + memory map ── */}
          {activeTab === 'Simulator' && (
            <div className="absolute inset-4 flex gap-4 overflow-hidden">
              {/* Left: System state card */}
              <div className="w-[240px] shrink-0 bg-[#16213e] rounded-lg border border-[#2d3748] p-5 flex flex-col gap-5">
                <h2 className="text-[#fbbf24] font-mono font-bold flex items-center gap-2 border-b border-[#2d3748] pb-2 text-sm">
                  <span>λ</span> SYSTEM_STATE
                </h2>
                <div>
                  <div className="text-[#a0a0a0] text-[10px] font-mono mb-1 uppercase tracking-wider">Program Counter</div>
                  <div className="text-2xl font-mono text-[#fbbf24]">{pc}</div>
                </div>
                <div>
                  <div className="text-[#a0a0a0] text-[10px] font-mono mb-1 uppercase tracking-wider">Cycle Count</div>
                  <div className="text-xl font-mono text-[#eaeaea]">{cycleCount.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[#a0a0a0] text-[10px] font-mono mb-1 uppercase tracking-wider">Machine Status</div>
                  <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-[#0f3460] rounded border border-[#2d3748]">
                    <div className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse shrink-0" />
                    <span className="font-mono text-xs text-[#4ade80]">RUNNING_NORMAL</span>
                  </div>
                </div>
                <div>
                  <div className="text-[#a0a0a0] text-[10px] font-mono mb-1 uppercase tracking-wider">Faults</div>
                  <div className="text-xl font-mono text-[#eaeaea]">0</div>
                </div>
              </div>

              {/* Right: Memory map */}
              <div className="flex-1 bg-[#16213e] rounded-lg border border-[#2d3748] p-5 flex flex-col overflow-hidden">
                <h2 className="text-[#a0a0a0] font-mono text-xs mb-3 border-b border-[#2d3748] pb-2 uppercase tracking-wider">
                  Memory Map — Active Window
                </h2>
                <div className="flex-1 bg-[#0f3460] rounded border border-[#2d3748] p-3 font-mono text-xs overflow-y-auto">
                  <table className="w-full border-separate border-spacing-0">
                    <thead>
                      <tr className="text-[#a0a0a0]">
                        <th className="text-left pb-2 pr-6 font-normal">Address</th>
                        <th className="text-left pb-2 font-normal">Words</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MEMORY_ROWS.map(row => (
                        <tr
                          key={row.addr}
                          className={row.isPC ? 'border-l-2 border-[#fbbf24]' : ''}
                        >
                          <td className={`py-1 pr-6 ${row.isPC ? 'text-[#fbbf24] pl-2' : 'text-[#60a5fa]'}`}>
                            {row.addr}
                          </td>
                          <td className={row.isPC ? 'text-[#fbbf24]' : 'text-[#eaeaea]'}>
                            {row.words}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── PIPELINE TAB — 5-stage horizontal diagram ── */}
          {activeTab === 'Pipeline' && (
            <div className="absolute inset-4 bg-[#16213e] rounded-lg border border-[#2d3748] p-6 flex flex-col">
              <h2 className="text-[#a0a0a0] font-mono text-xs mb-6 border-b border-[#2d3748] pb-2 uppercase tracking-wider">
                Execution Pipeline — Cycle 148,092
              </h2>

              {/* Stage blocks */}
              <div className="flex items-start gap-0">
                {PIPELINE_STAGES.map((stage, idx) => (
                  <React.Fragment key={stage.id}>
                    <div className="flex flex-col items-center flex-1">
                      <div
                        className={`w-full rounded-lg border px-3 py-4 flex flex-col items-center gap-2 transition-colors ${
                          stage.active
                            ? 'bg-[#2a1f00] border-[#fbbf24] shadow-[0_0_12px_rgba(251,191,36,0.3)]'
                            : 'bg-[#0f3460] border-[#2d3748]'
                        }`}
                      >
                        <span className={`text-xs font-mono font-bold tracking-wider ${stage.active ? 'text-[#fbbf24]' : 'text-[#a0a0a0]'}`}>
                          {stage.label}
                        </span>
                        <span className={`text-[10px] font-mono ${stage.active ? 'text-[#fbbf24]' : 'text-[#60a5fa]'}`}>
                          {stage.pc}
                        </span>
                        {stage.active && (
                          <div className="flex items-center gap-1 mt-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
                            <span className="text-[9px] font-mono text-[#4ade80]">ACTIVE</span>
                          </div>
                        )}
                        {stage.stalled && (
                          <div className="flex items-center gap-1 mt-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-[#e94560]" />
                            <span className="text-[9px] font-mono text-[#e94560]">STALL</span>
                          </div>
                        )}
                      </div>
                    </div>
                    {idx < PIPELINE_STAGES.length - 1 && (
                      <div className="flex items-center pt-6 px-1">
                        <ArrowRight className="w-4 h-4 text-[#2d3748]" />
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>

              {/* Stage detail below */}
              <div className="mt-6 bg-[#0f3460] rounded border border-[#2d3748] p-4 font-mono text-xs">
                <div className="text-[#a0a0a0] mb-2 uppercase tracking-wider" style={{ fontSize: '10px' }}>Active Stage Detail — EXECUTE</div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-[#a0a0a0] mb-1" style={{ fontSize: '10px' }}>Instruction</div>
                    <div className="text-[#60a5fa]">MLOAD CR0, DR0, DR2</div>
                  </div>
                  <div>
                    <div className="text-[#a0a0a0] mb-1" style={{ fontSize: '10px' }}>ALU Op</div>
                    <div className="text-[#eaeaea]">CAP_DEREF</div>
                  </div>
                  <div>
                    <div className="text-[#a0a0a0] mb-1" style={{ fontSize: '10px' }}>Latency</div>
                    <div className="text-[#4ade80]">1 cy</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── REGISTERS / NAMESPACE stubs ── */}
          {(activeTab === 'Registers' || activeTab === 'Namespace') && (
            <div className="absolute inset-4 border border-[#2d3748] rounded bg-[#0f3460]/20 flex items-center justify-center text-[#a0a0a0]">
              <div className="text-center">
                <Box className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p className="text-sm">{activeTab} view</p>
                <p className="text-xs mt-2 opacity-50">Live data wired in a future iteration</p>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
