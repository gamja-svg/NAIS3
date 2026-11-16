import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '../src/main/db'
import {
  clearScenePending,
  createPreset,
  createScene,
  getSceneBase,
  importScenesJson,
  updateScene
} from '../src/main/scenes/repo'

// [custom] 미생성 씬의 기준 내용 — 마지막으로 뽑았거나 확인한 때의 프롬프트 (바뀐 태그 표시용)
const environment = vi.hoisted(() => ({ directory: '', importFile: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [environment.importFile] })
  }
}))

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-custom-base-'))
  environment.importFile = join(environment.directory, 'scenes.json')
  initDb()
})
afterEach(() => {
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

/** 시간 경과 흉내 — 변경 시각과 이미지를 한 시간 과거로 민다 (SQLite 시각은 초 단위) */
function passTime(): void {
  const db = getDb()
  db.exec("UPDATE custom_scene_marks SET changed_at = datetime(changed_at, '-1 hour')")
  db.exec("UPDATE images SET created_at = datetime(created_at, '-1 hour')")
}
function generate(sceneId: number): void {
  passTime()
  getDb()
    .prepare(
      `INSERT INTO images (file_path, payload_json, kind, scene_id) VALUES (?, '{}', 'scene', ?)`
    )
    .run(join(environment.directory, `img-${sceneId}-${Math.random()}.png`), sceneId)
}

describe('custom: base content of a pending scene', () => {
  it('keeps the content the last image was made from while the scene stays pending', () => {
    const id = createScene(createPreset('p'), 'a')
    updateScene(id, { prompt: 'girl, smile', negativePrompt: 'bad hands' })
    generate(id)
    expect(getSceneBase(id)).toBeNull() // 뽑은 그림과 내용이 같다

    updateScene(id, { prompt: 'girl, grin' })
    expect(getSceneBase(id)).toEqual({ prompt: 'girl, smile', negativePrompt: 'bad hands' })
    updateScene(id, { prompt: 'girl, grin, blush', negativePrompt: 'bad hands, blurry' })
    // 미생성인 동안 더 고쳐도 기준은 처음 그대로 — 바뀐 태그가 쌓여 보인다
    expect(getSceneBase(id)).toEqual({ prompt: 'girl, smile', negativePrompt: 'bad hands' })

    generate(id)
    expect(getSceneBase(id)).toBeNull() // 다시 뽑으면 표시도 끝
    updateScene(id, { prompt: 'girl' })
    expect(getSceneBase(id)?.prompt).toBe('girl, grin, blush') // 새 기준 = 다시 뽑은 때 내용
  })

  it('has no base for a scene that was never generated', () => {
    const id = createScene(createPreset('p'), 'a')
    updateScene(id, { prompt: 'one' })
    updateScene(id, { prompt: 'two' })
    expect(getSceneBase(id)).toBeNull()
  })

  it('starts from the checked content after the mark was turned off by hand', () => {
    const id = createScene(createPreset('p'), 'a')
    updateScene(id, { prompt: 'one' })
    generate(id)
    updateScene(id, { prompt: 'two' })
    clearScenePending(id)
    expect(getSceneBase(id)).toBeNull()
    updateScene(id, { prompt: 'three' })
    expect(getSceneBase(id)?.prompt).toBe('two')
  })

  it('records the base when a scene JSON import changes a generated scene', async () => {
    const preset = createPreset('p')
    const id = createScene(preset, 'a')
    updateScene(id, { prompt: 'old tags', negativePrompt: 'old neg' })
    generate(id)
    writeFileSync(
      environment.importFile,
      JSON.stringify({
        version: 1,
        scenes: [{ name: 'a', prompt: 'new tags', negativePrompt: 'old neg' }]
      }),
      'utf-8'
    )
    await importScenesJson(preset)
    expect(getSceneBase(id)).toEqual({ prompt: 'old tags', negativePrompt: 'old neg' })
  })

  it('adds the base columns to a marks table made by an older version', () => {
    closeDb()
    initDb()
    const db = getDb()
    db.exec('DROP TABLE IF EXISTS custom_scene_marks')
    db.exec(`CREATE TABLE custom_scene_marks (
      scene_id INTEGER PRIMARY KEY, changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      acked INTEGER NOT NULL DEFAULT 0)`)
    closeDb()
    initDb() // 새 연결 → 처음 쓸 때 칸을 더한다
    const id = createScene(createPreset('p'), 'a')
    updateScene(id, { prompt: 'one' })
    generate(id)
    updateScene(id, { prompt: 'two' })
    expect(getSceneBase(id)?.prompt).toBe('one')
  })
})
