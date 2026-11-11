<template>
    <div>
        <h1>This is remote layer component</h1>
        <div>{{ `Name: ${name}` }}</div>
        <div>{{ `Count: ${counter}` }}</div>
        <button @click="onClickCounter">Counter++</button>
    </div>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue'

const props = defineProps<{
    name: string
    callback?: () => void
}>()

const emit = defineEmits<{
    (e: 'counter', count: number): void
}>()

const counter = ref(0)

function onClickCounter() {
    counter.value++
    emit('counter', counter.value)
    props.callback?.()
}
onMounted(() => {
    console.log('remote layer component')
})
</script>