/**
 * Build the client-independent Chinese champion library snapshot.
 *
 * Runtime code must never call these upstream endpoints. This script runs in
 * CI/development, normalizes the responses, validates the complete snapshot,
 * and writes one minified, compression-friendly JSON artifact.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const CATALOG_URL = 'https://game.gtimg.cn/images/lol/act/img/js/heroList/hero_list.js'
const DETAIL_URL = 'https://game.gtimg.cn/images/lol/act/img/js/hero/{id}.js'
const CDRAGON_BIN_URL =
  'https://raw.communitydragon.org/latest/game/data/characters/{alias}/{alias}.bin.json'
const MATCHUPS_URL = 'https://lol-api-champion.op.gg/api/global/champions/ranked?tier={tier}'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 rank-analysis-data-sync/1.0'
const REQUEST_TIMEOUT_MS = 15_000
const DETAIL_CONCURRENCY = 8
const RETRIES = 1
const MATCHUP_TIERS = [
  'all',
  'gold_plus',
  'platinum_plus',
  'emerald_plus',
  'diamond_plus',
  'master_plus'
]

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'champion-library', 'cn-latest.json')
const MATCHUPS_OUTPUT_DIR = path.join(REPO_ROOT, 'data', 'champion-library', 'matchups')

const SLOT_ORDER = ['P', 'Q', 'W', 'E', 'R']
const LANE_ORDER = ['top', 'jungle', 'middle', 'bottom', 'support']
const LANE_MAP = new Map([
  ['top', 'top'],
  ['jungle', 'jungle'],
  ['mid', 'middle'],
  ['middle', 'middle'],
  ['adc', 'bottom'],
  ['bottom', 'bottom'],
  ['support', 'support'],
  ['utility', 'support']
])

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function fetchJson(url, label) {
  let lastError
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return JSON.parse(await response.text())
    } catch (error) {
      lastError = error
      if (attempt < RETRIES) await sleep(300 * (attempt + 1))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`${label} 请求失败（已重试 ${RETRIES} 次）: ${lastError?.message ?? lastError}`)
}

function patchMajorMinor(value) {
  const match = String(value ?? '').match(/(\d+)\.(\d+)/)
  return match ? `${Number(match[1])}.${Number(match[2])}` : null
}

function requiredNumber(value, field, championId) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new Error(`英雄 ${championId} 的 ${field} 不是有效数字: ${JSON.stringify(value)}`)
  }
  return number
}

function cleanFloat(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 1_000_000) / 1_000_000 : undefined
}

function modifiableBaseValue(record, field) {
  return cleanFloat(record?.[field]?.baseValue)
}

function findCharacterRoot(bin) {
  return Object.entries(bin ?? {}).find(([key]) => key.endsWith('/CharacterRecords/Root'))?.[1]
}

function splitRoles(value) {
  const roles = Array.isArray(value) ? value : String(value ?? '').split(/[,/|\s]+/)
  return [...new Set(roles.map(role => String(role).trim().toLowerCase()).filter(Boolean))]
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}

function cleanDescription(value) {
  const text = String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseSlashValues(value) {
  const text = cleanDescription(value)
  if (!text || text === '-') return []
  return text.split('/').map(part => {
    const normalized = part.trim()
    if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return Number(normalized)
    return normalized
  })
}

function rankValueKey(values) {
  return values.map(value => `${typeof value}:${String(value)}`).join('|')
}

function extractRankValues(description) {
  const results = []
  const seen = new Set()
  const pattern = /【([^【】]*\/[^【】]*)】/g
  for (const match of description.matchAll(pattern)) {
    const values = parseSlashValues(match[1])
    if (values.length < 2) continue
    // A rank value must actually change. Constant arrays are already represented
    // by cooldown/cost/range and add little value without a trustworthy label.
    if (new Set(values.map(String)).size < 2) continue
    const key = rankValueKey(values)
    if (seen.has(key)) continue
    seen.add(key)
    results.push({ label: `技能数值 ${results.length + 1}`, values })
  }
  return results
}

function normalizedSlot(value) {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
  if (key === 'passive' || key === 'p') return 'P'
  if (['q', 'w', 'e', 'r'].includes(key)) return key.toUpperCase()
  return null
}

function abilityMaxRank(slot, cooldowns, costs, ranges, rankValues) {
  if (slot === 'P') return 1
  const observed = Math.max(
    cooldowns.length,
    costs.length,
    ranges.length,
    ...rankValues.map(entry => entry.values.length)
  )
  if (observed > 1) return observed
  return slot === 'R' ? 3 : 5
}

function normalizeAbility(raw) {
  const slot = normalizedSlot(raw.spellKey)
  if (!slot) return null
  const description = cleanDescription(raw.description || raw.dynamicDescription)
  const cooldowns = parseSlashValues(raw.cooldownburn || raw.cooldown)
  const costs = parseSlashValues(raw.costburn || raw.cost)
  const ranges = parseSlashValues(raw.range)
  const rankValues = extractRankValues(description)
  return {
    slot,
    name: cleanDescription(raw.name) || `${slot} 技能`,
    description,
    iconUrl: String(raw.abilityIconPath ?? '').trim(),
    maxRank: abilityMaxRank(slot, cooldowns, costs, ranges, rankValues),
    cooldowns,
    costs,
    ranges,
    rankValues
  }
}

function normalizeStats(hero, championId, characterRoot) {
  const stat = (binKey, tencentKey, label) =>
    modifiableBaseValue(characterRoot, binKey) ??
    requiredNumber(hero[tencentKey], label, championId)
  const pair = (baseBinKey, baseTencentKey, growthBinKey, growthTencentKey, label) => ({
    base: stat(baseBinKey, baseTencentKey, `${label}.base`),
    growth: stat(growthBinKey, growthTencentKey, `${label}.growth`)
  })
  const attackSpeedBase = stat('attackSpeedModifiable', 'attackspeed', 'attackSpeed.base')
  const binAttackSpeedRatio = modifiableBaseValue(characterRoot, 'attackSpeedRatioModifiable')
  const resourceBase = requiredNumber(hero.mp, 'resource.base', championId)
  const resourceGrowth = requiredNumber(hero.mpperlevel, 'resource.growth', championId)
  return {
    health: pair('baseHPModifiable', 'hp', 'hpPerLevelModifiable', 'hpperlevel', 'health'),
    healthRegen: pair(
      'baseStaticHPRegenModifiable',
      'hpregen',
      'hpRegenPerLevelModifiable',
      'hpregenperlevel',
      'healthRegen'
    ),
    resourceName: resourceBase > 0 ? '法力值' : '无',
    resource: { base: resourceBase, growth: resourceGrowth },
    // BIN 的资源字段被哈希，当前仍使用腾讯公开字段。
    resourceRegen: {
      base: requiredNumber(hero.mpregen, 'resourceRegen.base', championId),
      growth: requiredNumber(hero.mpregenperlevel, 'resourceRegen.growth', championId)
    },
    attackDamage: pair(
      'baseDamageModifiable',
      'attackdamage',
      'damagePerLevelModifiable',
      'attackdamageperlevel',
      'attackDamage'
    ),
    armor: pair(
      'baseArmorModifiable',
      'armor',
      'armorPerLevelModifiable',
      'armorperlevel',
      'armor'
    ),
    magicResist: pair(
      'baseSpellBlockModifiable',
      'spellblock',
      'spellBlockPerLevelModifiable',
      'spellblockperlevel',
      'magicResist'
    ),
    attackSpeed: {
      base: attackSpeedBase,
      // Jhin 等特殊英雄的 BIN ratio 可能显式为 0；展示契约要求正数时回退基础攻速。
      ratio: binAttackSpeedRatio > 0 ? binAttackSpeedRatio : attackSpeedBase,
      growth: stat('attackSpeedPerLevelModifiable', 'attackspeedperlevel', 'attackSpeed.growth')
    },
    moveSpeed: stat('baseMoveSpeedModifiable', 'movespeed', 'moveSpeed'),
    attackRange: stat('attackRangeModifiable', 'attackrange', 'attackRange')
  }
}

function normalizeLanes(rawChampion) {
  const lanes = new Set()
  for (const position of rawChampion?.positions ?? []) {
    const normalized = LANE_MAP.get(
      String(position?.name ?? '')
        .trim()
        .toLowerCase()
    )
    if (normalized) lanes.add(normalized)
  }
  return LANE_ORDER.filter(lane => lanes.has(lane))
}

function matchupUrl(tier) {
  return MATCHUPS_URL.replace('{tier}', tier)
}

/**
 * Store a row in both directions. OP.GG exposes only selected counter rows, so
 * the reverse is mathematically valid for the same games but does not turn the
 * snapshot into a complete matrix; every output keeps isPartial=true.
 */
