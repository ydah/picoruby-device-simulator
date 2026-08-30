import { basicSetup } from 'codemirror';
import { StreamLanguage } from '@codemirror/language';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#070d19', color: '#e2e8f0' },
  '.cm-content': { fontFamily: '"SFMono-Regular", Consolas, monospace', fontSize: '14px', caretColor: '#5eead4' },
  '.cm-cursor': { borderLeftColor: '#5eead4' },
  '.cm-gutters': { backgroundColor: '#070d19', color: '#64748b', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#111827' },
  '&.cm-focused': { outline: '2px solid #14b8a6', outlineOffset: '-2px' },
});

export const createEditor = (parent: HTMLElement, document: string, onChange: (source: string) => void): EditorView => new EditorView({
  parent,
  state: EditorState.create({
    doc: document,
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      StreamLanguage.define(ruby),
      theme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
  }),
});
