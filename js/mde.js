/* js/mde.js — shared EasyMDE builder, used by both the Notes journal
 * (js/notes.js) and the Compendium entry editor (js/compendium.js).
 */
(function (OSR) {
  'use strict';

  // Standard dark toolbar, "[" autocomplete, and "[ ]" wrap-selection. Pass
  // opts.onSubmit(cm) to make plain Enter fire it (Shift-Enter still newlines).
  function buildMDE(element, opts) {
    opts = opts || {};
    if (typeof EasyMDE === 'undefined') return null;
    const fa = (n, i, t) => ({ name: n, action: EasyMDE[i], className: 'fa-solid ' + t, title: n[0].toUpperCase() + n.slice(1) });
    const mde = new EasyMDE({
      element: element,
      autoDownloadFontAwesome: false,
      spellChecker: false,
      status: false,
      minHeight: opts.minHeight || '160px',
      placeholder: opts.placeholder || '',
      toolbar: [
        fa('bold', 'toggleBold', 'fa-bold'),
        fa('italic', 'toggleItalic', 'fa-italic'),
        fa('heading', 'toggleHeadingSmaller', 'fa-heading'),
        '|',
        fa('quote', 'toggleBlockquote', 'fa-quote-left'),
        fa('unordered-list', 'toggleUnorderedList', 'fa-list-ul'),
        fa('ordered-list', 'toggleOrderedList', 'fa-list-ol'),
        '|',
        fa('link', 'drawLink', 'fa-link'),
        fa('table', 'drawTable', 'fa-table-cells'),
        fa('code', 'toggleCodeBlock', 'fa-code'),
        '|',
        { name: 'preview', action: EasyMDE.togglePreview, className: 'fa-solid fa-eye no-disable', title: 'Toggle preview' }
      ]
    });
    const cm = mde.codemirror;
    // "[" autocomplete against the Compendium.
    cm.on('cursorActivity', c => OSR.acFromCM(c));
    cm.on('blur', () => setTimeout(() => { if (OSR.compAC && OSR.compAC.kind === 'cm') OSR.closeAC(); }, 120));
    // "[" / "]" with a selection wraps it in [ ] instead of replacing it.
    cm.on('keydown', (c, e) => {
      if (e.key !== '[' && e.key !== ']') return;
      if (e.ctrlKey || e.metaKey || e.altKey || !c.somethingSelected()) return;
      e.preventDefault();
      c.operation(() => {
        c.replaceSelections(c.getSelections().map(t => '[' + t + ']'), 'around');
        c.setSelections(c.listSelections().map(r => {
          const a = r.from(), h = r.to();
          return { anchor: { line: a.line, ch: a.ch + 1 }, head: { line: h.line, ch: h.ch - 1 } };
        }));
      });
    });
    if (opts.onSubmit) {
      cm.on('keydown', (c, e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || OSR.compAC) return;
        e.preventDefault();
        opts.onSubmit(c);
      });
    }
    return mde;
  }

  OSR.buildMDE = buildMDE;
})(window.OSR = window.OSR || {});
