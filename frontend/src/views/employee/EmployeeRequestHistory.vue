<!-- src/views/employee/EmployeeRequestHistory.vue -->
<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import api from '@/utils/api'
import dayjs from 'dayjs'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import Swal from 'sweetalert2'
import socket, { subscribeEmployeeIfNeeded } from '@/utils/socket'
import * as XLSX from 'xlsx'
import { useDisplay } from 'vuetify'

dayjs.extend(isSameOrAfter)
dayjs.extend(isSameOrBefore)

const { mdAndUp } = useDisplay()

/* ───────── state ───────── */
const loading = ref(false)
const rows = ref([])
const q = ref('')
const status = ref('ALL')
const statuses = ['ALL','NEW','ACCEPTED','COOKING','READY','DELIVERED','CANCELED']
const employeeId = ref((localStorage.getItem('employeeId') || '').toString())

/* date filter */
const dateStart = ref('')
const dateEnd = ref('')

/* pagination */
const page = ref(1)
const itemsPerPage = ref(20)
const itemsPerPageOptions = [20, 50, 100, 'All']

/* expand/collapse per row */
const expanded = ref(new Set())
const isExpanded = id => expanded.value.has(id)
function toggleExpanded(id) {
  const s = new Set(expanded.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expanded.value = s
}

/* mobile filter dialog */
const showFilterDialog = ref(false)
function resetFilters() {
  q.value = ''
  status.value = 'ALL'
  dateStart.value = ''
  dateEnd.value = ''
  page.value = 1
  load()
}

/* ───────── helpers ───────── */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '—')
const normalize = o => ({ ...o, _id: String(o?._id || '') })

// newest-first sort key: orderDate > createdAt > eatDate
const dateVal = d => (d ? dayjs(d).valueOf() : 0)
const sortKey = r => Math.max(dateVal(r.orderDate), dateVal(r.createdAt), dateVal(r.eatDate))

function passFilters(doc) {
  if (!doc) return false
  if (employeeId.value && String(doc?.employee?.employeeId) !== String(employeeId.value)) return false
  if (status.value !== 'ALL' && doc.status !== status.value) return false
  if (q.value.trim()) {
    const rx = new RegExp(q.value.trim(), 'i')
    const hay = [
      doc.requestId,
      doc.orderType,
      (doc.menuChoices || []).join(', '),
      doc?.location?.kind,
      doc?.employee?.name,
      doc.specialInstructions,
      (doc.dietary || []).join(', ')
    ].filter(Boolean).join(' ')
    if (!rx.test(hay)) return false
  }
  return true
}
function upsertRow(doc) {
  const d = normalize(doc)
  const i = rows.value.findIndex(r => r._id === d._id)
  if (passFilters(d)) {
    if (i === -1) rows.value.unshift(d)
    else rows.value[i] = d
    // keep list sorted newest-first after insert/update
    rows.value = rows.value.slice().sort((a, b) => sortKey(b) - sortKey(a))
  } else if (i !== -1) {
    rows.value.splice(i, 1)
    expanded.value.delete(String(d._id))
  }
}
function removeRowById(id) {
  const i = rows.value.findIndex(r => r._id === id)
  if (i !== -1) rows.value.splice(i, 1)
  expanded.value.delete(String(id))
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (employeeId.value) params.set('employeeId', employeeId.value)
    if (status.value !== 'ALL') params.set('status', status.value)
    if (q.value.trim()) params.set('q', q.value.trim())
    if (dateStart.value) params.set('from', dateStart.value)
    if (dateEnd.value) params.set('to', dateEnd.value)
    const { data } = await api.get(`/public/food-requests?${params.toString()}`)
    const list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    rows.value = list.map(normalize).sort((a, b) => sortKey(b) - sortKey(a)) // ⬅️ newest first
    page.value = 1
  } finally { loading.value = false }
}

