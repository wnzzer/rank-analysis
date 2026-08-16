/**
 * 知识库构建：knowledge/ 源文件（markdown + yaml）→ data/knowledge/knowledge.json。
 * 纯 node 标准库实现（无运行时依赖），格式受控：
 * - modes/*.md: `# 标题` + `## 节名` + `- 条目`，条目按行抽取
 * - rules/signals.yaml: 固定缩进结构（见 knowledge/rules/signals.yaml）
 * - champions/: 本批骨架，存在 md 则按 modes 同法解析为 championNotes
 * 产物契约：Rust 端 `src-tauri/src/knowledge.rs` + 前端
 * `src/services/ai/shared/signals.ts` 共同消费，schemaVersion 变更需两端同步。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC_DIR = path.join(ROOT, 'knowledge')
const OUT_DIR = path.join(ROOT, 'data', 'knowledge')
const OUT_FILE = path.join(OUT_DIR, 'knowledge.json')

const SCHEMA_VERSION = 1
const PATCH = process.env.KNOWLEDGE_PATCH || '26.13'
/** 指标白名单与 signals.ts 的 KNOWN_METRICS 必须一致 */
const KNOWN_METRICS = new Set([
  'lossStreak',
  'winRate10',
  'games10',
  'isOffRole',
  'recentKda'
])
const KNOWN_OPS = new Set(['lt', 'lte', 'gt', 'gte', 'eq'])
const KNOWN_SCOPES = new Set(['teammate', 'enemy', 'self'])
const KNOWN_SEVERITIES = new Set(['info', 'warn', 'danger'])

/** 解析 modes/*.md / champions/*.md：`- ` 开头的条目归属上一个 `## 节` */
function parseMarkdown(content) {
  const entries = []
  let currentSection = ''
  for (const raw of content.split('\n')) {
    const line = raw.trimEnd()
    const sectionMatch = line.match(/^##\s+(.+)$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim()
      continue
    }
    const itemMatch = line.match(/^-\s+(.+)$/)
    if (itemMatch) {
      entries.push(`[${currentSection}] ${itemMatch[1].trim()}`)
    }
  }
  return entries
}

function parseModeKnowledge() {
  const result = {}
  for (const file of fs.readdirSync(path.join(SRC_DIR, 'modes')).filter(f => f.endsWith('.md'))) {
    const key = path.basename(file, '.md')
    const content = fs.readFileSync(path.join(SRC_DIR, 'modes', file), 'utf8')
    result[key] = parseMarkdown(content)
  }
  return result
}

function parseChampionNotes() {
  const result = {}
  const dir = path.join(SRC_DIR, 'champions')
  if (!fs.existsSync(dir)) return result
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const key = path.basename(file, '.md')
    const content = fs.readFileSync(path.join(dir, file), 'utf8')
    const entries = parseMarkdown(content)
    if (entries.length > 0) {
      result[key] = { powerSpike: entries }
    }
  }
  return result
}

/**
 * 解析 rules/signals.yaml（严格缩进结构）：
 * 顶层 `- id: x` 列表项；字段 `  key: value` 两级缩进；
 * `whenAll/whenAny` 子列表项 `    - metric: ...`。
 * 畸形条目直接抛错（本地构建，宁可失败也不产出坏规则）。
 */
function parseSignalRules(content) {
  const rules = []
  let current = null
  let inWhen = null
  let whenConditions = null

  const startRule = () => {
    current = { id: '', scope: '', position: null, whenAll: [], whenAny: [], text: '', severity: '' }
    inWhen = null
    rules.push(current)
  }

  for (const raw of content.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const indent = raw.match(/^\s*/)[0].length
    const line = raw.trim()

    if (indent === 0 && line.startsWith('- id:')) {
      startRule()
      current.id = line.slice(5).trim()
      continue
    }
    if (!current) continue

    if (indent === 2) {
      const match = line.match(/^(\w+):\s*(.*)$/)
      if (!match) throw new Error(`signals.yaml 解析失败（第 ${raw} 行）: ${line}`)
      const [key, value] = [match[1], match[2].trim()]
      if (key === 'scope') current.scope = value
      else if (key === 'position') current.position = value || null
      else if (key === 'text') current.text = value
      else if (key === 'severity') current.severity = value
      else if (key === 'whenAll' || key === 'whenAny') {
        inWhen = key
        whenConditions = []
        current[key] = whenConditions
      } else throw new Error(`signals.yaml 未知字段 ${key}`)
      continue
    }

    if (indent === 4 && inWhen) {
      const m = line.match(/^- (\w+):\s*(.*)$/)
      if (!m) throw new Error(`signals.yaml 条件解析失败: ${line}`)
      const cond = { metric: '', op: '', value: NaN }
      const [, key, value] = m
      if (key === 'metric') cond.metric = value.trim()
      else if (key === 'op') cond.op = value.trim()
      else if (key === 'value') cond.value = Number(value.trim())
      else throw new Error(`signals.yaml 条件未知字段 ${key}`)
      whenConditions.push(cond)
      continue
    }

    if (indent === 6 && inWhen) {
      const match = line.match(/^(\w+):\s*(.*)$/)
      if (!match) throw new Error(`signals.yaml 条件解析失败: ${line}`)
      const [key, value] = [match[1], match[2].trim()]
      if (key === 'metric') whenConditions[whenConditions.length - 1].metric = value
      else if (key === 'op') whenConditions[whenConditions.length - 1].op = value
      else if (key === 'value')
        whenConditions[whenConditions.length - 1].value = Number(value)
      else throw new Error(`signals.yaml 条件未知字段 ${key}`)
    }
  }

  return rules
}

function validateRule(rule) {
  const errors = []
  if (!rule.id) errors.push('id 缺失')
  if (!KNOWN_SCOPES.has(rule.scope)) errors.push(`scope 非法: ${rule.scope}`)
  if (!KNOWN_SEVERITIES.has(rule.severity)) errors.push(`severity 非法: ${rule.severity}`)
  if (!rule.text) errors.push('text 缺失')
  for (const key of ['whenAll', 'whenAny']) {
    for (const cond of rule[key]) {
      if (!KNOWN_METRICS.has(cond.metric)) errors.push(`指标不在白名单: ${cond.metric}`)
      if (!KNOWN_OPS.has(cond.op)) errors.push(`运算符非法: ${cond.op}`)
      if (typeof cond.value !== 'number' || Number.isNaN(cond.value)) errors.push(`value 非法: ${cond.value}`)
    }
  }
  if (errors.length > 0) {
    throw new Error(`规则 ${rule.id || '(未命名)'} 校验失败: ${errors.join('; ')}`)
  }
}

export function buildKnowledge() {
  const modeKnowledge = parseModeKnowledge()
  const championNotes = parseChampionNotes()
  const signalRules = parseSignalRules(
    fs.readFileSync(path.join(SRC_DIR, 'rules', 'signals.yaml'), 'utf8')
  )
  for (const rule of signalRules) validateRule(rule)

  const out = {
    schemaVersion: SCHEMA_VERSION,
    patch: PATCH,
    updatedAt: new Date().toISOString(),
    patchNotes: {},
    championNotes,
    modeKnowledge,
    signalRules
  }
  return out
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))

if (invokedDirectly) {
  const out = buildKnowledge()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n')
  console.log(
    `已写入 ${OUT_FILE}（patch=${out.patch}，modes=${Object.keys(out.modeKnowledge).length}，rules=${out.signalRules.length}）`
  )
}
