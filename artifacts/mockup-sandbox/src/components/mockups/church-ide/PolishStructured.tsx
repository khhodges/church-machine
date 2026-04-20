import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Menu, Play, FastForward, RotateCcw, AlertTriangle, Zap, Footprints } from 'lucide-react';

const MENU_GROUPS = [
  {
    name: 'Develop',
    items: ['Create', 'Math', 'Namespace', 'Memory Dump']
  },
  {
    name: 'Test',
    items: ['Simulator', 'Data Registers', 'Gate Log', 'Machine State', 'Pipeline', 'Trace', 'GC']
  },
  {
    name: 'Review',
    items: ['Abstractions', 'Tutorial', 'Reference', 'Docs']
  },
  {
    name: 'Hardware',
    items: ['Efinix Ti60 F225', 'Tang Nano 20K', 'Tang Nano 20K IoT']
  },
  {
    name: 'Configure',
    items: ['Devices', 'GitHub']
  },
  {
    name: 'Install',
    items: ['Builder', 'Lumps', 'Import LUMP', 'Bitstreams']
  }
];

export function PolishStructured() {
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const [activeGroup, setActiveGroup] = useState('Test');
  const [activeItem, setActiveItem] = useState('Simulator');
  const [isHoveringBtn, setIsHoveringBtn] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeGroupData = MENU_GROUPS.find(g => g.name === activeGroup);

  useEffect(() => {
    return () => {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    };
  }, []);

  const handleBtnMouseEnter = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    if (!isMenuOpen) setIsHoveringBtn(true);
  };

  const handleBtnMouseLeave = () => {
    hoverTimeout.current = setTimeout(() => setIsHoveringBtn(false), 120);
  };

  const handleBtnClick = () => {
    setIsHoveringBtn(false);
    setIsMenuOpen(prev => !prev);
  };

  return (
    <div className="w-full h-screen flex flex-col font-sans text-[#eaeaea] bg-[#1a1a2e] overflow-hidden">
      {/* Toolbar */}
      <header className="flex-none h-14 flex items-center justify-between px-4 border-b-2 border-[#e94560] bg-gradient-to-b from-[#0f0f23] to-[#1a1a2e] relative z-20">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-[#fbbf24] font-bold text-lg tracking-[1px]">λ Church Machine</span>
          </div>

          {/* Hamburger button with hover popup */}
          <div className="relative">
            <button
              onClick={handleBtnClick}
              onMouseEnter={handleBtnMouseEnter}
              onMouseLeave={handleBtnMouseLeave}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm font-medium transition-colors border border-[#2d3748]
                ${isMenuOpen ? 'bg-[#0f3460] text-white' : 'bg-[#16213e] hover:bg-[#0f3460] text-[#eaeaea]'}`}
            >
              <Menu className="w-4 h-4" />
              <ChevronDown className="w-3.5 h-3.5 text-[#fbbf24]" />
            </button>

            {/* Hover popup — only when menu is closed */}
            {isHoveringBtn && !isMenuOpen && (
              <div
                className="absolute left-0 top-full mt-1.5 z-50 pointer-events-none"
                style={{ minWidth: '180px' }}
              >
                <div className="bg-[#16213e] border border-[#2d3748] rounded shadow-xl px-3 py-2 text-xs font-mono">
                  <div className="text-[#a0a0a0] mb-0.5 uppercase tracking-wider" style={{ fontSize: '10px' }}>Current view</div>
                  <div className="flex items-center gap-1">
                    <span className="text-[#fbbf24]">{activeGroup}</span>
                    <span className="text-[#2d3748]">›</span>
                    <span className="text-[#eaeaea]">{activeItem}</span>
                  </div>
                </div>
                {/* Arrow tip */}
                <div
                  className="absolute -top-[5px] left-3 w-2.5 h-2.5 bg-[#16213e] border-l border-t border-[#2d3748] rotate-45"
                  style={{ marginTop: '1px' }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Run Controls */}
          <div className="flex items-center gap-1 bg-[#16213e] p-1 rounded border border-[#2d3748]">
            <button className="h-[28px] px-3 flex items-center justify-center rounded hover:bg-[#0f3460] text-red-400 transition-colors" title="Fault">
              <Zap className="w-4 h-4" />
            </button>
            <button className="h-[28px] px-3 flex items-center justify-center rounded hover:bg-[#0f3460] transition-colors" title="Step">
              <Footprints className="w-4 h-4" />
            </button>
            <button className="h-[28px] px-3 flex items-center justify-center rounded hover:bg-[#0f3460] transition-colors" title="Walk">
              <Play className="w-4 h-4" />
            </button>
            <button className="h-[28px] px-3 flex items-center justify-center rounded hover:bg-[#0f3460] transition-colors" title="Run">
              <FastForward className="w-4 h-4" />
            </button>
            <div className="w-[1px] h-4 bg-[#2d3748] mx-1"></div>
            <button className="h-[28px] px-3 flex items-center justify-center rounded hover:bg-[#e94560] hover:text-white transition-colors text-[#a0a0a0]" title="Reset">
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Machine State Strip */}
          <div className="flex items-center gap-4 px-4 h-[28px] rounded bg-[#0f3460] border border-[#2d3748] text-xs font-mono font-medium">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse"></div>
              <span className="text-[#4ade80]">RUNNING</span>
            </div>
            <span className="text-[#a0a0a0]">|</span>
            <span className="text-[#fbbf24]">0x00400000</span>
            <span className="text-[#a0a0a0]">|</span>
            <span>12,847 cy</span>
            <span className="text-[#a0a0a0]">|</span>
            <span>0 faults</span>
          </div>
        </div>
      </header>

      {/* Active View Breadcrumb */}
      <div className="flex-none h-6 bg-[#0d0d1f] flex items-center px-4 border-b border-[#2d3748] text-xs font-mono text-[#a0a0a0]">
        <span>{activeGroup}</span>
        <span className="mx-2 text-[#2d3748]">›</span>
        <span className="text-[#eaeaea]">{activeItem}</span>
      </div>

      <div className="flex-1 relative flex">
        {/* Mega Menu Overlay */}
        {isMenuOpen && (
          <div className="absolute top-0 left-4 mt-2 w-[600px] h-[400px] bg-[#16213e] border border-[#2d3748] rounded-md shadow-2xl flex z-30 overflow-hidden">
            {/* Left Column: Groups */}
            <div className="w-1/3 bg-[#0f0f23] border-r border-[#2d3748] p-4 flex flex-col gap-1">
              {MENU_GROUPS.map(group => (
                <button
                  key={group.name}
                  onClick={() => setActiveGroup(group.name)}
                  className={`w-full text-left px-4 py-3 rounded text-sm font-medium transition-colors
                    ${activeGroup === group.name 
                      ? 'bg-[#16213e] text-[#fbbf24] border-l-2 border-[#fbbf24]' 
                      : 'text-[#a0a0a0] hover:bg-[#16213e] hover:text-[#eaeaea] border-l-2 border-transparent'}`}
                >
                  {group.name}
                </button>
              ))}
            </div>
            
            {/* Right Column: Items */}
            <div className="w-2/3 p-6 bg-[#16213e] overflow-y-auto">
              <h3 className="text-xs font-bold text-[#a0a0a0] uppercase tracking-wider mb-4 border-b border-[#2d3748] pb-2">
                {activeGroup} Views
              </h3>
              <div className="flex flex-col gap-2">
                {activeGroupData?.items.map(item => (
                  <button
                    key={item}
                    onClick={() => {
                      setActiveItem(item);
                      setIsMenuOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 rounded text-sm transition-colors
                      ${activeItem === item
                        ? 'bg-[#e94560] text-white'
                        : 'text-[#eaeaea] hover:bg-[#0f3460]'}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main Content Area - Simulator View */}
        <main className="flex-1 bg-[#1a1a2e] p-6 flex flex-col gap-6 overflow-hidden">
          <div className="grid grid-cols-3 gap-6 h-full">
            {/* Left Col: Run State & Controls */}
            <div className="col-span-1 bg-[#16213e] rounded-lg border border-[#2d3748] p-6 flex flex-col">
              <h2 className="text-[#fbbf24] font-mono font-bold mb-6 flex items-center gap-2 border-b border-[#2d3748] pb-2">
                <span className="text-xl">λ</span> SYSTEM_STATE
              </h2>
              
              <div className="space-y-6">
                <div>
                  <div className="text-[#a0a0a0] text-xs font-mono mb-1">PROGRAM_COUNTER</div>
                  <div className="text-3xl font-mono text-[#fbbf24]">0x00400000</div>
                </div>

                <div>
                  <div className="text-[#a0a0a0] text-xs font-mono mb-1">CYCLE_COUNT</div>
                  <div className="text-2xl font-mono text-[#eaeaea]">12,847</div>
                </div>

                <div>
                  <div className="text-[#a0a0a0] text-xs font-mono mb-1">MACHINE_STATUS</div>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#0f3460] rounded border border-[#2d3748]">
                    <div className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse"></div>
                    <span className="font-mono text-sm text-[#4ade80]">RUNNING_NORMAL</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Middle & Right Col: Memory / Log */}
            <div className="col-span-2 bg-[#16213e] rounded-lg border border-[#2d3748] p-6 flex flex-col">
              <h2 className="text-[#a0a0a0] font-mono text-sm mb-4 border-b border-[#2d3748] pb-2">
                MEMORY_MAP (ACTIVE)
              </h2>
              <div className="flex-1 bg-[#0f3460] rounded border border-[#2d3748] p-4 font-mono text-sm overflow-y-auto">
                <table className="w-full">
                  <tbody className="text-[#a0a0a0]">
                    <tr className="hover:bg-[#16213e] transition-colors"><td className="py-1 pr-4 text-[#60a5fa]">0x003FFFE0</td><td className="text-[#eaeaea]">00000000 00000000 00000000 00000000</td></tr>
                    <tr className="hover:bg-[#16213e] transition-colors"><td className="py-1 pr-4 text-[#60a5fa]">0x003FFFF0</td><td className="text-[#eaeaea]">00000000 00000000 00000000 00000000</td></tr>
                    <tr className="bg-[#1a1a2e] border-l-2 border-[#fbbf24]"><td className="py-1 pr-4 text-[#fbbf24] pl-2">0x00400000</td><td className="text-[#fbbf24]">A93F0024 10004567 89AB0001 FFFFFFFF</td></tr>
                    <tr className="hover:bg-[#16213e] transition-colors"><td className="py-1 pr-4 text-[#60a5fa]">0x00400010</td><td className="text-[#eaeaea]">00000002 00000004 00000008 00000010</td></tr>
                    <tr className="hover:bg-[#16213e] transition-colors"><td className="py-1 pr-4 text-[#60a5fa]">0x00400020</td><td className="text-[#eaeaea]">00000020 00000040 00000080 00000100</td></tr>
                    <tr className="hover:bg-[#16213e] transition-colors"><td className="py-1 pr-4 text-[#60a5fa]">0x00400030</td><td className="text-[#eaeaea]">00000200 00000400 00000800 00001000</td></tr>
                    <tr className="hover:bg-[#16213e] transition-colors"><td className="py-1 pr-4 text-[#60a5fa]">0x00400040</td><td className="text-[#eaeaea]">00002000 00004000 00008000 00010000</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
