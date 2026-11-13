import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  WATCH_DONE_DIR,
  WATCH_FAILED_DIR,
  pickPresetByFileName,
  scanWatchFolder,
  setWatchFolderDir,
  setWatchFolderEnabled,
  stopWatchFolder
} from '../src/main/custom/watch-folder'
import {
  createPreset,
  createScene,
  getScene,
  listPresets,
  listScenes
} from '../src/main/scenes/repo'

// [custom] 감시 폴더: 프리셋 정하기, 덮어쓰기 불러오기, 완료/실패 폴더 이동 검증
const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {}
}))

let watchDir = ''
beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-custom-watch-'))
  watchDir = join(environment.directory, 'watch')
  mkdirSync(watchDir)
  initDb()
  setWatchFolderDir(watchDir)
  setWatchFolderEnabled(true)
})
afterEach(() => {
  stopWatchFolder()
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

function drop(name: string, body: unknown): void {
  writeFileSync(join(watchDir, name), typeof body === 'string' ? body : JSON.stringify(body))
}
/** 파일이 다 써졌는지 보려고 첫 확인은 건너뛴다 — 두 번째 확인에서 처리된다 */
function settle(): ReturnType<typeof scanWatchFolder> {
  expect(scanWatchFolder()).toEqual([])
  return scanWatchFolder()
}
const jsonLeft = (): string[] => readdirSync(watchDir).filter((n) => n.endsWith('.json'))
const sub = (name: string): string[] =>
  existsSync(join(watchDir, name)) ? readdirSync(join(watchDir, name)) : []

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
    expect(pickPresetByFileName('d1.json', presets)).toEqual(presets[0])
    expect(pickPresetByFileName('0NURA 일상복 (2).json', presets)).toEqual(presets[3])
  })
  it('does not match inside a longer word', () => {
    expect(pickPresetByFileName('0NURA_D11.json', presets)).toBe('none')
    expect(pickPresetByFileName('XD1.json', presets)).toBe('none')
  })
  it('refuses to guess between presets', () => {
    expect(pickPresetByFileName('0NURA_D1_N1.json', presets)).toBe('ambiguous')
    expect(
      pickPresetByFileName('D1.json', [
        { id: 1, name: 'D1' },
        { id: 9, name: 'd1' }
      ])
    ).toBe('ambiguous')
  })
  it('prefers the longest matching name', () => {
    const both = [
      { id: 1, name: 'D1' },
      { id: 2, name: '0NURA D1' }
    ]
    expect(pickPresetByFileName('0NURA D1.json', both)).toEqual(both[1])
  })
})

