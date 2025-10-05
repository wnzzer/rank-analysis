# 🎯 基于事件的路由切换系统

## 概述

从**轮询模式**升级到**事件驱动模式**，实现更高效、更实时的游戏状态监听和路由切换。

## 架构设计

```
┌─────────────────┐
│  游戏客户端      │
│  (LCU API)      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│  后端监听器              │
│  game_state_monitor.rs  │
│  - 2秒轮询 phase API    │
│  - 检测状态变化         │
└────────┬────────────────┘
         │
         ▼ (Tauri Event)
┌─────────────────────────┐
│  前端 Composable        │
│  useGameState.ts        │
│  - 监听事件             │
│  - 自动切换路由         │
└────────┬────────────────┘
         │
         ▼
┌─────────────────┐
│  Vue Router     │
│  路由切换       │
└─────────────────┘
```

## 关键组件

### 1. 后端：游戏状态监听器 (`game_state_monitor.rs`)

**功能：**
- 每 2 秒检查一次游戏客户端状态
- 调用 `get_my_summoner()` 和 `get_phase()` 获取状态
- 检测到状态变化时，通过 Tauri 事件系统发送到前端

**事件数据结构：**
```rust
pub struct GameStateEvent {
    pub connected: bool,         // 客户端是否连接
    pub phase: Option<String>,   // 游戏阶段
    pub summoner: Option<Summoner>, // 召唤师信息
}
```

**核心逻辑：**
```rust
// 检测状态变化
let state_changed = new_state.connected != self.last_state.connected
    || new_state.phase != self.last_state.phase;

if state_changed {
    // 发送事件到前端
    self.app_handle.emit("game-state-changed", &new_state)?;
}
```

### 2. 前端：游戏状态 Composable (`useGameState.ts`)

**功能：**
- 监听后端发送的 `game-state-changed` 事件
- 自动根据游戏状态切换路由
- 提供响应式的游戏状态数据

**使用方法：**
```typescript
import { useGameState } from '@renderer/composables/useGameState';

const { isConnected, currentPhase, summoner } = useGameState();
```

**路由切换逻辑：**
```typescript
if (state.connected && state.summoner) {
    // 客户端已连接 → 跳转到 Record 页面
    router.push({
        path: '/Record',
        query: { name: `${summoner.gameName}#${summoner.tagLine}` }
    });
} else {
    // 客户端断开 → 跳转到 Loading 页面
    router.push({ path: '/Loading' });
}
```

### 3. 前端：组件集成 (`SideNavigation.vue`)

**修改前（轮询）：**
```typescript
onMounted(() => {
    getGetMySummoner().then(() => {
        setInterval(() => {
            getGetMySummoner();  // 每 10 秒轮询
        }, 10000);
    })
});
```

**修改后（事件驱动）：**
```typescript
const { isConnected, summoner: gameStateSummoner } = useGameState();

watch(gameStateSummoner, (newSummoner) => {
    if (newSummoner) {
        mySummoner.value = newSummoner;
    }
}, { immediate: true });
```

## 优势对比

| 特性 | 轮询模式 ❌ | 事件驱动 ✅ |
|------|------------|-----------|
| **响应速度** | 最慢 10 秒 | 2 秒内响应 |
| **资源消耗** | 高（每个组件独立轮询） | 低（后端统一监听） |
| **代码复杂度** | 每个组件都要写轮询逻辑 | 一次注册，到处使用 |
| **一致性** | 不同组件可能状态不一致 | 全局状态统一 |
| **维护性** | 分散在多个组件 | 集中在一个模块 |

## 使用示例

### 在任何组件中使用

```vue
<template>
  <div>
    <div v-if="isConnected">
      游戏客户端已连接
      <div>当前阶段: {{ currentPhase }}</div>
      <div>召唤师: {{ summoner?.gameName }}</div>
    </div>
    <div v-else>
      等待游戏客户端连接...
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGameState } from '@renderer/composables/useGameState';

const { isConnected, currentPhase, summoner } = useGameState();
</script>
```

### 自定义路由切换逻辑

如果需要自定义路由切换逻辑，可以禁用自动切换：

```typescript
import { ref, onMounted, onUnmounted } from 'vue';
import { listen } from '@tauri-apps/api/event';

