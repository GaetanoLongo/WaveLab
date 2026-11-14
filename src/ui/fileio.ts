/**
 * Save / Open of .wlab files in the browser.
 *  - Chromium-based browsers: File System Access API (real "Save" to the same file).
 *  - Other browsers: Save downloads a file; Open uses a file chooser.
 */

import { FILE_EXTENSION } from '../core/model/project';
import { parseProjectFile, ProjectFileError, serializeProject } from '../core/io/project-file';
import { plainText } from '../core/plot/mathtext';
import { actions, editor, isDirty } from '../state/store';

interface FsHandle {
  name: string;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
  getFile(): Promise<File>;
}
type W = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<FsHandle>;
  showOpenFilePicker?: (o: unknown) => Promise<FsHandle[]>;
};

const PICKER_TYPES = [{ description: 'WaveLab project', accept: { 'application/json': [FILE_EXTENSION] } }];

/** File the project was last opened from / saved to (enables plain "Save"). */
let currentHandle: FsHandle | null = null;

export function forgetFileHandle() {
  currentHandle = null;
}

export function safeFileName(name: string): string {
  return plainText(name).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'waveform';
}

function say(notice: string) {
  editor.setState({ notice });
}

export async function saveProject(saveAs = false): Promise<void> {
  const w = window as W;
  try {
    if (w.showSaveFilePicker) {
      if (!currentHandle || saveAs) {
        currentHandle = await w.showSaveFilePicker({
          suggestedName: safeFileName(editor.getState().project.name) + FILE_EXTENSION,
          types: PICKER_TYPES,
        });
        const base = currentHandle.name.replace(/\.wlab$/i, '');
        if (base && base !== editor.getState().project.name) actions.renameProject(base);
      }
      const text = serializeProject(editor.getState().project, actions.savedView());
      const out = await currentHandle.createWritable();
      await out.write(text);
      await out.close();
      actions.markSaved();
      say(`Saved to ${currentHandle.name}`);
    } else {
      const text = serializeProject(editor.getState().project, actions.savedView());
      const name = safeFileName(editor.getState().project.name) + FILE_EXTENSION;
      downloadBlob(new Blob([text], { type: 'application/json' }), name);
      actions.markSaved();
      say(`Downloaded ${name}`);
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return; // user cancelled the dialog
    say(`Save failed: ${(e as Error).message}`);
  }
}

export async function openProject(): Promise<void> {
  if (isDirty(editor.getState()) && !window.confirm('Discard unsaved changes?')) return;
  const w = window as W;
  try {
    if (w.showOpenFilePicker) {
      const [h] = await w.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
      if (!h) return;
      await loadFile(await h.getFile(), h);
    } else {
      const file = await chooseFile();
      if (file) await loadFile(file, null);
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    say(`Open failed: ${(e as Error).message}`);
  }
}

/** Load a .wlab File object (also used for drag-and-drop). */
export async function loadFile(file: File, handle: FsHandle | null): Promise<boolean> {
  try {
    const { project, view } = parseProjectFile(await file.text());
    actions.loadProject(project, view);
    currentHandle = handle;
    say(`Opened ${file.name}`);
    return true;
  } catch (e) {
    const msg = e instanceof ProjectFileError ? e.message : `Could not read the file (${(e as Error).message}).`;
    say(`Open failed — ${msg}`);
    window.alert(`Could not open “${file.name}”:\n\n${msg}`);
    return false;
  }
}

function chooseFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${FILE_EXTENSION},application/json`;
    input.className = 'hidden-file-input';
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
