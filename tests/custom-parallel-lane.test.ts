import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationRequest } from '../src/shared/types'
import type { NaiAccountBalance } from '../src/main/nai/account-router'

// [custom] 동시 생성: 계정마다 뽑아도 되는지 판정 (Anlas를 쓰지 않는 것이 원칙)

const db = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  activeId: 'a'
}))
const accounts = [
  { id: 'a', label: 'A', token: 'token-a' },
  { id: 'b', label: 'B', token: 'token-b' }
]
vi.mock('../src/main/db/settings', () => ({
  getSetting: (key: string) => db.settings.get(key) ?? null,
  setSetting: (key: string, value: string) => db.settings.set(key, value),
  getNaiAccounts: () => accounts,
  getActiveNaiAccount: () => accounts.find((a) => a.id === db.activeId) ?? null,
  setActiveNaiAccount: () => true
}))
const net = vi.hoisted(() => ({
  balances: {} as Record<string, NaiAccountBalance>,
  calls: [] as string[]
}))
vi.mock('../src/main/nai/client', () => ({
  fetchAnlasBalance: async (token: string) => {
    net.calls.push(token)
    return net.balances[token] ?? { anlas: null, tier: null }
  }
}))
const sent = vi.hoisted(() => [] as [string, unknown][])
vi.mock('../src/main/ipc', () => ({
  broadcast: (channel: string, payload: unknown) => sent.push([channel, payload])
}))
const logged = vi.hoisted(() => [] as number[])
vi.mock('../src/main/nai/anlas-log', () => ({ logBalance: (n: number) => logged.push(n) }))

const { laneSelection, parallelLanes, parallelTarget, getParallelConfig, setParallelConfig } =
  await import('../src/main/custom/parallel')
const { LanePauseError } = await import('../src/main/queue/generation-queue')

const V5 = { model: 'nai-diffusion-5-curated' } as GenerationRequest
const V45 = { model: 'nai-diffusion-4-5-full' } as GenerationRequest
const opus = (percent: number, isNegative = false): NaiAccountBalance => ({
  anlas: 500,
  tier: 'opus',
  usage: { percent, isNegative, timeUntilNextPercent: 100 }
})

async function pauseReason(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise
    return null
  } catch (e) {
    expect(e).toBeInstanceOf(LanePauseError)
    return (e as InstanceType<typeof LanePauseError>).reason
  }
}

describe('custom: lane account check', () => {
  beforeEach(() => {
    db.settings.clear()
    net.balances = {}
    net.calls.length = 0
    sent.length = 0
    logged.length = 0
  })

  it('uses an Opus account with gauge left and tells the screen its balance', async () => {
    net.balances['token-b'] = opus(40)
    const selection = await laneSelection('b', V5)
    expect(selection.account.id).toBe('b')
    expect(selection.rotated).toBe(false)
    expect(sent.map(([c]) => c)).toEqual(['custom:laneBalance']) // b는 활성 계정이 아님
  })

  it('rests an account whose V5 gauge ran out instead of spending Anlas', async () => {
    net.balances['token-a'] = opus(0, true)
    expect(await pauseReason(laneSelection('a', V5))).toBe('exhausted')
    // V4.5는 게이지를 쓰지 않으니 그대로 뽑는다
    expect(await pauseReason(laneSelection('a', V45))).toBeNull()
  })

  it('asks for a fresh balance before every image', async () => {
    net.balances['token-a'] = opus(1)
    await laneSelection('a', V5)
    net.balances['token-a'] = opus(0, true)
    expect(await pauseReason(laneSelection('a', V5))).toBe('exhausted')
    expect(net.calls).toEqual(['token-a', 'token-a'])
  })

  it('rests non-Opus accounts, failed checks, unknown gauges and removed accounts', async () => {
    net.balances['token-a'] = { anlas: 500, tier: 'scroll' }
    expect(await pauseReason(laneSelection('a', V45))).toBe('notOpus')
    expect(await pauseReason(laneSelection('b', V5))).toBe('unknown') // 조회 실패
    // 조회에 실패한 b는 화면 값을 건드리지 않는다 (알린 것은 a 뿐)
    expect(sent.map(([, p]) => (p as { accountId?: string }).accountId ?? 'title')).toEqual([
      'a',
      'title'
    ])
    net.balances['token-b'] = { anlas: 500, tier: 'opus' }
    expect(await pauseReason(laneSelection('b', V5))).toBe('unknown') // 게이지 모름
    expect(await pauseReason(laneSelection('gone', V5))).toBe('unknown')
  })

  it('updates the title bar balance only for the active account', async () => {
    net.balances['token-a'] = opus(50)
    await laneSelection('a', V5)
    expect(sent.map(([c]) => c)).toEqual(['custom:laneBalance', 'anlas:balance'])
  })
})

describe('custom: parallel settings', () => {
  beforeEach(() => db.settings.clear())

  it('is off by default and lists every account when on', () => {
    expect(getParallelConfig()).toEqual({ enabled: false, target: null })
    expect(parallelLanes()).toBeNull()
    expect(setParallelConfig({ enabled: true })).toEqual({ enabled: true, target: null })
    expect(parallelLanes()).toEqual(['a', 'b'])
  })

  it('saves and clears the send-to account', () => {
    setParallelConfig({ target: 'b' })
    expect(parallelTarget()).toBe('b')
    expect(setParallelConfig({ target: null })).toEqual({ enabled: false, target: null })
    expect(parallelTarget()).toBeNull()
  })
})