/* ───────── computed ───────── */
const filteredRows = computed(() => {
  // copy → filter → sort newest-first
  let list = rows.value.slice()
  if (dateStart.value) {
    list = list.filter(r =>
      r.eatDate && dayjs(r.eatDate).isSameOrAfter(dayjs(dateStart.value), 'day')
    )
  }
  if (dateEnd.value) {
    list = list.filter(r =>
      r.eatDate && dayjs(r.eatDate).isSameOrBefore(dayjs(dateEnd.value), 'day')
    )
  }
  // (text/status/employee filters are already handled upstream via passFilters in upsertRow/load)
  return list.sort((a, b) => sortKey(b) - sortKey(a))
})
const pagedRows = computed(() => {
  if (itemsPerPage.value === 'All') return filteredRows.value
  const start = (page.value - 1) * itemsPerPage.value
  return filteredRows.value.slice(start, start + itemsPerPage.value)
})
const pageCount = computed(() => {
  if (itemsPerPage.value === 'All') return 1
  return Math.ceil(filteredRows.value.length / itemsPerPage.value) || 1
})

/* ───────── Excel ───────── */
function exportExcel() {
  const exportData = filteredRows.value.map(r => ({
    'Status': r.status,
    'Request ID': r.requestId,
    'Order Date': fmtDate(r.orderDate),
    'Eat Date': fmtDate(r.eatDate),
    'Time Start': r.eatTimeStart || '—',
    'Time End': r.eatTimeEnd || '—',
    'Employee ID': r?.employee?.employeeId,
    'Employee Name': r?.employee?.name,
    'Department': r?.employee?.department,
    'Order Type': r.orderType,
    'Meals': (r.meals || []).join(', '),
    'Quantity': r.quantity,
    'Location': r?.location?.kind + (r?.location?.other ? ' — ' + r.location.other : ''),
    'Menu Choices': (r.menuChoices || []).join(', '),
    'Menu Counts': JSON.stringify(r.menuCounts || []),
    'Dietary': (r.dietary || []).join(', '),
    'Dietary Counts': JSON.stringify(r.dietaryCounts || []),
    'Dietary Other': r.dietaryOther || '',
    'Special Instructions': r.specialInstructions || '',
    'Recurring': r.recurring?.enabled ? r.recurring.frequency : '—',
    'Recurring End Date': fmtDate(r.recurring?.endDate),
    'Skip Holidays': r.recurring?.skipHolidays ? 'Yes' : 'No'
  }))
  const ws = XLSX.utils.json_to_sheet(exportData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'MyRequests')
  XLSX.writeFile(wb, `MyRequests_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`)
}

/* ───────── sockets ───────── */
function registerSocket() {
  socket.on('foodRequest:created', (doc) => {
    if (String(doc?.employee?.employeeId) !== String(employeeId.value)) return
    upsertRow(doc)
    Swal.fire({ toast:true, icon:'success', title:'New request submitted', position:'top', timer:1200, showConfirmButton:false })
  })
  socket.on('foodRequest:updated', (doc) => {
    if (String(doc?.employee?.employeeId) !== String(employeeId.value)) return
    upsertRow(doc)
  })
  socket.on('foodRequest:statusChanged', (doc) => {
    if (String(doc?.employee?.employeeId) !== String(employeeId.value)) return
    upsertRow(doc)
    Swal.fire({ toast:true, icon:'info', title:`Status: ${doc.status}`, position:'top', timer:1200, showConfirmButton:false })
  })
  socket.on('foodRequest:deleted', ({ _id }) => {
    removeRowById(String(_id || ''))
    Swal.fire({ toast:true, icon:'warning', title:'Request deleted', position:'top', timer:1200, showConfirmButton:false })
  })
}
function unregisterSocket() {
  socket.off('foodRequest:created')
  socket.off('foodRequest:updated')
  socket.off('foodRequest:statusChanged')
  socket.off('foodRequest:deleted')
}

onMounted(async () => {
  subscribeEmployeeIfNeeded()
  await load()
  registerSocket()
})
onBeforeUnmount(() => { unregisterSocket() })
watch([q, status, dateStart, dateEnd], () => load())

