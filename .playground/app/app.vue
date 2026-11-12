<template>
  <TestCard />
  <RemoteLayerComp :name="'tester123'" :callback="callback" />
  <DateComp :format-pattern="'YY/MM/DD'" :locale="'en'" :date="'2026-12-24'" />
</template>

<script setup lang="ts">
import TestCard from '../../app/components/TestCard.vue';
import RemoteLayerComp from '../../app/components/RemoteLayerComp.vue';
import DateComp from '../../app/components/DateComp.vue';

function callback() {
    console.log('run callback')
}
</script>