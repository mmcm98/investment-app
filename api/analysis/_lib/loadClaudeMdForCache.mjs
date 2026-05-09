import { readFileSync } from 'node:fs'

import { dirname, join } from 'node:path'

import { fileURLToPath } from 'node:url'

/**
 * Loads root CLAUDE.md for Anthropic prompt caching (briefing synthesis rules).
 *
 * @returns {string}
 */
export function loadClaudeMdForBriefingCache() {
  try {
    const libDir = dirname(fileURLToPath(import.meta.url))

    const projectRoot = join(libDir, '..', '..', '..')

    const p = join(projectRoot, 'CLAUDE.md')

    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}
