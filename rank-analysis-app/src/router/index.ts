import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/Home'
  },
  {
    path: '/Home',
    name: 'Home',
    component: () => import('@renderer/views/Home.vue'),
    meta: { title: '主页' }
  },
  {
    path: '/Record',
    name: 'Record',
    component: () => import('@renderer/views/Record.vue'),
    meta: { title: '战绩查询' }
  },
  {
    path: '/Gaming',
    name: 'Gaming',
    component: () => import('@renderer/views/Gaming.vue'),
    meta: { title: '对局分析' }
  },
  {
    path: '/Growth',
    name: 'Growth',
    component: () => import('@renderer/views/Growth.vue'),
    meta: { title: '成长' }
  },
  {
    path: '/Mayhem',
    name: 'Mayhem',
    component: () => import('@renderer/views/Mayhem.vue'),
    meta: { title: '海克斯大乱斗' }
  },
  {
    path: '/Mayhem/champion/:id',
    name: 'MayhemChampionDetail',
    component: () => import('@renderer/views/MayhemChampionDetail.vue'),
    meta: { title: '大乱斗英雄详情' }
  },
  {
    path: '/Library',
    name: 'Library',
    component: () => import('@renderer/views/Library.vue'),
    meta: { title: '资产库' }
  },
  {
    path: '/Loading',
    // 旧连接门已并入主页状态卡；路由保留仅为兼容历史深链，重定向到主页
    redirect: '/Home'
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
        path: '/Settings/Companion',
        name: 'Companion',
        component: () => import('@renderer/views/settings/Companion.vue'),
        meta: { title: 'AI 搭子' }
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
