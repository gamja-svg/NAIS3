import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, initDb } from '../src/main/db'
import {
  pickPresetByFileName,
  scanWatchFolder,
  setWatchFolderDir,
  setWatchFolderEnabled,
  stopWatchFolder
} from '../src/main/custom/watch-folder'
import {
  createPreset,
  createScene,
  exportScenesJson,
  getScene,
  listPresets,
  listScenes
} from '../src/main/scenes/repo'

// [custom] 감시 폴더(보관함 방식): 켠 뒤 생기거나 바뀐 파일만 불러오고, 파일은 건드리지 않는다
const environment = vi.hoisted(() => ({ directory: '', exportFile: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showSaveDialog: async () => ({ canceled: false, filePath: environment.exportFile }) }
}))

let watchDir = ''
/** 감시를 켠 시각 — 테스트 파일은 이보다 뒤(또는 앞)로 시각을 직접 찍는다 */
const SINCE = Date.now() - 60_000
let clock = 0

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-custom-watch-'))
  environment.exportFile = join(environment.directory, 'export.json')
  watchDir = join(environment.directory, 'watch')
  mkdirSync(watchDir)
  clock = 0
  initDb()
  setWatchFolderDir(watchDir, SINCE)
  setWatchFolderEnabled(true, SINCE)
})
afterEach(() => {
  stopWatchFolder()
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

/** 파일을 쓰고 수정 시각을 켠 시각 이후로 찍는다 (쓸 때마다 1초씩 뒤로) */
function drop(rel: string, body: unknown): void {
  const path = join(watchDir, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body))
  const at = new Date(SINCE + 10_000 + ++clock * 1000)
  utimesSync(path, at, at)
}
/** 다 써졌는지 보려고 첫 확인은 건너뛴다 — 두 번째 확인에서 처리된다 */
function settle(): ReturnType<typeof scanWatchFolder> {
  expect(scanWatchFolder()).toEqual([])
  return scanWatchFolder()
}
function tree(dir = watchDir, rel = ''): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tree(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`]
  )
}

describe('custom: pickPresetByFileName', () => {
  const presets = [
    { id: 1, name: 'D1' },
    { id: 2, name: 'D10' },
    { id: 3, name: 'N1' },
    { id: 4, name: '일상복' }
  ]
  it('matches a preset name bounded by non-word characters', () => {
    expect(pickPresetByFileName('0NURA_D1_v3.json', presets)).toEqual(presets[0])
    expect(pickPresetByFileName('0NURA_D10.json', presets)).toEqual(presets[1])
    expect(pickPresetByFileName('sub/d1.json', presets)).toEqual(presets[0])
    expect(pickPresetByFileName('0NURA 일상복 (2).json', presets)).toEqual(presets[3])
  })
  it('does not match inside a longer word', () => {
    expect(pickPresetByFileName('0NURA_D11.json', presets)).toBe('none')
    expect(pickPresetByFileName('XD1.json', presets)).toBe('none')
  })
  it('refuses to guess between presets', () => {
    expect(pickPresetByFileName('0NURA_D1_N1.json', presets)).toBe('ambiguous')
  })
  it('prefers the longest matching name', () => {
    const both = [
      { id: 1, name: 'D1' },
      { id: 2, name: '윤초아 D1' }
    ]
    expect(pickPresetByFileName('윤초아 D1.json', both)).toEqual(both[1])
  })
})

describe('custom: watch folder', () => {
  it('imports a new file in a subfolder into the preset named in the JSON, leaving the file in place', () => {
    const preset = createPreset('윤초아 D1')
    const kept = createScene(preset, '001')
    const body = {
      preset: '윤초아 D1',
      scenes: [
        { name: '001', prompt: 'new prompt' },
        { name: '002', prompt: 'added' }
      ]
    }
    drop('옆집 뒷계/json 모음/0NURA_D1_001-175_v21.json', body)
    const [event] = settle()
    expect(event).toEqual({
      file: '옆집 뒷계/json 모음/0NURA_D1_001-175_v21.json',
      ok: true,
      presetId: preset,
      presetName: '윤초아 D1',
      presetCreated: false,
      added: 1,
      updated: 1,
      unchanged: 0
    })
    expect(getScene(kept)?.prompt).toBe('new prompt')
    expect(listScenes(preset).map((s) => s.name)).toEqual(['001', '002'])
    // 파일은 그 자리에 그대로, 다른 파일·폴더도 생기지 않는다
    expect(tree()).toEqual(['옆집 뒷계/json 모음/0NURA_D1_001-175_v21.json'])
    expect(JSON.parse(readFileSync(join(watchDir, event.file), 'utf-8'))).toEqual(body)
    expect(scanWatchFolder()).toEqual([])
    expect(scanWatchFolder()).toEqual([])
  })

  it('leaves files that were there before watching was switched on', () => {
    const preset = createPreset('D1')
    const old = join(watchDir, 'old.json')
    writeFileSync(old, JSON.stringify({ preset: 'D1', scenes: [{ name: 'x', prompt: 'old' }] }))
    const before = new Date(SINCE - 3_600_000)
    utimesSync(old, before, before)
    // 만든 시각까지 과거인 파일만 '원래 있던 것'으로 본다 — 테스트에서는 기준 시각을 지금 이후로 당겨 확인
    setWatchFolderDir(watchDir, Date.now() + 60_000)
    expect(settle()).toEqual([])
    expect(listScenes(preset)).toHaveLength(0)
    expect(existsSync(old)).toBe(true)
  })

  it('imports again only when the file changes, and waits while it is still being written', () => {
    const preset = createPreset('D1')
    drop('a.json', { preset: 'D1', scenes: [{ name: '001', prompt: 'one' }] })
    expect(scanWatchFolder()).toEqual([])
    drop('a.json', { preset: 'D1', scenes: [{ name: '001', prompt: 'two' }] }) // 쓰는 중
    expect(settle()).toHaveLength(1)
    expect(listScenes(preset)[0].prompt).toBe('two')
    expect(settle()).toEqual([])
    drop('a.json', { preset: 'D1', scenes: [{ name: '001', prompt: 'three' }] })
    expect(settle()[0]).toMatchObject({ ok: true, added: 0, updated: 1, unchanged: 0 })
    expect(listScenes(preset)).toHaveLength(1)
  })

  it('remembers handled files across a restart', () => {
    createPreset('D1')
    drop('a.json', { preset: 'D1', scenes: [{ name: '001', prompt: 'p' }] })
    expect(settle()).toHaveLength(1)
    stopWatchFolder() // 프로그램 종료 흉내 — 메모리 기록이 사라진다
    expect(settle()).toEqual([])
    drop('b.json', { preset: 'D1', scenes: [{ name: '002', prompt: 'p' }] })
    stopWatchFolder() // 꺼져 있는 동안 들어온 파일은 다음에 켰을 때 불러온다
    expect(settle().map((e) => e.file)).toEqual(['b.json'])
  })

  it('creates the preset named in the JSON, but never from the file name alone', () => {
    const count = listPresets().length
    drop('0NURA_D5.json', { scenes: [{ name: '001', prompt: 'p' }] })
    expect(settle()[0]).toEqual({ file: '0NURA_D5.json', ok: false, reason: 'noPreset' })
    expect(listPresets()).toHaveLength(count)
    drop(
      '0NURA_D5.json',
      '\uFEFF' + JSON.stringify({ preset: ' 윤초아 D5 ', scenes: [{ name: '001', prompt: 'p' }] })
    )
    expect(settle()[0]).toMatchObject({ ok: true, presetName: '윤초아 D5', presetCreated: true })
    expect(listPresets().filter((p) => p.name === '윤초아 D5')).toHaveLength(1)
  })

  it('reports files it cannot use once, without touching scenes or files', () => {
    const preset = createPreset('D1')
    createPreset('N1')
    drop('D1_N1.json', { scenes: [{ name: '001', prompt: 'p' }] })
    drop('broken.json', '{ not json')
    drop('empty.json', { preset: 'D1', scenes: [] })
    drop('settings.json', { theme: 'dark' })
    expect(settle().map((e) => [e.file, e.ok, e.reason])).toEqual([
      ['broken.json', false, 'unrecognized'],
      ['D1_N1.json', false, 'ambiguousPreset'],
      ['empty.json', false, 'empty'],
      ['settings.json', false, 'unrecognized']
    ])
    expect(listScenes(preset)).toHaveLength(0)
    expect(tree().sort()).toEqual(['D1_N1.json', 'broken.json', 'empty.json', 'settings.json'])
    expect(settle()).toEqual([])
  })

  it('ignores other file types and hidden folders, and does nothing while switched off', () => {
    const preset = createPreset('D1')
    const body = { preset: 'D1', scenes: [{ name: 'x', prompt: 'p' }] }
    drop('D1.txt', body)
    drop('.git/D1.json', body)
    drop('node_modules/pkg/package.json', body)
    expect(settle()).toEqual([])
    setWatchFolderEnabled(false)
    drop('D1.json', body)
    expect(settle()).toEqual([])
    expect(listScenes(preset)).toHaveLength(0)
  })

  it('does nothing when the folder is missing', () => {
    setWatchFolderDir(join(environment.directory, 'gone'), SINCE)
    expect(settle()).toEqual([])
  })

  it('writes the preset name into exported scene JSON', async () => {
    const preset = createPreset('윤초아 D1')
    createScene(preset, '001')
    await exportScenesJson(preset)
    const exported = JSON.parse(readFileSync(environment.exportFile, 'utf-8'))
    expect(exported.preset).toBe('윤초아 D1')
    expect(exported.scenes).toHaveLength(1)
  })
})
