import { SVG_NS, applyDarkModeFilter, hasRTLChars } from "@excalidraw/common";

import type { ExcalidrawElement, ExcalidrawTextElement } from "./types";

/**
 * ExcalidrawZ: colors for parts of a text element's text.
 *
 * Stored in `customData`, which other Excalidraw clients keep but ignore, as
 * ranges of `originalText` — so re-wrapping the text (resizing, font changes)
 * never moves them. They describe one exact text and element color: once the
 * text is edited by something that doesn't keep them up to date, or the whole
 * element is recolored, they no longer apply and the text is drawn in the
 * element's color alone.
 */
const TEXT_COLORS_KEY = "excalidrawZTextColors";

export type TextColorRange = Readonly<{
  /** offset into `originalText` (UTF-16 code units), inclusive */
  start: number;
  /** offset into `originalText` (UTF-16 code units), exclusive */
  end: number;
  color: string;
}>;

/** A run of a rendered line in one color (`null`: the element's color). */
export type TextColorSegment = Readonly<{
  text: string;
  color: string | null;
}>;

type StoredTextColors = {
  version: 1;
  /** the element's `strokeColor` the ranges were written against */
  baseColor: string;
  textLength: number;
  textHash: string;
  /**
   * Parallel arrays rather than an array of objects: ExcalidrawZ's native side
   * decodes `customData` with a JSON type that has no case for arrays of
   * objects (AnyCodable in ExcalidrawElementBase.swift), and would fail to
   * read the whole scene on one.
   */
  ranges: { starts: number[]; ends: number[]; colors: string[] };
};

type TextColorsElement = Pick<
  ExcalidrawTextElement,
  "originalText" | "strokeColor" | "customData"
>;

/** FNV-1a over the UTF-16 code units: cheap, and enough to spot a changed text */
const hashText = (text: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const isSameColor = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

/** The stored ranges, when well-formed for a text of `textLength`. */
const parseRanges = (
  stored: Partial<StoredTextColors["ranges"]> | undefined,
  textLength: number,
): TextColorRange[] | null => {
  const { starts, ends, colors } = stored ?? {};
  if (
    !Array.isArray(starts) ||
    !Array.isArray(ends) ||
    !Array.isArray(colors) ||
    starts.length !== ends.length ||
    starts.length !== colors.length
  ) {
    return null;
  }
  const ranges: TextColorRange[] = [];
  let previousEnd = 0;
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    const end = ends[index];
    const color = colors[index];
    if (
      typeof color !== "string" ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < previousEnd ||
      end <= start ||
      end > textLength
    ) {
      return null;
    }
    ranges.push({ start, end, color });
    previousEnd = end;
  }
  return ranges;
};