function buildMatchupSnapshot(response, tier, patch, generatedAt) {
  const rowsBySubject = new Map()
  const insert = (subjectId, lane, row) => {
    if (!rowsBySubject.has(subjectId)) rowsBySubject.set(subjectId, new Map())
    const byLane = rowsBySubject.get(subjectId)
    if (!byLane.has(lane)) byLane.set(lane, new Map())
    const byOpponent = byLane.get(lane)
    const previous = byOpponent.get(row.opponentId)
    if (!previous || row.games > previous.games) byOpponent.set(row.opponentId, row)
  }

  for (const rawChampion of response.data ?? []) {
    const subjectId = Number(rawChampion.id)
    if (!Number.isInteger(subjectId) || subjectId <= 0) continue
    for (const position of rawChampion.positions ?? []) {
      const lane = LANE_MAP.get(
        String(position?.name ?? '')
          .trim()
          .toLowerCase()
      )
      if (!lane) continue
      for (const counter of position.counters ?? []) {
        const opponentId = Number(counter.champion_id)
        const games = Number(counter.play)
        const wins = Number(counter.win)
        if (
          !Number.isInteger(opponentId) ||
          opponentId <= 0 ||
          !Number.isFinite(games) ||
          games <= 0 ||
          !Number.isFinite(wins)
        ) {
          continue
        }
        const winRate = Math.max(0, Math.min(1, wins / games))
        insert(subjectId, lane, { opponentId, winRate, games })
        insert(opponentId, lane, {
          opponentId: subjectId,
          winRate: 1 - winRate,
          games
        })
      }
    }
  }

  const champions = {}
  for (const subjectId of [...rowsBySubject.keys()].sort((left, right) => left - right)) {
    const lanes = {}
    const byLane = rowsBySubject.get(subjectId)
    for (const lane of LANE_ORDER) {
      const byOpponent = byLane.get(lane)
      if (!byOpponent) continue
      lanes[lane] = [...byOpponent.values()].sort(
        (left, right) => left.winRate - right.winRate || right.games - left.games
      )
    }
    champions[String(subjectId)] = lanes
  }
  return {
    schemaVersion: 1,
    patch,
    tier,
    region: 'global',
    generatedAt,
    source: 'OP.GG build snapshot',
    isPartial: true,
    champions
  }
}

