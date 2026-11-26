import { describe, expect, it } from 'vitest'
import {
  autoFolders,
  folderOrder,
  groupPresets,
  joinOrder,
  moveInFolders,
  namePrefix
} from '../src/renderer/src/lib/custom-preset-folders'

// [custom] 씬 프리셋 폴더: 묶음과 순서 계산
const presets = [
  { id: 1, name: '윤초아 n5' },
  { id: 2, name: '혼자' },
  { id: 3, name: '윤초아 D3' },
  { id: 4, name: '루나_교복' },
  { id: 5, name: '루나-사복' }
]

describe('custom: preset folders', () => {
  it('gathers a folder at its first preset and keeps the rest in place', () => {
    const groups = groupPresets(presets, { 1: 'A', 3: 'A' })
    expect(groups.map((g) => [g.folder, g.presets.map((p) => p.id)])).toEqual([
      ['A', [1, 3]],
      [null, [2]],
      [null, [4]],
      [null, [5]]
    ])
    expect(folderOrder(presets, { 1: 'A', 3: 'A' })).toEqual([1, 3, 2, 4, 5])
    expect(folderOrder(presets, {})).toEqual([1, 2, 3, 4, 5])
  })

  it('moves a preset only inside its folder, and a folder as one block', () => {
    const folders = { 1: 'A', 3: 'A' }
    expect(moveInFolders(presets, folders, 3, -1)).toEqual([3, 1, 2, 4, 5])
    expect(moveInFolders(presets, folders, 1, -1)).toBeNull()
    expect(moveInFolders(presets, folders, 3, 1)).toBeNull()
    expect(moveInFolders(presets, folders, 'A', 1)).toEqual([2, 1, 3, 4, 5])
    expect(moveInFolders(presets, folders, 'A', -1)).toBeNull()
    expect(moveInFolders(presets, folders, 2, -1)).toEqual([2, 1, 3, 4, 5])
    expect(moveInFolders(presets, folders, 5, 1)).toBeNull()
    expect(moveInFolders(presets, folders, '없는 폴더', 1)).toBeNull()
  })

  it('sends a joining preset to the end of the folder instead of pulling the folder up', () => {
    const folders = { 4: '루나', 5: '루나' }
    expect(joinOrder(presets, folders, [2], '루나')).toEqual([1, 3, 4, 5, 2])
    expect(joinOrder(presets, folders, [1, 3], '루나')).toEqual([2, 4, 5, 1, 3])
    expect(joinOrder(presets, folders, [4], '루나')).toEqual([1, 2, 3, 5, 4])
    expect(joinOrder(presets, folders, [1, 3], '새 폴더')).toEqual([1, 2, 3, 4, 5])
  })

  it('groups by the first word of the name', () => {
    expect(namePrefix('  윤초아 n5')).toBe('윤초아')
    expect(namePrefix('루나_교복')).toBe('루나')
    expect(autoFolders(presets, {})).toEqual({ 윤초아: [1, 3], 루나: [4, 5] })
  })

  it('leaves foldered and one-word presets alone, but fills an existing folder', () => {
    expect(autoFolders(presets, { 1: '내 폴더' })).toEqual({ 루나: [4, 5] })
    expect(autoFolders(presets, { 1: '윤초아', 4: 'X', 5: 'X' })).toEqual({ 윤초아: [3] })
    expect(
      autoFolders(
        [
          { id: 9, name: '혼자' },
          { id: 10, name: '혼자' }
        ],
        {}
      )
    ).toEqual({})
  })
})
