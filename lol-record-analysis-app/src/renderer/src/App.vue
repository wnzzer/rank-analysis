<template>
  <div class="all-contains">
    <t-layout>
      <t-header style="background-color: #242424;">
        <div style="display: flex; justify-content: space-between; padding: 10px 10px;">
          <div> <img slot="logo" theme="dark" width="40" class="logo" src="./assets/logo.png" alt="logo" />
          </div>

          <div  autoWidth="true" style="display: flex; width: 30%;">
            <t-input placeholder="查询召唤师" clearable>
              <template #suffixIcon>
                <search-icon :style="{ cursor: 'pointer' }" />
              </template>
            </t-input>
            <span style="margin-left: 20px; width: 200px; margin-right: 20px;" class="gradient-text">
              躺赢的混子#212212
            </span>
            <span>
              <t-image src="https://cn.bing.com/images/search?view=detailV2&ccid=3khCqZPW&id=9C940338CF6F0FFC414E48C941398B1B91346A09&thid=OIP.3khCqZPWMwaEXWZ-HzdQHQHaEK&mediaurl=https%3a%2f%2fimages.wallpapersden.com%2fimage%2fdownload%2fyone-hd-league-of-legends-art_bW1pamuUmZqaraWkpJRmbmdlrWZlbWU.jpg&exph=1080&expw=1920&q=lol&simid=608019365476959109&FORM=IRPRST&ck=43E65D3681FECF37DD17B501F38EC958&selectedIndex=1&itb=0" :style="{ width: '40px', height: '40px' }" shape="circle" fit="cover" />
            </span>
          </div>
        </div>

      </t-header>
      <t-layout>
        <t-menu theme="dark" :collapsed="collapsed" :style="{ width: collapsed ? '80px' : '120px', height: '85vh' }">
          <!-- <template #logo>
            <img :width="collapsed ? 35 : 100" src="./assets/logo.png" alt="logo" />
          </template> -->


          <t-menu-item value="item3">
            <template #icon>
              <ChartComboIcon />
            </template>
            生涯
          </t-menu-item>
          <t-menu-item value="item4">
            <template #icon>
              <LoadIcon />
            </template>
            对局
          </t-menu-item>
          <t-menu-item value="item5">
            <template #icon>
              <tag-icon />
            </template>
            标签
          </t-menu-item>

          <template #operations>
            <t-button class="t-demo-collapse-btn" variant="text" shape="square" @click="onClinkIcon">
              <template #icon>
                <component :is="currentIcon"  style="color: white"/>
              </template>
            </t-button>
          </template>
        </t-menu>

      </t-layout>
    </t-layout>
  </div>
</template>
<script setup lang="ts">
import {
  ChartComboIcon,
  LoadIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  TagIcon,
  SearchIcon 
} from 'tdesign-icons-vue-next';
import { ref } from 'vue';
//折叠按钮
const collapsed = ref(false)
const currentIcon = ref(ChevronLeftIcon)
const onClinkIcon = () => {
  collapsed.value = !collapsed.value
  if (collapsed.value === false) {
    currentIcon.value = ChevronLeftIcon
  } else {
    currentIcon.value = ChevronRightIcon
  }
}
</script>
<style lang="css">
.gradient-text {
  color: transparent;
  background-clip: text;
  -webkit-background-clip: text;
  background-image: linear-gradient(to right, #8678f9, #c7d2fe);
  background-size: 200% auto;
  animation: textGradient 1.5s linear infinite;
}

@keyframes textGradient {
  to {
    background-position: 200%;
  }
}

</style>