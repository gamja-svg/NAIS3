import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, initDb } from '../src/main/db'
import {
  createCharacter,
  createFolder,
  deleteFolder,
  listCharacters,
  reorderCharacters
} from '../src/main/characters/repo'
import {
  arrangeFolderGroups,
  createFolderGroup,
  deleteFolderGroup,
  listFolderGroups,
  updateFolderGroup
} from '../src/main/custom/folder-groups'
import type { FolderGroupKind } from '../src/shared/types'

// [custom] 상위 폴더 저장: 순서·소속·정리, 원본 폴더·카드는 건드리지 않음
const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'ko' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {}
}))

beforeEach(() => {
  environment.directory = mkdtempSync(join(tmpdir(), 'nais3-custom-groups-'))
  initDb()
})
afterEach(() => {
  closeDb()
  rmSync(environment.directory, { recursive: true, force: true })
})

describe('custom: folder groups storage', () => {
  it('starts empty, then keeps group order, state and folder links', () => {
    expect(listFolderGroups('chars')).toEqual({ groups: [], links: [] })
    const a = createFolder('윤초아')
    const b = createFolder('Lover_C')
    const c = createFolder('레비')
    const g1 = createFolderGroup('chars', '옆집 뒷계')
    const g2 = createFolderGroup('chars', '악마 하렘')
    updateFolderGroup(g2, { collapsed: true, color: '#c47a72' })
    updateFolderGroup(g1, { name: '옆집 뒷계 ①' })
    arrangeFolderGroups(
      'chars',
      [g2, g1],
      [
        { folderId: a, groupId: g1 },
        { folderId: b, groupId: g1 },
        { folderId: c, groupId: g2 }
      ]
    )
    const { groups, links } = listFolderGroups('chars')
    expect(groups).toEqual([
      { id: g2, name: '악마 하렘', collapsed: true, color: '#c47a72' },
      { id: g1, name: '옆집 뒷계 ①', collapsed: false, color: null }
    ])
    expect(links.sort((x, y) => x.folderId - y.folderId)).toEqual([
      { folderId: a, groupId: g1 },
      { folderId: b, groupId: g1 },
      { folderId: c, groupId: g2 }
    ])
  })

  it('replaces links on arrange and ignores folders or groups that do not exist', () => {
    const a = createFolder('A')
    const b = createFolder('B')
    const g = createFolderGroup('chars', 'G')
    arrangeFolderGroups('chars', [g], [{ folderId: a, groupId: g }])
    arrangeFolderGroups(
      'chars',
      [g],
      [
        { folderId: b, groupId: g },
        { folderId: 999, groupId: g },
        { folderId: a, groupId: 999 }
      ]
    )
    expect(listFolderGroups('chars').links).toEqual([{ folderId: b, groupId: g }])
  })

  it('drops links of deleted folders, and deleting a group keeps its folders and cards', () => {
    const a = createFolder('A')
    const b = createFolder('B')
    const card = createCharacter('카드', b)
    const g = createFolderGroup('chars', 'G')
    arrangeFolderGroups(
      'chars',
      [g],
      [
        { folderId: a, groupId: g },
        { folderId: b, groupId: g }
      ]
    )
    deleteFolder(a)
    expect(listFolderGroups('chars').links).toEqual([{ folderId: b, groupId: g }])
    deleteFolderGroup(g)
    expect(listFolderGroups('chars')).toEqual({ groups: [], links: [] })
    const { folders, items } = listCharacters()
    expect(folders.map((f) => f.id)).toEqual([b])
    expect(items.find((i) => i.id === card)?.folderId).toBe(b)
  })

  it('leaves the original folder order to the original reorder', () => {
    const a = createFolder('A')
    const b = createFolder('B')
    const g = createFolderGroup('chars', 'G')
    arrangeFolderGroups('chars', [g], [{ folderId: a, groupId: g }])
    reorderCharacters([
      { type: 'folder', id: b },
      { type: 'folder', id: a }
    ])
    expect(listCharacters().folders.map((f) => f.id)).toEqual([b, a])
    expect(listFolderGroups('chars').links).toEqual([{ folderId: a, groupId: g }])
  })

  it('refuses unknown kinds', () => {
    expect(() => listFolderGroups('frags' as FolderGroupKind)).toThrow()
    expect(() => createFolderGroup('x' as FolderGroupKind, 'G')).toThrow()
  })
})
