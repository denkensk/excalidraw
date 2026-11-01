import {
  KEYS,
  THEME,
  applyDarkModeFilter,
  hasRTLChars,
} from "@excalidraw/common";
import {
  getTextColorRanges,
  getTextColorsEditUpdate,
  getTextColorsUpdate,
  isTextElement,
  newElementWith,
} from "@excalidraw/element";

import type { TextColorRange } from "@excalidraw/element";
import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import type App from "../components/App";

/**
 * ExcalidrawZ: shows the colored parts of the text being edited.
 *
 * A textarea draws its text in one color, so while the text has colored
 * ranges the textarea's text goes transparent — it still handles typing,
 * input methods, selection and the caret — and a copy of it, laid out by the
 * same styles, draws the colors underneath.
 */

const COLORED_CLASS = "excalidraw-wysiwyg--text-colors";
const MIRROR_CLASS = "excalidraw-wysiwyg-text-colors";
const STYLE_ID = "excalidraw-wysiwyg-text-colors-style";
// the selection while the color picker has the focus (the textarea hides its own)
const INACTIVE_SELECTION_COLOR = "rgba(128, 128, 128, 0.3)";

type Selection = { start: number; end: number };

const editors = new WeakMap<
  object,
  { elementId: string; editable: HTMLTextAreaElement }
>();

/**
 * The part of the edited text that's selected, for the color picker to color
 * only that part (see actionChangeStrokeColor). All of the text selected — as
 * it is when editing starts — isn't a part: the whole element takes the color,
 * as it always did.
 */
export const getTextEditorSelection = (
  app: object,
  elementId: string,
): Selection | null => {
  const editor = editors.get(app);
  if (editor?.elementId !== elementId) {
    return null;
  }
  const { selectionStart: start, selectionEnd: end, value } = editor.editable;
  return start < end && (start > 0 || end < value.length)
    ? { start, end }
    : null;
};

const ensureStyles = (document: Document) => {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // the text fill only: the caret keeps the text's color
  style.textContent = `
.${COLORED_CLASS} { -webkit-text-fill-color: transparent; }
.${COLORED_CLASS}::selection {
  -webkit-text-fill-color: transparent;
  background-color: rgba(56, 132, 255, 0.3);
  background-color: color-mix(in srgb, Highlight 40%, transparent);
}`;
  document.head.appendChild(style);
};

type Snapshot = {
  text: string;
  strokeColor: string;
  ranges: readonly TextColorRange[];
};

const isSameRanges = (
  a: readonly TextColorRange[],
  b: readonly TextColorRange[],
) =>
  a.length === b.length &&
  a.every(
    (range, index) =>
      range.start === b[index].start &&
      range.end === b[index].end &&
      range.color === b[index].color,
  );

