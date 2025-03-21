<template>
    <div>
        <h2>Automation Settings</h2>
        <div>
            <label for="auto-accept-match">Auto Accept Match</label>
            <n-switch id="auto-accept-match" v-model:value="settings.autoAcceptMatch"></n-switch>
        </div>
        <div>
            <label for="auto-select-champion">Auto Select Champion</label>
            <n-switch id="auto-select-champion" v-model:value="settings.autoSelectChampion"></n-switch>
        </div>
        <div>
            <label for="auto-ban-champion">Auto Ban Champion</label>
            <n-switch id="auto-ban-champion" v-model:value="settings.autoBanChampion"></n-switch>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const settings = ref({
    autoAcceptMatch: false,
    autoSelectChampion: false,
    autoBanChampion: false
});
</script>