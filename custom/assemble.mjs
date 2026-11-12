// 원본 소스 폴더(현재 폴더)에 커스텀 빌드 설정을 얹는다.
// 사용: node assemble.mjs <버전> <owner/repo>
// 바꿀 자리를 못 찾으면 실패한다(원본 구조가 바뀐 것이므로 사람이 확인해야 함).
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const [version, repo] = process.argv.slice(2)
assert.match(version ?? '', /^\d+\.\d+\.\d+$/, '버전 형식 오류')
assert.match(repo ?? '', /^[\w.-]+\/[\w.-]+$/, '저장소 형식 오류 (owner/repo)')
const [owner, name] = repo.split('/')

async function edit(path, replacements) {
  let text = await readFile(path, 'utf8')
  for (const [pattern, replacement] of replacements) {
    const matches = text.match(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g'))
    assert.equal(matches?.length, 1, `${path}: 바꿀 자리가 정확히 1곳이어야 함 → ${pattern}`)
    text = text.replace(pattern, replacement)
  }
  await writeFile(path, text)
}

// 1. 버전 번호
await edit('package.json', [[/^(  "version": ")[^"]+(",)$/m, `$1${version}$2`]])

// 2. 업데이트 확인 주소 (앱 안의 확인 코드 + 설치 파일에 들어가는 업데이트 설정)
await edit('src/main/updater.ts', [[/^const REPO = '[^']+'$/m, `const REPO = '${repo}'`]])
await edit('electron-builder.yml', [
  [/^(publish:\n  provider: github\n  owner: )\S+(\n  repo: )\S+$/m, `$1${owner}$2${name}`]
])

console.log(`조립 완료: 버전 ${version}, 업데이트 주소 ${repo}`)
