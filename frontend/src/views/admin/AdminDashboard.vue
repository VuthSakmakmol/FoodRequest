<!-- src/views/admin/AdminDashboard.vue -->
<script setup>
import { ref, onMounted } from 'vue'
import dayjs from 'dayjs'
import VueApexCharts from 'vue3-apexcharts'
import api from '@/utils/api'

/* ───────── ID → Display name maps (adjust if your backend uses other codes) ───────── */
const MEAL_NAME = {
  1: 'Breakfast',
  2: 'Lunch',
  3: 'Dinner',
  4: 'Snack',
  Breakfast: 'Breakfast',
  Lunch: 'Lunch',
  Dinner: 'Dinner',
  Snack: 'Snack'
}
const MENU_TYPE_NAME = {
  STD: 'Standard',
  Standard: 'Standard',
  VEG: 'Vegetarian',
  Vegetarian: 'Vegetarian',
  VGN: 'Vegan',
  Vegan: 'Vegan',
  NP: 'No pork',
  'No pork': 'No pork',
  NB: 'No beef',
  'No beef': 'No beef'
}

/* ───────── State ───────── */
const loading = ref(false)
const stats = ref({ total:0, cooking:0, delivered:0, canceled:0, pending:0 })
const recent = ref([])

/* Most Ordered Meals (bar) */
const barSeries = ref([{ name: 'Orders', data: [] }])
const barOptions = ref({
  chart: { type: 'bar', toolbar: { show: false } },
  xaxis: { categories: [] },
  plotOptions: { bar: { borderRadius: 4 } },
  colors: ['#66BB6A'],
  dataLabels: { enabled: true },
  tooltip: { y: { formatter: (v) => `${v} orders` } }
})
const barKey = ref('bar-0') // force rerender when labels change

/* Menu Types (donut) */
const pieSeries = ref([])
const pieOptions = ref({
  chart: { type: 'donut' },
  labels: [],
  legend: { position: 'bottom' },
  colors: ['#42A5F5','#66BB6A','#FFB300','#8E24AA','#FB8C00'],
  dataLabels: { enabled: true },
  tooltip: { y: { formatter: (v) => `${v} orders` } }
})
const pieKey = ref('pie-0') // force rerender when labels change

/* Status Distribution (stacked bar) */
const statusSeries = ref([])
const statusOptions = ref({
  chart: { type: 'bar', stacked: true, toolbar: { show: false } },
  plotOptions: { bar: { horizontal: true, borderRadius: 3 } },
  xaxis: { categories: ['Requests'] },
  legend: { position: 'bottom' },
  colors: ['#9E9E9E','#42A5F5','#FB8C00','#00897B','#66BB6A','#E53935'],
  dataLabels: { enabled: true }
})

/* Load data */
async function loadData() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/dashboard')

    const counts = data?.counts || {}
    const mealsArr = Array.isArray(data?.meals) ? data.meals : []
    const menuTypesArr = Array.isArray(data?.menuTypes) ? data.menuTypes : []
    recent.value = Array.isArray(data?.recent) ? data.recent : []

    // Stats
    stats.value.total     = Object.values(counts).reduce((s,v) => s + (Number(v)||0), 0)
    stats.value.cooking   = Number(counts.COOKING || 0)
    stats.value.delivered = Number(counts.DELIVERED || 0)
    stats.value.canceled  = Number(counts.CANCELED || 0)
    stats.value.pending   = (Number(counts.NEW||0)) + (Number(counts.ACCEPTED||0)) + (Number(counts.READY||0))

    // ── Most Ordered Meals (bar): map ids → names; rebuild options so legend/x-axis update
    const mealLabels = mealsArr.map(m => MEAL_NAME[m?._id] ?? String(m?._id ?? 'Unknown'))
    const mealCounts = mealsArr.map(m => Number(m?.count || 0))
    barSeries.value = [{ name: 'Orders', data: mealCounts }]
    barOptions.value = {
      ...barOptions.value,
      xaxis: { ...barOptions.value.xaxis, categories: mealLabels }
    }
    barKey.value = `bar-${mealLabels.join('|')}`

    // ── Menu Types (donut): map ids → names; rebuild whole options to ensure legend uses labels
    const mtLabels = menuTypesArr.map(m => MENU_TYPE_NAME[m?._id] ?? String(m?._id ?? 'Unknown'))
    const mtCounts = menuTypesArr.map(m => Number(m?.count || 0))
    pieSeries.value = mtCounts
    pieOptions.value = {
      ...pieOptions.value,
      labels: mtLabels,
      legend: { position: 'bottom' } // keep legend visible and labeled
    }
    pieKey.value = `pie-${mtLabels.join('|')}`

    // ── Status Distribution
    const order = ['NEW','ACCEPTED','COOKING','READY','DELIVERED','CANCELED']
    statusSeries.value = order
      .filter(k => counts[k] != null)
      .map(k => ({ name: k, data: [Number(counts[k] || 0)] }))

  } finally {
    loading.value = false
  }
}

