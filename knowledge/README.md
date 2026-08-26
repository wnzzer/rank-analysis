# 知识库源文件（人类友好）

本目录是知识库 `data/knowledge/knowledge.json` 的源文件，由
`scripts/build-knowledge.mjs` 编译（`node scripts/build-knowledge.mjs`），
产物经 jsDelivr / GitCode 分发，客户端（Rust `knowledge` 模块）拉取后
注入 AI prompt（`src/services/ai/shared/intelContext.ts`）。

## 目录结构

```
knowledge/
├── modes/          # 模式知识合集（markdown：`# 标题` + `## 节` + `- 条目`）
│   ├── ranked.md   #   排位（召唤师峡谷 5v5）
│   ├── brawl.md    #   斗魂竞技场（queueId 1700）
│   ├── mayhem.md   #   海克斯大乱斗（queueId 2400）
│   └── aram.md     #   大乱斗
├── champions/      # 单英雄知识点（渐进补充，本批仅骨架）
└── rules/
    └── signals.yaml # 关联信号规则（阈值 + 文案模板，前端 evaluateSignals 消费）
```

## 维护流程

1. 编辑源文件 → `node scripts/build-knowledge.mjs` 本地生成并自检；
2. push 后 CI（`.github/workflows/knowledge-data.yml`）会自动重建产物并提交
   到 `data/knowledge/knowledge.json`，客户端下次拉取即生效，无需发版。

## 约定

- 每份 modes 文件结构：`# 模式名` 开头，`## 节名` 分节，条目以 `- ` 开头，
  脚本按行抽取（跳过标题与空行）。条目为**通用打法建议**，避免编造具体数字
  或英雄数值（版本数值由 OP.GG / 国服补丁管道负责）。
- 版本英雄改动（patchNotes）已由 `data/patch-notes/cn-latest.json` 管道
  独立覆盖，知识库产物中该字段保持空对象，避免双源冲突。
- `rules/signals.yaml` 的指标取值必须在前端信号引擎白名单内
  （`src/services/ai/shared/signals.ts` 的 `KNOWN_METRICS`），
  未知指标会被引擎静默跳过（远程规则不可信输入按防御式处理）。
