import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stampPath = path.join(desktopRoot, 'build', 'install-stamp.json')

test('local build stamp records the GitHub origin repository', () => {
  const result = spawnSync(process.execPath, ['scripts/write-build-stamp.mjs'], {
    cwd: desktopRoot,
    encoding: 'utf8'
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'))
  assert.equal(stamp.schemaVersion, 1)
  assert.equal(stamp.repository, 'ytheesh96/hermes-loop')
})

test('CI build stamp rejects invalid repository values and preserves the upstream default', () => {
  const result = spawnSync(process.execPath, ['scripts/write-build-stamp.mjs'], {
    cwd: desktopRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_SHA: 'f'.repeat(40),
      GITHUB_REF_NAME: 'main',
      GITHUB_REPOSITORY: 'https://evil.example/owner/repo',
      GIT_DIR: path.join(os.tmpdir(), 'hermes-missing-git-dir')
    }
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'))
  assert.equal(stamp.schemaVersion, 1)
  assert.equal(stamp.repository, 'NousResearch/hermes-agent')
})