onMounted(loadData)

/* KPI colors */
const statColors = {
  total: 'blue-lighten-5',
  cooking: 'orange-lighten-5',
  delivered: 'green-lighten-5',
  canceled: 'red-lighten-5',
  pending: 'grey-lighten-4'
}

/* Date helper for recent list */
function bestDate(r) {
  const d = r?.eatDate || r?.orderDate || r?.createdAt || r?.serveDate
  return d ? dayjs(d).format('YYYY-MM-DD') : '—'
}
</script>

<template>
  <v-container fluid>
    <!-- KPI Cards -->
    <v-row>
      <v-col cols="6" md="2" v-for="(v,k) in stats" :key="k">
        <v-card class="pa-3" elevation="1" :color="statColors[k]">
          <div class="text-caption text-medium-emphasis">{{ k.toUpperCase() }}</div>
          <div class="text-h5 font-weight-bold">{{ v }}</div>
        </v-card>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="6">
        <v-card class="pa-3" elevation="2">
          <div class="text-subtitle-1 font-weight-bold mb-2">🥗 Most Ordered Meals</div>
          <VueApexCharts
            :key="barKey"
            type="bar"
            height="260"
            :options="barOptions"
            :series="barSeries"
          />
          <div v-if="!barSeries[0]?.data?.length" class="text-medium-emphasis text-caption mt-2">
            No meal data yet.
          </div>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card class="pa-3" elevation="2">
          <div class="text-subtitle-1 font-weight-bold mb-2">🍛 Menu Types</div>
          <VueApexCharts
            :key="pieKey"
            type="donut"
            height="260"
            :options="pieOptions"
            :series="pieSeries"
          />
          <div v-if="!pieSeries.length" class="text-medium-emphasis text-caption mt-2">
            No menu type data yet.
          </div>
        </v-card>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12">
        <v-card class="pa-3" elevation="2">
          <div class="text-subtitle-1 font-weight-bold mb-2">📊 Status Distribution</div>
          <VueApexCharts
            type="bar"
            height="260"
            :options="statusOptions"
            :series="statusSeries"
          />
          <div v-if="!statusSeries.length" class="text-medium-emphasis text-caption mt-2">
            No status data yet.
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Recent Requests -->
    <v-card class="pa-3 mt-4" elevation="2">
      <div class="d-flex align-center justify-space-between">
        <div class="text-subtitle-1 font-weight-bold mb-2">🕒 Recent Requests</div>
        <v-progress-circular v-if="loading" indeterminate size="20" color="primary" />
      </div>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>ID</th>
            <th>Employee</th>
            <th>Meals</th>
            <th>Qty</th>
            <th>Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in recent" :key="r._id">
            <td>{{ r.requestId || '—' }}</td>
            <td>{{ r.employee?.name || '—' }}</td>
            <td>{{ (r.meals || []).join(', ') }}</td>
            <td>{{ r.quantity }}</td>
            <td>{{ bestDate(r) }}</td>
            <td>{{ r.status }}</td>
          </tr>
          <tr v-if="!recent.length && !loading">
            <td colspan="6" class="text-center text-medium-emphasis">No recent requests.</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </v-container>
</template>
