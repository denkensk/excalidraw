/**
 * ExcalidrawZ: "match width / height / size" — an extra row under the align
 * buttons. The selected rectangles, diamonds and ellipses take the largest
 * width and/or height among them, each resized around its own center.
 * Anything else in the selection (arrows, text, ...) is left alone; labels
 * re-wrap and bound arrows follow, as with a manual resize.
 */
import {
  CaptureUpdateAction,
  deepCopyElement,
  getBoundTextElement,
  resizeSingleElement,
  updateFrameMembershipOfSelectedElements,
} from "@excalidraw/element";

import type { RenderEnvironment, Scene } from "@excalidraw/element";
import type {
  ElementsMap,
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { useApp } from "../components/App";
import { IconButton } from "../components/IconButton";
import { createIcon } from "../components/icons";
import { useUIAppState } from "../context/ui-appState";
import { t } from "../i18n";

import { register } from "./register";

import type { ActionManager } from "./manager";
import type { TranslationKeys } from "../i18n";
import type { AppClassProperties, UIAppState } from "../types";

export type MatchedDimension = "width" | "height" | "size";

const iconProps = {
  width: 20,
  height: 20,
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const MatchWidthIcon = createIcon(
  <g strokeWidth="1.25">
    <path d="M4.167 4.167h11.666M5.625 2.708 4.167 4.167l1.458 1.458M14.375 2.708l1.458 1.459-1.458 1.458" />
    <rect x="4.167" y="7.5" width="11.666" height="3.333" rx="1.25" />
    <rect x="4.167" y="12.917" width="11.666" height="4.166" rx="1.25" />
  </g>,
  iconProps,
);

export const MatchHeightIcon = createIcon(
  <g strokeWidth="1.25">
    <path d="M4.167 4.167v11.666M2.708 5.625 4.167 4.167l1.458 1.458M2.708 14.375l1.459 1.458 1.458-1.458" />
    <rect x="7.5" y="4.167" width="3.333" height="11.666" rx="1.25" />
    <rect x="12.917" y="4.167" width="4.166" height="11.666" rx="1.25" />
  </g>,
  iconProps,
);

export const MatchSizeIcon = createIcon(
  <g strokeWidth="1.25">
    <path d="M8.125 4.375h8.75M9.583 2.917 8.125 4.375l1.458 1.458M15.417 2.917l1.458 1.458-1.458 1.458" />
    <path d="M4.375 8.125v8.75M2.917 9.583 4.375 8.125l1.458 1.458M2.917 15.417l1.458 1.458 1.458-1.458" />
    <rect x="8.125" y="8.125" width="8.75" height="8.75" rx="1.667" />
  </g>,
  iconProps,
);

const isMatchSizeTarget = (element: ExcalidrawElement) =>
  element.type === "rectangle" ||
  element.type === "diamond" ||
  element.type === "ellipse";

const getMatchSizeTargets = (appState: UIAppState, app: AppClassProperties) =>
  app.scene.getSelectedElements(appState).filter(isMatchSizeTarget);

export const matchSizeActionsPredicate = (
  appState: UIAppState,
  app: AppClassProperties,
) => getMatchSizeTargets(appState, app).length > 1;

export const matchElementsSize = (
  elements: readonly NonDeletedExcalidrawElement[],
  dimension: MatchedDimension,
  scene: Scene,
  renderEnvironment?: RenderEnvironment,
) => {
  const width = Math.max(...elements.map((element) => element.width));
  const height = Math.max(...elements.map((element) => element.height));

  for (const element of elements) {
    const nextWidth = dimension === "height" ? element.width : width;
    const nextHeight = dimension === "width" ? element.height : height;
    if (nextWidth === element.width && nextHeight === element.height) {
      continue;
    }

    // the shape and its label as they were before this resize
    const origElement = deepCopyElement(element);
    const originalElementsMap: ElementsMap = new Map([
      [element.id, origElement],
    ]);
    const boundTextElement = getBoundTextElement(
      element,
      scene.getNonDeletedElementsMap(),
    );
    if (boundTextElement) {
      originalElementsMap.set(
        boundTextElement.id,
        deepCopyElement(boundTextElement),
      );
    }

    resizeSingleElement(
      nextWidth,
      nextHeight,
      element,
      origElement,
      originalElementsMap,
      scene,
      // a label re-wraps unless only the height changes ("s")
      dimension === "width" ? "e" : dimension === "height" ? "s" : "se",
      { shouldResizeFromCenter: true, renderEnvironment },
    );
  }
};

const registerMatchSizeAction = ({
  name,
  label,
  icon,
  dimension,
}: {
  name: "matchWidth" | "matchHeight" | "matchSize";
  label: TranslationKeys;
  icon: React.ReactNode;
  dimension: MatchedDimension;
}) =>
  register({
    name,
    label,
    icon,
    trackEvent: { category: "element" },
    predicate: (elements, appState, _, app) =>
      matchSizeActionsPredicate(appState, app),
    perform: (elements, appState, _, app) => {
      const targets = getMatchSizeTargets(appState, app);
      if (targets.length < 2) {
        return false;
      }

      matchElementsSize(targets, dimension, app.scene, app.renderEnvironment);

      return {
        appState,
        elements: updateFrameMembershipOfSelectedElements(
          elements,
          appState,
          app,
        ),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      };
    },
    PanelComponent: ({ updateData }) => (
      <IconButton
        type="button"
        icon={icon}
        onClick={() => updateData(null)}
        title={t(label)}
        aria-label={t(label)}
      />
    ),
  });

export const actionMatchWidth = registerMatchSizeAction({
  name: "matchWidth",
  label: "labels.matchWidth",
  icon: MatchWidthIcon,
  dimension: "width",
});

export const actionMatchHeight = registerMatchSizeAction({
  name: "matchHeight",
  label: "labels.matchHeight",
  icon: MatchHeightIcon,
  dimension: "height",
});

export const actionMatchSize = registerMatchSizeAction({
  name: "matchSize",
  label: "labels.matchSize",
  icon: MatchSizeIcon,
  dimension: "size",
});

/** The extra row inside the align fieldset; hidden below two shapes. */
export const MatchSizeButtons = ({
  renderAction,
}: {
  renderAction: ActionManager["renderAction"];
}) => {
  const app = useApp();
  const appState = useUIAppState();

  if (!matchSizeActionsPredicate(appState, app)) {
    return null;
  }

  return (
    <div className="align-buttons__row">
      {renderAction("matchWidth")}
      {renderAction("matchHeight")}
      {renderAction("matchSize")}
    </div>
  );
};
