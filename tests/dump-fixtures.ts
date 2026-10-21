// 把造数据对局快照导出为 JSON，供离线检查脚本（如张冠李戴检测）使用
import { writeFileSync } from 'node:fs'
import { CASES } from './ai-fixtures'
writeFileSync(process.argv[2], JSON.stringify(Object.fromEntries(CASES.map(c => [c.key, c.snap]))))
