// @dada78641/AutoCrop <https://github.com/msikma/autocrop>
// © MIT license

import {clamp, clamp8} from './math.js'

/**
 * Calculates the perceived brightness of a color.
 * 
 * Uses brightness values from the Rec. 601 standard.
 */
export function calcBrightness(r, g, b) {
  return (0.299 * r) + (0.587 * g) + (0.114 * b)
}

/**
 * Calculates perceived brightness with normalization applied.
 */
export function calcNormalizedBrightness(r, g, b, blackPoint, whitePoint, gammaValue) {
  return calcBrightness(
    calcNormalizedColor(r, blackPoint, whitePoint, gammaValue),
    calcNormalizedColor(g, blackPoint, whitePoint, gammaValue),
    calcNormalizedColor(b, blackPoint, whitePoint, gammaValue),
  )
}

/**
 * Calculates a color value with normalization applied.
 */
export function calcNormalizedColor(value, blackPoint, whitePoint, gammaValue) {
  const black = clamp8(blackPoint)
  const white = clamp(clamp8(whitePoint), black, 255)
  const adjusted = Math.pow((clamp8(value) - black) / (white - black), 1 / gammaValue)
  return clamp8(adjusted * 255)
}
