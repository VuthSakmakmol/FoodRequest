<script setup>
import { ref, onMounted } from 'vue'
import api from '@/utils/api'


const rows = ref([])
const loading = ref(false)


onMounted(load)


async function load() {
loading.value = true
try {
const { data } = await api.get('/chef/orders/today')
rows.value = Array.isArray(data) ? data : (data?.data || [])
} finally {
loading.value = false
}
}
</script>


<template>
<v-card class="rounded-2xl">
<v-toolbar color="primary" title="Chef — Today" class="rounded-t-2xl" />
<v-card-text>
<v-progress-linear v-if="loading" indeterminate class="mb-4" />
<v-table density="comfortable">
<thead>
<tr>
<th>Order</th>
<th>Items</th>
<th>Status</th>
</tr>
</thead>
<tbody>
<tr v-for="r in rows" :key="r._id">
<td>{{ r.orderNo }}</td>
<td>{{ (r.items||[]).map(i=>`${i.qty}× ${i.name}`).join(', ') }}</td>
<td>{{ r.status }}</td>
</tr>
</tbody>
</v-table>
</v-card-text>
</v-card>
</template>