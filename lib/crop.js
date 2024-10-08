// @dada78641/AutoCrop <https://github.com/msikma/autocrop>
// © MIT license

import sharp from 'sharp'
import {calcBrightness, calcNormalizedColor, calcNormalizedBrightness} from '../util/color.js'

const SIDE_TOP = 1
const SIDE_RIGHT = 2
const SIDE_BOTTOM = 3
const SIDE_LEFT = 4

/**
 * Applies correction to the scan length for aspect ratio correction.
 */
function correctScanRatio(scanLength, imageRatio, canvasRatio, applyCorrection) {
  if (!applyCorrection || imageRatio === canvasRatio) {
    return scanLength
  }
  const ratioDifference = imageRatio > canvasRatio ? canvasRatio / imageRatio : imageRatio / canvasRatio
  return scanLength * ratioDifference
}

/**
 * Returns the length of the side we're asking for, and the length of the other side.
 */
function getSideLength(width, height, side) {
  if (side === SIDE_TOP || side === SIDE_BOTTOM) {
    return [width, height]
  }
  if (side === SIDE_LEFT || side === SIDE_RIGHT) {
    return [height, width]
  }
  throw new Error(`Invalid side: ${side} (w=${width}, h=${height})`)
}

/**
 * Returns the width or height of a given side.
 */
function getSideScanLength(width, height, imageRatio, canvasRatio, side) {
  if (side === SIDE_TOP || side === SIDE_BOTTOM) {
    return correctScanRatio(width, imageRatio, canvasRatio, imageRatio < canvasRatio)
  }
  if (side === SIDE_LEFT || side === SIDE_RIGHT) {
    return correctScanRatio(height, imageRatio, canvasRatio, imageRatio > canvasRatio)
  }
  throw new Error(`Invalid side: ${side} (w=${width}, h=${height})`)
}

/**
 * Calculates the middle of two ray hits based on their brightness.
 */
function normalizeRayHits(rayHits) {
  const [a, b] = rayHits

  // Positions of the rays and their pixel brightness.
  const aPos = a[0]
  const aLevel = a[1] / 255
  const bPos = b[0]
  const bLevel = b[1] / 255

  // Determine if the earlier or the later hit is brighter.
  const direction = aLevel > bLevel
  // Normalize the brightness to a maximum of 1.0.
  const factor = direction ? (1 / aLevel) : (1 / bLevel)
  const aLevelNormalized = aLevel * factor
  const bLevelNormalized = bLevel * factor

  // Calculate the weight between the two positions based on their brightness.
  const diff = bPos - aPos
  const weight = bLevelNormalized * aLevelNormalized
  const pos = direction ? bPos - (diff * (1 - weight)) : aPos + (diff * (1 - weight))

  return pos
}

export class CropDetector {
  filepath
  data
  isLoaded = false

  // Aspect ratio of the visible image inside.
  imageRatio = 0

  settings = {
    // Amount of rays (as percentage).
    rayAmount: 0.025,
    // Minimal amount of rays to cast.
    rayAmountMin: 15,
    // Margin from image edge where rays start.
    rayMargin: 0.1,
    // % of how deep we search (up to 0.5, which is center of the image).
    rayMaxDepth: 0.4,
    // Brightness at which point we consider this a hit.
    rayThreshold: 15,
    // Normalization values for rays.
    rayBlack: 6,
    rayWhite: 60,
    rayGamma: 1,
  }

