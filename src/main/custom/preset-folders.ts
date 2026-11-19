import { getDb } from '../db'

/**
 * [custom] 씬 프리셋 폴더 — 프리셋 목록이 길어질 때 묶어 보는 용도.
 * 폴더는 프리셋에 붙는 이름표일 뿐이다 (같은 이름표끼리 목록에서 한 묶음으로 보인다).
 * 순서는 프리셋 순서를 그대로 쓴다. 지워진 프리셋의 이름표는 읽을 때 걸러 내고 치운다.
 */
function foldersDb(): ReturnType<typeof getDb> {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_preset_folders (
      preset_id INTEGER PRIMARY KEY,
      folder TEXT NOT NULL
    )
  `)
  return db
}

const FOLDER_MAX = 60
export const cleanFolderName = (name: string): string =>
  name.replace(/\s+/g, ' ').trim().slice(0, FOLDER_MAX)

/** 프리셋 id → 폴더 이름 */
export function getPresetFolders(): Record<number, string> {
  const db = foldersDb()
  db.exec('DELETE FROM custom_preset_folders WHERE preset_id NOT IN (SELECT id FROM scene_presets)')
  const rows = db.prepare('SELECT preset_id, folder FROM custom_preset_folders').all() as {
    preset_id: number
    folder: string
  }[]
  return Object.fromEntries(rows.map((r) => [r.preset_id, r.folder]))
}

/** 프리셋들을 폴더에 넣는다. folder가 비었으면 폴더에서 뺀다 */
export function setPresetFolder(presetIds: number[], folder: string | null): void {
  const db = foldersDb()
  const name = folder ? cleanFolderName(folder) : ''
  const remove = db.prepare('DELETE FROM custom_preset_folders WHERE preset_id = ?')
  const put = db.prepare(
    `INSERT INTO custom_preset_folders (preset_id, folder) VALUES (?, ?)
     ON CONFLICT(preset_id) DO UPDATE SET folder = excluded.folder`
  )
  db.transaction(() => {
    for (const id of presetIds) {
      if (name) put.run(id, name)
      else remove.run(id)
    }
  })()
}

/** 폴더 이름 바꾸기 (이미 있는 이름이면 그 폴더와 합쳐진다) */
export function renamePresetFolder(from: string, to: string): void {
  const name = cleanFolderName(to)
  if (!name) return
  foldersDb()
    .prepare('UPDATE custom_preset_folders SET folder = ? WHERE folder = ?')
    .run(name, from)
}