describe('custom: watch folder', () => {
  it('waits until the file stops changing, then imports and moves it to the done folder', () => {
    const preset = createPreset('D1')
    const kept = createScene(preset, '001')
    drop('0NURA_D1.json', {
      scenes: [
        { name: '001', prompt: 'new prompt' },
        { name: '002', prompt: 'added' }
      ]
    })
    expect(scanWatchFolder()).toEqual([])
    // 쓰는 중: 내용이 또 바뀌면 다시 한 번 기다린다
    drop('0NURA_D1.json', {
      scenes: [
        { name: '001', prompt: 'final prompt' },
        { name: '002', prompt: 'added' }
      ]
    })
    utimesSync(join(watchDir, '0NURA_D1.json'), new Date(), new Date(Date.now() + 5000))
    const [event] = settle()
    expect(event).toMatchObject({
      file: '0NURA_D1.json',
      ok: true,
      presetId: preset,
      presetName: 'D1',
      presetCreated: false,
      added: 1,
      updated: 1,
      unchanged: 0,
      moved: true
    })
    expect(getScene(kept)?.prompt).toBe('final prompt')
    expect(listScenes(preset).map((s) => s.name)).toEqual(['001', '002'])
    expect(jsonLeft()).toEqual([])
    expect(sub(WATCH_DONE_DIR)).toHaveLength(1)
    expect(sub(WATCH_DONE_DIR)[0]).toMatch(/^\d{8}-\d{6}_0NURA_D1\.json$/)
    expect(scanWatchFolder()).toEqual([])
  })

  it('reports unchanged scenes when the same file is dropped again', () => {
    const preset = createPreset('D1')
    drop('D1.json', { scenes: [{ name: '001', prompt: 'p' }] })
    expect(settle()[0]).toMatchObject({ added: 1, updated: 0, unchanged: 0 })
    drop('D1.json', { scenes: [{ name: '001', prompt: 'p' }] })
    expect(settle()[0]).toMatchObject({ added: 0, updated: 0, unchanged: 1 })
    expect(listScenes(preset)).toHaveLength(1)
    expect(sub(WATCH_DONE_DIR)).toHaveLength(2)
  })

  it('uses the preset named in the JSON and creates it when missing', () => {
    const d1 = createPreset('D1')
    drop('0NURA_D1.json', { preset: 'D5', scenes: [{ name: '001', prompt: 'p' }] })
    expect(settle()[0]).toMatchObject({ ok: true, presetName: 'D5', presetCreated: true, added: 1 })
    const d5 = listPresets().find((p) => p.name === 'D5')!
    expect(listScenes(d5.id)).toHaveLength(1)
    expect(listScenes(d1)).toHaveLength(0)
    drop(
      'again.json',
      '﻿' + JSON.stringify({ preset: ' d5 ', scenes: [{ name: '002', prompt: 'p' }] })
    )
    expect(settle()[0]).toMatchObject({ ok: true, presetId: d5.id, presetCreated: false })
    expect(listPresets().filter((p) => p.name.toLowerCase() === 'd5')).toHaveLength(1)
  })

  it('moves files it cannot place to the failed folder with a reason, without touching scenes', () => {
    const preset = createPreset('D1')
    createPreset('N1')
    const presetCount = listPresets().length
    drop('nothing.json', { scenes: [{ name: '001', prompt: 'p' }] })
    drop('D1_N1.json', { scenes: [{ name: '001', prompt: 'p' }] })
    drop('D1_broken.json', '{ not json')
    drop('D1_empty.json', { scenes: [] })
    const events = settle()
    expect(events.map((e) => [e.file, e.ok, e.reason])).toEqual([
      ['D1_N1.json', false, 'ambiguousPreset'],
      ['D1_broken.json', false, 'unrecognized'],
      ['D1_empty.json', false, 'empty'],
      ['nothing.json', false, 'noPreset']
    ])
    expect(listScenes(preset)).toHaveLength(0)
    expect(listPresets()).toHaveLength(presetCount)
    expect(jsonLeft()).toEqual([])
    const failed = sub(WATCH_FAILED_DIR)
    expect(failed.filter((n) => n.endsWith('.json'))).toHaveLength(4)
    expect(failed.filter((n) => n.endsWith('.json.txt'))).toHaveLength(4)
  })

  it('ignores subfolders, other file types, and does nothing while switched off', () => {
    const preset = createPreset('D1')
    mkdirSync(join(watchDir, 'D1'))
    writeFileSync(
      join(watchDir, 'D1', 'D1.json'),
      JSON.stringify({ scenes: [{ name: 'x', prompt: 'p' }] })
    )
    drop('D1.txt', { scenes: [{ name: 'x', prompt: 'p' }] })
    expect(settle()).toEqual([])
    setWatchFolderEnabled(false)
    drop('D1.json', { scenes: [{ name: '001', prompt: 'p' }] })
    expect(settle()).toEqual([])
    expect(listScenes(preset)).toHaveLength(0)
    expect(jsonLeft()).toEqual(['D1.json'])
    setWatchFolderEnabled(true)
    expect(settle()).toHaveLength(1)
    expect(listScenes(preset)).toHaveLength(1)
  })

  it('does nothing when the folder is missing', () => {
    setWatchFolderDir(join(environment.directory, 'gone'))
    expect(settle()).toEqual([])
  })
})
