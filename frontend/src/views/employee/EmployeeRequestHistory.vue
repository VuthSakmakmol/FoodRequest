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

/* ───────── Mini i18n (EN→KM display) ───────── */
const KM = {
  'My Requests': '',
  'Search (type, menu, note, requester)': '',
  Status: 'ស្ថានភាព',
  From: 'ចាប់ពី',
  To: 'ដល់',
  Refresh: '',
  Export: '',
  Filters: '',
  Reset: 'កំណត់ឡើងវិញ',
  Close: 'បិទ',
  Apply: 'អនុវត្ត',
  'Rows per page': '',

  Details: 'ព័ត៌មានលម្អិត',
  'Requester (ID & Name)': 'អ្នកស្នើ (លេខ & ឈ្មោះ)',
  'Order Date': 'កាលបរិច្ឆេទស្នើ',
  'Eat Date': 'កាលបរិច្ឆេទទទួលអាហារ',
  Time: 'ពេលវេលា',
  'Order Type': 'ប្រភេទការបញ្ជាទិញ',
  'Meal(s)': 'អាហារ',
  Qty: 'ចំនួន',
  Location: 'ទីតាំង',

  NEW: 'ថ្មី',
  ACCEPTED: 'បានទទួលយក',
  COOKING: 'កំពុងចម្អិន',
  READY: 'រួចរាល់',
  DELIVERED: 'បានផ្តល់',
  CANCELED: 'បានបោះបង់',

  'New request submitted': 'បានដាក់ស្នើសំណើថ្មី',
  'Request deleted': 'បានលុបសំណើ',
}
const tkm = (en) => KM[en] || en

/* Khmer labels for menu/allergen in details tree */
const MENU_KM_MAP = {
  Standard: 'ញាំទូទៅ',
  Vegetarian: 'មិនញាំសាច់',
  Vegan: 'ញាំបួស',
  'No pork': 'តមសាច់ជ្រូក',
  'No beef': 'តមសាច់គោ',
}
const ALLERGEN_KM_MAP = {
  Peanut: 'សណ្តែកដី',
  Shellfish: 'សត្វសំបកសមុទ្រ',
  Egg: 'ស៊ុត',
  Gluten: 'គ្លុយតែន',
  'Dairy/Lactose': 'ទឹកដោះគោ/ឡាក់តូស',
  Soy: 'សណ្តែកសៀង',
  Others: 'ផ្សេងទៀត',
}
const menuKM = (en) => MENU_KM_MAP[en] || en
const allergenKM = (en) => ALLERGEN_KM_MAP[en] || en

/* NEW: OrderType & Meals bilingual maps for table cells */
const ORDER_TYPE_KM_MAP = {
  'Daily meal': 'អាហារប្រចាំថ្ងៃ',
  'Meeting catering': 'អាហារប្រជុំ',
  'Visitor meal': 'អាហារភ្ញៀវ',
}
const MEAL_KM_MAP_ROW = {
  Breakfast: 'អាហារពេលព្រឹក',
  Lunch: 'អាហារថ្ងៃត្រង់',
  Dinner: 'អាហារពេលល្ងាច',
  Snack: 'អាហារសម្រន់',
}
const orderTypeKM = (en) => ORDER_TYPE_KM_MAP[en] || en
const mealListKM = (arr = []) => arr.map(m => MEAL_KM_MAP_ROW[m] || m).join(', ')

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
    rows.value = list.map(normalize).sort((a, b) => sortKey(b) - sortKey(a))
    page.value = 1
  } finally { loading.value = false }
}

