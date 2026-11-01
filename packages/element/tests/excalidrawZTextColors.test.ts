import {
  adjustTextColorRanges,
  getClearTextColorsUpdate,
  getColorTextRangeUpdate,
  getTextColorLines,
  getTextColorRanges,
  getTextColorsEditUpdate,
  getTextColorsUpdate,
  hasTextColors,
} from "../src/excalidrawZTextColors";

import type { TextColorRange } from "../src/excalidrawZTextColors";
import type { ExcalidrawTextElement } from "../src/types";

const BLACK = "#1e1e1e";
const RED = "#e03131";
const BLUE = "#1971c2";

type TestTextElement = Pick<
  ExcalidrawTextElement,
  "text" | "originalText" | "strokeColor" | "customData"
>;

/** A text element with `ranges` stored for its current text and color. */
const textWithColors = (
  originalText: string,
  ranges: TextColorRange[],
  {
    text = originalText,
    strokeColor = BLACK,
    customData,
  }: Partial<TestTextElement> = {},
): TestTextElement => {
  const base = { text, originalText, strokeColor, customData };
  return { ...base, ...getTextColorsUpdate(base, originalText, ranges) };
};

describe("excalidrawZ text colors", () => {
  describe("stored ranges", () => {
    it("apply while the text and the element's color are unchanged", () => {
      const element = textWithColors("hello world", [
        { start: 6, end: 11, color: RED },
      ]);

      expect(getTextColorRanges(element)).toEqual([
        { start: 6, end: 11, color: RED },
      ]);
    });

    it("stop applying once the text is edited behind their back", () => {
      const element = textWithColors("hello world", [
        { start: 6, end: 11, color: RED },
      ]);

      expect(
        getTextColorRanges({ ...element, originalText: "hello there" }),
      ).toBe(null);
      expect(
        getTextColorRanges({ ...element, originalText: "hello world!" }),
      ).toBe(null);
    });

    it("stop applying once the whole element is recolored", () => {
      const element = textWithColors("hello world", [
        { start: 6, end: 11, color: RED },
      ]);

      expect(getTextColorRanges({ ...element, strokeColor: BLUE })).toBe(null);
    });

    it("ignore malformed data", () => {
      const element = textWithColors("hello world", [
        { start: 6, end: 11, color: RED },
      ]);
      const stored = element.customData!.excalidrawZTextColors;

      for (const ranges of [
        // out of bounds
        { starts: [0], ends: [20], colors: [RED] },
        // overlapping
        { starts: [0, 4], ends: [5, 8], colors: [RED, BLUE] },
        // empty
        { starts: [3], ends: [3], colors: [RED] },
        // mismatched lengths
        { starts: [0], ends: [2], colors: [] },
        // not the stored shape
        [{ start: 0, end: 2, color: RED }],
      ]) {
        expect(
          getTextColorRanges({
            ...element,
            customData: { excalidrawZTextColors: { ...stored, ranges } },
          }),
        ).toBe(null);
      }
      expect(
        getTextColorRanges({
          ...element,
          customData: { excalidrawZTextColors: { ...stored, version: 2 } },
        }),
      ).toBe(null);
    });

    it("are stored in shapes ExcalidrawZ's native side can decode", () => {
      // its AnyCodable (ExcalidrawElementBase.swift) has no case for arrays of
      // objects: one anywhere in `customData` fails decoding the whole scene
      const hasArrayOfObjects = (value: unknown): boolean =>
        Array.isArray(value)
          ? value.some((item) => typeof item === "object" && item !== null)
          : typeof value === "object" && value !== null
          ? Object.values(value).some(hasArrayOfObjects)
          : false;
      const element = textWithColors("hello world", [
        { start: 0, end: 5, color: BLUE },
        { start: 6, end: 11, color: RED },
      ]);

      expect(element.customData!.excalidrawZTextColors.ranges).toEqual({
        starts: [0, 6],
        ends: [5, 11],
        colors: [BLUE, RED],
      });
      expect(hasArrayOfObjects(element.customData)).toBe(false);
    });

    it("leave other custom data alone, and no data when there are no ranges", () => {
      const element = textWithColors(
        "hello",
        [{ start: 0, end: 5, color: RED }],
        { customData: { other: 1 } },
      );
      expect(element.customData?.other).toBe(1);
      expect(hasTextColors(element)).toBe(true);

      expect(getTextColorsUpdate(element, "hello", [])).toEqual({
        customData: { other: 1 },
      });
      expect(
        getTextColorsUpdate(
          textWithColors("hello", [{ start: 0, end: 5, color: RED }]),
          "hello",
          [],
        ),
      ).toEqual({ customData: {} });
    });
  });

  describe("coloring a range", () => {
    const color = (
      element: TestTextElement,
      start: number,
      end: number,
      color: string,
    ) =>
      getTextColorRanges({
        ...element,
        ...getColorTextRangeUpdate(element, start, end, color),
      });

    it("colors the range", () => {
      expect(color(textWithColors("hello world", []), 6, 11, RED)).toEqual([
        { start: 6, end: 11, color: RED },
      ]);
    });

    it("splits the range it recolors part of", () => {
      const element = textWithColors("hello world", [
        { start: 0, end: 11, color: RED },
      ]);

      expect(color(element, 3, 7, BLUE)).toEqual([
        { start: 0, end: 3, color: RED },
        { start: 3, end: 7, color: BLUE },
        { start: 7, end: 11, color: RED },
      ]);
    });

    it("merges neighbors of the same color", () => {
      const element = textWithColors("hello world", [
        { start: 0, end: 3, color: RED },
        { start: 7, end: 11, color: RED },
      ]);

      expect(color(element, 3, 7, RED)).toEqual([
        { start: 0, end: 11, color: RED },
      ]);
    });

    it("gives the range back to the element's color", () => {
      const element = textWithColors("hello world", [
        { start: 0, end: 11, color: RED },
      ]);

      expect(color(element, 0, 6, BLACK)).toEqual([
        { start: 6, end: 11, color: RED },
      ]);
      expect(color(element, 0, 11, BLACK)).toBe(null);
    });

    it("never splits a character in two", () => {
      // "a😀b": the emoji is a surrogate pair at offsets 1-2
      expect(color(textWithColors("a😀b", []), 2, 4, RED)).toEqual([
        { start: 1, end: 4, color: RED },
      ]);
    });

    it("is cleared by recoloring the whole element", () => {
      const element = textWithColors(
        "hello",
        [{ start: 0, end: 5, color: RED }],
        { customData: { other: 1 } },
      );

      expect(getClearTextColorsUpdate(element)).toEqual({
        customData: { other: 1 },
      });
      expect(getClearTextColorsUpdate(textWithColors("hello", []))).toEqual({});
    });
  });

  describe("editing the text", () => {
    const red = (start: number, end: number) => ({ start, end, color: RED });

    it("shifts what follows the edit", () => {
      expect(
        adjustTextColorRanges([red(6, 11)], "hello world", "oh hello world", 3),
      ).toEqual([red(9, 14)]);
    });

    it("continues the color typed at the end of colored text", () => {
      expect(
        adjustTextColorRanges([red(6, 11)], "hello world", "hello world!", 12),
      ).toEqual([red(6, 12)]);
    });

    it("keeps the color of text typed inside colored text", () => {
      expect(
        adjustTextColorRanges([red(6, 11)], "hello world", "hello wo-rld", 9),
      ).toEqual([red(6, 12)]);
    });

    it("leaves text typed right before colored text in the element's color", () => {
      expect(
        adjustTextColorRanges([red(6, 11)], "hello world", "hello -world", 7),
      ).toEqual([red(7, 12)]);
    });

    it("gives text typed at the start of a line the color of that line", () => {
      expect(
        adjustTextColorRanges([red(4, 7)], "abc\ndef", "abc\nXdef", 5),
      ).toEqual([red(4, 8)]);
      expect(adjustTextColorRanges([red(0, 3)], "abc", "Xabc", 1)).toEqual([
        red(0, 4),
      ]);
    });

    it("continues the color on a line started at the end of colored text", () => {
      const afterEnter = adjustTextColorRanges([red(0, 3)], "abc", "abc\n", 4);
      expect(afterEnter).toEqual([red(0, 4)]);
      expect(adjustTextColorRanges(afterEnter, "abc\n", "abc\nd", 5)).toEqual([
        red(0, 5),
      ]);
    });

    it("shrinks colored text that's deleted from", () => {
      expect(
        adjustTextColorRanges([red(6, 11)], "hello world", "hello wd", 7),
      ).toEqual([red(6, 8)]);
      expect(
        adjustTextColorRanges([red(6, 11)], "hello world", "hello", 5),
      ).toEqual([]);
    });

    it("gives replacing text the color of what it replaces", () => {
      expect(
        adjustTextColorRanges([red(6, 11)], "hello world", "hello there", 11),
      ).toEqual([red(6, 11)]);
      expect(
        adjustTextColorRanges([red(0, 5)], "hello world", "hi world", 2),
      ).toEqual([red(0, 2)]);
    });

    it("tells where repeated characters were typed from the caret", () => {
      // "a" typed after a red "a" in "aa", or at the end of it
      expect(adjustTextColorRanges([red(0, 1)], "aa", "aaa", 2)).toEqual([
        red(0, 2),
      ]);
      expect(adjustTextColorRanges([red(0, 1)], "aa", "aaa", 3)).toEqual([
        red(0, 1),
      ]);
      // backspace on the middle one of three: the red last one stays
      expect(adjustTextColorRanges([red(2, 3)], "aaa", "aa", 1)).toEqual([
        red(1, 2),
      ]);
    });

    it("follows an input method replacing its composition", () => {
      // typing 你 at the end of red text: "n", "ni", then "你"
      let ranges = adjustTextColorRanges([red(0, 2)], "ab", "abn", 3);
      ranges = adjustTextColorRanges(ranges, "abn", "abni", 4);
      ranges = adjustTextColorRanges(ranges, "abni", "ab你", 3);
      expect(ranges).toEqual([red(0, 3)]);
    });

    it("updates the element's data as its text is edited", () => {
      const element = textWithColors("hello world", [red(6, 11)]);
      const update = getTextColorsEditUpdate(element, "hello world!", 12);

      expect(
        getTextColorRanges({
          ...element,
          originalText: "hello world!",
          ...update,
        }),
      ).toEqual([red(6, 12)]);
      // plain text keeps no data
      expect(
        getTextColorsEditUpdate(textWithColors("hello", []), "hello!", 6),
      ).toBe(null);
      // stale data goes away
      expect(
        getTextColorsEditUpdate(
          { ...element, strokeColor: BLUE },
          "hello world!",
          12,
        ),
      ).toEqual({ customData: {} });
    });
  });

  describe("rendered lines", () => {
    it("cut each line into runs of one color", () => {
      const element = textWithColors("hello world\nsecond line", [
        { start: 6, end: 18, color: RED },
      ]);

      expect(getTextColorLines(element)).toEqual([
        [
          { text: "hello ", color: null },
          { text: "world", color: RED },
        ],
        [
          { text: "second", color: RED },
          { text: " line", color: null },
        ],
      ]);
    });

    it("line up with text the wrapping broke into lines", () => {
      // wrapping replaced the spaces it broke at, and trimmed one
      const element = textWithColors(
        "hello  world wide",
        [{ start: 7, end: 17, color: RED }],
        { text: "hello\nworld\nwide" },
      );

      expect(getTextColorLines(element)).toEqual([
        [{ text: "hello", color: null }],
        [{ text: "world", color: RED }],
        [{ text: "wide", color: RED }],
      ]);
    });

    it("line up with text broken inside words", () => {
      const element = textWithColors(
        "中文测试文本",
        [{ start: 2, end: 4, color: RED }],
        {
          text: "中文测\n试文本",
        },
      );

      expect(getTextColorLines(element)).toEqual([
        [
          { text: "中文", color: null },
          { text: "测", color: RED },
        ],
        [
          { text: "试", color: RED },
          { text: "文本", color: null },
        ],
      ]);
    });

    it("are left to the plain renderer when they can't be trusted", () => {
      const ranges = [{ start: 0, end: 2, color: RED }];
      // no ranges
      expect(getTextColorLines(textWithColors("hello", []))).toBe(null);
      // `text` isn't `originalText` wrapped
      expect(
        getTextColorLines(textWithColors("hello", ranges, { text: "help" })),
      ).toBe(null);
      // right-to-left text
      expect(getTextColorLines(textWithColors("שלום", ranges))).toBe(null);
    });
  });
});
