import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '../src/main/db'
import { listImages } from '../src/main/images/storage'
import { createPreset, createScene, deleteScene } from '../src/main/scenes/repo'

// [custom] 히스토리 항목에 씬·프리셋 이름이 같이 온다
const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {}
}))

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-custom-history-'))
  initDb()
})
afterEach(() => {
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

function addImage(name: string, sceneId: number | null): void {
  getDb()
    .prepare(`INSERT INTO images (file_path, payload_json, kind, scene_id) VALUES (?, '{}', ?, ?)`)
    .run(join(environment.directory, name), sceneId == null ? 't2i' : 'scene', sceneId)
}

describe('custom: history shows where a scene image came from', () => {
  it('returns the preset and scene name for scene images, and nothing for others', () => {
    const preset = createPreset('윤초아 D3 v16')
    const scene = createScene(preset, '42')
    addImage('plain.png', null)
    addImage('scene.png', scene)
    const { items, total } = listImages(10, 0)
    expect(total).toBe(2)
    expect(items.map((i) => [i.kind, i.presetName, i.sceneName, i.presetId, i.sceneId])).toEqual([
      ['scene', '윤초아 D3 v16', '42', preset, scene],
      ['t2i', null, null, null, null]
    ])
  })

  it('drops the names once the scene is deleted', () => {
    const scene = createScene(createPreset('P'), 'gone')
    addImage('scene.png', scene)
    deleteScene(scene)
    const { items } = listImages(10, 0)
    expect(items.every((i) => i.sceneName == null && i.presetName == null)).toBe(true)
  })
})
