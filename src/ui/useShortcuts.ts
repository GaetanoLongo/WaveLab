/** Global keyboard shortcuts. Ignored while typing in form fields (native editing wins). */

import { useEffect } from 'react';
import { actions, editor, isDirty } from '../state/store';
import { openExportDialog, useExportDialog } from './export/ExportDialog';
import { openProject, saveProject } from './fileio';
import { anyDialogOpen } from './Modal';
import { useSpectrum } from './panels/SpectrumDialog';
import { usePwmDialog } from './panels/PwmDialog';
import { useRectifierDialog } from './panels/RectifierDialog';
import { useModulationDialog } from './panels/ModulationDialog';
import { useAnnotate } from './annotate';

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'color', 'button'].includes(t.type);
  return t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      // Save / Export / Open are intercepted even in fields so the browser dialogs never open.
      if (mod && k === 's') {
        e.preventDefault();
        if (e.shiftKey) openExportDialog();
        else void saveProject(false);
        return;
      }
      if (mod && k === 'o') {
        e.preventDefault();
        void openProject();
        return;
      }
      if (useExportDialog.getState().open || anyDialogOpen() || useSpectrum.getState().open || usePwmDialog.getState().open || useRectifierDialog.getState().open || useModulationDialog.getState().open || useAnnotate.getState().editing !== null) return; // modals handle their own keys
      if (isTyping(e.target)) return;

      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        actions.undo();
      } else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        actions.redo();
      } else if (mod && k === 'c') {
        if (window.getSelection()?.toString()) return; // let text copy work
        actions.copy();
      } else if (mod && k === 'v') {
        actions.paste();
      } else if (mod && k === 'd') {
        e.preventDefault();
        actions.duplicate();
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        const ann = useAnnotate.getState().selected;
        if (ann) {
          actions.deleteAnnotation(ann);
          useAnnotate.setState({ selected: null });
        } else actions.deleteSignal();
      } else if (e.key === 'Escape') {
        if (useAnnotate.getState().selected) useAnnotate.setState({ selected: null });
        else actions.select(null);
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty(editor.getState())) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);
}
