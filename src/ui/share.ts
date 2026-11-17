/** Share links in the interface: copy the link of the current project, open one from the address. */

import { LONG_LINK_CHARS, decodeShare, encodeShare, payloadFromHash, shareUrl } from '../core/io/share';
import { parseProjectFile, ProjectFileError, serializeProject } from '../core/io/project-file';
import { actions, editor, isDirty } from '../state/store';

const say = (notice: string) => editor.setState({ notice });

export async function copyShareLink(): Promise<void> {
  try {
    const st = editor.getState();
    if (st.project.signals.length === 0) return say('Nothing to share yet: add a waveform first.');
    const url = shareUrl(await encodeShare(serializeProject(st.project, actions.savedView())));
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      /* no clipboard permission: show the link instead */
    }
    if (!copied) window.prompt('Copy this link:', url);
    const long = url.length > LONG_LINK_CHARS ? ' It is long: some chat apps cut long links, in that case save the project file instead.' : '';
    say(`${copied ? 'Link copied' : 'Link ready'} (${url.length.toLocaleString('en')} characters). Anyone opening it gets this project; nothing is uploaded.${long}`);
  } catch (e) {
    say(`Could not make a link: ${(e as Error).message}`);
  }
}

/** If the address carries a shared project, open it (and remove it from the address). */
export async function openSharedFromAddress(): Promise<void> {
  const payload = payloadFromHash(location.hash);
  if (!payload) return;
  // Remove the fragment first: reloading must not overwrite later work with the shared project again.
  history.replaceState(null, '', location.pathname + location.search);
  try {
    if (isDirty(editor.getState()) && !window.confirm('Open the shared project and discard the current unsaved changes?')) return;
    const { project, view } = parseProjectFile(await decodeShare(payload));
    actions.loadProject(project, view);
    say('Opened a shared project. Save it to keep your own copy.');
  } catch (e) {
    const msg = e instanceof ProjectFileError ? e.message : (e as Error).message;
    say(`The shared link could not be opened: ${msg}`);
    window.alert(`The shared link could not be opened:\n\n${msg}`);
  }
}
