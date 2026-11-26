export const NAI_V5_CURATED = 'nai-diffusion-5-curated'
export const NAI_V5_FULL = 'nai-diffusion-5-full'
/**
 * V5 Full의 Effort "Medium" — 요청 플래그가 아니라 별도 증류 모델이다.
 * (2026-10-08 공지, 같은 날 novelai.net 번들에서 확인: `naiDiffusionV5FullMedium`)
 */
export const NAI_V5_FULL_MEDIUM = 'nai-diffusion-5-full-medium'

export function isV5Model(model: string): boolean {
  return model.startsWith('nai-diffusion-5-')
}

/** V5 Full 계열 (High·Medium, 인페인트 포함) — Qwen 1471 토큰·nsfw UC 규칙을 공유한다. */
export function isV5FullModel(model: string): boolean {
  return (
    model === NAI_V5_FULL ||
    model === `${NAI_V5_FULL}-inpainting` ||
    model === NAI_V5_FULL_MEDIUM ||
    model === `${NAI_V5_FULL_MEDIUM}-inpainting`
  )
}

export function inpaintingModelFor(model: string): string {
  if (model === NAI_V5_CURATED) return 'nai-diffusion-4-5-curated-inpainting'
  if (model === NAI_V5_FULL) return `${NAI_V5_FULL}-inpainting`
  if (model === NAI_V5_FULL_MEDIUM) return `${NAI_V5_FULL_MEDIUM}-inpainting`
  return model.includes('inpainting') ? model : `${model}-inpainting`
}

export type GenerationEffort = 'medium' | 'high'

/** Effort 토글이 있는 모델인지 (V5 Full, 어느 effort든) */
export function hasEffortToggle(model: string): boolean {
  return model === NAI_V5_FULL || model === NAI_V5_FULL_MEDIUM
}

/** Medium effort 모델인지 (생성·인페인트) */
export function isMediumEffortModel(model: string): boolean {
  return model === NAI_V5_FULL_MEDIUM || model === `${NAI_V5_FULL_MEDIUM}-inpainting`
}

export function effortOf(model: string): GenerationEffort {
  return isMediumEffortModel(model) ? 'medium' : 'high'
}

/** 토글이 있는 모델이면 해당 effort의 모델 id로, 아니면 그대로. */
export function withEffort(model: string, effort: GenerationEffort): string {
  if (!hasEffortToggle(model)) return model
  return effort === 'medium' ? NAI_V5_FULL_MEDIUM : NAI_V5_FULL
}

/** 모델 선택 UI용 — Medium도 "V5 Full"로 보인다 (effort는 별도 토글). */
export function baseModelForSelect(model: string): string {
  return model === NAI_V5_FULL_MEDIUM ? NAI_V5_FULL : model
}

/**
 * Medium이 고정하는 설정 (웹 모델 테이블의 `fixedSettings`).
 * 웹 요청 준비 단계는 여기에 더해 사용자 UC를 비우고(캐릭터 UC 포함) Heavy 프리셋 텍스트만 보내며,
 * 모델에 cfgRescale 기능이 없어 `cfg_rescale` 필드 자체를 지운다.
 * 사용자의 High 설정(steps 등)은 요청 객체에 그대로 두고 전송 시에만 덮어쓴다.
 */
export const MEDIUM_EFFORT_FIXED = {
  steps: 14,
  sampler: 'k_euler_ancestral',
  /** NAIS3 UcPresetIndex 0 = Heavy */
  ucPreset: 0
} as const

/** 실제로 서버에 보내질 steps (Medium은 14 고정) */
export function effectiveSteps(model: string, steps: number): number {
  return isMediumEffortModel(model) ? MEDIUM_EFFORT_FIXED.steps : steps
}

