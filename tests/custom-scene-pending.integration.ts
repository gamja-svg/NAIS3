import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '../src/main/db'
import {
  clearScenePending,
  createPreset,
  createScene,
  deleteScene,
  getScene,
  importScenesJson,
  listScenes,
  updateScene
} from '../src/main/scenes/repo'

// [custom] 씬 JSON 덮어쓰기 불러오기 + '변경 후 미생성' 표시 검증
const environment = vi.hoisted(() => ({ directory: '', importFile: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [environment.importFile] })
  }
}))

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-custom-pending-'))
  environment.importFile = join(environment.directory, 'scenes.json')
  initDb()
})
afterEach(() => {
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

/** 시간 경과 흉내 — 지금까지의 변경 시각과 이미지를 한 시간 과거로 민다 (SQLite 시각은 초 단위) */
function passTime(): void {
  const db = getDb()
  db.exec(`CREATE TABLE IF NOT EXISTS custom_scene_marks (
    scene_id INTEGER PRIMARY KEY, changed_at TEXT NOT NULL DEFAULT (datetime('now')), acked INTEGER NOT NULL DEFAULT 0)`)
  db.exec("UPDATE custom_scene_marks SET changed_at = datetime(changed_at, '-1 hour')")
  db.exec("UPDATE images SET created_at = datetime(created_at, '-1 hour')")
}
function addImage(sceneId: number, when = "datetime('now')"): void {
  passTime()
  getDb()
    .prepare(
      `INSERT INTO images (file_path, payload_json, kind, scene_id, created_at)
       VALUES (?, '{}', 'scene', ?, ${when})`
    )
    .run(join(environment.directory, `img-${sceneId}-${Math.random()}.png`), sceneId)
}
function writeImport(scenes: object[]): void {
  writeFileSync(environment.importFile, JSON.stringify({ version: 1, scenes }), 'utf-8')
}
const pending = (id: number): boolean => getScene(id)?.pending === true

describe('custom: pending marker', () => {
  it('marks a scene with no images, clears it once an image exists', () => {
    const id = createScene(createPreset('p'), 'a')
    expect(pending(id)).toBe(true)
    addImage(id)
    expect(pending(id)).toBe(false)
  })

  it('turns on only when prompt, negative prompt or size really change', () => {
    const preset = createPreset('p')
    const id = createScene(preset, 'a')
    updateScene(id, { prompt: 'one' })
    addImage(id)
    expect(pending(id)).toBe(false)

    updateScene(id, { name: 'renamed' })
    updateScene(id, { reserveCount: 3 })
    updateScene(id, { prompt: 'one' })
    expect(pending(id)).toBe(false)

    passTime()
    updateScene(id, { prompt: 'two' })
    expect(pending(id)).toBe(true)
    expect(listScenes(preset).find((s) => s.id === id)?.pending).toBe(true)

    addImage(id)
    expect(pending(id)).toBe(false)

    passTime()
    updateScene(id, { negativePrompt: 'bad' })
    expect(pending(id)).toBe(true)
    addImage(id)
    expect(pending(id)).toBe(false)
    passTime()
    updateScene(id, { width: 1024 })
    expect(pending(id)).toBe(true)
  })

  it('ignores images made before the change', () => {
    const id = createScene(createPreset('p'), 'a')
    addImage(id)
    expect(pending(id)).toBe(false)
    passTime()
    updateScene(id, { prompt: 'changed' })
    expect(pending(id)).toBe(true)
  })

  it('can be dismissed by hand and comes back on the next change', () => {
    const id = createScene(createPreset('p'), 'a')
    clearScenePending(id)
    expect(pending(id)).toBe(false)
    updateScene(id, { prompt: 'again' })
    expect(pending(id)).toBe(true)
    clearScenePending(id)
    expect(pending(id)).toBe(false)
  })

  it('survives deleting a marked scene', () => {
    const preset = createPreset('p')
    const id = createScene(preset, 'a')
    updateScene(id, { prompt: 'x' })
    deleteScene(id)
    expect(getScene(id)).toBeNull()
    expect(listScenes(preset)).toHaveLength(0)
  })
})

describe('custom: import overwrites scenes with the same name', () => {
  it('replaces content in place, keeps order and images, adds unknown names', async () => {
    const preset = createPreset('p')
    const first = createScene(preset, '131scene')
    const second = createScene(preset, '132scene')
    updateScene(first, { prompt: 'old first', negativePrompt: 'old neg' })
    updateScene(second, { prompt: 'keep second' })
    addImage(first)
    addImage(second)
    expect(pending(first)).toBe(false)
    passTime()

    writeImport([
      {
        name: '131scene',
        prompt: 'new first',
        negativePrompt: 'new neg',
        width: 1024,
        height: 1024
      },
      { name: '132scene', prompt: 'keep second', negativePrompt: '', width: 832, height: 1216 },
      { name: '133scene', prompt: 'brand new', negativePrompt: '', width: 1024, height: 1024 }
    ])
    const result = await importScenesJson(preset)
    expect(result).toEqual({ count: 3 })

    const scenes = listScenes(preset)
    expect(scenes.map((s) => s.name)).toEqual(['131scene', '132scene', '133scene'])
    expect(scenes[0]).toMatchObject({
      id: first,
      prompt: 'new first',
      negativePrompt: 'new neg',
      width: 1024,
      height: 1024,
      imageCount: 1,
      pending: true
    })
    // 내용이 같은 씬은 건드리지 않는다
    expect(scenes[1]).toMatchObject({ id: second, prompt: 'keep second', pending: false })
    expect(scenes[2]).toMatchObject({ prompt: 'brand new', imageCount: 0, pending: true })
  })

  it('importing the same file twice changes nothing the second time', async () => {
    const preset = createPreset('p')
    writeImport([{ name: 'a', prompt: 'p1', negativePrompt: 'n1', width: 1024, height: 1024 }])
    await importScenesJson(preset)
    const [scene] = listScenes(preset)
    addImage(scene.id)
    expect(pending(scene.id)).toBe(false)
    passTime()

    await importScenesJson(preset)
    expect(listScenes(preset)).toHaveLength(1)
    expect(pending(scene.id)).toBe(false)
  })
})