  constructor({aspectRatio} = {}) {
    this.imageRatio = aspectRatio ?? 0
  }
  /** Returns a pixel at a given x/y coordinate. */
  _getPixelAt(x, y) {
    const {data, info} = this.data
    const offset = (x * info.channels) + (y * (info.width * info.channels))
    const rgb = data.slice(offset, offset + info.channels)
    return rgb
  }
  /** Returns a pixel at a given offset from a given edge. */
  _getPixelFromEdge(side, b, a) {
    const {info} = this.data
    if (side === SIDE_TOP) {
      return this._getPixelAt(b, a)
    }
    if (side === SIDE_BOTTOM) {
      return this._getPixelAt(b, info.height - 1 - a)
    }
    if (side === SIDE_LEFT) {
      return this._getPixelAt(a, b)
    }
    if (side === SIDE_RIGHT) {
      return this._getPixelAt(info.width - 1 - a, b)
    }
  }
  /** Returns thr brightness of a single pixel at a given x/y coordinate. */
  _getPixelBrightnessAt(x, y) {
    const rgb = this._getPixelAt(x, y)
    return calcBrightness(rgb[0], rgb[1], rgb[2])
  }
  /** Returns the brightness of the background (from the top left corner). */
  _getBgBrightness() {
    // Grab a 2x2 block of pixels in the top left corner.
    const pixel2x2 = [
      this._getPixelBrightnessAt(0, 0),
      this._getPixelBrightnessAt(1, 0),
      this._getPixelBrightnessAt(0, 1),
      this._getPixelBrightnessAt(1, 1),
    ]
    // Return the average of these pixels.
    return pixel2x2.reduce((n, m) => n + m, 0) / pixel2x2.length
  }
  /** Casts a single ray from a given side (horizontally or vertically) to find the image edge. */
  _castEdgeRay(b, side, maxDepth, bgBrightness) {
    const {rayThreshold, rayBlack, rayWhite, rayGamma} = this.settings
    let rayHits = []
    let a = 0
    while (true) {
      if (a >= maxDepth) {
        break
      }
      // Color of the pixel at the given coordinate.
      const pixel = this._getPixelFromEdge(side, b, a)
      // Normalized pixel color given the background color.
      const normalized = calcNormalizedBrightness(pixel[0], pixel[1], pixel[2], rayBlack + bgBrightness, rayWhite, rayGamma)
      
      if (normalized > rayThreshold) {
        rayHits.push([a, normalized])
      }
      if (normalized <= rayThreshold && rayHits.length > 0) {
        rayHits = []
      }
      if (rayHits.length >= 2) {
        return normalizeRayHits(rayHits)
      }
     
      a += 1
    }
    
    // We did not find an edge.
    return null
  }
  /** Finds the edge of the visible image from a given side by casting rays. */
  _findEdge(side, bgBrightness) {
    const {data, info} = this.data
    const {rayAmount, rayAmountMin, rayMaxDepth, rayMargin} = this.settings

    const canvasRatio = info.width / info.height
    const imageRatio = this.imageRatio !== 0 ? this.imageRatio : canvasRatio

    // Full length of the canvas.
    const sideLength = getSideLength(info.width, info.height, side)
    // Length corrected for what aspect ratio we expect the visible image to be.
    const scanLength = getSideScanLength(info.width, info.height, imageRatio, canvasRatio, side)

    const offsetStart = (scanLength * rayMargin) + ((sideLength[0] - scanLength) / 2)
    const offsetEnd = sideLength[0] - offsetStart
    const rayNumber = Math.max(Math.floor(scanLength * rayAmount), rayAmountMin)
    const rayStep = offsetEnd / rayNumber

    // This is how far we'll search.
    const maxDepth = Math.floor(sideLength[1] * rayMaxDepth)
    const sideEdges = new Array(rayNumber).fill()
      .map((_, n) => {
        // 'b' refers to a coordinate along the given side; y for the left and right sides, x for the top and bottom sides.
        const b = Math.round((n * rayStep) + offsetStart)
        const ray = this._castEdgeRay(b, side, maxDepth, bgBrightness)
        return ray
      })
      .filter(n => n !== null)
    const sideEdge = Math.min(...sideEdges)

    return sideEdge
  }
  /** Finds the visible edges of the image in all four directions. */
  _findEdges(bgBrightness) {
    return {
      top: this._findEdge(SIDE_TOP, bgBrightness),
      right: this._findEdge(SIDE_RIGHT, bgBrightness),
      bottom: this._findEdge(SIDE_BOTTOM, bgBrightness),
      left: this._findEdge(SIDE_LEFT, bgBrightness),
    }
  }
  /** Runs crop box detection and returns the coordinates plus metadata. */
  async detectCropBox() {
    if (!this.isLoaded) {
      throw new Error(`No image loaded.`)
    }
    const {info} = this.data
    const bgBrightness = this._getBgBrightness()
    const edges = this._findEdges(bgBrightness)
    
    const croppedWidth = info.width - edges.left - edges.right
    const croppedHeight = info.height - edges.top - edges.bottom
    const croppedRatio = croppedWidth / croppedHeight

    return {
      source: {
        width: info.width,
        height: info.height,
        aspectRatio: info.width / info.height,
      },
      cropped: {
        width: croppedWidth,
        height: croppedHeight,
        aspectRatio: croppedRatio,
        correctedWidth: this.imageRatio > croppedRatio ? info.width * (this.imageRatio / croppedRatio) : info.width,
        correctedHeight: this.imageRatio > croppedRatio ? info.height : info.height * (this.imageRatio / croppedRatio),
        edges,
      },
      target: {
        aspectRatio: this.imageRatio,
      },
      image: {
        backgroundBrightness: bgBrightness,
      },
    }
  }
  /** Loads an image from a Base 64 encoded string. */
  async loadImageBase64(base64) {
    const mime = base64.match(/^data:(.+?);base64,/)
    if (mime === null) {
      throw new Error(`Not a base64 image string.`)
    }
    const data = base64.slice(mime[0].length)
    const buffer = Buffer.from(data, 'base64')
    return this.loadImageBuffer(buffer)
  }
  /** Loads an image from a binary buffer. */
  async loadImageBuffer(buffer) {
    const metadata = await sharp(buffer).metadata()
    const {data, info} = await sharp(buffer).raw().toBuffer({resolveWithObject: true})

    this.isLoaded = true
    this.filepath = '<buffer>'
    this.data = {data, info, metadata}
  }
  /** Loads an image from a file on the disk. */
  async loadImageFile(filepath) {
    const metadata = await sharp(filepath).metadata()
    const {data, info} = await sharp(filepath).raw().toBuffer({resolveWithObject: true})

    this.isLoaded = true
    this.filepath = filepath
    this.data = {data, info, metadata}
  }
}
