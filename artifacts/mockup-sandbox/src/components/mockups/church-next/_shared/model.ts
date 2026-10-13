export type View = 'namespace' | 'codeedit' | 'lump' | 'build' | 'thread-design' | 'namespace-design';
export type Artifact = { slot: string; version: number; source: string; id: string };
export type Slot = { name: string; kind: string; placed: number; bytes: number };
export type ThreadDraft = {
  name: string; bodyWords: number;
  registers: { register: number; value: string }[];
  capabilities: { register: number; target: string; policy: string }[];
};
export type NamespaceEntry = { id: number; name: string; node: string; slot: string; policy: string; boot: boolean };
export type NamespaceDraft = { name: string; ideNode: string; bootChoice: string; entries: NamespaceEntry[] };
export const initialThreadDraft = (): ThreadDraft => ({
  name: 'Boot.Thread', bodyWords: 256,
  registers: [{register: 0, value: '0'}, {register: 1, value: '0'}],
  capabilities: [{register: 0, target: 'UART_DEV', policy: 'write'}],
});
export const initialNamespaceDraft = (): NamespaceDraft => ({
  name: 'Boot.NS draft', ideNode: 'Wukong', bootChoice: 'Thread.2',
  entries: [
    {id: 1, name: 'Thread.2', node: 'Wukong', slot: '3', policy: 'Resident', boot: true},
    {id: 2, name: 'UART_DEV', node: 'Wukong', slot: '2', policy: 'Resident', boot: false},
  ],
});
export const initialSlots: Slot[] = [
  { name: 'Boot.NS', kind: 'Namespace', placed: 12, bytes: 384 },
  { name: 'Boot.Thread', kind: 'Thread', placed: 34, bytes: 608 },
  { name: 'UART_DEV', kind: 'Device', placed: 17, bytes: 192 },
  { name: 'SelfTest', kind: 'Program', placed: 98, bytes: 432 },
  { name: 'CapabilityTest', kind: 'Program', placed: 23, bytes: 368 },
];
export function sampleSource(name: string, version: number) {
  return `; ${name} · saved demo revision v${version}\n; Illustrative source — not assembler syntax\n\nobject ${name}\n  capability console : UART_DEV\n  capability thread  : Boot.Thread\n\nentry main\n  load    r1, ${version >= 99 ? '0x2A' : '0x01'}\n  call    console.write, r1\n  check   thread.permission, execute\n  return  success\n\n; No live capabilities are resolved in this demo`;
}
export function initialArtifacts(): Artifact[] {
  return initialSlots.flatMap(s => [s.placed, ...(s.name === 'SelfTest' ? [99] : [])].map(version => ({ slot: s.name, version, source: sampleSource(s.name, version), id: `DEMO-${s.name}-${version}` })));
}
export const disassembly = `; EXAMPLE DISASSEMBLY — illustrative bytes\n; Not produced by a Church Machine assembler\n\n0000  01 10 00 01   LOAD    r1, immediate\n0004  20 02 01 00   CALL    c2.write, r1\n0008  31 03 00 04   CHECK   c3, execute\n000C  40 00 00 00   RETURN  success\n\n; Symbolic operations explain intent only.\n; Addresses and opcodes are sample values.`;
export const hex = `Offset    Example bytes\n────────  ───────────────────────\n00000000  4C 55 4D 50  01 00 00 00\n00000008  10 00 00 00  02 00 00 00\n00000010  01 10 00 01  20 02 01 00\n00000018  31 03 00 04  40 00 00 00\n\nDEMO fixture, not a valid binary encoding.\nNo header or ISA conformance is implied.`;
export type DemoSnapshot = { id: string; slots: Slot[]; target: string; clock: string };