export interface NaiModelCapabilities {
  vibes: boolean
  characterReferences: boolean
  /**
   * [custom] V5식 정밀 레퍼런스 (2026-11-24 출시, Full·Curated) — Fidelity 없음, 강도 5.0까지,
   * 의상 레퍼런스·`같은 의상 선호`, 그림은 검정 여백 없이 버킷 크기로 잘라 보낸다
   */
  referencesV5: boolean
  variety: boolean
  noiseScheduleSelection: boolean
  transparency: boolean
  maxCharacters: number
}

export function modelCapabilities(model: string): NaiModelCapabilities {
  if (isV5Model(model)) {
    // [custom] 정밀 레퍼런스는 High effort만 — Medium(14스텝)에서는 웹도 꺼 둔다
    const references = !isMediumEffortModel(model)
    return {
      vibes: false,
      characterReferences: references,
      referencesV5: references,
      variety: false,
      noiseScheduleSelection: false,
      transparency: true,
      maxCharacters: 32
    }
  }
  return {
    vibes: true,
    characterReferences: true,
    referencesV5: false,
    variety: true,
    noiseScheduleSelection: true,
    transparency: false,
    maxCharacters: 6
  }
}

export function canEnableAnotherCharacter(model: string, enabledCount: number): boolean {
  return enabledCount < modelCapabilities(model).maxCharacters
}

export function generationDefaultsForModel(model: string): {
  steps: number
  cfgScale: number
  sampler: string
  noiseSchedule: string
  variety: boolean
} {
  return isV5Model(model)
    ? {
        steps: 23,
        cfgScale: 7,
        sampler: 'k_euler_ancestral',
        noiseSchedule: 'karras',
        variety: false
      }
    : {
        steps: 28,
        cfgScale: 5,
        sampler: 'k_euler_ancestral',
        noiseSchedule: 'karras',
        variety: false
      }
}

/** Current NovelAI web limits: Qwen for V5, T5 for V4/V4.5. */
export function promptTokenLimit(model: string): number {
  if (isV5FullModel(model)) return 1471
  if (isV5Model(model)) return 703
  return 512
}

/** [custom] 정밀 레퍼런스 강도의 윗값 — V5는 5.0, 그 전은 1.0 */
export function referenceStrengthMax(model: string): number {
  return modelCapabilities(model).referencesV5 ? 5 : 1
}

/**
 * [custom] 이 모델에 보낼 레퍼런스 종류 — V5가 아니면 웹처럼 의상 레퍼런스는 빼고(null),
 * `같은 의상 선호` 변형은 원래 종류로 접는다.
 */
export function referenceTypeFor(model: string, type: string): string | null {
  if (modelCapabilities(model).referencesV5) return type
  if (type === 'costume') return null
  if (type === 'character_mainoutfit') return 'character'
  if (type === 'character&style_anyoutfit') return 'character&style'
  return type
}

/**
 * [custom] V5 레퍼런스 그림의 버킷 97개 (웹 클라이언트와 같음) — 높이 4096부터 1024까지 64씩 내려가며
 * 1메가픽셀 안의 가장 넓은 64 배수 폭, 그리고 그것들을 눕힌 것.
 */
export const REFERENCE_BUCKETS: readonly (readonly [number, number])[] = (() => {
  const portrait: [number, number][] = []
  for (let height = 4096; height >= 1024; height -= 64)
    portrait.push([Math.floor(1048576 / (height * 64)) * 64, height])
  const landscape = portrait
    .slice(0, -1)
    .reverse()
    .map(([w, h]): [number, number] => [h, w])
  return [...portrait, ...landscape]
})()

/** [custom] 그림 비율에 가장 가까운 버킷 (로그 비율 기준) */
export function referenceBucketFor(width: number, height: number): readonly [number, number] {
  const aspect = Math.log(Math.max(width, 1) / Math.max(height, 1))
  let best = REFERENCE_BUCKETS[0]
  let bestGap = Infinity
  for (const bucket of REFERENCE_BUCKETS) {
    const gap = Math.abs(aspect - Math.log(bucket[0] / bucket[1]))
    if (gap < bestGap) {
      best = bucket
      bestGap = gap
    }
  }
  return best
}
