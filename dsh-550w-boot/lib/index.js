// Host half of dsh-550w-boot.
//
// WHY THIS HALF EXISTS AT ALL: the bundle patch row must name an importable
// host entry. Pointing the row at `dsh-550w-boot/client` would hand the host a
// classic browser script, which it cannot import. So this module exists to be
// importable, and it deliberately does almost nothing else.
//
// THE ANIMATION ITSELF IS THE BROWSER HALF'S JOB (lib/client.js). It injects a
// full-window overlay before the application mounts and removes it when the
// animation is done. Nothing here can reach the page: the host runs as Node
// inside the desktop application and has no DOM.
//
// NO CONFIG SCHEMA ON PURPOSE. A real schemastery schema is what puts options in
// the settings UI, and a plugin installed under <profile>/node_modules cannot
// import '@deepseek-ai/schemastery' (module resolution is rewritten for a
// plugin's entry specifier only, not for the imports inside it). The vendored
// workaround is real but the options here are three numbers and a boolean, so
// they live in build.mjs and are baked into the browser half instead. See
// README.zh-CN.md.

import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const name = 'boot550w'

const here = dirname(fileURLToPath(import.meta.url))

/* Read our own manifest and built browser half.
 *
 * The question this answers is the one that cannot be answered from the outside:
 * is the plugin the application is running the code that is on disk? A plugin's
 * host half is imported once at startup and a re-enable re-runs apply() from the
 * CACHED module, so "I changed the file and nothing happened" is normal and
 * says nothing about whether the change was ever loaded. Printing the built
 * bundle's size and mtime makes that visible in one line. */
const describeBuild = () => {
  const lines = []
  try {
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
    lines.push('v' + (typeof pkg.version === 'string' ? pkg.version : '?'))
  } catch { /* a missing manifest is not worth an error */ }

  try {
    const client = join(here, 'client.js')
    const info = statSync(client)
    lines.push('client.js ' + (info.size / 1024).toFixed(1) + ' KB, mtime ' + info.mtime.toISOString())
  } catch {
    lines.push('client.js MISSING (run: node build.mjs)')
  }

  return lines.join(' | ')
}

export function apply(ctx) {
  const summary = describeBuild()

  // eslint-disable-next-line no-console
  console.log('[boot550w] host half active — ' + summary)

  /* No teardown is needed, and that is not an omission: this half owns no
   * resource. The overlay belongs to the page, and the browser half registers
   * its own disposer for it. Declaring the effect anyway would be a promise the
   * host cannot keep, so nothing is registered. */
  void ctx
}

export default { name, apply }
