<template>
  <h2>測試主頁</h2>
  <div class="list">
    <NuxtLink to="/basic">Basic組件</NuxtLink>
    <NuxtLink to="/dayjs">dayjs組件</NuxtLink>
    <NuxtLink to="/virtual-scroll">VirtualScroll組件</NuxtLink>
  </div>
</template>
<style scoped>
.list {
  display: flex;
  gap: 1rem;
  justify-content: center;
  align-items: center;
}
</style>