/* ───────── computed ───────── */
const filteredRows = computed(() => {
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
    'Status / ស្ថានភាព': r.status,
    'Request ID': r.requestId,
    'Order Date / កាលបរិច្ឆេទស្នើ': fmtDate(r.orderDate),
    'Eat Date / កាលបរិច្ឆេទទទួលអាហារ': fmtDate(r.eatDate),
    'Time Start / ពេលចាប់ផ្តើម': r.eatTimeStart || '—',
    'Time End / ពេលបញ្ចប់': r.eatTimeEnd || '—',
    'Employee ID': r?.employee?.employeeId,
    'Employee Name': r?.employee?.name,
    'Department': r?.employee?.department,
    'Order Type / ប្រភេទ': r.orderType,
    'Meals / អាហារ': (r.meals || []).join(', '),
    'Quantity / ចំនួន': r.quantity,
    'Location / ទីតាំង': r?.location?.kind + (r?.location?.other ? ' — ' + r.location.other : ''),
    'Menu Choices': (r.menuChoices || []).join(', '),
    'Menu Counts': JSON.stringify(r.menuCounts || []),
    'Dietary': (r.dietary || []).join(', '),
    'Dietary Counts': JSON.stringify(r.dietaryCounts || []),
    'Dietary Other': r.dietaryOther || '',
    // 🔁 updated recurring fields (no frequency)
    'Recurring Enabled': r.recurring?.enabled ? 'Yes' : 'No',
    'Recurring End Date': fmtDate(r.recurring?.endDate),
    'Skip Holidays': r.recurring?.skipHolidays ? 'Yes' : 'No',
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
    Swal.fire({ toast:true, icon:'success', title:tkm('New request submitted'), position:'top', timer:1200, showConfirmButton:false })
  })
  socket.on('foodRequest:updated', (doc) => {
    if (String(doc?.employee?.employeeId) !== String(employeeId.value)) return
    upsertRow(doc)
  })
  socket.on('foodRequest:statusChanged', (doc) => {
    if (String(doc?.employee?.employeeId) !== String(employeeId.value)) return
    upsertRow(doc)
    Swal.fire({ toast:true, icon:'info', title:`${tkm('Status')} : ${tkm(doc.status)}`, position:'top', timer:1200, showConfirmButton:false })
  })
  socket.on('foodRequest:deleted', ({ _id }) => {
    removeRowById(String(_id || ''))
    Swal.fire({ toast:true, icon:'warning', title:tkm('Request deleted'), position:'top', timer:1200, showConfirmButton:false })
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
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card class="rounded-lg" elevation="1">
      <!-- Desktop / Tablet toolbar -->
      <v-toolbar v-if="mdAndUp" flat density="comfortable" class="py-2">
        <v-toolbar-title class="text-subtitle-1 font-weight-bold">
          {{ 'My Requests' }}
        </v-toolbar-title>
        <v-spacer />
        <v-text-field
          v-model="q" density="compact"
          :placeholder="tkm('Search (type, menu, note, requester)')"
          clearable hide-details variant="outlined" class="mr-2" style="max-width:260px"
          @keyup.enter="load"
        />
        <!-- Desktop select -->
        <v-select
          v-model="status"
          :items="statuses"
          density="compact"
          :label="tkm('Status')"
          hide-details
          variant="outlined"
          class="mr-2"
          style="max-width:160px"
        >
          <template #selection="{ item }">
            <span>{{ item.title || item.value || item }}</span>
            <span class="km ml-1">({{ tkm(item.title || item.value || item) }})</span>
          </template>

          <!-- prevent duplicate by clearing default title/subtitle -->
          <template #item="{ props: sp, item }">
            <v-list-item v-bind="sp" :title="undefined" :subtitle="undefined">
              <v-list-item-title>{{ item.title || item.value || item }}</v-list-item-title>
              <v-list-item-subtitle class="km">
                {{ tkm(item.title || item.value || item) }}
              </v-list-item-subtitle>
            </v-list-item>
          </template>
        </v-select>
        <v-text-field
          v-model="dateStart" type="date" density="compact" :label="tkm('From')"
          hide-details variant="outlined" class="mr-2" style="max-width:160px"
        />
        <v-text-field
          v-model="dateEnd" type="date" density="compact" :label="tkm('To')"
          hide-details variant="outlined" class="mr-2" style="max-width:160px"
        />

        <v-tooltip text="Refresh" location="bottom">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              :loading="loading"
              icon
              color="primary"
              class="mr-2"
              @click="load"
              aria-label="Refresh"
              title="Refresh"
            >
              <i class="fa-solid fa-rotate-right"></i>
            </v-btn>
          </template>
        </v-tooltip>

        <v-tooltip text="Export Excel" location="bottom">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon
              color="success"
              variant="flat"
              @click="exportExcel"
              aria-label="Export Excel"
              title="Export Excel"
            >
              <i class="fa-regular fa-file-excel"></i>
            </v-btn>
          </template>
        </v-tooltip>

        <v-tooltip text="Filters" location="bottom">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon
              variant="flat"
              color="secondary"
              class="ml-1"
              @click="showFilterDialog = true"
              aria-label="Filters"
              title="Filters"
            >
              <i class="fa-solid fa-filter"></i>
            </v-btn>
          </template>
        </v-tooltip>
      </v-toolbar>

      <v-divider />

      <!-- Mobile search + Refresh + Filters -->
      <v-sheet v-if="!mdAndUp" class="px-3 pt-3 pb-1 bg-transparent">
        <div class="d-flex align-center gap-2">
          <v-text-field
            v-model="q" density="compact" :placeholder="tkm('Search (type, menu, note, requester)')"
            clearable hide-details variant="outlined" class="flex-grow-1"
            @keyup.enter="load"
          />
          <v-tooltip text="Refresh" location="bottom">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                :loading="loading"
                icon
                variant="tonal"
                @click="load"
                aria-label="Refresh"
                title="Refresh"
                size="small"
                style="margin: 4px;"
              >
                <i class="fa-solid fa-rotate-right"></i>
              </v-btn>
            </template>
          </v-tooltip>
          <v-btn @click="showFilterDialog = true">{{ tkm('Filters') }}</v-btn>
        </div>
      </v-sheet>

      <!-- Filters dialog for mobile -->
      <v-dialog v-model="showFilterDialog" fullscreen transition="dialog-bottom-transition">
        <v-card>
          <v-toolbar density="comfortable" color="primary" class="text-white">
            <v-btn icon variant="text" class="text-white" @click="showFilterDialog=false"><v-icon>mdi-close</v-icon></v-btn>
            <v-toolbar-title>{{ tkm('Filters') }}</v-toolbar-title>
            <v-spacer />
            <v-btn variant="text" class="text-white" @click="resetFilters">
              <v-icon start>mdi-restore</v-icon> {{ tkm('Reset') }}
            </v-btn>
          </v-toolbar>

          <v-card-text>
            <v-row dense>
              <v-col cols="12">
                <v-select v-model="status" :items="statuses" :label="tkm('Status')" variant="outlined" density="comfortable" hide-details>
                  <template #selection="{ item }">
                    <span>{{ item.title || item.value || item }}</span>
                    <span class="km ml-1">({{ tkm(item.title || item.value || item) }})</span>
                  </template>
                  <template #item="{ props: sp, item }">
                    <v-list-item v-bind="sp" :title="undefined" :subtitle="undefined">
                      <v-list-item-title>{{ item.title || item.value || item }}</v-list-item-title>
                      <v-list-item-subtitle class="km">
                        {{ tkm(item.title || item.value || item) }}
                      </v-list-item-subtitle>
                    </v-list-item>
                  </template>
                </v-select>
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field v-model="dateStart" type="date" :label="tkm('From')" variant="outlined" density="comfortable" hide-details />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field v-model="dateEnd" type="date" :label="tkm('To')" variant="outlined" density="comfortable" hide-details />
              </v-col>
              <v-col cols="12" sm="6">
                <v-select v-model="itemsPerPage" :items="itemsPerPageOptions" :label="tkm('Rows per page')" variant="outlined" density="comfortable" hide-details />
              </v-col>
            </v-row>
          </v-card-text>

          <v-card-actions class="px-4 pb-4">
            <v-btn color="grey" variant="tonal" @click="showFilterDialog=false">{{ tkm('Close') }}</v-btn>
            <v-spacer />
            <v-btn color="primary" @click="showFilterDialog=false; load()">{{ tkm('Apply') }}</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <v-card-text class="pa-0">
        <div class="table-wrap">
          <!-- MATCH ADMIN: align-left + comfy-cells + row-hover -->
          <v-table density="comfortable" class="min-width-table align-left comfy-cells row-hover">
            <thead>
              <tr>
                <th><div class="hdr-2l"><div class="en">Status</div><div class="km">{{ tkm('Status') }}</div></div></th>
                <th style="width: 120px;"><div class="hdr-2l"><div class="en">Details</div><div class="km">{{ tkm('Details') }}</div></div></th>
                <th><div class="hdr-2l"><div class="en">Requester (ID & Name)</div><div class="km">{{ tkm('Requester (ID & Name)') }}</div></div></th>
                <th><div class="hdr-2l"><div class="en">Order Date</div><div class="km">{{ tkm('Order Date') }}</div></div></th>
                <th><div class="hdr-2l"><div class="en">Eat Date</div><div class="km">{{ tkm('Eat Date') }}</div></div></th>
                <th><div class="hdr-2l"><div class="en">Time</div><div class="km">{{ tkm('Time') }}</div></div></th>
                <th><div class="hdr-2l"><div class="en">Order Type</div><div class="km">{{ tkm('Order Type') }}</div></div></th>
                <th><div class="hdr-2l"><div class="en">Meal(s)</div><div class="km">{{ tkm('Meal(s)') }}</div></div></th>
                <th><div class="hdr-2l"><div class="en">Qty</div><div class="km">{{ tkm('Qty') }}</div></div></th>
                <th><div class="hdr-2l"><div class="en">Location</div><div class="km">{{ tkm('Location') }}</div></div></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="r in pagedRows" :key="r._id">
                <tr>
                  <td>
                    <v-chip :color="{ NEW:'grey', ACCEPTED:'primary', COOKING:'orange', READY:'teal', DELIVERED:'green', CANCELED:'red' }[r.status]" size="small" label>
                      <div class="chip-2l">
                        <div class="en">{{ r.status }}</div>
                        <div class="km">{{ tkm(r.status) }}</div>
                      </div>
                    </v-chip>
                  </td>
                  <td>
                    <v-btn size="small" variant="text" color="secondary" @click="toggleExpanded(r._id)">
                      {{ isExpanded(r._id) ? 'Hide details' : 'Details' }}
                      <span class="km ml-1">({{ isExpanded(r._id) ? 'លាក់' : tkm('Details') }})</span>
                    </v-btn>
                  </td>
                  <td>{{ r?.employee?.employeeId || '—' }}<span v-if="r?.employee?.name"> — {{ r.employee.name }}</span></td>
                  <td>{{ fmtDate(r.orderDate) }}</td>
                  <td>{{ fmtDate(r.eatDate) }}</td>
                  <td>{{ r.eatTimeStart || '—' }}<span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span></td>

                  <td>
                    <div class="cell-2l">
                      <div class="en">{{ r.orderType }}</div>
                      <div class="km">{{ orderTypeKM(r.orderType) }}</div>
                    </div>
                  </td>

                  <td>
                    <div class="cell-2l">
                      <div class="en">{{ (r.meals || []).join(', ') }}</div>
                      <div class="km">{{ mealListKM(r.meals) }}</div>
                    </div>
                  </td>

                  <td>{{ r.quantity }}</td>
                  <td>{{ r?.location?.kind }}<span v-if="r?.location?.other"> — {{ r.location.other }}</span></td>
                </tr>

                <!-- Details row -->
                <tr v-if="isExpanded(r._id)" class="details-row">
                  <td colspan="10">
                    <v-expand-transition>
                      <div class="px-3 py-2">
                        <div class="tree">
                          <div class="tree-node root">
                            <div class="node-label two-lines">
                              <div class="en"><strong>{{ tkm('Qty') }}</strong> {{ r.quantity }}</div>
                              <div class="km">{{ tkm('Qty') }}</div>
                            </div>
                            <div class="children">
                              <template v-for="[menuName, menuCnt] in menuMap(r)" :key="menuName">
                                <div class="tree-node">
                                  <div class="node-label two-lines">
                                    <div class="en"><span class="arrow">→</span><strong>{{ menuName }}</strong> ×{{ menuCnt }}</div>
                                    <div class="km">{{ menuKM(menuName) }}</div>
                                  </div>
                                  <div class="children" v-if="Array.from((dietaryByMenu(r).get(menuName) || new Map()).entries()).length">
                                    <div
                                      class="tree-node leaf"
                                      v-for="[allergen, aCnt] in Array.from((dietaryByMenu(r).get(menuName) || new Map()).entries())"
                                      :key="menuName + '_' + allergen"
                                    >
                                      <div class="node-label two-lines">
                                        <div class="en"><span class="arrow small">↳</span>{{ allergen }} ×{{ aCnt }}</div>
                                        <div class="km">{{ allergenKM(allergen) }}</div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </template>
                            </div>
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
          <v-select
            v-model="itemsPerPage"
            :items="itemsPerPageOptions"
            density="compact"
            :label="tkm('Rows per page')"
            hide-details variant="outlined" style="max-width:140px"
          />
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

/* bilingual headers */
.hdr-2l .en{ font-weight:600; }
.hdr-2l .km{ font-size:.82rem; opacity:.85; }

/* two-line table cells */
.cell-2l{ display:flex; flex-direction:column; line-height:1.1; }
.cell-2l .km{ font-size:.86rem; opacity:.9; }

/* status chip two-line */
.chip-2l{ display:flex; flex-direction:column; line-height:1; }
.chip-2l .km{ font-size:.78em; opacity:.9; }

/* details */
.details-row{ background: rgba(0,0,0,0.02); }
.tree{ font-size:.96rem; line-height:1.4; }
.tree .node-label{ display:inline-flex; align-items:center; gap:.4rem; padding:.2rem .5rem; border-radius:.5rem; }
.tree .root>.node-label{ background: rgba(16,185,129,.12); }
.tree .tree-node .node-label{ background: rgba(59,130,246,.10); }
.tree .leaf .node-label{ background: rgba(234,179,8,.12); }
.arrow{ font-weight:700; } .arrow.small{ opacity:.9; }
.children{ margin-left:1.2rem; padding-left:.6rem; border-left:2px dashed rgba(0,0,0,.15); margin-top:.35rem; }

/* Khmer font helper */
.km{
  font-family: 'Kantumruy Pro', system-ui, -apple-system, Segoe UI, Roboto,
               'Helvetica Neue', Arial, 'Noto Sans Khmer', sans-serif;
}

/* ---------- MATCH ADMIN: Left alignment + comfy spacing + hover ---------- */

/* Force left alignment for headers/cells */
.align-left :deep(table thead th),
.align-left :deep(table tbody td){
  text-align: left !important;
}

/* Top/bottom breathing room for each td */
.comfy-cells :deep(table tbody td){
  vertical-align: top;
  padding-top: 10px !important;
  padding-bottom: 10px !important;
}

/* Also pad headers for balance */
.comfy-cells :deep(table thead th){
  padding-top: 10px !important;
  padding-bottom: 10px !important;
}

/* Hover color for normal rows (exclude expanded details row) */
.row-hover :deep(table tbody tr:not(.details-row):hover){
  background: rgba(59,130,246,0.08);
  transition: background 120ms ease;
}

/* Keep inner components from centering inside cells */
.min-width-table :deep(td > *){
  justify-content: flex-start !important;
  text-align: left !important;
}

/* phone tweaks */
@media (max-width: 600px){
  .min-width-table th,.min-width-table td{ min-width: 90px; }
  .table-wrap{ -webkit-overflow-scrolling: touch; }
  .v-toolbar{ padding-left: .5rem; padding-right: .5rem; }
}
</style>
