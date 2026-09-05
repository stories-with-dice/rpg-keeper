/* js/notes.js — campaign-wide Markdown journal composer.
 * Enter logs the current text to the Session Log and clears the box;
 * Shift-Enter inserts a newline. The unsent draft persists as state.notes.
 */
(function (OSR) {
  'use strict';
  const $ = OSR.$;

  let notesTimer = null;
  // Exposed on OSR: js/main.js's tab-click handler refreshes the CodeMirror
  // view when switching back to the Character tab.
  OSR.notesMDE = null;

  function submitNote() {
    if (!OSR.notesMDE) return;
    const text = OSR.notesMDE.value().trim();
    if (!text) return;
    OSR.pushNote('Journal', text, '', { md: true });
    OSR.notesMDE.value('');
    OSR.state.notes = '';
    OSR.save();
  }

  function renderNotes() {
    if (!OSR.notesMDE) { $('#notes-area').value = OSR.state.notes || ''; return; }
    if (!OSR.notesMDE.codemirror.hasFocus()) OSR.notesMDE.value(OSR.state.notes || '');
  }

  function wireNotes() {
    OSR.notesMDE = OSR.buildMDE($('#notes-area'), {
      minHeight: '150px',
      placeholder: 'Journal entry (Markdown)… Enter to log it, Shift-Enter for a new line',
      onSubmit: submitNote
    });
    if (!OSR.notesMDE) {
      const area = $('#notes-area');
      area.addEventListener('input', () => {
        OSR.state.notes = area.value;
        clearTimeout(notesTimer);
        notesTimer = setTimeout(OSR.save, 300);
      });
      area.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitNoteFromTextarea(area); }
      });
      area.addEventListener('blur', OSR.save);
      return;
    }
    OSR.notesMDE.codemirror.on('change', () => {
      OSR.state.notes = OSR.notesMDE.value();
      clearTimeout(notesTimer);
      notesTimer = setTimeout(OSR.save, 400);
    });
    OSR.notesMDE.codemirror.on('blur', OSR.save);
    renderNotes();
  }
  function submitNoteFromTextarea(area) {
    const text = area.value.trim();
    if (!text) return;
    OSR.pushNote('Journal', text, '', { md: true });
    area.value = ''; OSR.state.notes = ''; OSR.save();
  }

  Object.assign(OSR, { submitNote, renderNotes, wireNotes, submitNoteFromTextarea });
})(window.OSR = window.OSR || {});
