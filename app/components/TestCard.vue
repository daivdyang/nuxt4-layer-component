<template>
    <div>
        <h1>This is test component</h1>
        <div>{{ `Title: ${info.name}` }}</div>
        <div>{{ `Count: ${counter}` }}</div>
        <button @click="counter++">Counter++</button>
    </div>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue'

const counter = ref(0)
const info = ref({
    name: ''
})

onMounted(() => {
    console.log('test card is mounted')
})
</script>