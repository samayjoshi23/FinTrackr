/**
 * Build-time version stamp for the update/wipe mechanism.
 *
 * Emits `public/version.json` with:
 *   {
 *     buildId:       "<git-short-sha>-<epoch-ms>",   // always changes per build
 *     breakingBuild: "<BREAKING_BUILD constant>",     // developer-controlled wipe flag
 *     builtAt:       "<ISO timestamp>"                // human-readable, for debugging
 *   }
 *
 * `public/` is copied verbatim into `dist/fintrackr/browser/` by the Angular
 * builder, so the deployed asset is `/version.json` at the site root. Firebase
 * Hosting serves it with `Cache-Control: no-cache` (see `firebase.json`).
 *
 * Wired via `prebuild` and `prestart` scripts in package.json so both
 * `ng build` and `ng serve` see a fresh stamp.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

/** Best-effort short SHA — falls back to 'nogit' when git isn't available (e.g. CI cache). */
function readGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'nogit';
  }
}

/** Read BREAKING_BUILD from the TS constant so the source of truth stays a single file. */
function readBreakingBuild() {
  const filePath = resolve(projectRoot, 'src/environment/version-config.ts');
  const source = readFileSync(filePath, 'utf8');
  const match = source.match(/BREAKING_BUILD\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    throw new Error(
      `generate-version: could not parse BREAKING_BUILD from ${filePath}. ` +
        `Expected a line like: export const BREAKING_BUILD = '1';`,
    );
  }
  return match[1];
}

const sha = readGitSha();
const now = Date.now();
const payload = {
  buildId: `${sha}-${now}`,
  breakingBuild: readBreakingBuild(),
  builtAt: new Date(now).toISOString(),
};

const outDir = resolve(projectRoot, 'public');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'version.json');
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

console.log(
  `generate-version: wrote ${outPath}\n  ${JSON.stringify(payload)}`,
);
