import { KEYS } from "@excalidraw/common";
import {
  getTextColorRanges,
  getTextColorsUpdate,
  hasTextColors,
  newElementWith,
} from "@excalidraw/element";

import type {
  ExcalidrawTextElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { actionChangeStrokeColor } from "../actions/actionProperties";
import { exportScene } from "../scene/export";
import { API } from "../tests/helpers/api";
import { Keyboard } from "../tests/helpers/ui";
import { getTextEditor, updateTextEditor } from "../tests/queries/dom";
import { act, fireEvent, render, unmountComponent } from "../tests/test-utils";

const { h } = window;

unmountComponent();

const RED = "#e03131";
const BLUE = "#1971c2";

const getText = (id: string) =>
  h.elements.find(
    (element) => element.id === id,
  ) as NonDeleted<ExcalidrawTextElement>;

const pickColor = (color: string) =>
  act(() => {
    h.app.actionManager.executeAction(actionChangeStrokeColor, "ui", {
      color,
    });
  });

const editNewText = async (text: string) => {
  const element = API.createElement({ type: "text", text });
  API.setElements([element]);
  API.setSelectedElements([element]);
  Keyboard.keyPress(KEYS.ENTER);
  const editor = await getTextEditor();
  return { id: element.id, editor };
};

const undoKey = (editor: HTMLTextAreaElement, redo = false) =>
  fireEvent.keyDown(editor, {
    key: KEYS.Z,
    shiftKey: redo,
    [KEYS.CTRL_OR_CMD]: true,
  });

describe("ExcalidrawZ text colors in the text editor", () => {
  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("colors the whole text when all of it is selected, as when editing starts", async () => {
    const { id, editor } = await editNewText("hello world");
    editor.setSelectionRange(0, 11);

    pickColor(RED);

    expect(getText(id).strokeColor).toBe(RED);
    expect(hasTextColors(getText(id))).toBe(false);
  });

  it("colors only the selected part of the edited text", async () => {
    const { id, editor } = await editNewText("hello world");
    const { strokeColor } = getText(id);

    editor.setSelectionRange(6, 11);
    pickColor(RED);

    expect(getText(id).strokeColor).toBe(strokeColor);
    expect(getTextColorRanges(getText(id))).toEqual([
      { start: 6, end: 11, color: RED },
    ]);
    // the textarea's text goes transparent over the colored copy
    expect(editor.classList.contains("excalidraw-wysiwyg--text-colors")).toBe(
      true,
    );
    const spans = [
      ...document.querySelectorAll(".excalidraw-wysiwyg-text-colors span"),
    ] as HTMLSpanElement[];
    expect(spans.map((span) => span.textContent)).toEqual(["hello ", "world"]);
    expect(spans[0].style.color).toBe("");
    expect(spans[1].style.color).not.toBe("");
  });

  it("keeps the colors on the text as it's typed, and after editing", async () => {
    const { id, editor } = await editNewText("hello world");
    editor.setSelectionRange(6, 11);
    pickColor(RED);

    // typed at the end of the red word: continues it
    updateTextEditor(editor, "hello world!");
    expect(getTextColorRanges(getText(id))).toEqual([
      { start: 6, end: 12, color: RED },
    ]);

    Keyboard.exitTextEditor(editor);
    expect(h.state.editingTextElement).toBe(null);
    expect(getTextColorRanges(getText(id))).toEqual([
      { start: 6, end: 12, color: RED },
    ]);
    expect(document.querySelector(".excalidraw-wysiwyg-text-colors")).toBe(
      null,
    );
  });

  it("undoes and redoes coloring from the keyboard while editing", async () => {
    const { id, editor } = await editNewText("hello world");
    editor.setSelectionRange(6, 11);
    pickColor(RED);
    editor.setSelectionRange(0, 5);
    pickColor(BLUE);

    // handled (default prevented), instead of undoing typing
    expect(undoKey(editor)).toBe(false);
    expect(getTextColorRanges(getText(id))).toEqual([
      { start: 6, end: 11, color: RED },
    ]);
    undoKey(editor);
    expect(getTextColorRanges(getText(id))).toBe(null);

    undoKey(editor, true);
    expect(getTextColorRanges(getText(id))).toEqual([
      { start: 6, end: 11, color: RED },
    ]);

    // once the text changes, undo is the textarea's again
    updateTextEditor(editor, "hello world!");
    expect(undoKey(editor)).toBe(true);
  });

  it("gives a selected part back to the text's color", async () => {
    const { id, editor } = await editNewText("hello world");
    const { strokeColor } = getText(id);
    editor.setSelectionRange(6, 11);
    pickColor(RED);

    editor.setSelectionRange(6, 11);
    pickColor(strokeColor);

    expect(getTextColorRanges(getText(id))).toBe(null);
    expect(editor.classList.contains("excalidraw-wysiwyg--text-colors")).toBe(
      false,
    );
  });

  it("recolors the whole text, parts included, without a selection", async () => {
    const { id, editor } = await editNewText("hello world");
    editor.setSelectionRange(6, 11);
    pickColor(RED);

    editor.setSelectionRange(3, 3);
    pickColor(BLUE);

    expect(getText(id).strokeColor).toBe(BLUE);
    expect(hasTextColors(getText(id))).toBe(false);
  });

  it("recolors the whole text, parts included, when it's selected", async () => {
    const { id, editor } = await editNewText("hello world");
    const { strokeColor } = getText(id);
    editor.setSelectionRange(6, 11);
    pickColor(RED);
    Keyboard.exitTextEditor(editor);

    API.setSelectedElements([getText(id)]);
    // even in the color it already has
    pickColor(strokeColor);
    expect(hasTextColors(getText(id))).toBe(false);

    pickColor(BLUE);
    expect(getText(id).strokeColor).toBe(BLUE);
  });

  it("leaves plain text without any data", async () => {
    const { id, editor } = await editNewText("hello");

    updateTextEditor(editor, "hello world");
    Keyboard.exitTextEditor(editor);

    expect(getText(id).customData).toBe(undefined);
    expect(editor.classList.contains("excalidraw-wysiwyg--text-colors")).toBe(
      false,
    );
  });
});

describe("ExcalidrawZ text colors in SVG exports", () => {
  it("exports the colored parts as tspans", async () => {
    const text = API.createElement({ type: "text", text: "hello world" });
    const element = newElementWith(
      text,
      getTextColorsUpdate(text, text.originalText, [
        { start: 6, end: 11, color: RED },
      ]),
    );

    const svg = await exportScene({
      type: "svg",
      data: {
        elements: [element] as NonDeletedExcalidrawElement[],
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
      },
      config: { canvasBackgroundColor: false },
    });

    const spans = [...svg.querySelectorAll("text tspan")];
    expect(spans.map((span) => span.textContent)).toEqual(["hello ", "world"]);
    expect(spans[0].getAttribute("fill")).toBe(null);
    expect(spans[1].getAttribute("fill")).toBe(RED);
  });
});
