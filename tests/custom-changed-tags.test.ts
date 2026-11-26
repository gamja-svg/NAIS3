// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NaisApi } from '../src/preload/index'
import { ChangedTagsNote } from '../src/renderer/src/components/custom-changed-tags'
import { PromptEditor } from '../src/renderer/src/components/prompt-editor'
import { changedTagRanges } from '../src/renderer/src/lib/custom-prompt-diff'
import { useLanguageStore } from '../src/renderer/src/lib/i18n'

// [custom] 미생성 씬 — 바뀐 태그 노란 칠과 빠진 태그 줄

describe('custom: changed tag marks', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    window.nais = {
      invoke: vi.fn(async () => ({ counts: [0] })),
      on: () => () => {}
    } as unknown as NaisApi
    useLanguageStore.setState({ lang: 'ko' })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  /** 노랗게 칠한 글자들 (가중치·찾기 층은 style에 노란 밑줄이 없다) */
  const yellow = (): string[] =>
    [...container.querySelectorAll('span')]
      .filter((s) => s.getAttribute('style')?.includes('inset 0 -2px 0 rgb(234 179 8)'))
      .map((s) => s.textContent ?? '')

  it('paints the changed tags in the editor and nothing without marks', async () => {
    const value = 'girl, grin, outdoors'
    await act(async () =>
      root.render(
        h(PromptEditor, {
          value,
          onValueChange: () => {},
          marks: changedTagRanges(value, 'girl, smile, outdoors')
        })
      )
    )
    expect(yellow()).toEqual(['grin'])
    await act(async () => root.render(h(PromptEditor, { value, onValueChange: () => {} })))
    expect(yellow()).toEqual([])
  })

  it('explains the yellow and lists removed tags under the editor', async () => {
    await act(async () =>
      root.render(h(ChangedTagsNote, { current: 'girl, grin', base: 'girl, smile, blush' }))
    )
    expect(container.textContent).toContain('노란색 = 마지막으로 뽑은 뒤 바뀐 태그')
    expect([...container.querySelectorAll('s')].map((s) => s.textContent)).toEqual([
      'smile',
      'blush'
    ])
    await act(async () => root.render(h(ChangedTagsNote, { current: 'girl', base: 'girl' })))
    expect(container.textContent).toBe('')
  })
})
