/**
 * ExcalidrawZ: shorter `arrow` arrowheads.
 *
 * Upstream draws their sides 25px long at 20° to the line, whatever the
 * stroke width, which in dense diagrams covers labels and neighboring shapes.
 * Shorter sides at a wider angle make the arrowhead only a little narrower,
 * while it reaches back less than half as far along the line.
 */

/**
 * Length of the sides of `arrow` arrowheads, in pixels. Has to stay above
 * the size at which scaled down arrowheads open up the widest (10px, see
 * `getArrowheadAngle()`).
 */
export const EXCALIDRAWZ_ARROW_ARROWHEAD_SIZE = 13;

/**
 * Angle of the sides of full-size `arrow` arrowheads to the line, in degrees.
 * At most the 30° scaled down arrowheads open up to (see
 * `getArrowheadAngle()`), or they would close up instead.
 */
export const EXCALIDRAWZ_ARROW_ARROWHEAD_ANGLE = 30;
