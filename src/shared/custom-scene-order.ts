/**
 * [custom] 씬 번호 순서 — 이름이 번호로 시작하는 씬("25", "25 뒤돌아보기", "54_3")을 번호 자리에 둔다.
 * 감시 폴더로 새 씬이 들어올 때 끝에 붙지 않고 번호 자리에 끼우고, 섞인 프리셋은 번호순으로 정렬한다.
 */
interface Named {
  id: number
  name: string
}

/** 이름 앞머리의 번호들 — "54_3" → [54, 3], "25 뒤돌아보기" → [25]. 번호로 시작하지 않으면 null */
export function sceneNumberKey(name: string): number[] | null {
  const head = /^\s*(\d+(?:[._-]\d+)*)/.exec(name)
  return head ? head[1].split(/[._-]/).map(Number) : null
}

/** 번호 비교 — 앞에서부터, 짧은 쪽이 먼저 (54 < 54_3 < 55) */
export function compareSceneKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

/**
 * 새 씬을 번호 자리에 끼운 순서 — 있던 씬의 순서는 건드리지 않는다.
 * 새 씬은 자기 번호 이하인 마지막 씬 바로 뒤에 (그런 씬이 없으면 더 큰 번호의 첫 씬 앞에) 들어간다.
 * 번호가 없는 새 씬과, 번호 씬이 하나도 없는 목록은 끝에 붙는다.
 */
export function placeScenesByNumber(ordered: Named[], addedIds: number[]): number[] {
  const added = new Set(addedIds)
  const list = ordered.filter((s) => !added.has(s.id))
  for (const scene of ordered.filter((s) => added.has(s.id))) {
    const key = sceneNumberKey(scene.name)
    let at = list.length
    if (key) {
      const keys = list.map((s) => sceneNumberKey(s.name))
      const last = keys.findLastIndex((k) => k !== null && compareSceneKeys(k, key) <= 0)
      const next = keys.findIndex((k) => k !== null && compareSceneKeys(k, key) > 0)
      at = last >= 0 ? last + 1 : next >= 0 ? next : list.length
    }
    list.splice(at, 0, scene)
  }
  return list.map((s) => s.id)
}

/** 번호순으로 정렬한 순서 — 번호가 같으면 원래 순서, 번호 없는 씬은 원래 순서대로 뒤에 */
export function sortScenesByNumber(ordered: Named[]): number[] {
  const keyed = ordered
    .map((scene, index) => ({ scene, index, key: sceneNumberKey(scene.name) }))
    .filter((e): e is { scene: Named; index: number; key: number[] } => e.key !== null)
    .sort((a, b) => compareSceneKeys(a.key, b.key) || a.index - b.index)
  return [
    ...keyed.map((e) => e.scene.id),
    ...ordered.filter((s) => sceneNumberKey(s.name) === null).map((s) => s.id)
  ]
}