function validateMatchupSnapshot(snapshot) {
  if (snapshot.schemaVersion !== 1 || snapshot.isPartial !== true) {
    throw new Error(`对位快照 ${snapshot.tier} 的 schema/isPartial 非法`)
  }
  for (const [subjectId, lanes] of Object.entries(snapshot.champions)) {
    if (!Number.isInteger(Number(subjectId))) throw new Error(`非法对位英雄 ID: ${subjectId}`)
    for (const [lane, rows] of Object.entries(lanes)) {
      if (!LANE_ORDER.includes(lane)) throw new Error(`非法分路: ${lane}`)
      const opponents = new Set()
      let previousWinRate = -1
      for (const row of rows) {
        if (!(row.winRate >= 0 && row.winRate <= 1) || !(row.games > 0)) {
          throw new Error(`对位快照 ${snapshot.tier}/${subjectId}/${lane} 含非法行`)
        }
        if (opponents.has(row.opponentId)) {
          throw new Error(`对位快照 ${snapshot.tier}/${subjectId}/${lane} 含重复对手`)
        }
        if (row.winRate < previousWinRate) {
          throw new Error(`对位快照 ${snapshot.tier}/${subjectId}/${lane} 未按胜率升序`)
        }
        opponents.add(row.opponentId)
        previousWinRate = row.winRate
      }
    }
  }
}

function sourceWarnings(champions) {
  const warnings = []
  const zeroAttackDamageGrowth = champions.filter(
    champion => champion.stats.attackDamage.growth === 0
  )
  if (zeroAttackDamageGrowth.length) {
    warnings.push(
      `最终快照 attackDamage.growth=0: ${zeroAttackDamageGrowth.map(champion => champion.alias).join(', ')}`
    )
  }
  const suspiciousRankValues = []
  for (const champion of champions) {
    for (const ability of champion.abilities) {
      for (const rankValue of ability.rankValues) {
        for (const value of rankValue.values) {
          if (
            typeof value === 'string' &&
            (/%%/.test(value) ||
              (value.match(/%/g) ?? []).length > 1 ||
              (value.match(/\./g) ?? []).length > 1)
          ) {
            suspiciousRankValues.push(`${champion.id}/${ability.slot}:${value}`)
          }
        }
      }
    }
  }
  if (suspiciousRankValues.length) {
    warnings.push(`腾讯源疑似缺少分隔符的技能值: ${suspiciousRankValues.join(', ')}`)
  }
  return warnings
}

