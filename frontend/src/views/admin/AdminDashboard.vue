<script setup>
import { ref, onMounted } from 'vue'
import api from '@/utils/api'
import dayjs from 'dayjs'
import VueApexCharts from 'vue3-apexcharts'

const stats = ref({ total:0, cooking:0, delivered:0, canceled:0, pending:0 })

const barSeries = ref([])
const barOptions = ref({
  chart: { type: 'bar', toolbar: { show: false } },
  xaxis: { categories: [] },
  plotOptions: { bar: { borderRadius: 4 } },
  colors: ['#66BB6A'],
  dataLabels: { enabled: true }
})

const pieSeries = ref([])
const pieOptions = ref({
  chart: { type: 'donut' },
  labels: [],
  legend: { position: 'bottom' },
  colors: ['#42A5F5','#66BB6A','#FFB300','#8E24AA','#FB8C00']
})

const statusSeries = ref([])
const statusOptions = ref({
  chart: { type: 'bar', stacked: true, toolbar: { show: false } },
  plotOptions: { bar: { horizontal: true, borderRadius: 3 } },
  xaxis: { categories: ['Requests'] },
  legend: { position: 'bottom' },
  colors: ['#9E9E9E','#42A5F5','#FB8C00','#00897B','#66BB6A','#E53935'],
  dataLabels: { enabled: true }
})

const recent = ref([])

async function loadData() {
  const { data } = await api.get('/admin/dashboard')

  // Stats
  stats.value.total     = Object.values(data.counts || {}).reduce((s,v) => s+v, 0)
  stats.value.cooking   = data.counts?.COOKING   || 0
  stats.value.delivered = data.counts?.DELIVERED || 0
  stats.value.canceled  = data.counts?.CANCELED  || 0
  stats.value.pending   = (data.counts?.NEW||0) + (data.counts?.ACCEPTED||0) + (data.counts?.READY||0)

  // Bar chart: Most Ordered Meals
  barSeries.value = [{ name: 'Orders', data: data.meals.map(m => m.count) }]
  barOptions.value.xaxis.categories = data.meals.map(m => m._id)

  // Pie chart: Menu Types
  pieSeries.value = data.menuTypes.map(m => m.count)
  pieOptions.value.labels = data.menuTypes.map(m => m._id)

  // Status Distribution
  statusSeries.value = Object.entries(data.counts || {}).map(([k,v]) => ({
    name: k, data: [v]
  }))

  // Recent Requests
  recent.value = data.recent || []
}

onMounted(loadData)

// 🔹 Color mapping for KPI cards
const statColors = {
  total: 'blue-lighten-5',
  cooking: 'orange-lighten-5',
  delivered: 'green-lighten-5',
  canceled: 'red-lighten-5',
  pending: 'grey-lighten-4'
}
</script>

<template>
  <v-container fluid>
    <!-- KPI Cards -->
    <v-row>
      <v-col cols="12" md="2" v-for="(v,k) in stats" :key="k">
        <v-card
          class="pa-3"
          elevation="1"
          :color="statColors[k]"
        >
          <div class="text-caption text-medium-emphasis">{{ k.toUpperCase() }}</div>
          <div class="text-h5 font-weight-bold">{{ v }}</div>
        </v-card>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="6">
        <v-card class="pa-3" elevation="2">
          <div class="text-subtitle-1 font-weight-bold mb-2">🥗 Most Ordered Meals</div>
          <VueApexCharts type="bar" height="250" :options="barOptions" :series="barSeries" />
        </v-card>
      </v-col>
      <v-col cols="12" md="6">
        <v-card class="pa-3" elevation="2">
          <div class="text-subtitle-1 font-weight-bold mb-2">🍛 Menu Types</div>
          <VueApexCharts type="donut" height="250" :options="pieOptions" :series="pieSeries" />
        </v-card>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12">
        <v-card class="pa-3" elevation="2">
          <div class="text-subtitle-1 font-weight-bold mb-2">📊 Status Distribution</div>
          <VueApexCharts type="bar" height="250" :options="statusOptions" :series="statusSeries" />
        </v-card>
      </v-col>
    </v-row>

    <!-- Recent Requests -->
    <v-card class="pa-3 mt-4" elevation="2">
      <div class="text-subtitle-1 font-weight-bold mb-2">🕒 Recent Requests</div>
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
            <td>{{ r.requestId }}</td>
            <td>{{ r.employee?.name }}</td>
            <td>{{ (r.meals || []).join(', ') }}</td>
            <td>{{ r.quantity }}</td>
            <td>{{ dayjs(r.serveDate).format('YYYY-MM-DD') }}</td>
            <td>{{ r.status }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </v-container>
</template>
