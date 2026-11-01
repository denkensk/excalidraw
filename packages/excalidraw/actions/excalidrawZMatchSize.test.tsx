import { fireEvent, queryByLabelText } from "@testing-library/react";
import React from "react";

import { CaptureUpdateAction } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { defaultLang, setLanguage } from "../i18n";
import { API } from "../tests/helpers/api";
import { Keyboard, UI } from "../tests/helpers/ui";
import { act, render, unmountComponent } from "../tests/test-utils";

import {
  actionMatchHeight,
  actionMatchSize,
  actionMatchWidth,
} from "./excalidrawZMatchSize";

const { h } = window;

const getCenter = (element: ExcalidrawElement) => [
  element.x + element.width / 2,
  element.y + element.height / 2,
];

const expectCenter = (element: ExcalidrawElement, [cx, cy]: number[]) => {
  const [x, y] = getCenter(element);
  expect(x).toBeCloseTo(cx);
  expect(y).toBeCloseTo(cy);
};

const createShapes = () => {
  const small = API.createElement({
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
  });
  const wide = API.createElement({
    type: "diamond",
    x: 200,
    y: 0,
    width: 160,
    height: 40,
  });
  const tall = API.createElement({
    type: "ellipse",
    x: 400,
    y: 0,
    width: 80,
    height: 90,
  });
  // an undoable step of its own, so undo can revert just the resize
  API.updateScene({
    elements: [small, wide, tall],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  API.setSelectedElements([small, wide, tall]);
  return [small, wide, tall];
};

describe("match width / height / size (ExcalidrawZ)", () => {
  beforeEach(async () => {
    unmountComponent();
    await act(() => setLanguage(defaultLang));
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("gives every shape the largest width and height, keeping its center", () => {
    const shapes = createShapes();
    const centers = shapes.map(getCenter);

    API.executeAction(actionMatchSize);

    shapes.forEach((shape, index) => {
      const latest = API.getElement(shape);
      expect(latest.width).toBe(160);
      expect(latest.height).toBe(90);
      expectCenter(latest, centers[index]);
    });
  });

  it("matches only the width, or only the height", () => {
    const shapes = createShapes();
    const heights = shapes.map((shape) => shape.height);

    API.executeAction(actionMatchWidth);
    expect(shapes.map((shape) => API.getElement(shape).width)).toEqual([
      160, 160, 160,
    ]);
    expect(shapes.map((shape) => API.getElement(shape).height)).toEqual(
      heights,
    );

    API.executeAction(actionMatchHeight);
    expect(shapes.map((shape) => API.getElement(shape).height)).toEqual([
      90, 90, 90,
    ]);
  });

  it("is a single undo step", () => {
    const shapes = createShapes();
    const before = shapes.map(({ x, y, width, height }) => ({
      x,
      y,
      width,
      height,
    }));

    API.executeAction(actionMatchSize);
    Keyboard.undo();

    expect(
      shapes.map((shape) => {
        const { x, y, width, height } = API.getElement(shape);
        return { x, y, width, height };
      }),
    ).toEqual(before);
    expect(shapes.some((shape) => API.getElement(shape).isDeleted)).toBe(false);
  });

  it("keeps a rotated shape's center and angle", () => {
    const rotated = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 60,
      height: 20,
      angle: 0.5 as any,
    });
    const big = API.createElement({
      type: "rectangle",
      x: 200,
      y: 0,
      width: 120,
      height: 80,
    });
    API.setElements([rotated, big]);
    API.setSelectedElements([rotated, big]);
    const center = getCenter(rotated);

    API.executeAction(actionMatchSize);

    const latest = API.getElement(rotated);
    expect(latest.width).toBe(120);
    expect(latest.height).toBe(80);
    expect(latest.angle).toBe(0.5);
    expectCenter(latest, center);
  });

  it("keeps a container's label centered in the resized container", () => {
    const [container, createdLabel] = API.createTextContainer({
      label: { text: "label" },
    });
    const label = createdLabel as ExcalidrawTextElement;
    API.updateElement(container, { x: 0, y: 0, width: 100, height: 50 });
    API.updateElement(label, { textAlign: "center", verticalAlign: "middle" });
    const big = API.createElement({
      type: "rectangle",
      x: 200,
      y: 0,
      width: 200,
      height: 120,
    });
    API.setElements([container, label, big]);
    API.setSelectedElements([container, big]);

    API.executeAction(actionMatchSize);

    const latestContainer = API.getElement(container);
    const latestLabel = API.getElement(label);
    expect(latestContainer.width).toBe(200);
    expect(latestContainer.height).toBe(120);
    expect(latestLabel.containerId).toBe(container.id);
    expectCenter(latestLabel, getCenter(latestContainer));
  });

  it("leaves other selected elements alone; bound arrows follow", () => {
    const left = UI.createElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const right = UI.createElement("rectangle", {
      x: 300,
      y: 25,
      width: 50,
      height: 50,
    });
    const arrow = UI.createElement("arrow", {
      x: 90,
      y: 50,
      width: 220,
      height: 0,
    });
    const text = API.createElement({
      type: "text",
      x: 0,
      y: 200,
      text: "note",
    });
    API.setElements([...h.elements, text]);
    expect(arrow.get().startBinding?.elementId).toBe(left.id);
    expect(arrow.get().endBinding?.elementId).toBe(right.id);

    const arrowEndX = () => {
      const { x, points } = arrow.get();
      return x + points[points.length - 1][0];
    };
    const endBefore = arrowEndX();
    const textBefore = { ...API.getElement(text) };

    API.setSelectedElements([
      left.get(),
      right.get(),
      arrow.get(),
      text,
    ] as NonDeletedExcalidrawElement[]);
    API.executeAction(actionMatchSize);

    expect(right.get().width).toBe(100);
    expect(right.get().height).toBe(100);
    expect(left.get().width).toBe(100);
    // the arrow is not a target, but its end moved with the grown rectangle
    expect(arrow.get().startBinding?.elementId).toBe(left.id);
    expect(arrow.get().endBinding?.elementId).toBe(right.id);
    expect(arrowEndX()).toBeLessThan(endBefore);
    expect(API.getElement(text)).toEqual(textBefore);
  });

  it("shows the buttons only with two or more shapes selected", () => {
    const [small, wide] = createShapes();
    const text = API.createElement({ type: "text", x: 0, y: 200 });
    API.setElements([small, wide, text]);
    const panel = () => document.querySelector<HTMLElement>(".App-menu__left")!;

    API.setSelectedElements([small, text]);
    expect(queryByLabelText(panel(), "Align left")).not.toBe(null);
    expect(queryByLabelText(panel(), "Match size")).toBe(null);

    API.setSelectedElements([small, wide]);
    expect(queryByLabelText(panel(), "Match width")).not.toBe(null);
    expect(queryByLabelText(panel(), "Match height")).not.toBe(null);

    fireEvent.click(queryByLabelText(panel(), "Match size")!);
    expect(API.getElement(small).width).toBe(160);
    expect(API.getElement(small).height).toBe(50);
  });
});
