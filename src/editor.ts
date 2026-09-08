import { minimalSetup } from 'codemirror';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#070d19', color: '#e2e8f0' },
  '.cm-content': { fontFamily: '"SFMono-Regular", Consolas, monospace', fontSize: '14px', caretColor: '#5eead4' },
  '.cm-cursor': { borderLeftColor: '#5eead4' },
  '.cm-gutters': { backgroundColor: '#070d19', color: '#94a3b8', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#111827' },
  '&.cm-focused': { outline: '2px solid #14b8a6', outlineOffset: '-2px' },
}, { dark: true });

const highlighting = HighlightStyle.define([
  { tag: tags.keyword, color: '#fda4af' },
  { tag: tags.string, color: '#99f6e4' },
  { tag: [tags.number, tags.bool, tags.null], color: '#fcd34d' },
  { tag: [tags.atom, tags.typeName, tags.className], color: '#7dd3fc' },
  { tag: tags.comment, color: '#94a3b8' },
]);

export const createEditor = (parent: HTMLElement, document: string, onChange: (source: string) => void): EditorView => new EditorView({
  parent,
  state: EditorState.create({
    doc: document,
    extensions: [
      minimalSetup,
      lineNumbers(),
      keymap.of([indentWithTab]),
      StreamLanguage.define(ruby),
      syntaxHighlighting(highlighting),
      theme,
      EditorView.contentAttributes.of({
        'aria-label': 'main.rb の Ruby コード',
        'aria-describedby': 'editor-help',
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
  }),
});