onMounted(async () => {
  const unlisten = await listen('game-state-changed', (event) => {
    const state = event.payload;
    
    // 自定义逻辑
    if (state.connected && state.phase === 'ChampSelect') {
      router.push({ path: '/Gaming' });
    }
  });
});
```

## 事件流程图

```
游戏启动
  │
  ▼
后端检测到 summoner 可访问
  │
  ▼
后端发送事件: { connected: true, summoner: {...} }
  │
  ▼
前端接收事件
  │
  ▼
检查当前路由
  │
  ├─ 如果在 Loading 页面 → 跳转到 Record
  └─ 否则 → 更新 summoner 数据

游戏关闭
  │
  ▼
后端检测到 summoner 不可访问
  │
  ▼
后端发送事件: { connected: false, summoner: null }
  │
  ▼
前端接收事件
  │
  ▼
检查当前路由
  │
  └─ 如果不在 Loading 页面 → 跳转到 Loading
```

## 性能优化

### 1. 后端缓存
```rust
// 状态没有变化时不发送事件
if new_state.connected == self.last_state.connected 
   && new_state.phase == self.last_state.phase {
    return; // 跳过
}
```

### 2. 前端去重
```typescript
// 监听器自动去重，不需要手动处理
const { isConnected } = useGameState(); // 响应式，自动更新
```

### 3. 资源清理
```typescript
onUnmounted(() => {
    // 自动清理事件监听器
    if (unlisten) {
        unlisten();
    }
});
```

## 调试技巧

### 后端日志
```rust
log::info!(
    "Game state changed: connected={}, phase={:?}",
    new_state.connected,
    new_state.phase
);
```

### 前端日志
```typescript
console.log('🎮 Game state changed:', state);
console.log('📍 Auto navigated to Record page');
```

### 查看事件流
在浏览器控制台：
```javascript
// 查看所有游戏状态变化
window.__TAURI__.event.listen('game-state-changed', (event) => {
  console.log('Event:', event.payload);
});
```

## 迁移指南

### 1. 移除旧的轮询代码

**删除：**
```typescript
setInterval(() => {
    getGetMySummoner();
}, 10000);
```

**替换为：**
```typescript
const { summoner } = useGameState();
```

### 2. 移除手动路由切换

**删除：**
```typescript
if (router.currentRoute.value.path == "/Loading") {
    router.push({ path: '/Record' });
}
```

**自动处理：**
`useGameState()` 已经包含了自动路由切换逻辑

### 3. 更新类型定义

如果前端 `Summoner` 类型与后端不完全一致：
```typescript
const mySummoner = computed(() => {
  if (gameStateSummoner.value) {
    return {
      ...gameStateSummoner.value,
      // 添加额外字段或转换
    } as Summoner;
  }
  return {} as Summoner;
});
```

## 扩展功能

### 添加更多事件

**后端：**
```rust
// 添加新事件
if in_game {
    self.app_handle.emit("game-started", &game_info)?;
}
```

**前端：**
```typescript
await listen('game-started', (event) => {
  const gameInfo = event.payload;
  router.push({ path: '/Gaming' });
});
```

### Phase 特定的路由

```typescript
if (state.phase === 'ChampSelect') {
  router.push({ path: '/Champion-Select' });
} else if (state.phase === 'InProgress') {
  router.push({ path: '/In-Game' });
}
```

## 相关文件

### 后端
- `src-tauri/src/game_state_monitor.rs` - 状态监听器
- `src-tauri/src/main.rs` - 启动监听器
- `src-tauri/src/lib.rs` - 模块注册

### 前端
- `src/composables/useGameState.ts` - Composable
- `src/components/SideNavigation.vue` - 使用示例
- `src/router/index.ts` - 路由配置

## 总结

- ✅ **响应更快** - 2 秒内响应状态变化
- ✅ **资源更省** - 后端统一监听，避免重复轮询
- ✅ **代码更简洁** - 一行代码即可使用
- ✅ **维护更容易** - 逻辑集中在一个模块
- ✅ **扩展更灵活** - 可以轻松添加新的事件和逻辑
