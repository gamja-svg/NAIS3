import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, initDb } from '../src/main/db'
import { parseSceneImport } from '../src/main/scenes/import-formats'
import {
  applyImportedScenes,
  createPreset,
  createScene,
  deleteScene,
  exportScenesJson,
  getScene,
  isSceneReferencesOff,
  isSceneTransparent,
  listScenes,
  setSceneReferencesOff,
  setSceneTransparent,
  updateScene
} from '../src/main/scenes/repo'

// [custom] 씬별 투명 배경: 켠 씬만 투명 배경으로 뽑는다. 씬 JSON의 "transparent"로도 켜고 끈다
const environment = vi.hoisted(() => ({ directory: '', file: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [environment.file] }),
    showSaveDialog: async () => ({ canceled: false, filePath: environment.file })
  }
}))

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-custom-transparent-'))
  environment.file = join(environment.directory, 'scenes.json')
  initDb()
})
afterEach(() => {
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

describe('custom: per-scene transparent background', () => {
  it('turns on and off per scene and shows in lists', () => {
    const preset = createPreset('p')
    const a = createScene(preset, 'a')
    const b = createScene(preset, 'b')
    expect(isSceneTransparent(a)).toBe(false)
    expect(setSceneTransparent(a, true)).toBe(true)
    expect(setSceneTransparent(a, true)).toBe(false) // 이미 켜져 있음
    expect(isSceneTransparent(a)).toBe(true)
    expect(getScene(a)?.transparent).toBe(true)
    expect(getScene(b)?.transparent).toBeUndefined()
    expect(listScenes(preset).map((s) => !!s.transparent)).toEqual([true, false])
    expect(setSceneTransparent(a, false)).toBe(true)
    expect(getScene(a)?.transparent).toBeUndefined()
  })

  it('does not survive on a new scene that reuses a deleted scene id', () => {
    const preset = createPreset('p')
    const a = createScene(preset, 'a')
    setSceneTransparent(a, true)
    deleteScene(a)
    expect(isSceneTransparent(a)).toBe(false)
  })

  it('follows "transparent" in a scene JSON, and counts a change as a scene to redo', () => {
    const preset = createPreset('p')
    const a = createScene(preset, 'a')
    updateScene(a, { prompt: 'one' })
    const parsed = parseSceneImport(
      JSON.stringify({
        scenes: [
          { name: 'a', prompt: 'one', transparent: true }, // 내용은 같고 투명만 켬
          { name: 'new', prompt: 'two', transparent: true },
          { name: 'plain', prompt: 'three' }
        ]
      })
    )
    const first = applyImportedScenes(preset, parsed ?? [])
    const byName = Object.fromEntries(listScenes(preset).map((s) => [s.name, s]))
    expect(byName.a.transparent).toBe(true)
    expect(byName.new.transparent).toBe(true)
    expect(byName.plain.transparent).toBeUndefined()
    expect(first.sceneIds).toContain(a)

    // 칸이 없으면 그대로, false면 끈다 (prompt 없는 줄로도)
    const second = applyImportedScenes(
      preset,
      parseSceneImport(
        JSON.stringify({
          scenes: [
            { name: 'a', prompt: 'one' },
            { name: 'new', transparent: false }
          ]
        })
      ) ?? []
    )
    expect(getScene(a)?.transparent).toBe(true)
    expect(getScene(byName.new.id)?.transparent).toBeUndefined()
    expect(second.sceneIds).toEqual([byName.new.id])
  })

  it('is written to exported scene JSON', async () => {
    const preset = createPreset('p')
    setSceneTransparent(createScene(preset, 'a'), true)
    createScene(preset, 'b')
    await exportScenesJson(preset)
    const saved = JSON.parse(readFileSync(environment.file, 'utf-8')) as {
      scenes: { name: string; transparent?: boolean }[]
    }
    expect(saved.scenes.map((s) => s.transparent)).toEqual([true, undefined])
  })

  // [custom] 씬별 레퍼런스 끄기 — 같은 방식으로 씬에 붙는 표시
  it('turns references off per scene, from the menu or a scene JSON', () => {
    const preset = createPreset('p')
    const a = createScene(preset, 'a')
    const b = createScene(preset, 'b')
    expect(setSceneReferencesOff(a, true)).toBe(true)
    expect(setSceneReferencesOff(a, true)).toBe(false)
    expect([isSceneReferencesOff(a), isSceneReferencesOff(b)]).toEqual([true, false])
    expect(listScenes(preset).map((s) => !!s.referencesOff)).toEqual([true, false])
    expect(getScene(a)?.referencesOff).toBe(true)

    const done = applyImportedScenes(
      preset,
      parseSceneImport(
        JSON.stringify({
          scenes: [
            { name: 'a', references: true },
            { name: 'b', references: false },
            { name: 'c', prompt: 'new', references: false }
          ]
        })
      ) ?? []
    )
    const c = listScenes(preset).find((s) => s.name === 'c')!.id
    expect([a, b, c].map(isSceneReferencesOff)).toEqual([false, true, true])
    expect(done.sceneIds.sort()).toEqual([a, b, c].sort())
    deleteScene(b)
    expect(isSceneReferencesOff(b)).toBe(false)
  })
})
