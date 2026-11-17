/**
 * [custom] 콕 찍기 — 모양 후보를 다듬고 고르는 계산 (모델과 무관한 순수 함수).
 * 자동검열기(engine.py)의 Shaper와 같은 규칙: 가장 큰 덩어리만 남기고 구멍을 메운 뒤,
 * 겹치는 후보를 추리고 덩어리꼴(볼록 껍질에 견준 넓이)이 좋은 것 가운데 점수가 높은 것을 고른다.
 */

export interface Mask {
  width: number
  height: number
  /** 0 또는 1 */
  data: Uint8Array
}

export function maskArea(m: Mask): number {
  let n = 0
  for (let i = 0; i < m.data.length; i++) n += m.data[i]
  return n
}

/** 4방향으로 이어진 덩어리 가운데 가장 큰 것만 남긴다 */
export function largestBlob(m: Mask): Mask {
  const { width, height, data } = m
  const label = new Int32Array(data.length)
  const stack = new Int32Array(data.length)
  let best = 0
  let bestSize = 0
  let next = 0
  for (let start = 0; start < data.length; start++) {
    if (!data[start] || label[start]) continue
    next++
    let size = 0
    let top = 0
    stack[top++] = start
    label[start] = next
    while (top > 0) {
      const p = stack[--top]
      size++
      const x = p % width
      if (x > 0 && data[p - 1] && !label[p - 1]) {
        label[p - 1] = next
        stack[top++] = p - 1
      }
      if (x < width - 1 && data[p + 1] && !label[p + 1]) {
        label[p + 1] = next
        stack[top++] = p + 1
      }
      if (p >= width && data[p - width] && !label[p - width]) {
        label[p - width] = next
        stack[top++] = p - width
      }
      if (p < data.length - width && data[p + width] && !label[p + width]) {
        label[p + width] = next
        stack[top++] = p + width
      }
    }
    if (size > bestSize) {
      bestSize = size
      best = next
    }
  }
  const out = new Uint8Array(data.length)
  if (best) for (let i = 0; i < out.length; i++) out[i] = label[i] === best ? 1 : 0
  return { width, height, data: out }
}

/** 안쪽 구멍을 메운다 — 가장자리에서 닿지 않는 빈 곳을 채운다 */
export function fillHoles(m: Mask): Mask {
  const { width, height, data } = m
  const outside = new Uint8Array(data.length)
  const stack = new Int32Array(data.length)
  let top = 0
  const seed = (p: number): void => {
    if (!data[p] && !outside[p]) {
      outside[p] = 1
      stack[top++] = p
    }
  }
  for (let x = 0; x < width; x++) {
    seed(x)
    seed((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    seed(y * width)
    seed(y * width + width - 1)
  }
  while (top > 0) {
    const p = stack[--top]
    const x = p % width
    if (x > 0) seed(p - 1)
    if (x < width - 1) seed(p + 1)
    if (p >= width) seed(p - width)
    if (p < data.length - width) seed(p + width)
  }
  const out = new Uint8Array(data.length)
  for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 1
  return { width, height, data: out }
}

export const tidy = (m: Mask): Mask => fillHoles(largestBlob(m))

/** 볼록 껍질의 넓이 (점들의 좌표는 픽셀 중심) */
function hullArea(points: [number, number][]): number {
  if (points.length < 3) return 0
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: [number, number][]): [number, number][] => {
    const h: [number, number][] = []
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop()
      h.push(p)
    }
    h.pop()
    return h
  }
  const hull = [...half(points), ...half([...points].reverse())]
  let area = 0
  for (let i = 0; i < hull.length; i++) {
    const [x0, y0] = hull[i]
    const [x1, y1] = hull[(i + 1) % hull.length]
    area += x0 * y1 - x1 * y0
  }
  return Math.abs(area) / 2
}

/** 덩어리꼴 정도 — 1에 가까우면 덩어리, 0에 가까우면 선·고리 같은 것 */
export function solidity(m: Mask): number {
  const { width, height, data } = m
  // 줄마다 양 끝 픽셀만 봐도 볼록 껍질은 같다
  const edge: [number, number][] = []
  for (let y = 0; y < height; y++) {
    let first = -1
    let last = -1
    for (let x = 0; x < width; x++) {
      if (!data[y * width + x]) continue
      if (first < 0) first = x
      last = x
    }
    if (first < 0) continue
    edge.push([first, y])
    if (last !== first) edge.push([last, y])
  }
  if (edge.length < 8) return 0
  const count = edge.length
  return maskArea(m) / Math.max(1, hullArea(edge) + count / 2)
}

export interface Candidate {
  mask: Mask
  score: number
  solidity: number
  area: number
}

function overlap(a: Mask, b: Mask): number {
  let n = 0
  for (let i = 0; i < a.data.length; i++) n += a.data[i] & b.data[i]
  return n
}

/**
 * 콕 찍은 자리의 후보를 작은 것부터 늘어놓고(거의 같은 것은 하나만), 처음 보여 줄 것을 고른다.
 * limit = 그림 넓이의 절반 — 그보다 넓은 것은 배경이다.
 */
export function chooseCandidates(
  cands: Candidate[],
  limit: number
): { list: Candidate[]; pick: number } {
  const sized = cands.filter((c) => c.area >= 12 && c.area <= limit).sort((a, b) => a.area - b.area)
  const list: Candidate[] = []
  for (const c of sized)
    if (!list.some((u) => overlap(c.mask, u.mask) >= 0.92 * Math.max(c.area, u.area))) list.push(c)
  if (list.length === 0) return { list, pick: 0 }
  const solid = list.map((_, i) => i).filter((i) => list[i].solidity >= 0.5)
  const pool = solid.length > 0 ? solid : list.map((_, i) => i)
  let pick = pool[0]
  for (const i of pool) if (list[i].score > list[pick].score) pick = i
  return { list, pick }
}

/** 찍은 자리 둘레를 넉넉히 잘라 볼 창 [x0, y0, x1, y1] — 작은 부위일수록 크게 확대돼 모양이 정확해진다 */
export function pickWindow(
  width: number,
  height: number,
  x: number,
  y: number,
  side: number
): [number, number, number, number] {
  if (side >= 0.8 * Math.max(width, height)) return [0, 0, width, height]
  const w = Math.min(side, width)
  const h = Math.min(side, height)
  const x0 = Math.min(Math.max(Math.round(x - w / 2), 0), width - w)
  const y0 = Math.min(Math.max(Math.round(y - h / 2), 0), height - h)
  return [x0, y0, x0 + w, y0 + h]
}

/** 창 가장자리에 닿았는지 — 닿았으면 잘린 것일 수 있어 더 넓은 창으로 다시 본다 */
export function touchesBorder(m: Mask): boolean {
  const { width, height, data } = m
  for (let x = 0; x < width; x++) if (data[x] || data[(height - 1) * width + x]) return true
  for (let y = 0; y < height; y++) if (data[y * width] || data[y * width + width - 1]) return true
  return false
}

/** 마스크가 차지한 네모 [x0, y0, x1, y1] (없으면 null) */
export function maskBox(m: Mask): [number, number, number, number] | null {
  const { width, height, data } = m
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!data[y * width + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1]
}
