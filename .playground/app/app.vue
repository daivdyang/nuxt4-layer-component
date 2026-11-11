<template>
  <TestCard />
  <RemoteLayerComp :name="'tester123'" :callback="callback" />
</template>

<script setup lang="ts">
import TestCard from '../../app/components/TestCard.vue';
import RemoteLayerComp from '../../app/components/RemoteLayerComp.vue';

function callback() {
    console.log('run callback')
}
</script>