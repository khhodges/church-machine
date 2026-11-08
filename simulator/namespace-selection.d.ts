export {};
declare global {
  var NamespaceSelection: {
    read(): string | null;
    remember(id: string): void;
    name(id: string, fallback: string): string;
    current(): string | null;
    select(id: string): boolean;
    designKey: string;
  };
}
