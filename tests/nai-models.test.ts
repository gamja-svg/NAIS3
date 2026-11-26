import { describe, expect, it } from 'vitest'
import {
  baseModelForSelect,
  effectiveSteps,
  effortOf,
  generationDefaultsForModel,
  hasEffortToggle,
  isMediumEffortModel,
  withEffort,
  canEnableAnotherCharacter,
  inpaintingModelFor,
  isV5Model,
  modelCapabilities,
  REFERENCE_BUCKETS,
  referenceBucketFor,
  referenceStrengthMax,
  referenceTypeFor,
  promptTokenLimit
} from '../src/shared/nai-models'

describe('NAI 모델별 동작', () => {
  it('V5 Curated와 Full을 식별한다', () => {
    expect(isV5Model('nai-diffusion-5-curated')).toBe(true)
    expect(isV5Model('nai-diffusion-5-full')).toBe(true)
    expect(isV5Model('nai-diffusion-4-5-full')).toBe(false)
  })

  it('V5 웹 기본값은 23 steps, CFG 7, Euler Ancestral이다', () => {
    expect(generationDefaultsForModel('nai-diffusion-5-full')).toMatchObject({
      steps: 23,
      cfgScale: 7,
      sampler: 'k_euler_ancestral',
      noiseSchedule: 'karras',
      variety: false
    })
  })

  it('V5는 바이브·Variety+를 지원하지 않는다 ([custom] 정밀 레퍼런스는 2026-11-24부터 Full·Curated)', () => {
    expect(modelCapabilities('nai-diffusion-5-curated')).toMatchObject({
      vibes: false,
      characterReferences: true,
      referencesV5: true,
      variety: false,
      noiseScheduleSelection: false,
      transparency: true,
      maxCharacters: 32
    })
  })

  it('V5는 캐릭터 32명까지, V4.5는 6명까지 활성화할 수 있다', () => {
    expect(canEnableAnotherCharacter('nai-diffusion-5-full', 31)).toBe(true)
    expect(canEnableAnotherCharacter('nai-diffusion-5-full', 32)).toBe(false)
    expect(canEnableAnotherCharacter('nai-diffusion-4-5-full', 5)).toBe(true)
    expect(canEnableAnotherCharacter('nai-diffusion-4-5-full', 6)).toBe(false)
  })

  it('프롬프트 한도는 V5 Curated 703, Full 1471이고 V4.5는 512다', () => {
    expect(promptTokenLimit('nai-diffusion-5-curated')).toBe(703)
    expect(promptTokenLimit('nai-diffusion-5-full')).toBe(1471)
    expect(promptTokenLimit('nai-diffusion-4-5-full')).toBe(512)
  })

  it('V5 Full은 전용 인페인트, Curated는 V4.5 Curated 인페인트를 쓴다', () => {
    expect(inpaintingModelFor('nai-diffusion-5-full')).toBe('nai-diffusion-5-full-inpainting')
    expect(inpaintingModelFor('nai-diffusion-5-curated')).toBe(
      'nai-diffusion-4-5-curated-inpainting'
    )
  })
})

describe('V5 Full Effort 토글 (Medium/High)', () => {
  it('Medium은 별도 모델 id이며 V5 Full에서만 토글된다', () => {
    expect(withEffort('nai-diffusion-5-full', 'medium')).toBe('nai-diffusion-5-full-medium')
    expect(withEffort('nai-diffusion-5-full-medium', 'high')).toBe('nai-diffusion-5-full')
    expect(withEffort('nai-diffusion-5-curated', 'medium')).toBe('nai-diffusion-5-curated')
    expect(hasEffortToggle('nai-diffusion-5-full-medium')).toBe(true)
    expect(hasEffortToggle('nai-diffusion-4-5-full')).toBe(false)
    expect(effortOf('nai-diffusion-5-full')).toBe('high')
    expect(effortOf('nai-diffusion-5-full-medium-inpainting')).toBe('medium')
    expect(baseModelForSelect('nai-diffusion-5-full-medium')).toBe('nai-diffusion-5-full')
  })

  it('Medium은 전용 인페인트 모델을 쓰고 V5 Full의 한도·기본값을 공유한다', () => {
    expect(inpaintingModelFor('nai-diffusion-5-full-medium')).toBe(
      'nai-diffusion-5-full-medium-inpainting'
    )
    expect(isMediumEffortModel('nai-diffusion-5-full-medium-inpainting')).toBe(true)
    expect(promptTokenLimit('nai-diffusion-5-full-medium')).toBe(1471)
    // [custom] 정밀 레퍼런스만 다르다 (High effort 전용)
    expect(modelCapabilities('nai-diffusion-5-full-medium')).toEqual({
      ...modelCapabilities('nai-diffusion-5-full'),
      characterReferences: false,
      referencesV5: false
    })
  })

  it('Medium은 실제 전송 스텝이 14로 고정된다', () => {
    expect(effectiveSteps('nai-diffusion-5-full-medium', 28)).toBe(14)
    expect(effectiveSteps('nai-diffusion-5-full', 28)).toBe(28)
  })

  // [custom] V5 정밀 레퍼런스
  it('[custom] V5 정밀 레퍼런스: Full·Curated만, 강도 5.0까지, Medium과 V4.5는 그대로', () => {
    expect(modelCapabilities('nai-diffusion-5-full').characterReferences).toBe(true)
    expect(modelCapabilities('nai-diffusion-5-full-medium')).toMatchObject({
      characterReferences: false,
      referencesV5: false
    })
    expect(modelCapabilities('nai-diffusion-4-5-full')).toMatchObject({
      characterReferences: true,
      referencesV5: false
    })
    expect(referenceStrengthMax('nai-diffusion-5-full')).toBe(5)
    expect(referenceStrengthMax('nai-diffusion-4-5-full')).toBe(1)
  })

  it('[custom] V5가 아닌 모델에는 의상 레퍼런스를 빼고 같은 의상 변형을 접는다', () => {
    const v45 = 'nai-diffusion-4-5-full'
    expect(referenceTypeFor(v45, 'costume')).toBeNull()
    expect(referenceTypeFor(v45, 'character_mainoutfit')).toBe('character')
    expect(referenceTypeFor(v45, 'character&style_anyoutfit')).toBe('character&style')
    expect(referenceTypeFor(v45, 'style')).toBe('style')
    const v5 = 'nai-diffusion-5-curated'
    expect(referenceTypeFor(v5, 'costume')).toBe('costume')
    expect(referenceTypeFor(v5, 'character_mainoutfit')).toBe('character_mainoutfit')
  })

  it('[custom] V5 레퍼런스 버킷: 웹과 같은 97개, 비율이 가장 가까운 것을 고른다', () => {
    expect(REFERENCE_BUCKETS).toHaveLength(97)
    expect(REFERENCE_BUCKETS[0]).toEqual([256, 4096])
    expect(REFERENCE_BUCKETS[96]).toEqual([4096, 256])
    expect(REFERENCE_BUCKETS[48]).toEqual([1024, 1024])
    for (const [w, h] of REFERENCE_BUCKETS) {
      expect(w % 64).toBe(0)
      expect(h % 64).toBe(0)
      expect(w * h).toBeLessThanOrEqual(1048576)
    }
    expect(referenceBucketFor(1024, 1024)).toEqual([1024, 1024])
    expect(referenceBucketFor(832, 1216)).toEqual([832, 1216])
    expect(referenceBucketFor(1216, 832)).toEqual([1216, 832])
    expect(referenceBucketFor(2000, 3000)).toEqual([832, 1216])
    expect(referenceBucketFor(100, 10000)).toEqual([256, 4096])
  })
})
