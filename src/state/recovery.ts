/**
 * Recovery copy: while the project has unsaved changes, a copy (same format as a .wlab
 * file) is kept in this browser's localStorage, so a crash, a closed tab or a file that
 * cannot be reopened never loses the work. It is removed once the project is saved or
 * the changes are discarded. Stored on this device only.
 */

import { create } from 'zustand';
import { emptyProject } from '../core/model/project';
import { parseProjectFile, serializeProject } from '../core/io/project-file';
import { actions, editor, isDirty } from './store';

const KEY = 'wavelab.recovery';

interface Stored {
  savedAt: number;
  name: string;
  file: string;
}

/** A recovery copy found at start-up (shown as a banner until restored or discarded). */
export const useRecovery = create<{ found: Stored | null }>(() => ({ found: null }));

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    return typeof s.file === 'string' && typeof s.savedAt === 'number' ? s : null;
  } catch {
    return null;
  }
}

function write(s: Stored | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage full or blocked: recovery is best effort.
  }
}

let started = false;

/** Look for a previous copy, then keep the copy up to date (debounced). */
export function startRecovery(): void {
  if (started) return;
  started = true;
  const found = read();
  if (found) useRecovery.setState({ found });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    // Never overwrite a copy the user has not decided about yet.
    if (useRecovery.getState().found) return;
    const st = editor.getState();
    if (!isDirty(st)) write(null);
    else write({ savedAt: Date.now(), name: st.project.name, file: serializeProject(st.project, actions.savedView()) });
  };
  editor.subscribe((s, prev) => {
    if (s.project === prev.project && s.savedProject === prev.savedProject) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 800);
  });
  window.addEventListener('pagehide', flush);
}

export function restoreRecovery(): void {
  const found = useRecovery.getState().found;
  useRecovery.setState({ found: null });
  if (!found) return;
  try {
    const { project, view } = parseProjectFile(found.file);
    actions.loadProject(project, view);
    // Restored work is unsaved by definition.
    editor.setState({ savedProject: emptyProject(), notice: 'Unsaved work restored. Save it to keep it.' });
  } catch (e) {
    editor.setState({ notice: `The recovery copy could not be read (${(e as Error).message}).` });
    write(null);
  }
}

export function discardRecovery(): void {
  useRecovery.setState({ found: null });
  write(null);
}
