/**
 * 组件样式守门：亮暗差异只能经 token 表达（见 CODE_QUALITY.md「主题材质规则」）
 *
 * 规则（仅扫 .vue 的 <style>，含 theme-fixed 注释的行豁免）：
 * - theme-light：组件内不得写 .theme-light 补丁
 * - white-alpha：不得裸写 rgba(255,255,255,…)（改用 token）
 * - glow：带颜色的外发光（blur>0 且无扩散的 0 0 Npx + 颜色）必须乘 --fx-glow
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

type RuleId = 'theme-light' | 'white-alpha' | 'glow'

const SRC = resolve(__dirname, '..')
const WHITE = /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/
const GLOW = /(?<![\d.]\s)\b0 0 [1-9]\d*px/
const COLOR = /rgba\(|color-mix\(|#[0-9a-fA-F]{3,8}\b/

const RULES: Record<RuleId, (line: string) => boolean> = {
  'theme-light': line => line.includes('.theme-light'),
  'white-alpha': line => WHITE.test(line),
  glow: line => GLOW.test(line) && COLOR.test(line) && !line.includes('--fx-glow')
}

function vueFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules' && name !== '__tests__') vueFiles(p, acc)
    } else if (name.endsWith('.vue')) acc.push(p)
  }
  return acc
}

/** 文件（posix 相对路径）→ 规则 → 违规行 */
function scan(): Map<string, Map<RuleId, string[]>> {
  const result = new Map<string, Map<RuleId, string[]>>()
  for (const file of vueFiles(SRC)) {
    const src = readFileSync(file, 'utf8')
    const rel = relative(SRC, file).split('\\').join('/')
    for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      const startLine = src.slice(0, m.index).split('\n').length
      m[1].split('\n').forEach((line, i) => {
        if (line.includes('theme-fixed')) return
        for (const [id, test] of Object.entries(RULES) as [RuleId, (l: string) => boolean][]) {
          if (!test(line)) continue
          const byRule = result.get(rel) ?? new Map<RuleId, string[]>()
          byRule.set(id, [...(byRule.get(id) ?? []), `${startLine + i}: ${line.trim()}`])
          result.set(rel, byRule)
        }
      })
    }
  }
  return result
}

describe('component styles follow the theme material rules', () => {
  const violations = scan()

  it('has no violations', () => {
    const report: string[] = []
    for (const [file, byRule] of violations) {
      for (const [id, lines] of byRule) report.push(`${file} [${id}]\n  ${lines.join('\n  ')}`)
    }
    expect(report, report.join('\n')).toEqual([])
  })
})
