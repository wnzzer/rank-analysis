import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    /** 侧栏 / 标题栏展示名 */
    title?: string
    /**
     * 该页是否不依赖 LCU 连接。
     *
     * `useGameState` 的连接监听在「客户端断开」时会把用户推回 Loading，而
     * `game-state-changed` 是 ≤10s 一次的心跳（见 game_state_monitor.rs 的
     * `state_changed || diff_time > 10s`）——所以任何不声明本标记的页面，在未开
     * 客户端时最多待 10 秒就会被弹走。
     *
     * 数据源不来自 LCU 的页面（英雄榜走 OP.GG 快照、设置读本地配置）必须声明
     * `true`，否则压根没法用。改成 meta 驱动而非在 useGameState 里硬编码路径
     * 前缀，是因为后者漏过一次：`/Champions`（#168 新增）就没进豁免名单。
     */
    offlineCapable?: boolean
  }
}

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/Loading'
  },
  {
    path: '/Record',
    name: 'Record',
    component: () => import('@renderer/views/Record.vue'),
    meta: { title: '战绩查询' }
  },
  {
    path: '/MatchDetail',
    name: 'MatchDetail',
    component: () => import('@renderer/views/MatchDetail.vue'),
    meta: { title: '对局详情', offlineCapable: true } // 独立窗口 / 详情页读的是已取回的对局数据
  },
  {
    path: '/Gaming',
    name: 'Gaming',
    component: () => import('@renderer/views/Gaming.vue'),
    meta: { title: '对局分析' }
  },
  {
    path: '/Champions',
    name: 'Champions',
    component: () => import('@renderer/views/Champions.vue'),
    meta: { title: '英雄榜', offlineCapable: true } // 榜单数据来自 OP.GG 快照，与 LCU 无关
  },
  {
    path: '/Loading',
    name: 'Loading',
    component: () => import('@renderer/views/Loading.vue'),
    meta: { title: '加载中' }
  },
  {
    // 开发用：情报卡动画演示，无导航入口，仅 #/IntelDemo 直达
    path: '/IntelDemo',
    name: 'IntelDemo',
    component: () => import('@renderer/views/IntelDemo.vue'),
    meta: { title: '情报卡演示' }
  },
  {
    path: '/Settings',
    name: 'Settings',
    redirect: '/Settings/Automation',
    component: () => import('@renderer/views/Settings.vue'),
    meta: { title: '设置', offlineCapable: true }, // 设置只读写本地配置
    children: [
      {
        path: '/Settings/General',
        name: 'General',
        component: () => import('@renderer/views/settings/General.vue'),
        meta: { title: '常规设置' }
      },
      {
        path: '/Settings/Automation',
        name: 'Automation',
        component: () => import('@renderer/views/settings/Automation.vue'),
        meta: { title: '自动化' }
      },
      {
        path: '/Settings/Tags',
        name: 'Tags',
        component: () => import('@renderer/views/settings/Tags.vue'),
        meta: { title: '标签管理' }
      },
      {
        path: '/Settings/PlayerNotes',
        name: 'PlayerNotes',
        component: () => import('@renderer/views/settings/PlayerNotes.vue'),
        meta: { title: '我标记过的人' }
      },
      {
        path: '/Settings/DataSync',
        name: 'DataSync',
        component: () => import('@renderer/views/settings/DataSync.vue'),
        meta: { title: '数据与同步' }
      },
      {
        path: '/Settings/About',
        name: 'About',
        component: () => import('@renderer/views/settings/About.vue'),
        meta: { title: '关于' }
      }
    ]
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export function getFirstPath(currentPath: string) {
  return currentPath.split('/')[1]
}

export default router
