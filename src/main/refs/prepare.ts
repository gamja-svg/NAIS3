import { readFileSync } from 'fs'
import sharp from '../sharp'
import type { CharacterReferenceOptions, VibeOptions } from '../nai/payload'
import { ENDPOINTS } from '../nai/endpoints'
import { t } from '../i18n'
import {
  modelCapabilities,
  referenceBucketFor,
  referenceStrengthMax,
  referenceTypeFor
} from '../../shared/nai-models'
import {
  charRefRowsByIds,
  enabledCharRefRows,
  enabledVibeRows,
  saveVibeEncoding,
  vibeRowsByIds
} from './repo'
import { getVibeEncoding, putVibeEncoding } from './vibe-encoding-cache'

/** 생성 직전 바이브 준비 — 미인코딩/ie 변경분만 encode-vibe (2 Anlas) 후 캐시.
 *  newlyEncoded: 이번에 새로 인코딩된 바이브 id (카드 표시 갱신 통지용) */
export async function prepareVibes(
  token: string,
  model: string,
  ids?: number[]
): Promise<{ vibes: VibeOptions[]; newlyEncoded: number[] }> {
  // ids 지정 시 그 바이브들(enabled 무시 — 출연 예약), 미지정 시 enabled 항목
  const rows = ids ? vibeRowsByIds(ids) : enabledVibeRows()
  const vibes: VibeOptions[] = []
  const newlyEncoded: number[] = []
  for (const row of rows) {
    let encoded = getVibeEncoding(row.encoded, row.encodedIe, model, row.infoExtracted)
    if (!encoded) {
      // [custom] 여러 계정이 동시에 생성할 때 같은 바이브를 각자 인코딩(계정마다 2 Anlas)하지 않게,
      // 진행 중인 인코딩이 있으면 그 결과를 같이 쓴다
      const key = `${row.id}|${model}|${row.infoExtracted}`
      let pending = vibeEncodingsInFlight.get(key)
      const mine = !pending
      if (!pending) {
        pending = encodeVibe(token, row, model).finally(() => vibeEncodingsInFlight.delete(key))
        vibeEncodingsInFlight.set(key, pending)
      }
      encoded = await pending
      if (mine) newlyEncoded.push(row.id)
    }
    vibes.push({ strength: row.strength, encodedVibeBase64: encoded })
  }
  return { vibes, newlyEncoded }
}

/** [custom] 바이브 id·모델·ie별로 진행 중인 인코딩 */
const vibeEncodingsInFlight = new Map<string, Promise<string>>()

async function encodeVibe(
  token: string,
  row: { id: number; filePath: string; infoExtracted: number },
  model: string
): Promise<string> {
  const res = await fetch(ENDPOINTS.encodeVibe, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: readFileSync(row.filePath).toString('base64'),
      information_extracted: row.infoExtracted,
      model
    })
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(t('ui.vibeEncodingFailedValueValue', res.status, text.slice(0, 200)))
  }
  const encoded = Buffer.from(await res.arrayBuffer()).toString('base64')
  // [custom] 기다리는 사이 다른 계정이 다른 모델 인코딩을 저장했을 수 있으니 지금 값에 더해 저장한다
  const latest = vibeRowsByIds([row.id])[0]
  const packed = putVibeEncoding(
    latest?.encoded ?? null,
    latest?.encodedIe ?? null,
    model,
    row.infoExtracted,
    encoded
  )
  saveVibeEncoding(row.id, packed, row.infoExtracted)
  return encoded
}

/**
 * 캐릭레퍼 이미지 전처리 — OpenAPI 명세: 1024×1536 / 1536×1024 / 1472×1472
 * 캔버스에 검정 패딩으로 맞춰 전송. 종횡비에 따라 캔버스 선택.
 */
export async function processCharRefImage(filePath: string, bucketed: boolean): Promise<string> {
  const buf = readFileSync(filePath)
  const meta = await sharp(buf).metadata()
  const w = meta.width ?? 1
  const h = meta.height ?? 1
  // [custom] V5: 검정 여백 없이, 비율이 가장 가까운 버킷을 덮게 키운 뒤 가운데를 잘라 보낸다 (웹과 같음)
  if (bucketed) {
    const [bw, bh] = referenceBucketFor(w, h)
    if (w === bw && h === bh && meta.format === 'png') return buf.toString('base64')
    const cropped = await sharp(buf)
      .resize(bw, bh, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
      .png()
      .toBuffer()
    return cropped.toString('base64')
  }
  const ratio = w / h
  const canvas =
    ratio > 1.2
      ? { w: 1536, h: 1024 }
      : ratio < 1 / 1.2
        ? { w: 1024, h: 1536 }
        : { w: 1472, h: 1472 }

  const png = await sharp(buf)
    .resize(canvas.w, canvas.h, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
    .png()
    .toBuffer()
  return png.toString('base64')
}

export async function prepareCharRefs(
  ids?: number[],
  // [custom] 보낼 모델 — V5면 그림 손질·종류·강도 범위가 다르다
  model = ''
): Promise<CharacterReferenceOptions[]> {
  const v5 = modelCapabilities(model).referencesV5
  const maxStrength = referenceStrengthMax(model)
  // ids 지정 시 그 캐릭레퍼들(enabled 무시 — 출연 예약), 미지정 시 enabled 항목
  const rows = ids ? charRefRowsByIds(ids) : enabledCharRefRows()
  const result: CharacterReferenceOptions[] = []
  for (const row of rows) {
    // V5가 아닌 모델에는 의상 레퍼런스를 보내지 않는다 (웹과 같음)
    const referenceType = referenceTypeFor(model, row.refType)
    if (referenceType === null) continue
    result.push({
      referenceType: referenceType as CharacterReferenceOptions['referenceType'],
      strength: Math.min(row.strength, maxStrength),
      fidelity: row.fidelity,
      imageBase64: await processCharRefImage(row.filePath, v5)
    })
  }
  return result
}
