import { createHash } from 'crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from 'fs'
import { createRequire } from 'node:module'
import { join } from 'path'
import type * as Ort from 'onnxruntime-node'
import type { CensorPickResult } from '../../shared/types'
import { t } from '../i18n'
import sharp from '../sharp'
import {
  chooseCandidates,
  maskArea,
  maskBox,
  pickWindow,
  solidity,
  tidy,
  touchesBorder,
  type Candidate
} from './censor-shape'

/**
 * [custom] 콕 찍기 — 누른 자리에 있는 것의 모양을 따 준다 (MobileSAM, 자동검열기와 같은 모델).
 *
 * - 모델은 설치 파일에 넣지 않고 처음 쓸 때 한 번 받는다 (두 파일, 합쳐 약 45MB). 받은 파일은 SHA-256으로 확인한다.
 * - 찍은 자리 둘레만 잘라 1024로 키워 읽는다 — 작은 부위도 모양이 정확하다. 같은 자리 근처를 다시 찍으면
 *   읽어 둔 것을 그대로 써서 빠르다.
 * - 후보(작은 것~큰 것)를 함께 돌려줘서, 화면에서 더 작게/크게로 바꿀 수 있다.
 */

// 포크 main의 custom/models — 커밋으로 고정해 파일이 바뀌어도 이 버전은 같은 것을 받는다
const MODEL_BASE =
  'https://raw.githubusercontent.com/gamja-svg/NAIS3/f94ddc8c45731586721fe39e98efa7acb08dcd2d/custom/models'
export const SAM_MODELS = {
  encoder: {
    file: 'mobile_sam_encoder.onnx',
    size: 27969715,
    sha256: 'a6a1e4de3f37c02010545c2edbeeeac8cc90ad1020a681b214c22f8b5f313888'
  },
  decoder: {
    file: 'mobile_sam_decoder.onnx',
    size: 16496916,
    sha256: '8f72ca4fb1b501bd030c19090f39d547987b609f79c1e9fc66f13b06a71d431f'
  }
} as const
type ModelKey = keyof typeof SAM_MODELS

const SIZE = 1024
const MEAN = [123.675, 116.28, 103.53]
const STD = [58.395, 57.12, 57.375]

export interface SamDeps {
  /** 모델을 두는 폴더 */
  dir: string
  /** 받는 정도(0~100)를 알린다 */
  progress?: (percent: number) => void
  fetch?: typeof fetch
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function modelReady(dir: string, key: ModelKey): boolean {
  const path = join(dir, SAM_MODELS[key].file)
  return existsSync(path) && statSync(path).size === SAM_MODELS[key].size
}

/** 모델 파일이 없으면 받는다. 크기·SHA-256이 다르면 버리고 실패로 알린다 */
export async function ensureModels(deps: SamDeps): Promise<void> {
  mkdirSync(deps.dir, { recursive: true })
  const missing = (Object.keys(SAM_MODELS) as ModelKey[]).filter((k) => !modelReady(deps.dir, k))
  if (missing.length === 0) return
  const total = missing.reduce((n, k) => n + SAM_MODELS[k].size, 0)
  let done = 0
  let shown = -1
  const get = deps.fetch ?? fetch
  for (const key of missing) {
    const model = SAM_MODELS[key]
    const path = join(deps.dir, model.file)
    const tmp = `${path}.part`
    try {
      const res = await get(`${MODEL_BASE}/${model.file}`, { redirect: 'follow' })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const out = createWriteStream(tmp)
      const reader = res.body.getReader()
      for (;;) {
        const { done: end, value } = await reader.read()
        if (end) break
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
        done += value.length
        const percent = Math.min(99, Math.floor((done / total) * 100))
        if (percent !== shown) deps.progress?.((shown = percent))
      }
      await new Promise<void>((resolve, reject) => {
        out.once('error', reject)
        out.end(() => resolve())
      })
      if (statSync(tmp).size !== model.size || sha256(tmp) !== model.sha256)
        throw new Error('checksum')
      renameSync(tmp, path)
    } catch (e) {
      rmSync(tmp, { force: true })
      throw new Error(
        t('ui.customCensorModelFailedValue', e instanceof Error ? e.message : String(e))
      )
    }
  }
  deps.progress?.(100)
}

interface Sessions {
  ort: typeof Ort
  encoder: Ort.InferenceSession
  decoder: Ort.InferenceSession
}

let sessions: Promise<Sessions> | null = null

function loadSessions(deps: SamDeps): Promise<Sessions> {
  sessions ??= (async () => {
    await ensureModels(deps)
    // 실행할 때 불러온다 — 이 모듈을 못 읽는 환경에서도 앱의 다른 기능은 그대로 돌게
    const ort = createRequire(__filename)('onnxruntime-node') as typeof Ort
    const open = (key: ModelKey): Promise<Ort.InferenceSession> =>
      ort.InferenceSession.create(join(deps.dir, SAM_MODELS[key].file), {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all'
      })
    return { ort, encoder: await open('encoder'), decoder: await open('decoder') }
  })()
  // 실패하면 다음에 다시 해 본다 (모델을 다시 받을 수 있게)
  sessions.catch(() => (sessions = null))
  return sessions
}

/** 모델을 미리 준비한다 (검열을 켤 때) */
export async function warmSam(deps: SamDeps): Promise<void> {
  await loadSessions(deps)
}

type Win = [number, number, number, number]

interface Picture {
  key: string
  width: number
  height: number
  /** RGB (3채널) */
  rgb: Buffer
}
interface Embedding {
  key: string
  win: Win
  tensor: Ort.Tensor
}

let picture: Picture | null = null
let embedding: Embedding | null = null

async function loadPicture(path: string): Promise<Picture> {
  const key = `${path}|${statSync(path).mtimeMs}`
  if (picture?.key === key) return picture
  const { data, info } = await sharp(path)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  picture = { key, width: info.width, height: info.height, rgb: data }
  return picture
}

/** 창을 잘라 긴 변 1024로 맞추고, 모델 입력(1x3x1024x1024, 정규화·나머지는 0)으로 만든다 */
async function encode(s: Sessions, pic: Picture, win: Win): Promise<Ort.Tensor> {
  if (embedding && embedding.key === pic.key && embedding.win.every((v, i) => v === win[i]))
    return embedding.tensor
  const [x0, y0, x1, y1] = win
  const w = x1 - x0
  const h = y1 - y0
  const scale = SIZE / Math.max(w, h)
  const rw = Math.round(w * scale)
  const rh = Math.round(h * scale)
  const resized = await sharp(pic.rgb, {
    raw: { width: pic.width, height: pic.height, channels: 3 }
  })
    .extract({ left: x0, top: y0, width: w, height: h })
    .resize(rw, rh, { fit: 'fill', kernel: 'linear' })
    .raw()
    .toBuffer()
  const input = new Float32Array(3 * SIZE * SIZE)
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const i = (y * rw + x) * 3
      const o = y * SIZE + x
      for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + o] = (resized[i + c] - MEAN[c]) / STD[c]
    }
  const out = await s.encoder.run({ image: new s.ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) })
  embedding = { key: pic.key, win, tensor: out.embedding }
  return out.embedding
}

