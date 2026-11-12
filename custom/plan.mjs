// 빌드 계획과 릴리스 안내문을 만든다.
//   node custom/plan.mjs plan                         → 새로 빌드할지 판단 (GitHub Actions 출력)
//   node custom/plan.mjs notes <버전> <원본태그> <해시> → 릴리스 안내문 출력
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFile, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/
const REV_LIMIT = 1000 // 원본 1.0.30 → 커스텀 1.0.30000 ~ 1.0.30999

/** 설치 파일 내용에 영향을 주는 파일만 묶어 지문을 만든다. 지문이 같으면 다시 빌드하지 않는다. */
async function customHash() {
  const patches = (await readdir(join(here, 'patches'))).filter((n) => n.endsWith('.patch')).sort()
  assert.ok(patches.length > 0, 'custom/patches 에 수정 파일이 없음')
  const hash = createHash('sha256')
  for (const name of [...patches.map((n) => `patches/${n}`), 'assemble.mjs']) {
    hash.update(`${name}\n`)
    hash.update((await readFile(join(here, name), 'utf8')).replaceAll('\r\n', '\n'))
    hash.update('\n')
  }
  return hash.digest('hex').slice(0, 16)
}

async function github(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {})
    }
  })
  assert.ok(res.ok, `GitHub 응답 오류 ${res.status}: ${path}`)
  return res.json()
}

/** 원본 버전과 기존 커스텀 릴리스 목록으로 다음 할 일을 정한다. (순수 함수 — 테스트 가능) */
export function decide(upstreamTag, releases, hash) {
  const up = TAG.exec(upstreamTag)
  assert.ok(up, `원본 태그 형식 오류: ${upstreamTag}`)
  const [major, minor, patch] = up.slice(1).map(Number)
  const mine = releases
    .map((r) => ({ m: TAG.exec(r.tag_name ?? ''), body: r.body ?? '' }))
    .filter(({ m }) => m && +m[1] === major && +m[2] === minor)
    .map(({ m, body }) => ({ n: +m[3], body }))
    .filter(({ n }) => Math.floor(n / REV_LIMIT) === patch)
    .sort((a, b) => b.n - a.n)
  let rev = 0
  if (mine.length > 0) {
    const builtHash = /^custom-hash: ([0-9a-f]+)$/m.exec(mine[0].body)?.[1]
    if (builtHash === hash) return { build: false, version: `${major}.${minor}.${mine[0].n}` }
    rev = (mine[0].n % REV_LIMIT) + 1
  }
  assert.ok(rev < REV_LIMIT, '같은 원본 버전에서 수정 횟수 한도 초과')
  return { build: true, version: `${major}.${minor}.${patch * REV_LIMIT + rev}` }
}

const [mode, ...args] = process.argv.slice(2)
if (mode === 'plan') {
  const upstream = process.env.UPSTREAM
  const repo = process.env.GITHUB_REPOSITORY
  assert.ok(upstream && repo, 'UPSTREAM, GITHUB_REPOSITORY 필요')
  const upstreamTag = (await github(`/repos/${upstream}/releases/latest`)).tag_name
  const releases = await github(`/repos/${repo}/releases?per_page=100`)
  const hash = await customHash()
  const result = decide(upstreamTag, releases, hash)
  const lines = [
    `build=${result.build}`,
    `version=${result.version}`,
    `upstream_tag=${upstreamTag}`,
    `hash=${hash}`
  ]
  console.log(lines.join('\n'))
  console.log(
    result.build
      ? `→ 빌드함: 원본 ${upstreamTag} 기반 커스텀 ${result.version}`
      : `→ 건너뜀: 커스텀 ${result.version} 이 이미 최신 (원본 ${upstreamTag}, 수정 내용 동일)`
  )
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n')
} else if (mode === 'notes') {
  const [version, upstreamTag, hash] = args
  assert.ok(version && upstreamTag && hash, '사용: notes <버전> <원본태그> <해시>')
  const upstream = process.env.UPSTREAM
  const notes = await readFile(join(here, 'NOTES.md'), 'utf8')
  console.log(
    [
      `비공식 커스텀 빌드입니다. 원본 [${upstream} ${upstreamTag}](https://github.com/${upstream}/releases/tag/${upstreamTag}) 에 아래 수정을 얹어 자동으로 만들었습니다.`,
      '',
      notes.trim(),
      '',
      '윈도우 전용. 설치 전에 NAIS3에서 백업 내보내기(`.nais`)를 해 두세요.',
      '',
      `custom-hash: ${hash}`
    ].join('\n')
  )
} else if (mode) {
  assert.fail(`알 수 없는 명령: ${mode}`)
}
