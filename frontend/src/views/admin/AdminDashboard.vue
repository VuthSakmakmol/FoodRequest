<script setup>
import { ref, onMounted } from 'vue'
import api from '@/utils/api'


const me = ref(null)
const stats = ref(null)


onMounted(async () => {
const { data: profile } = await api.get('/auth/me')
me.value = profile
// Example: hit a protected admin endpoint
try {
const { data } = await api.get('/admin/summary')
stats.value = data
} catch (e) {
// if your backend restricts, handle error here
}
})
</script>


<template>
<v-card class="rounded-2xl">
<v-toolbar title="Admin Dashboard" class="rounded-t-2xl" color="primary" />
<v-card-text>
<div class="mb-4">Welcome, <strong>{{ me?.name || me?.loginId }}</strong></div>
<pre class="text-caption">{{ stats }}</pre>
</v-card-text>
</v-card>
</template>