/** Sorted, in bounds, non-empty, non-overlapping, same-color neighbors merged. */
const normalizeRanges = (
  ranges: readonly TextColorRange[],
  textLength: number,
) => {
  const normalized: TextColorRange[] = [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (const range of sorted) {
    const last = normalized[normalized.length - 1];
    const start = Math.max(0, range.start, last ? last.end : 0);
    const end = Math.min(textLength, range.end);
    if (end <= start) {
      continue;
    }
    if (last && last.end === start && isSameColor(last.color, range.color)) {
      normalized[normalized.length - 1] = { ...last, end };
    } else {
      normalized.push({ start, end, color: range.color });
    }
  }
  return normalized;
};

const isInsideSurrogatePair = (text: string, offset: number) => {
  if (offset <= 0 || offset >= text.length) {
    return false;
  }
  const high = text.charCodeAt(offset - 1);
  const low = text.charCodeAt(offset);
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
};

export const hasTextColors = (element: Pick<ExcalidrawElement, "customData">) =>
  !!element.customData && TEXT_COLORS_KEY in element.customData;

/**
 * The colored ranges of the element's text, or `null` when it has none that
 * still apply.
 */
export const getTextColorRanges = (
  element: TextColorsElement,
): readonly TextColorRange[] | null => {
  const stored: StoredTextColors | undefined =
    element.customData?.[TEXT_COLORS_KEY];
  const { originalText } = element;
  if (
    !stored ||
    stored.version !== 1 ||
    typeof stored.baseColor !== "string" ||
    !isSameColor(stored.baseColor, element.strokeColor) ||
    stored.textLength !== originalText.length ||
    stored.textHash !== hashText(originalText)
  ) {
    return null;
  }
  const ranges = parseRanges(stored.ranges, originalText.length);
  return ranges?.length ? ranges : null;
};

/**
 * The element update storing `ranges` for `text` (the element's
 * `originalText`, current or about to be). No ranges leave no data behind
 * (but an empty `customData`: newElementWith skips `undefined` updates).
 */
export const getTextColorsUpdate = (
  element: Pick<ExcalidrawTextElement, "strokeColor" | "customData">,
  text: string,
  ranges: readonly TextColorRange[],
): { customData: ExcalidrawElement["customData"] } => {
  const { [TEXT_COLORS_KEY]: _, ...customData } = element.customData ?? {};
  if (!ranges.length) {
    return { customData };
  }
  const stored: StoredTextColors = {
    version: 1,
    baseColor: element.strokeColor,
    textLength: text.length,
    textHash: hashText(text),
    ranges: {
      starts: ranges.map((range) => range.start),
      ends: ranges.map((range) => range.end),
      colors: ranges.map((range) => range.color),
    },
  };
  return { customData: { ...customData, [TEXT_COLORS_KEY]: stored } };
};

/**
 * For recoloring the whole element: the parts take the new color too, like
 * applying a color to all of a text in a word processor.
 */
export const getClearTextColorsUpdate = (
  element: Pick<ExcalidrawTextElement, "strokeColor" | "customData">,
) => (hasTextColors(element) ? getTextColorsUpdate(element, "", []) : {});

/** The element update coloring `[start, end)` of its `originalText`. */
export const getColorTextRangeUpdate = (
  element: TextColorsElement,
  start: number,
  end: number,
  color: string,
) => {
  const text = element.originalText;
  let from = Math.max(0, Math.min(start, text.length));
  let to = Math.max(from, Math.min(end, text.length));
  // never split a character in two
  if (isInsideSurrogatePair(text, from)) {
    from--;
  }
  if (isInsideSurrogatePair(text, to)) {
    to++;
  }

  const ranges: TextColorRange[] = [];
  for (const range of getTextColorRanges(element) ?? []) {
    if (range.end <= from || range.start >= to) {
      ranges.push(range);
      continue;
    }
    if (range.start < from) {
      ranges.push({ ...range, end: from });
    }
    if (range.end > to) {
      ranges.push({ ...range, start: to });
    }
  }
  if (from < to && !isSameColor(color, element.strokeColor)) {
    ranges.push({ start: from, end: to, color });
  }
  return getTextColorsUpdate(
    element,
    text,
    normalizeRanges(ranges, text.length),
  );
};

type TextEdit = {
  /** where the edit starts, in both texts */
  start: number;
  /** where it ends in the previous text */
  previousEnd: number;
  /** where it ends in the next text */
  nextEnd: number;
};

/**
 * The smallest edit turning `previous` into `next`. Repeated characters
 * around it make its position ambiguous ("aa" → "aaa"); `caret` — the end of
 * what was typed, or where the deletion happened — picks the actual one.
 */
const getTextEdit = (
  previous: string,
  next: string,
  caret: number | null,
): TextEdit => {
  const minLength = Math.min(previous.length, next.length);
  let start = 0;
  while (
    start < minLength &&
    previous.charCodeAt(start) === next.charCodeAt(start)
  ) {
    start++;
  }
  let suffix = 0;
  while (
    suffix < minLength - start &&
    previous.charCodeAt(previous.length - 1 - suffix) ===
      next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }
  let previousEnd = previous.length - suffix;
  let nextEnd = next.length - suffix;
  // the prefix match puts the edit as late as possible: move it back towards
  // the caret while the texts allow it
  while (
    caret !== null &&
    nextEnd > caret &&
    start > 0 &&
    previous.charCodeAt(previousEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    start--;
    previousEnd--;
    nextEnd--;
  }
  return { start, previousEnd, nextEnd };
};

/**
 * The color text inserted by `edit` takes: that of the first character it
 * replaces, else of the character before it — or, at the start of a line,
 * of the first one after it — as in a word processor.
 */
const getInheritedColor = (
  ranges: readonly TextColorRange[],
  previous: string,
  edit: TextEdit,
) => {
  const colorAt = (offset: number) =>
    ranges.find((range) => range.start <= offset && offset < range.end)
      ?.color ?? null;

  if (edit.previousEnd > edit.start) {
    return colorAt(edit.start);
  }
  const before = edit.start - 1;
  const after = edit.start;
  if (before >= 0 && previous[before] !== "\n") {
    return colorAt(before);
  }
  if (after < previous.length && previous[after] !== "\n") {
    return colorAt(after);
  }
  // an empty line: a line break typed at the end of colored text carries
  // its color
  return before >= 0 ? colorAt(before) : null;
};

/**
 * Moves ranges along with an edit of the text: what follows it shifts, what
 * it removed loses its color, and what it inserted takes the color of its
 * surroundings (see getInheritedColor).
 */
export const adjustTextColorRanges = (
  ranges: readonly TextColorRange[],
  previous: string,
  next: string,
  caret: number | null,
): TextColorRange[] => {
  if (previous === next) {
    return [...ranges];
  }
  const edit = getTextEdit(previous, next, caret);
  const delta = edit.nextEnd - edit.previousEnd;
  const adjusted: TextColorRange[] = [];
  for (const range of ranges) {
    if (range.start < edit.start) {
      adjusted.push({ ...range, end: Math.min(range.end, edit.start) });
    }
    if (range.end > edit.previousEnd) {
      adjusted.push({
        ...range,
        start: Math.max(range.start, edit.previousEnd) + delta,
        end: range.end + delta,
      });
    }
  }
  const color = getInheritedColor(ranges, previous, edit);
  if (color && edit.nextEnd > edit.start) {
    adjusted.push({ start: edit.start, end: edit.nextEnd, color });
  }
  return normalizeRanges(adjusted, next.length);
};

/**
 * The element update keeping its ranges on its text as it's edited to
 * `next`, or `null` when it has no ranges to keep. Ranges that no longer
 * applied before the edit are dropped.
 */
export const getTextColorsEditUpdate = (
  element: TextColorsElement,
  next: string,
  caret: number | null,
) => {
  if (!hasTextColors(element)) {
    return null;
  }
  const ranges = getTextColorRanges(element);
  return getTextColorsUpdate(
    element,
    next,
    ranges
      ? adjustTextColorRanges(ranges, element.originalText, next, caret)
      : [],
  );
};

/**
 * The element's rendered lines (`text`, as wrapped) cut into runs of one
 * color; `null` when it has no colored ranges, when `text` doesn't line up
 * with `originalText`, or when it has right-to-left characters, whose
 * bidirectional layout runs drawn one after another would break.
 */
export const getTextColorLines = (
  element: Pick<
    ExcalidrawTextElement,
    "text" | "originalText" | "strokeColor" | "customData"
  >,
): TextColorSegment[][] | null => {
  const ranges = getTextColorRanges(element);
  if (!ranges || hasRTLChars(element.text)) {
    return null;
  }

  const text = element.text.replace(/\r\n?/g, "\n");
  const original = element.originalText;
  let rangeIndex = 0;
  // offsets come in increasing order
  const colorAt = (offset: number) => {
    while (rangeIndex < ranges.length && ranges[rangeIndex].end <= offset) {
      rangeIndex++;
    }
    const range = ranges[rangeIndex];
    return range && range.start <= offset ? range.color : null;
  };

  const lines: TextColorSegment[][] = [[]];
  let originalIndex = 0;
  for (const char of text) {
    let color: string | null = null;
    if (original.startsWith(char, originalIndex)) {
      color = colorAt(originalIndex);
      originalIndex += char.length;
    } else if (char !== "\n") {
      // whitespace the wrapping dropped at the end of a line
      while (
        originalIndex < original.length &&
        !original.startsWith(char, originalIndex) &&
        /\s/.test(original[originalIndex])
      ) {
        originalIndex++;
      }
      if (original.startsWith(char, originalIndex)) {
        color = colorAt(originalIndex);
        originalIndex += char.length;
      } else if (/\S/.test(char)) {
        return null;
      }
    }
    // (a line break missing from `originalText` is one the wrapping added)
    if (char === "\n") {
      lines.push([]);
      continue;
    }
    const line = lines[lines.length - 1];
    const last = line[line.length - 1];
    if (last && last.color === color) {
      line[line.length - 1] = { text: last.text + char, color };
    } else {
      line.push({ text: char, color });
    }
  }
  return /\S/.test(original.slice(originalIndex)) ? null : lines;
};

/**
 * Draws a rendered line run by run, placed as `fillText` would place the
 * whole line with `textAlign`. Changes the context's `textAlign`.
 */
export const fillTextColorLine = (
  context: CanvasRenderingContext2D,
  segments: readonly TextColorSegment[],
  x: number,
  y: number,
  {
    textAlign,
    baseColor,
    isDarkMode,
  }: { textAlign: string; baseColor: string; isDarkMode: boolean },
) => {
  const widths = segments.map(
    (segment) => context.measureText(segment.text).width,
  );
  const lineWidth = widths.reduce((sum, width) => sum + width, 0);
  let left =
    textAlign === "center"
      ? x - lineWidth / 2
      : textAlign === "right"
      ? x - lineWidth
      : x;
  context.textAlign = "left";
  segments.forEach((segment, index) => {
    context.fillStyle = applyDarkModeFilter(
      segment.color ?? baseColor,
      isDarkMode,
    );
    context.fillText(segment.text, left, y);
    left += widths[index];
  });
};

/** Fills an SVG `<text>` with a `<tspan>` per run. */
export const appendTextColorSpans = (
  text: SVGTextElement,
  segments: readonly TextColorSegment[],
  isDarkMode: boolean,
) => {
  for (const segment of segments) {
    const span = text.ownerDocument.createElementNS(SVG_NS, "tspan");
    span.textContent = segment.text;
    if (segment.color) {
      span.setAttribute("fill", applyDarkModeFilter(segment.color, isDarkMode));
    }
    text.appendChild(span);
  }
};