export const createTextColorEditor = ({
  app,
  element,
  editable,
}: {
  app: App;
  element: ExcalidrawTextElement;
  editable: HTMLTextAreaElement;
}) => {
  const ownerDocument = editable.ownerDocument;
  ensureStyles(ownerDocument);

  const mirror = ownerDocument.createElement("div");
  mirror.className = MIRROR_CLASS;
  mirror.setAttribute("aria-hidden", "true");

  const getElement = () => {
    const latest = app.scene.getElement(element.id);
    return latest && isTextElement(latest) ? latest : null;
  };

  const getSelection = (): Selection | null => {
    const { selectionStart, selectionEnd } = editable;
    return selectionStart < selectionEnd
      ? { start: selectionStart, end: selectionEnd }
      : null;
  };
  editors.set(app, { elementId: element.id, editable });

  // the text an input method is composing, which it underlines
  let composition: { start: number; length: number } | null = null;

  const render = () => {
    const latest = getElement();
    const text = editable.value;
    const ranges =
      latest && latest.originalText === text && !hasRTLChars(text)
        ? getTextColorRanges(latest)
        : null;
    const selection =
      ownerDocument.activeElement === editable ? null : getSelection();

    editable.classList.toggle(COLORED_CLASS, !!ranges);
    if (!ranges && !selection) {
      mirror.style.display = "none";
      mirror.replaceChildren();
      return;
    }
    mirror.style.display = "";

    const marked =
      ranges && composition
        ? {
            start: composition.start,
            end: Math.min(text.length, composition.start + composition.length),
          }
        : null;
    const boundaries = new Set([0, text.length]);
    for (const { start, end } of [
      ...(ranges ?? []),
      ...(selection ? [selection] : []),
      ...(marked ? [marked] : []),
    ]) {
      boundaries.add(start);
      boundaries.add(end);
    }
    const offsets = [...boundaries]
      .filter((offset) => offset >= 0 && offset <= text.length)
      .sort((a, b) => a - b);

    const isDarkMode = app.state.theme === THEME.DARK;
    const fragment = ownerDocument.createDocumentFragment();
    let rangeIndex = 0;
    for (let index = 0; index < offsets.length - 1; index++) {
      const from = offsets[index];
      const to = offsets[index + 1];
      const span = ownerDocument.createElement("span");
      span.textContent = text.slice(from, to);
      if (!ranges) {
        // the textarea draws the text: only the selection shows here
        span.style.color = "transparent";
      } else {
        while (rangeIndex < ranges.length && ranges[rangeIndex].end <= from) {
          rangeIndex++;
        }
        const range = ranges[rangeIndex];
        if (range && range.start <= from) {
          span.style.color = applyDarkModeFilter(range.color, isDarkMode);
        }
      }
      if (selection && from >= selection.start && to <= selection.end) {
        span.style.backgroundColor = INACTIVE_SELECTION_COLOR;
      }
      if (marked && from >= marked.start && to <= marked.end) {
        span.style.textDecoration = "underline";
      }
      fragment.appendChild(span);
    }
    mirror.replaceChildren(fragment);
    mirror.scrollTop = editable.scrollTop;
    mirror.scrollLeft = editable.scrollLeft;
  };

  const syncStyle = () => {
    mirror.style.cssText = editable.style.cssText;
    mirror.dir = editable.dir;
    mirror.style.pointerEvents = "none";
    mirror.style.userSelect = "none";
    render();
  };
  // the editor restyles the textarea as the text, zoom or theme change
  const styleObserver = new MutationObserver(syncStyle);
  styleObserver.observe(editable, {
    attributes: true,
    attributeFilter: ["style"],
  });

  // Undo/redo of coloring while the text stays as it was colored: the
  // textarea's own undo only knows about typing, and would undo that instead.
  const takeSnapshot = (): Snapshot | null => {
    const latest = getElement();
    return latest
      ? {
          text: latest.originalText,
          strokeColor: latest.strokeColor,
          ranges: getTextColorRanges(latest) ?? [],
        }
      : null;
  };
  let current = takeSnapshot();
  let undoStack: Snapshot[] = [];
  let redoStack: Snapshot[] = [];

  const trackColoring = () => {
    const next = takeSnapshot();
    if (!next) {
      return;
    }
    if (
      current &&
      next.text === current.text &&
      next.strokeColor === current.strokeColor
    ) {
      if (!isSameRanges(next.ranges, current.ranges)) {
        undoStack.push(current);
        redoStack = [];
      }
    } else {
      undoStack = [];
      redoStack = [];
    }
    current = next;
  };

  const restoreSnapshot = (snapshot: Snapshot) => {
    const latest = getElement();
    if (!latest) {
      return;
    }
    // not a new coloring to track
    current = snapshot;
    app.scene.replaceAllElements(
      app.scene
        .getElementsIncludingDeleted()
        .map((other) =>
          other.id === latest.id
            ? newElementWith(
                other,
                getTextColorsUpdate(
                  latest,
                  latest.originalText,
                  snapshot.ranges,
                ),
              )
            : other,
        ),
    );
  };

  const unsubscribeScene = app.scene.onUpdate(() => {
    trackColoring();
    render();
  });

  const onCompositionStart = () => {
    composition = { start: editable.selectionStart, length: 0 };
  };
  const onCompositionUpdate = (event: CompositionEvent) => {
    if (composition) {
      composition.length = event.data.length;
    }
  };
  const onCompositionEnd = () => {
    composition = null;
    render();
  };
  editable.addEventListener("compositionstart", onCompositionStart);
  editable.addEventListener("compositionupdate", onCompositionUpdate);
  editable.addEventListener("compositionend", onCompositionEnd);
  editable.addEventListener("focus", render);
  editable.addEventListener("blur", render);

  return {
    /** Puts the colors under the textarea, once it's in the document. */
    mount: () => {
      editable.parentNode?.insertBefore(mirror, editable);
      syncStyle();
    },
    /**
     * The element update keeping the colored ranges on the text after an
     * input, to apply along with the new text.
     */
    getEditUpdate: () => {
      const latest = getElement();
      return latest
        ? getTextColorsEditUpdate(latest, editable.value, editable.selectionEnd)
        : null;
    },
    /** Undo/redo of coloring; `true` when it handled the key. */
    handleKeyDown: (event: KeyboardEvent) => {
      if (
        !event[KEYS.CTRL_OR_CMD] ||
        event.altKey ||
        event.isComposing ||
        event.key.toLowerCase() !== KEYS.Z
      ) {
        return false;
      }
      const [from, to] = event.shiftKey
        ? [redoStack, undoStack]
        : [undoStack, redoStack];
      const snapshot = from[from.length - 1];
      const latest = getElement();
      if (
        !snapshot ||
        !current ||
        !latest ||
        snapshot.text !== latest.originalText ||
        snapshot.strokeColor !== latest.strokeColor
      ) {
        return false;
      }
      event.preventDefault();
      from.pop();
      to.push(current);
      restoreSnapshot(snapshot);
      return true;
    },
    destroy: () => {
      styleObserver.disconnect();
      unsubscribeScene();
      editable.removeEventListener("compositionstart", onCompositionStart);
      editable.removeEventListener("compositionupdate", onCompositionUpdate);
      editable.removeEventListener("compositionend", onCompositionEnd);
      editable.removeEventListener("focus", render);
      editable.removeEventListener("blur", render);
      editable.classList.remove(COLORED_CLASS);
      mirror.remove();
      if (editors.get(app)?.editable === editable) {
        editors.delete(app);
      }
    },
  };
};
