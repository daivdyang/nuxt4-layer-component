<template>
    <div>
        <h2>測試TestCard組件與RemoteLayerComp組件</h2>
        <TestCard />
        <RemoteLayerComp :name="'tester123'" :callback="callback" />
    </div>
</template>
<script setup lang="ts">
import TestCard from '../../../app/components/TestCard.vue';
import RemoteLayerComp from '../../../app/components/RemoteLayerComp.vue';

function callback() {
    console.log('run callback')
}
</script>