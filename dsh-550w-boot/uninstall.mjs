/* ============================================================================
   uninstall.mjs — remove this plugin from a DSH profile.

   RUN
     node uninstall.mjs                    # profile "desktop", $DSH_HOME
     node uninstall.mjs --profile web

   Reverses install.mjs exactly: drops "dsh-550w-boot" from
   `dsh.profile.bundles` and deletes the installed copy. It does not restore the
   backup install.mjs wrote, because that backup also predates any later edit the
   plugin manager made to the same file; removing one name is the change that was
   made, so removing one name is the change that is undone.

   A backup is still written before the manifest is touched, so the exact
   previous bytes are recoverable.
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

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

const profileDir = join(dshHome, 'profiles', profile)
const manifestPath = join(profileDir, 'package.json')
const targetDir = join(dshHome, 'profiles', 'node_modules', PACKAGE_NAME)

if (!existsSync(manifestPath)) {
  console.error('uninstall: no profile manifest at ' + manifestPath)
  process.exit(1)
}

/* Deletion guard: the directory must be the one this package is installed into,
 * and must actually hold this package. A wrong --dsh-home must not delete an
 * unrelated directory. */
if (existsSync(targetDir)) {
  const installedManifest = join(targetDir, 'package.json')
  let installedName = null
  try { installedName = JSON.parse(readFileSync(installedManifest, 'utf8')).name } catch { /* unreadable */ }
  if (installedName !== PACKAGE_NAME) {
    console.error('uninstall: ' + targetDir + ' does not hold ' + PACKAGE_NAME
      + ' (found: ' + JSON.stringify(installedName) + '); refusing to delete it')
    process.exit(1)
  }
  rmSync(targetDir, { recursive: true, force: true })
  console.log('  removed    ' + targetDir)
} else {
  console.log('  package    not installed at ' + targetDir)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const bundles = manifest?.dsh?.profile?.bundles

if (Array.isArray(bundles) && bundles.includes(PACKAGE_NAME)) {
  writeFileSync(manifestPath + '.' + PACKAGE_NAME + '.uninstall.bak', readFileSync(manifestPath), 'utf8')
  manifest.dsh.profile.bundles = bundles.filter((name) => name !== PACKAGE_NAME)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log('  bundles -> ' + JSON.stringify(manifest.dsh.profile.bundles))
} else {
  console.log('  bundles    does not list ' + PACKAGE_NAME + '; manifest untouched')
}

/* Leftovers from an earlier install, reported rather than deleted blindly. */
const backupCandidates = existsSync(profileDir)
  ? readdirSync(profileDir).filter((name) => name.startsWith('package.json.' + PACKAGE_NAME))
  : []
for (const name of backupCandidates) console.log('  note       backup kept: ' + join(profileDir, name))

console.log('')
console.log('  Uninstalled. Restart DeepSeek Harness to start without the animation.')