/* ───────── MENU/DIETARY helpers ───────── */
function menuMap(r) {
  const m = new Map()
  for (const it of (r.menuCounts || [])) {
    if (!it?.choice) continue
    const n = Number(it.count || 0)
    if (!n) continue
    m.set(it.choice, (m.get(it.choice) || 0) + n)
  }
  if (!m.has('Standard')) {
    const nonStd = Array.from(m.entries())
      .filter(([k]) => k !== 'Standard')
      .reduce((s, [, v]) => s + v, 0)
    const std = Math.max(Number(r.quantity || 0) - nonStd, 0)
    if (std > 0) m.set('Standard', std)
  }
  for (const [k, v] of m.entries()) if (!v) m.delete(k)
  return m
}
function dietaryByMenu(r) {
  const g = new Map()
  for (const d of (r.dietaryCounts || [])) {
    const menu = d?.menu || 'Standard'
    const allergen = d?.allergen
    const cnt = Number(d?.count || 0)
    if (!allergen || !cnt) continue
    if (!g.has(menu)) g.set(menu, new Map())
    const inner = g.get(menu)
    inner.set(allergen, (inner.get(allergen) || 0) + cnt)
  }
  return g
}
function totals(r) {
  const m = menuMap(r)
  const totalMenus = Array.from(m.values()).reduce((a, b) => a + b, 0)
  const leftoverMenus = Number(r.quantity || 0) - totalMenus
  const g = dietaryByMenu(r)
  const perMenuDietaryLeft = new Map()
  for (const [menu, cnt] of m.entries()) {
    const sumDiet = Array.from((g.get(menu) || new Map()).values()).reduce((a, b) => a + b, 0)
    perMenuDietaryLeft.set(menu, cnt - sumDiet)
  }
  return { totalMenus, leftoverMenus, perMenuDietaryLeft }
}
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card class="rounded-lg" elevation="1">
      <!-- Desktop / Tablet toolbar -->
      <v-toolbar v-if="mdAndUp" flat density="comfortable" class="py-2">
        <v-toolbar-title class="text-subtitle-1 font-weight-bold">
          My Requests <v-chip size="x-small" class="ml-2" color="teal" label>Live</v-chip>
        </v-toolbar-title>
        <v-spacer />
        <v-text-field
          v-model="q" density="compact" placeholder="Search (type, menu, note, requester)"
          clearable hide-details variant="outlined" class="mr-2" style="max-width:260px"
          @keyup.enter="load"
        />
        <v-select
          v-model="status" :items="statuses" density="compact" label="Status"
          hide-details variant="outlined" class="mr-2" style="max-width:160px"
        />
        <v-text-field
          v-model="dateStart" type="date" density="compact" label="From"
          hide-details variant="outlined" class="mr-2" style="max-width:160px"
        />
        <v-text-field
          v-model="dateEnd" type="date" density="compact" label="To"
          hide-details variant="outlined" class="mr-2" style="max-width:160px"
        />
        <v-btn :loading="loading" color="primary" @click="load" class="mr-2" prepend-icon="mdi-refresh">Refresh</v-btn>
        <v-btn color="success" @click="exportExcel" prepend-icon="mdi-file-excel">Export</v-btn>
      </v-toolbar>

      <!-- Mobile toolbar -->
      <v-toolbar v-else flat density="comfortable" class="py-2">
        <v-toolbar-title class="text-subtitle-2 font-weight-bold">My Requests</v-toolbar-title>
        <v-spacer />
        <v-btn icon variant="text" @click="exportExcel" :title="'Export'">
          <v-icon>mdi-file-excel</v-icon>
        </v-btn>
      </v-toolbar>

      <v-divider />

      <!-- Mobile search + Refresh + Filters -->
      <v-sheet v-if="!mdAndUp" class="px-3 pt-3 pb-1 bg-transparent">
        <div class="d-flex align-center gap-2">
          <v-text-field
            v-model="q" density="compact" placeholder="Search"
            clearable hide-details variant="outlined" class="flex-grow-1"
            @keyup.enter="load"
          />
          <v-btn color="grey" variant="tonal" @click="load">Refresh</v-btn>
          <v-btn color="primary" variant="flat" @click="showFilterDialog = true">Filters</v-btn>
        </div>
      </v-sheet>

      <!-- Filters dialog for mobile -->
      <v-dialog v-model="showFilterDialog" fullscreen transition="dialog-bottom-transition">
        <v-card>
          <v-toolbar density="comfortable" color="primary" class="text-white">
            <v-btn icon variant="text" class="text-white" @click="showFilterDialog=false"><v-icon>mdi-close</v-icon></v-btn>
            <v-toolbar-title>Filters</v-toolbar-title>
            <v-spacer />
            <v-btn variant="text" class="text-white" @click="resetFilters">
              <v-icon start>mdi-restore</v-icon> Reset
            </v-btn>
          </v-toolbar>

          <v-card-text>
            <v-row dense>
              <v-col cols="12">
                <v-select v-model="status" :items="statuses" label="Status" variant="outlined" density="comfortable" hide-details />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field v-model="dateStart" type="date" label="From" variant="outlined" density="comfortable" hide-details />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field v-model="dateEnd" type="date" label="To" variant="outlined" density="comfortable" hide-details />
              </v-col>
              <v-col cols="12" sm="6">
                <v-select v-model="itemsPerPage" :items="itemsPerPageOptions" label="Rows per page" variant="outlined" density="comfortable" hide-details />
              </v-col>
            </v-row>
          </v-card-text>

          <v-card-actions class="px-4 pb-4">
            <v-btn color="grey" variant="tonal" @click="showFilterDialog=false">Close</v-btn>
            <v-spacer />
            <v-btn color="primary" @click="showFilterDialog=false; load()">Apply</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <v-card-text class="pa-0">
        <div class="table-wrap">
          <v-table density="comfortable" class="min-width-table">
            <thead>
              <tr>
                <th>Status</th>
                <th style="width: 120px;">Details</th>
                <th>Requester (ID &amp; Name)</th>
                <th>Order Date</th>
                <th>Eat Date</th>
                <th>Time</th>
                <th>Order Type</th>
                <th>Meal(s)</th>
                <th>Qty</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="r in pagedRows" :key="r._id">
                <tr>
                  <td>
                    <v-chip :color="{ NEW:'grey', ACCEPTED:'primary', COOKING:'orange', READY:'teal', DELIVERED:'green', CANCELED:'red' }[r.status]" size="small" label>
                      {{ r.status }}
                    </v-chip>
                  </td>
                  <td>
                    <v-btn size="small" variant="text" color="secondary" @click="toggleExpanded(r._id)">
                      {{ isExpanded(r._id) ? 'Hide details' : 'Details' }}
                    </v-btn>
                  </td>
                  <td>{{ r?.employee?.employeeId || '—' }}<span v-if="r?.employee?.name"> — {{ r.employee.name }}</span></td>
                  <td>{{ fmtDate(r.orderDate) }}</td>
                  <td>{{ fmtDate(r.eatDate) }}</td>
                  <td>{{ r.eatTimeStart || '—' }}<span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span></td>
                  <td>{{ r.orderType }}</td>
                  <td>{{ (r.meals || []).join(', ') }}</td>
                  <td>{{ r.quantity }}</td>
                  <td>{{ r?.location?.kind }}<span v-if="r?.location?.other"> — {{ r.location.other }}</span></td>
                </tr>

                <tr v-if="isExpanded(r._id)" class="details-row">
                  <td colspan="10">
                    <v-expand-transition>
                      <div class="px-3 py-2">
                        <div class="tree">
                          <div class="tree-node root">
                            <div class="node-label"><strong>Quantity</strong> {{ r.quantity }}</div>
                            <div class="children">
                              <template v-for="[menuName, menuCnt] in menuMap(r)" :key="menuName">
                                <div class="tree-node">
                                  <div class="node-label"><span class="arrow">→</span><strong>{{ menuName }}</strong> ×{{ menuCnt }}</div>
                                  <div class="children" v-if="Array.from((dietaryByMenu(r).get(menuName) || new Map()).entries()).length">
                                    <div class="tree-node leaf" v-for="[allergen, aCnt] in Array.from((dietaryByMenu(r).get(menuName) || new Map()).entries())" :key="menuName + '_' + allergen">
                                      <div class="node-label"><span class="arrow small">↳</span>{{ allergen }} ×{{ aCnt }}</div>
                                    </div>
                                  </div>
                                </div>
                              </template>
                            </div>
                          </div>

                          <div class="mt-2 text-caption">
                            <template v-if="totals(r).leftoverMenus === 0">
                              <span class="ok">✔ Menu totals match quantity</span>
                            </template>
                            <template v-else>
                              <span class="warn">⚠ Menu totals {{ totals(r).totalMenus }} differ from quantity {{ r.quantity }} (Δ {{ totals(r).leftoverMenus }})</span>
                            </template>
                          </div>
                          <div class="mt-1 text-caption">
                            <span v-for="[menuName, left] in totals(r).perMenuDietaryLeft.entries()" :key="'chk_'+menuName" class="mr-3" :class="left >= 0 ? 'ok' : 'warn'">
                              {{ menuName }}: dietary Δ {{ left }}
                            </span>
                          </div>

                          <div class="mt-2 text-caption text-medium-emphasis" v-if="r.menuChoices?.length">
                            Selected menus: {{ r.menuChoices.join(', ') }}
                          </div>
                          <div class="mt-1 text-caption" v-if="r.dietary?.length">
                            Dietary selected: {{ r.dietary.join(', ') }}
                          </div>
                          <div class="mt-1 text-caption" v-if="r.dietaryOther">
                            Other dietary note: {{ r.dietaryOther }}
                          </div>
                          <div class="mt-1 text-caption" v-if="r.recurring?.enabled">
                            Recurring: {{ r.recurring.frequency }}<span v-if="r.recurring.endDate"> until {{ fmtDate(r.recurring.endDate) }}</span><span v-if="r.recurring.skipHolidays"> (skip holidays)</span>
                          </div>
                        </div>
                      </div>
                    </v-expand-transition>
                  </td>
                </tr>
              </template>

              <tr v-if="!rows.length && !loading">
                <td colspan="10" class="text-center py-6 text-medium-emphasis">No requests found.</td>
              </tr>
            </tbody>
          </v-table>
        </div>

        <!-- pagination -->
        <div class="d-flex flex-wrap gap-2 justify-space-between align-center pa-3">
          <v-select v-model="itemsPerPage" :items="itemsPerPageOptions" density="compact" label="Rows per page" hide-details variant="outlined" style="max-width:140px" />
          <v-pagination v-model="page" :length="pageCount" :total-visible="7" />
        </div>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.table-wrap{ overflow-x:auto; display:block; }

/* Inputs a bit tighter */
:deep(.v-field__input){ min-height: 36px; }

.min-width-table th,.min-width-table td{ min-width:120px; white-space:nowrap; }

/* details */
.details-row{ background: rgba(0,0,0,0.02); }
.tree{ font-size:.96rem; line-height:1.4; }
.tree .node-label{ display:inline-flex; align-items:center; gap:.4rem; padding:.2rem .5rem; border-radius:.5rem; }
.tree .root>.node-label{ background: rgba(16,185,129,.12); }
.tree .tree-node .node-label{ background: rgba(59,130,246,.10); }
.tree .leaf .node-label{ background: rgba(234,179,8,.12); }
.arrow{ font-weight:700; } .arrow.small{ opacity:.9; }
.children{ margin-left:1.2rem; padding-left:.6rem; border-left:2px dashed rgba(0,0,0,.15); margin-top:.35rem; }
.ok{ color:#16a34a; } .warn{ color:#dc2626; }

/* phone tweaks */
@media (max-width: 600px){
  .min-width-table th,.min-width-table td{ min-width: 90px; }
  .table-wrap{ -webkit-overflow-scrolling: touch; }
  .v-toolbar{ padding-left: .5rem; padding-right: .5rem; }
}
</style>
