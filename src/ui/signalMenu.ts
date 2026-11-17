/** Right-click entries of a signal (shared by the plot and the signal list). */

import type { SignalDef } from '../core/model/project';
import { actions } from '../state/store';
import type { MenuItem } from './ContextMenu';

export function signalMenuItems(s: SignalDef, multiFigure: boolean, fit?: () => void, rename?: () => void): MenuItem[] {
  const items: MenuItem[] = [];
  if (rename) items.push({ label: 'Rename', disabled: s.locked, onClick: rename });
  if (fit) items.push({ label: 'Fit view to this signal', onClick: fit });
  items.push(
    { label: s.style.visible ? 'Hide' : 'Show', onClick: () => actions.toggleVisible(s.id) },
    { label: s.locked ? 'Unlock' : 'Lock', onClick: () => actions.toggleLock(s.id) },
    { label: 'Duplicate', onClick: () => actions.duplicate(s.id) },
    { label: 'Copy', onClick: () => actions.copy(s.id) },
  );
  if (multiFigure) items.push({ label: 'Remove from this figure', onClick: () => actions.removeFromFigure(s.id) });
  items.push('separator', { label: 'Delete from project', danger: true, onClick: () => actions.deleteSignal(s.id) });
  return items;
}
