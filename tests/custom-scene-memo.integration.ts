import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '../src/main/db'
import {
  bulkDelete,
  createPreset,
  createScene,
  deletePreset,
  deleteScene,
  exportScenesJson,
  getScene,
  importScenesJson,
  listScenes,
  setSceneMemo,
  updateScene
} from '../src/main/scenes/repo'

// [custom] 씬 메모(별명): 카드에 보이는 한 줄 메모. 내용 변경이 아니고, 지운 씬의 메모는 남지 않는다
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
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-custom-memo-'))
  environment.file = join(environment.directory, 'scenes.json')
  initDb()
})
afterEach(() => {
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

const memoOf = (id: number): string | undefined => getScene(id)?.memo

describe('custom: scene memo', () => {
  it('saves one tidy line, shows it in lists, and clears it when empty', () => {
    const preset = createPreset('p')
    const id = createScene(preset, '41')
    expect(memoOf(id)).toBeUndefined()
    setSceneMemo(id, '  침대 위\n미소  ')
    expect(memoOf(id)).toBe('침대 위 미소')
    expect(listScenes(preset).find((s) => s.id === id)?.memo).toBe('침대 위 미소')
    setSceneMemo(id, 'x'.repeat(300))
    expect(memoOf(id)).toHaveLength(200)
    setSceneMemo(id, '   ')
    expect(memoOf(id)).toBeUndefined()
  })

  it('is not a content change — a generated scene stays generated', () => {
    const id = createScene(createPreset('p'), 'a')
    updateScene(id, { prompt: 'one' })
    getDb()
      .prepare(
        `INSERT INTO images (file_path, payload_json, kind, scene_id, created_at)
         VALUES ('x.png', '{}', 'scene', ?, datetime('now', '+1 minute'))`
      )
      .run(id)
    expect(getScene(id)?.pending).toBe(false)
    setSceneMemo(id, '메모')
    expect(getScene(id)?.pending).toBe(false)
  })

  it('drops memos of deleted scenes so a reused number starts clean', () => {
    const preset = createPreset('p')
    const keep = createPreset('keep')
    const a = createScene(preset, 'a')
    const b = createScene(preset, 'b')
    const c = createScene(preset, 'c')
    for (const id of [a, b, c]) setSceneMemo(id, `memo ${id}`)
    deleteScene(c) // 마지막 번호 → 다음 씬이 같은 번호를 받을 수 있다
    const reused = createScene(preset, 'new')
    expect(memoOf(reused)).toBeUndefined()
    bulkDelete([a])
    deletePreset(preset)
    const rows = getDb().prepare('SELECT scene_id FROM custom_scene_memos').all()
    expect(rows).toEqual([])
    expect(keep).toBeGreaterThan(0)
  })

  it('reads memos from scene JSON without marking scenes as changed, and writes them back', async () => {
    const preset = createPreset('p')
    const id = createScene(preset, '1')
    updateScene(id, { prompt: 'girl' })
    getDb()
      .prepare(
        `INSERT INTO images (file_path, payload_json, kind, scene_id, created_at)
         VALUES ('x.png', '{}', 'scene', ?, datetime('now', '+1 minute'))`
      )
      .run(id)
    writeFileSync(
      environment.file,
      JSON.stringify({
        version: 1,
        scenes: [
          { name: '1', prompt: 'girl', memo: '교복 미소' },
          { name: '2', prompt: 'girl, sitting', memo: '앉은 자세' },
          { name: '3', prompt: 'girl, lying' }
        ]
      }),
      'utf-8'
    )
    await importScenesJson(preset)
    const scenes = listScenes(preset)
    expect(scenes.map((s) => [s.name, s.memo])).toEqual([
      ['1', '교복 미소'],
      ['2', '앉은 자세'],
      ['3', undefined]
    ])
    expect(getScene(id)?.pending).toBe(false) // 메모만 바뀐 씬은 다시 뽑을 필요 없다

    // 메모 칸이 없으면 그대로, 빈 글자면 지운다
    writeFileSync(
      environment.file,
      JSON.stringify({
        version: 1,
        scenes: [
          { name: '1', prompt: 'girl' },
          { name: '2', prompt: 'girl, sitting', memo: '' }
        ]
      }),
      'utf-8'
    )
    await importScenesJson(preset)
    expect(listScenes(preset).map((s) => s.memo)).toEqual(['교복 미소', undefined, undefined])

    await exportScenesJson(preset)
    const saved = JSON.parse(readFileSync(environment.file, 'utf-8')) as {
      scenes: { name: string; memo?: string }[]
    }
    expect(saved.scenes.map((s) => s.memo)).toEqual(['교복 미소', undefined, undefined])
  })
})