async function candidatesIn(
  s: Sessions,
  pic: Picture,
  win: Win,
  x: number,
  y: number
): Promise<Candidate[]> {
  const [x0, y0, x1, y1] = win
  const w = x1 - x0
  const h = y1 - y0
  const scale = SIZE / Math.max(w, h)
  const { Tensor } = s.ort
  const out = await s.decoder.run({
    image_embeddings: await encode(s, pic, win),
    // 찍은 점 하나 + 자리 채움 점 (상자가 없을 때의 정해진 입력 꼴)
    point_coords: new Tensor('float32', [(x - x0) * scale, (y - y0) * scale, 0, 0], [1, 2, 2]),
    point_labels: new Tensor('float32', [1, -1], [1, 2]),
    mask_input: new Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: new Tensor('float32', [0], [1]),
    orig_im_size: new Tensor('float32', [h, w], [2])
  })
  const logits = out.masks.data as Float32Array
  const scores = out.iou_predictions.data as Float32Array
  const count = out.masks.dims[1]
  const list: Candidate[] = []
  // 0번은 점이 여럿일 때 쓰는 한 장짜리 출력 — 점 하나일 때는 나머지 셋이 작은 것·중간·큰 것이다
  for (let k = count > 1 ? 1 : 0; k < count; k++) {
    const data = new Uint8Array(w * h)
    const base = k * w * h
    for (let i = 0; i < data.length; i++) data[i] = logits[base + i] > 0 ? 1 : 0
    const mask = tidy({ width: w, height: h, data })
    const area = maskArea(mask)
    if (area >= 12) list.push({ mask, score: scores[k], solidity: solidity(mask), area })
  }
  return list
}

async function shapePng(c: Candidate, win: Win): Promise<CensorPickResult['shapes'][number]> {
  const box = maskBox(c.mask)!
  const w = box[2] - box[0]
  const h = box[3] - box[1]
  const alpha = Buffer.alloc(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      alpha[y * w + x] = c.mask.data[(y + box[1]) * c.mask.width + x + box[0]] ? 255 : 0
  // 흰색 + 알파 — 화면의 칠 레이어에 그대로 그릴 수 있다
  const png = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } })
    .joinChannel(alpha, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer()
  return {
    x: win[0] + box[0],
    y: win[1] + box[1],
    width: w,
    height: h,
    png: png.toString('base64')
  }
}

/** 그림(path)의 (x, y) 자리에 있는 것의 모양 후보들 — 작은 것부터, pick = 처음 칠할 것 */
export async function pickShape(
  deps: SamDeps,
  path: string,
  x: number,
  y: number
): Promise<CensorPickResult> {
  const s = await loadSessions(deps)
  const pic = await loadPicture(path)
  const px = Math.min(pic.width - 1, Math.max(0, Math.round(x)))
  const py = Math.min(pic.height - 1, Math.max(0, Math.round(y)))
  const full: Win = [0, 0, pic.width, pic.height]
  const same = (a: Win, b: Win): boolean => a.every((v, i) => v === b[i])

  let win = pickWindow(pic.width, pic.height, px, py, 384)
  // 방금 읽어 둔 창의 가운데 쪽을 다시 찍었으면 그 창을 그대로 쓴다 (다시 읽지 않아 빠르다)
  if (embedding && embedding.key === pic.key) {
    const [lx0, ly0, lx1, ly1] = embedding.win
    const qx = (lx1 - lx0) * 0.22
    const qy = (ly1 - ly0) * 0.22
    if (px >= lx0 + qx && px <= lx1 - qx && py >= ly0 + qy && py <= ly1 - qy) win = embedding.win
  }
  let found = await candidatesIn(s, pic, win, px, py)
  if (!same(win, full) && found.some((c) => touchesBorder(c.mask))) {
    // 창 끝에 닿은 후보가 있으면 잘린 것일 수 있다 — 더 넓게 한 번 더
    win = pickWindow(pic.width, pic.height, px, py, 768)
    found = await candidatesIn(s, pic, win, px, py)
  }
  const { list, pick } = chooseCandidates(found, 0.5 * pic.width * pic.height)
  return { shapes: await Promise.all(list.map((c) => shapePng(c, win))), pick }
}
