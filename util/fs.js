// @dada78641/AutoCrop <https://github.com/msikma/autocrop>
// © MIT license

import url from 'url'
import path from 'path'

/**
 * Returns the package root directory path.
 */
export function getPackageRoot() {
  const filepath = path.join(url.fileURLToPath(new URL('.', import.meta.url)), '..')
  return filepath
}