function normalizeChampion(summary, detail, lanes, characterRoot) {
  const hero = detail?.hero
  if (!hero) throw new Error(`英雄 ${summary.heroId} 详情缺少 hero`)
  const id = requiredNumber(hero.heroId ?? summary.heroId, 'id', summary.heroId)
  const baseSkin =
    (detail.skins ?? []).find(skin => String(skin.isBase) === '1') ?? detail.skins?.[0]
  const abilitiesBySlot = new Map()
  for (const spell of detail.spells ?? []) {
    const ability = normalizeAbility(spell)
    if (ability && !abilitiesBySlot.has(ability.slot)) abilitiesBySlot.set(ability.slot, ability)
  }
  const abilities = SLOT_ORDER.map(slot => abilitiesBySlot.get(slot)).filter(Boolean)
  const champion = {
    id,
    name: cleanDescription(hero.title || summary.title),
    title: cleanDescription(hero.name || summary.name),
    alias: String(hero.alias || summary.alias || '').trim(),
    shortBio: cleanDescription(hero.shortBio),
    roles: splitRoles(hero.roles ?? summary.roles),
    lanes,
    portraitUrl: String(hero.palmHeroHeadImg || baseSkin?.iconImg || '').trim(),
    splashUrl: String(baseSkin?.centerImg || baseSkin?.mainImg || '').trim(),
    difficulty: requiredNumber(hero.difficultyL, 'difficulty', id),
    stats: normalizeStats(hero, id, characterRoot),
    abilities
  }
  const damageType = String(hero.damageType ?? '').trim()
  if (damageType) champion.damageType = damageType
  return champion
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

function validateSnapshot(snapshot) {
  if (snapshot.schemaVersion !== 1) throw new Error('schemaVersion 必须为 1')
  if (!snapshot.patch) throw new Error('patch 不能为空')
  if (snapshot.champions.length < 170) {
    throw new Error(`英雄数量异常: ${snapshot.champions.length}（至少应有 170）`)
  }
  const ids = new Set()
  const aliases = new Set()
  let positiveAttackDamageGrowth = 0
  for (const champion of snapshot.champions) {
    if (ids.has(champion.id)) throw new Error(`重复英雄 ID: ${champion.id}`)
    ids.add(champion.id)
    const aliasKey = champion.alias.toLowerCase()
    if (!aliasKey) throw new Error(`英雄 ${champion.id} 缺少 alias`)
    if (aliases.has(aliasKey)) throw new Error(`重复英雄 alias: ${champion.alias}`)
    aliases.add(aliasKey)
    const slots = champion.abilities.map(ability => ability.slot)
    for (const slot of SLOT_ORDER) {
      if (!slots.includes(slot)) throw new Error(`英雄 ${champion.id} 缺少 ${slot} 技能`)
    }
    if (champion.abilities.find(ability => ability.slot === 'P')?.maxRank !== 1) {
      throw new Error(`英雄 ${champion.id} 的被动 maxRank 必须为 1`)
    }
    if (champion.stats.attackDamage.growth > 0) positiveAttackDamageGrowth += 1
    if (!(champion.stats.attackSpeed.ratio > 0)) {
      throw new Error(`英雄 ${champion.id} 的 attackSpeed.ratio 必须大于 0`)
    }
  }
  if (positiveAttackDamageGrowth < 160) {
    throw new Error(
      `成长攻击力有效英雄不足: ${positiveAttackDamageGrowth}/${snapshot.champions.length}`
    )
  }
}

async function main() {
  const startedAt = Date.now()
  console.log('正在拉取腾讯英雄目录与 OP.GG 构建期分路快照…')
  const [catalog, ...matchupResponses] = await Promise.all([
    fetchJson(CATALOG_URL, '腾讯英雄目录'),
    ...MATCHUP_TIERS.map(tier => fetchJson(matchupUrl(tier), `OP.GG ${tier} 对位快照`))
  ])
  const patch = patchMajorMinor(catalog.version)
  if (!patch) throw new Error(`无法解析腾讯版本: ${catalog.version ?? '未知'}`)
  for (const [index, response] of matchupResponses.entries()) {
    const lanePatch = patchMajorMinor(response?.meta?.version)
    if (!lanePatch || patch !== lanePatch) {
      throw new Error(
        `数据版本不一致：腾讯=${catalog.version ?? '未知'}，OP.GG ${MATCHUP_TIERS[index]}=${response?.meta?.version ?? '未知'}`
      )
    }
  }
  const summaries = Array.isArray(catalog.hero) ? catalog.hero : []
  const laneResponse = matchupResponses[MATCHUP_TIERS.indexOf('emerald_plus')]
  const lanesById = new Map(
    (laneResponse.data ?? []).map(champion => [Number(champion.id), normalizeLanes(champion)])
  )
  console.log(
    `版本 ${patch}，开始并发拉取 ${summaries.length} 个英雄详情（并发 ${DETAIL_CONCURRENCY}）…`
  )
  let completed = 0
  const binFailures = []
  const champions = await mapConcurrent(summaries, DETAIL_CONCURRENCY, async summary => {
    const id = Number(summary.heroId)
    const alias = String(summary.alias ?? '').trim()
    const binUrl = CDRAGON_BIN_URL.replaceAll('{alias}', alias.toLowerCase())
    const [detail, characterBin] = await Promise.all([
      fetchJson(DETAIL_URL.replace('{id}', String(id)), `英雄 ${id} 详情`),
      fetchJson(binUrl, `英雄 ${id}/${alias} BIN`).catch(error => {
        binFailures.push(`${alias}: ${error.message}`)
        return null
      })
    ])
    const characterRoot = findCharacterRoot(characterBin)
    if (characterBin && !characterRoot) binFailures.push(`${alias}: 缺少 CharacterRecords/Root`)
    completed += 1
    if (completed % 20 === 0 || completed === summaries.length) {
      console.log(`英雄详情进度 ${completed}/${summaries.length}`)
    }
    return normalizeChampion(summary, detail, lanesById.get(id) ?? [], characterRoot)
  })
  champions.sort((left, right) => left.id - right.id)
  const generatedAt = new Date().toISOString()
  const snapshot = {
    schemaVersion: 1,
    patch,
    generatedAt,
    sources: {
      catalog: CATALOG_URL,
      details: DETAIL_URL,
      characterBins: CDRAGON_BIN_URL,
      lanes: matchupUrl('emerald_plus')
    },
    champions
  }
  validateSnapshot(snapshot)
  const json = `${JSON.stringify(snapshot)}\n`
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, json, 'utf8')
  await mkdir(MATCHUPS_OUTPUT_DIR, { recursive: true })
  let matchupsByteLength = 0
  for (const [index, tier] of MATCHUP_TIERS.entries()) {
    const matchupSnapshot = buildMatchupSnapshot(matchupResponses[index], tier, patch, generatedAt)
    validateMatchupSnapshot(matchupSnapshot)
    const matchupJson = `${JSON.stringify(matchupSnapshot)}\n`
    matchupsByteLength += Buffer.byteLength(matchupJson)
    await writeFile(path.join(MATCHUPS_OUTPUT_DIR, `${tier}.json`), matchupJson, 'utf8')
  }
  const byteLength = Buffer.byteLength(json)
  const noLane = champions
    .filter(champion => champion.lanes.length === 0)
    .map(champion => champion.id)
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`已写入 ${OUTPUT_PATH}`)
  console.log(
    `英雄 ${champions.length}，大小 ${(byteLength / 1024 / 1024).toFixed(2)} MiB，耗时 ${elapsedSeconds}s`
  )
  console.log(
    `对位快照 ${MATCHUP_TIERS.length} 份，总大小 ${(matchupsByteLength / 1024).toFixed(1)} KiB`
  )
  console.log(`无 OP.GG 分路英雄 ${noLane.length}: ${noLane.join(', ') || '无'}`)
  console.log(`CommunityDragon BIN 回退 ${binFailures.length}: ${binFailures.join('; ') || '无'}`)
  for (const warning of sourceWarnings(champions)) console.warn(`源数据告警：${warning}`)
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
