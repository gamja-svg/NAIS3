import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPresetFolders,
  renamePresetFolder,
  setPresetFolder
} from '../src/main/custom/preset-folders'
import { closeDb, initDb } from '../src/main/db'
import { createPreset, deletePreset } from '../src/main/scenes/repo'

// [custom] 씬 프리셋 폴더: 프리셋에 붙는 이름표. 프리셋을 지우면 이름표도 사라진다
const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }
}))

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-custom-folders-'))
  initDb()
})
afterEach(() => {
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

describe('custom: preset folders', () => {
  it('puts presets in a folder, moves them, and takes them out', () => {
    const a = createPreset('a')
    const b = createPreset('b')
    expect(getPresetFolders()).toEqual({})
    setPresetFolder([a, b], '  윤초아   폴더 ')
    expect(getPresetFolders()).toEqual({ [a]: '윤초아 폴더', [b]: '윤초아 폴더' })
    setPresetFolder([b], '다른 폴더')
    expect(getPresetFolders()).toEqual({ [a]: '윤초아 폴더', [b]: '다른 폴더' })
    setPresetFolder([a], null)
    setPresetFolder([b], '   ')
    expect(getPresetFolders()).toEqual({})
  })

  it('renames a folder, merging into one that already has the name', () => {
    const a = createPreset('a')
    const b = createPreset('b')
    setPresetFolder([a], 'A')
    setPresetFolder([b], 'B')
    renamePresetFolder('A', 'C')
    expect(getPresetFolders()).toEqual({ [a]: 'C', [b]: 'B' })
    renamePresetFolder('C', 'B')
    expect(getPresetFolders()).toEqual({ [a]: 'B', [b]: 'B' })
    renamePresetFolder('B', '  ')
    expect(getPresetFolders()).toEqual({ [a]: 'B', [b]: 'B' })
  })

  it('forgets the folder of a deleted preset', () => {
    const a = createPreset('a')
    const b = createPreset('b')
    setPresetFolder([a, b], 'A')
    deletePreset(b)
    expect(getPresetFolders()).toEqual({ [a]: 'A' })
  })
})
