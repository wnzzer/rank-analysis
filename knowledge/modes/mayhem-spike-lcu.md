# A3.0 Spike：LCU 强化暴露度探测记录

> 目的：复核「LCU 不暴露局内三选一状态」这一竞品结论（aramgg_client 与 HexBox
> 均因此采用屏幕 OCR）。若某端点在 2400 对局中暴露了可用状态/事件，A3 主路径
> 可从 OCR 升级为事件订阅——这是本 spike 唯一的成功判据。
>
> 探测工具：应用内命令 `mayhem_probe_lcu`（对局中调用，扫描候选端点 JSON 中
> 键名含 "augment" 的路径并回报）。

## 待探测端点

| 端点 | 预期 | 结果 |
|---|---|---|
| `lol-gameflow/v1/session` | 可能有 phase/map 变化字段 | ☐ 待录 |
| `lol-champ-select/v1/session` | 局内是否复活 | ☐ 待录 |
| `lol-gameflow/v1/gameflow-phase` | 仅字符串，作对照 | ☐ 待录 |
| Live Client Data `/liveclientdata/eventdata`（2999） | 是否新增强化选择事件类型 | ☐ 待录（需 InGame；当前 probe 未覆盖，待 A3.1 截屏层落地时补测） |

## 记录模板

```text
日期：        补丁：       queueId：     客户端：
probe 输出（原样粘贴）：
结论：[ ] 维持 OCR 主路径   [ ] 发现可用状态（贴路径与样例）
```

## 已知背景（2026-08-26）

- aramgg_client（valkia）：ChampSelect 只读 LCU + 对局中 PaddleOCR 屏幕标题区，
  README 明示推荐链路"只读取状态和统计数据"，未使用任何局内强化端点。
- HexBox（hexdata）：本地 OCR 识别三选一，同样不读内存/LCU 局内状态。
- 结论置信度：高。OCR 仍是 A3 主路径；本探测作为长期低成本复核手段保留。

## 复核流程

1. 进入一局海克斯大乱斗（queueId 2400），打到第一次三选一出现后停留 10 秒。
2. 开发者工具执行：
   ```js
   const r = await window.__TAURI__.core.invoke('mayhem_probe_lcu')
   console.log(JSON.stringify(r, null, 2))
   ```
3. 按模板把结果追加到本文档表格下方（保留历史记录，勿覆盖旧条目）。
