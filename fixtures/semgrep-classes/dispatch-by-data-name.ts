// Annotated fixture for manifests/semgrep-classes/dispatch-by-data-name.yaml (TypeScript shapes).
import * as plugins from './plugins';
import registry from './registry';

type MenuId = 'file' | 'folder' | 'note';

export function Menu(onFile: () => void, onFolder: () => void, onNote: () => void) {
  const newItemActions: Record<MenuId, () => void> = {
    file: onFile,
    folder: onFolder,
    note: onNote,
  };
  // ok: cw-computed-method-call-js
  return (id: MenuId) => newItemActions[id]();
}

export function OpenKey(onFile: () => void) {
  const open: Record<string, () => void> = { file: onFile };
  // ruleid: cw-computed-method-call-js
  return (id: string) => open[id]();
}

export function Untyped(onFile: () => void) {
  const table = { file: onFile };
  // ruleid: cw-computed-method-call-js
  return (id: string) => table[id]();
}

export function FromNamespace(name: string) {
  // ruleid: cw-computed-method-call-js
  return plugins[name]();
}

export function FromGlobal(name: string) {
  // ruleid: cw-computed-method-call-js
  return (globalThis as any)[name]();
}

export function FromImported(name: string) {
  // ruleid: cw-computed-method-call-js
  return registry[name]();
}

export function FromThis(this: any, name: string) {
  // ruleid: cw-computed-method-call-js
  return this[name]();
}
