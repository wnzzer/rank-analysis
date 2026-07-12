import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'

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
    meta: { title: '对局详情' }
  },
  {
    path: '/Gaming',
    name: 'Gaming',
    component: () => import('@renderer/views/Gaming.vue'),
    meta: { title: '对局分析' }
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
    meta: { title: '设置' },
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
