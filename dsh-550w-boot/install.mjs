/* ============================================================================
   install.mjs — install this plugin into a DSH profile.

   RUN
     node install.mjs                      # profile "desktop", $DSH_HOME
     node install.mjs --profile web
     node install.mjs --dsh-home "C:\\Users\\me\\.dsh"
     node install.mjs --dry-run

   WHAT IT DOES, AND WHY IT IS THREE SEPARATE THINGS

   1. Copies this package to `<DSH_HOME>/profiles/node_modules/dsh-550w-boot`.
      That directory is the profile interception layer: it is on Node's ordinary
      ancestor walk from the profile directory, so a bare `dsh-550w-boot` name
      resolves there without any link, and the profile's own pnpm installs
      (which run with cwd = the profile dir) never prune it.

   2. Adds "dsh-550w-boot" to `dsh.profile.bundles` in the profile's
      package.json. This is the ONLY switch that selects a layer: the app reads
      it at boot and resolves each name through that package's
      `dsh.bundle.patch`, then composes the patch files. Nothing watches
      package.json, so this takes effect on the next start.

   3. Backs up package.json before touching it, and prints both the restart step
      and the exact restore command.

   It is NOT a dependency install. No `dependencies` entry is written: the
   package is not in any registry, and a `dependencies` entry naming it would
   make the next plugin install in the GUI fail when pnpm tried to fetch it.
   The bundle list is enough for the app to load it.

   Paths are resolved and printed before anything is written, and the copy
   target is refused unless it looks exactly like the install directory this
   script owns.
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const PACKAGE_NAME = 'dsh-550w-boot'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  if (at === -1) return fallback
  const value = argv[at + 1]
  return value === undefined || value.startsWith('--') ? true : value
}
const profile = String(flag('profile', 'desktop'))
const dshHome = resolve(String(flag('dsh-home', process.env.DSH_HOME || join(homedir(), '.dsh'))))
const dryRun = argv.includes('--dry-run')

const profileDir = join(dshHome, 'profiles', profile)
const manifestPath = join(profileDir, 'package.json')
const targetDir = join(dshHome, 'profiles', 'node_modules', PACKAGE_NAME)
const backupPath = manifestPath + '.' + PACKAGE_NAME + '.bak'

const problems = []

if (!existsSync(manifestPath)) {
  problems.push('no profile manifest at ' + manifestPath
    + ' — start DeepSeek Harness once so the profile exists, or pass --profile <name>')
}
if (!existsSync(join(here, 'lib', 'client.js'))) {
  problems.push('lib/client.js is missing — run: node build.mjs')
}

/* The target must be the directory this script owns. Checked before any delete,
 * because a wrong `--dsh-home` must not turn into a deleted directory. */
const expectedTail = join('profiles', 'node_modules', PACKAGE_NAME)
if (!targetDir.endsWith(expectedTail)) {
  problems.push('refusing to touch ' + targetDir + ': it does not end with ' + expectedTail)
}

if (problems.length > 0) {
  for (const problem of problems) console.error('install: ' + problem)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dsh = manifest.dsh || {}
manifest.dsh.profile = manifest.dsh.profile || {}
const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []

console.log('  profile    ' + profileDir)
console.log('  installs   ' + targetDir)
console.log('  bundles    ' + JSON.stringify(bundles.length > 0 ? bundles : manifest.dsh.profile.bundles))

if (dryRun) {
  console.log('  --dry-run: nothing written')
  process.exit(0)
}

/* ---- 1. the package ---- */

/* Remove first so a removed file cannot survive an upgrade. The path was
 * checked above; re-check the one thing that makes deletion unambiguous. */
if (existsSync(targetDir)) {
  const installedManifest = join(targetDir, 'package.json')
  if (existsSync(installedManifest)) {
    let installedName = null
    try { installedName = JSON.parse(readFileSync(installedManifest, 'utf8')).name } catch { /* unreadable */ }
    if (installedName !== PACKAGE_NAME) {
      console.error('install: ' + targetDir + ' holds a package named "' + installedName + '", not '
        + PACKAGE_NAME + '; refusing to replace it')
      process.exit(1)
    }
  }
  rmSync(targetDir, { recursive: true, force: true })
}
mkdirSync(targetDir, { recursive: true })

/* Copy exactly what package.json declares as publishable, plus the manifest —
 * so test/ and tools/ stay out of the installed copy. */
const own = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
const entries = ['package.json', ...(Array.isArray(own.files) ? own.files : ['lib', 'animation', 'cordis.patch.yml'])]
const copied = []
for (const entry of entries) {
  const from = join(here, entry)
  if (!existsSync(from)) continue
  const to = join(targetDir, entry)
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: statSync(from).isDirectory() })
  copied.push(entry)
}
console.log('  copied     ' + copied.join(', '))

/* ---- 2. the bundle list ---- */

if (!bundles.includes(PACKAGE_NAME)) {
  writeFileSync(backupPath, readFileSync(manifestPath), 'utf8')
  bundles.push(PACKAGE_NAME)
  manifest.dsh.profile.bundles = bundles
  /* Same shape the plugin manager writes: two-space JSON, trailing newline. */
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log('  bundles -> ' + JSON.stringify(bundles))
  console.log('  backup     ' + backupPath)
} else {
  console.log('  bundles    already lists ' + PACKAGE_NAME + '; manifest untouched')
}

/* ---- 3. what the user has to do ---- */

console.log('')
console.log('  Installed. Now:')
console.log('    1. fully quit DeepSeek Harness (not just the window) and start it again;')
console.log('    2. the animation plays before the interface appears — click or press any key to skip.')
console.log('')
console.log('  If it does not appear, the app prints one line naming the reason:')
console.log('    dsh: skipping profile bundle "' + PACKAGE_NAME + '": ...')
console.log('')
console.log('  To undo exactly this change:')
console.log('    node "' + join(here, 'uninstall.mjs') + '" --profile ' + profile)
if (existsSync(backupPath)) {
  console.log('    (or restore ' + backupPath + ' over package.json and delete ' + targetDir + ')')
}
