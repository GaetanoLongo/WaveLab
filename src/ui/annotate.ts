/** UI state for annotations: the placement tool and the selected annotation. */

import { create } from 'zustand';

export type AnnotateTool = 'text' | 'arrow' | 'dim-t' | 'dim-y';

export const useAnnotate = create<{ tool: AnnotateTool | null; selected: string | null; editing: string | null }>(() => ({
  tool: null,
  selected: null,
  editing: null,
}));

export const setAnnotateTool = (tool: AnnotateTool | null) => useAnnotate.setState({ tool, selected: null });
export const selectAnnotation = (id: string | null) => useAnnotate.setState({ selected: id });
export const editAnnotation = (id: string | null) => useAnnotate.setState({ editing: id, selected: id });
