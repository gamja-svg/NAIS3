import type { GenerationRequest, ParallelConfig } from '../../shared/types'
import { getActiveNaiAccount, getNaiAccounts, getSetting, setSetting } from '../db/settings'
import {
  isOpusUsageExhausted,
  requestUsesV5Usage,
  type NaiAccountSelection
} from '../nai/account-router'
import { logBalance } from '../nai/anlas-log'
import { fetchAnlasBalance } from '../nai/client'
import { LanePauseError } from '../queue/generation-queue'
import { broadcast } from '../ipc'

/**
 * [custom] 여러 계정으로 동시 생성 — 계정(레인)마다 한 장씩.
 * 켜는 스위치와 '보낼 곳'은 설정에 두고, 큐는 여기 함수로 계정 목록과 보낼 곳을 읽는다.
 * 원칙: 동시 생성은 Opus 계정만, 게이지가 바닥난 계정은 Anlas를 쓰지 않고 쉰다.
 */
const ENABLED_KEY = 'custom_parallel_accounts'
const TARGET_KEY = 'custom_parallel_target'

/** 쉬는 시간 — 게이지는 몇 분 안에 다시 차오르고, Opus 아닌 계정은 구독이 바뀔 때까지 */
const PAUSE_MS = { exhausted: 60_000, notOpus: 5 * 60_000, unknown: 30_000 } as const

export function getParallelConfig(): ParallelConfig {
  return { enabled: getSetting(ENABLED_KEY) === '1', target: getSetting(TARGET_KEY) || null }
}

export function setParallelConfig(patch: Partial<ParallelConfig>): ParallelConfig {
  if (patch.enabled !== undefined) setSetting(ENABLED_KEY, patch.enabled ? '1' : '0')
  if (patch.target !== undefined) setSetting(TARGET_KEY, patch.target ?? '')
  return getParallelConfig()
}

/** 큐가 쓸 계정 목록 — 꺼져 있으면 null (큐는 2개 미만이면 원래대로 한 장씩) */
export function parallelLanes(): string[] | null {
  if (getSetting(ENABLED_KEY) !== '1') return null
  return getNaiAccounts().map((account) => account.id)
}

export function parallelTarget(): string | null {
  return getSetting(TARGET_KEY) || null
}

type Balance = Awaited<ReturnType<typeof fetchAnlasBalance>>

/** 계정별 잔액을 화면에 알린다. 활성 계정이면 상단 잔액 표시도 갱신 */
function announce(accountId: string, balance: Balance): void {
  broadcast('custom:laneBalance', {
    accountId,
    anlas: balance.anlas,
    tier: balance.tier,
    ...(balance.usage ? { usage: balance.usage } : {})
  })
  if (balance.anlas !== null && getActiveNaiAccount()?.id === accountId) {
    broadcast('anlas:balance', {
      anlas: balance.anlas,
      tier: balance.tier,
      ...(balance.usage ? { usage: balance.usage } : {})
    })
  }
}

/**
 * 이 계정이 지금 이 요청을 뽑아도 되는지 확인하고 그 계정을 준다 (원본 계정 선택과 같은 모양).
 * 안 되면 LanePauseError — 큐가 그 계정을 쉬게 하고 항목은 다른 계정에 넘긴다.
 * 잔액은 장마다 새로 묻는다 (원본도 계정이 둘 이상이면 V5 생성 전마다 묻는다) — 묵은 값으로
 * 게이지가 바닥난 줄 모르고 뽑아 Anlas가 나가는 일을 막는다.
 */
export async function laneSelection(
  accountId: string,
  request: GenerationRequest
): Promise<NaiAccountSelection> {
  const account = getNaiAccounts().find((a) => a.id === accountId)
  if (!account) throw new LanePauseError('unknown', PAUSE_MS.unknown)
  const balance = await fetchAnlasBalance(account.token)
  // 조회 실패는 화면의 마지막 값을 지우지 않는다
  if (balance.tier == null) throw new LanePauseError('unknown', PAUSE_MS.unknown)
  announce(accountId, balance)
  if (balance.tier !== 'opus') throw new LanePauseError('notOpus', PAUSE_MS.notOpus)
  if (requestUsesV5Usage(request)) {
    // 게이지를 모르면 뽑지 않는다 (원본 자동 전환도 게이지를 모르는 계정은 고르지 않는다)
    if (!balance.usage) throw new LanePauseError('unknown', PAUSE_MS.unknown)
    if (isOpusUsageExhausted(balance)) throw new LanePauseError('exhausted', PAUSE_MS.exhausted)
  }
  return { account, balance, rotated: false }
}

/** 생성이 끝난 뒤 잔액 갱신 (실패해도 생성 흐름엔 영향 없음) */
export function refreshLaneBalance(accountId: string, token: string): void {
  void fetchAnlasBalance(token).then((balance) => {
    if (balance.tier == null) return
    announce(accountId, balance)
    // 사용량 기록은 활성 계정 것만 (여러 계정 잔액이 섞이면 '오늘 쓴 Anlas' 계산이 어긋난다)
    if (balance.anlas !== null && getActiveNaiAccount()?.id === accountId) logBalance(balance.anlas)
  })
}
