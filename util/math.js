// @dada78641/AutoCrop <https://github.com/msikma/autocrop>
// © MIT license

/**
 * Clamps a value to a given min and max range.
 */
export function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

/**
 * Clamps a value between [0, 255].
 */
export function clamp8(value) {
  return clamp(value, 0, 255)
}
