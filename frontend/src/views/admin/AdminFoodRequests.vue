<!-- src/views/admin/AdminFoodRequests.vue -->
<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import dayjs from 'dayjs'
import Swal from 'sweetalert2'
import api from '@/utils/api'
import { useAuth } from '@/store/auth'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'
import { useDisplay } from 'vuetify'
import * as XLSX from 'xlsx'

const { mdAndUp } = useDisplay()
const auth = useAuth()

/* ───────── Mini i18n (EN→KM for table/details only) ───────── */
const KM = {
  Status: 'ស្ថានភាព',
  'Requester (ID & Name)': 'អ្នកស្នើ (លេខ & ឈ្មោះ)',
  'Order Date': 'កាលបរិច្ឆេទស្នើ',
  'Eat Date': 'កាលបរិច្ឆេទទទួលអាហារ',
  Time: 'ពេលវេលា',
  Dept: 'នាយកដ្ឋាន',
  Type: 'ប្រភេទ',
  Qty: 'ចំនួន',
  Actions: 'សកម្មភាព',
  Details: 'ព័ត៌មានលម្អិត',
  'Hide details': 'លាក់ព័ត៌មាន',
  'No requests found.': 'រកមិនឃើញទិន្នន័យទេ។',
  Quantity: 'បរិមាណ',
  'Selected menus': 'ម៉ឺនុយដែលបានជ្រើសរើស',
  'Other dietary note': 'សម្គាល់អាហារូបត្ថម្ភផ្សេងទៀត',
  'Special instruction': 'សេចក្តីណែនាំពិសេស',
  Recurring: 'កំណត់ម្ដងហើយកើតឡើងថេរ',
  'Menu totals match quantity': 'ចំនួនម៉ឺនុយត្រូវនឹងបរិមាណ',
  'Menu totals differ from quantity': 'ចំនួនម៉ឺនុយមិនត្រូវនឹងបរិមាណ',

  // statuses
  ACTIVE: 'សកម្ម',
  ALL: 'ទាំងអស់',
  NEW: 'ថ្មី',
  ACCEPTED: 'បានទទួលយក',
  COOKING: 'កំពុងចម្អិន',
  READY: 'រួចរាល់',
  DELIVERED: 'បានផ្តល់',
  CANCELED: 'បានបោះបង់',
}
const tkm = (en) => KM[en] || en

/* Khmer labels for menu/allergen (details tree) */
const MENU_KM_MAP = {
  Standard: 'ញាំទូទៅ',
  Vegetarian: 'មិនញាំសាច់',
  Vegan: 'ញាំបួស',
  'No pork': 'មិនញាំសាច់ជ្រូក',
  'No beef': 'មិនញាំសាច់គោ',
}

/* Khmer labels for meals (table cell) */
const MEAL_KM_MAP_ROW = {
  Breakfast: 'អាហារពេលព្រឹក',
  Lunch: 'អាហារថ្ងៃត្រង់',
  Dinner: 'អាហារពេលល្ងាច',
  Snack: 'អាហារសម្រន់',
}
const mealListKM = (arr = []) => arr.map(m => MEAL_KM_MAP_ROW[m] || m).join(', ')


const ALLERGEN_KM_MAP = {
  Peanut: 'មិនញាំសណ្តែកដី',
  Shellfish: 'មិនញាំសត្វសំបកសមុទ្រ',
  Egg: 'មិនញាំស៊ុត',
  Gluten: 'គ្លុយតែន',
  'Dairy/Lactose': 'មិនញាំទឹកដោះគោ/ឡាក់តូស',
  Soy: 'មិនញាំសណ្តែកសៀង',
  Others: 'ផ្សេងទៀត',
}
const menuKM = (en) => MENU_KM_MAP[en] || en
const allergenKM = (en) => ALLERGEN_KM_MAP[en] || en

/* ───────── state ───────── */
const loading = ref(false)
const rows = ref([])
const q = ref('')
const status = ref('ALL')
const fromDate = ref('')
const toDate = ref('')
const showFilterDialog = ref(false)

const page = ref(1)
const perPage = ref(20)
const perPageOptions = [20, 50, 100, 'All']

const statuses = ['ACTIVE','ALL','NEW','ACCEPTED','COOKING','READY','DELIVERED','CANCELED']
const COLOR = { NEW:'grey', ACCEPTED:'primary', COOKING:'orange', READY:'teal', DELIVERED:'green', CANCELED:'red' }

const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '—')
const normalize = o => ({
  ...o,
  _id: String(o?._id || ''),
  requestId: String(o?.requestId || ''),
  orderType: o?.orderType || '',
  quantity: Number(o?.quantity || 0),
  meals: Array.isArray(o?.meals) ? o.meals : [],  
  menuChoices: Array.isArray(o?.menuChoices) ? o.menuChoices : [],
  menuCounts: Array.isArray(o?.menuCounts) ? o.menuCounts : [],
  dietary: Array.isArray(o?.dietary) ? o.dietary : [],
  dietaryCounts: Array.isArray(o?.dietaryCounts) ? o.dietaryCounts : [],
})

/* ───────── MENU / DIETARY math ───────── */
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

/* ───────── expand/collapse ───────── */
const expanded = ref(new Set())
const isExpanded = id => expanded.value.has(id)
function toggleExpanded(id) {
  const s = new Set(expanded.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expanded.value = s
}

/* ───────── CRUD / data load ───────── */
function upsertRow(doc) {
  const d = normalize(doc)
  const i = rows.value.findIndex(r => r._id === d._id)
  if (status.value === 'ACTIVE' && ['DELIVERED','CANCELED'].includes(d.status)) {
    if (i !== -1) rows.value.splice(i, 1)
    expanded.value.delete(d._id)
    return
  }
  if (i === -1) rows.value.unshift(d)
  else rows.value[i] = d
}
function removeRowById(id) {
  const i = rows.value.findIndex(r => r._id === id)
  if (i !== -1) rows.value.splice(i, 1)
  expanded.value.delete(id)
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (q.value.trim()) params.set('q', q.value.trim())
    if (status.value && status.value !== 'ALL' && status.value !== 'ACTIVE') params.set('status', status.value)
    if (fromDate.value) params.set('from', fromDate.value)
    if (toDate.value) params.set('to', toDate.value)

    const { data } = await api.get(`/admin/food-requests?${params.toString()}`)
    let list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    if (status.value === 'ACTIVE') list = list.filter(r => !['DELIVERED','CANCELED'].includes(r.status))
    rows.value = list.map(normalize)
    page.value = 1
  } finally { loading.value = false }
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  if (!auth.user) await auth.fetchMe()
  localStorage.setItem('authRole', auth.user?.role || '')
  subscribeRoleIfNeeded()

  await load()
  socket.on('foodRequest:created', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:updated', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:statusChanged', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:deleted', ({ _id }) => removeRowById(String(_id||'')))
})
onBeforeUnmount(() => {
  socket.off('foodRequest:created')
  socket.off('foodRequest:updated')
  socket.off('foodRequest:statusChanged')
  socket.off('foodRequest:deleted')
})
watch([q, status, fromDate, toDate], () => { page.value = 1; load() })

/* ───────── paging ───────── */
const totalItems = computed(() => rows.value.length)
const totalPages = computed(() => perPage.value === 'All' ? 1 : Math.max(1, Math.ceil(totalItems.value / perPage.value)))
const pagedRows = computed(() => {
  if (perPage.value === 'All') return rows.value
  const start = (page.value - 1) * perPage.value
  return rows.value.slice(start, start + perPage.value)
})

/* ───────── workflow ───────── */
const nextSteps = (s) => {
  switch (s) {
    case 'NEW': return ['ACCEPTED','CANCELED']
    case 'ACCEPTED': return ['COOKING','CANCELED']
    case 'COOKING': return ['READY','CANCELED']
    case 'READY': return ['DELIVERED','CANCELED']
    default: return []
  }
}
async function updateStatus(row, target) {
  if (!row?._id) {
    await Swal.fire({ icon:'error', title:'Missing _id', text:'This row has no Mongo _id. Cannot update.' })
    return
  }
  let reason = ''
  if (target === 'CANCELED') {
    const { value } = await Swal.fire({
      icon: 'warning',
      title: 'Cancel Request',
      input: 'select',
      inputOptions: {
        'not_have': 'Not have',
        'not_enough': 'Not enough',
        'direct_message': 'Please directly message instead',
        'out_of_stock': 'Out of stock',
        'off_hours': 'Not work hour',
        'other': 'Other'
      },
      inputPlaceholder: 'Select a reason',
      showCancelButton: true,
      confirmButtonText: 'Submit',
      cancelButtonText: 'Back',
      inputValidator: (v) => !v && 'Reason required'
    })
    if (!value) return
    reason = value
  }
  const before = { ...row }
  try {
    const url = `/admin/food-requests/${encodeURIComponent(row._id)}/status`
    const { data: updated } = await api.patch(url, { status: target, reason })
    upsertRow(updated)
    await Swal.fire({ icon:'success', title:'Updated', timer:900, showConfirmButton:false })
  } catch (e) {
    upsertRow(before)
    await Swal.fire({ icon:'error', title:'Failed', text: e?.response?.data?.message || e.message || 'Request failed' })
  }
}

/* ───────── mobile helpers ───────── */
function resetFilters() {
  q.value = ''
  status.value = 'ALL'
  fromDate.value = ''
  toDate.value = ''
  page.value = 1
  load()
}

/* ───────── Export to Excel (3 sheets) ───────── */
const exporting = ref(false)

function toMainRow(r) {
  return {
    _id: r._id,
    RequestID: r.requestId || '',
    Status: r.status || '',
    OrderType: r.orderType || '',
    Quantity: r.quantity || 0,
    EmployeeID: r.employee?.employeeId || '',
    Name: r.employee?.name || '',
    Department: r.employee?.department || '',
    OrderDate: fmtDate(r.orderDate),
    EatDate: fmtDate(r.eatDate),
    Time: [r.eatTimeStart, r.eatTimeEnd].filter(Boolean).join(' – '),
    MenuChoices: Array.isArray(r.menuChoices) ? r.menuChoices.join(', ') : '',
    DietarySelected: Array.isArray(r.dietary) ? r.dietary.join(', ') : '',
    DietaryOther: r.dietaryOther || '',
    SpecialInstructions: r.specialInstructions || '',
    Recurring: r?.recurring?.enabled
      ? `${r.recurring.frequency}${r.recurring.endDate ? ' until ' + fmtDate(r.recurring.endDate) : ''}${r.recurring.skipHolidays ? ' (skip holidays)' : ''}`
      : ''
  }
}
function buildMenuRows(list) {
  const out = []
  for (const r of list) {
    const m = menuMap(r)
    for (const [menuName, count] of m.entries()) {
      out.push({
        RequestID: r.requestId || '',
        Status: r.status || '',
        EatDate: fmtDate(r.eatDate),
        Menu: menuName,
        Count: count
      })
    }
  }
  return out
}
function buildDietaryRows(list) {
  const out = []
  for (const r of list) {
    const g = dietaryByMenu(r)
    for (const [menuName, inner] of g.entries()) {
      for (const [allergen, count] of inner.entries()) {
        out.push({
          RequestID: r.requestId || '',
          Status: r.status || '',
          EatDate: fmtDate(r.eatDate),
          Menu: menuName,
          Allergen: allergen,
          Count: count
        })
      }
    }
  }
  return out
}

async function exportExcel() {
  try {
    exporting.value = true
    const list = rows.value
    const wb = XLSX.utils.book_new()

    const main = list.map(toMainRow)
    const wsMain = XLSX.utils.json_to_sheet(main)
    XLSX.utils.book_append_sheet(wb, wsMain, 'Requests')

    const menuRows = buildMenuRows(list)
    const wsMenus = XLSX.utils.json_to_sheet(menuRows)
    XLSX.utils.book_append_sheet(wb, wsMenus, 'Menus')

    const dietRows = buildDietaryRows(list)
    const wsDiet = XLSX.utils.json_to_sheet(dietRows)
    XLSX.utils.book_append_sheet(wb, wsDiet, 'Dietary')

    for (const ws of [wsMain, wsMenus, wsDiet]) {
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 })
      const colWidths = data[0]?.map((_, c) =>
        ({ wch: Math.min(50, Math.max(...data.map(row => String(row?.[c] ?? '').length), 8)) })
      ) || []
      ws['!cols'] = colWidths
    }

    const rangeText = [
      fromDate.value ? `from_${fromDate.value}` : '',
      toDate.value ? `to_${toDate.value}` : '',
      status.value && status.value !== 'ALL' ? `status_${status.value}` : ''
    ].filter(Boolean).join('_')
    const stamp = dayjs().format('YYYYMMDD_HHmmss')
    const fname = `FoodRequests_${rangeText || 'all'}_${stamp}.xlsx`

    XLSX.writeFile(wb, fname)
  } catch (err) {
    console.error(err)
    await Swal.fire({ icon: 'error', title: 'Export failed', text: err?.message || 'Unknown error' })
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card elevation="1" class="rounded-lg">
      <!-- Toolbar -->
      <v-toolbar flat density="comfortable" class="px-2">
        <v-toolbar-title class="text-subtitle-1 font-weight-bold title-clamp">
          <span>Food Requests</span>
        </v-toolbar-title>
        <v-spacer />

        <!-- Desktop/tablet inline filters (EN-only labels) -->
        <template v-if="mdAndUp">
          <v-text-field v-model="q" density="compact" placeholder="Search"
                        hide-details variant="outlined" class="mr-2"
                        @keyup.enter="load" style="max-width: 220px" />

          <v-select v-model="status" :items="statuses" density="compact" label="Status"
                    hide-details variant="outlined" class="mr-2" style="max-width: 160px" />

          <v-text-field v-model="fromDate" type="date" density="compact" label="From"
                        hide-details variant="outlined" class="mr-2" style="max-width: 150px" />
          <v-text-field v-model="toDate" type="date" density="compact" label="To"
                        hide-details variant="outlined" class="mr-2" style="max-width: 150px" />

          <v-select v-model="perPage" :items="perPageOptions" density="compact" label="Rows"
                    hide-details variant="outlined" style="max-width: 110px" class="mr-2" />

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
                title="Refresh">
                <i class="fa-solid fa-rotate-right"></i>
              </v-btn>
            </template>
          </v-tooltip>
          <!-- ICON-ONLY: Filters -->
          <v-tooltip text="Filters" location="bottom">
            <template #activator="{ props }">
              <v-btn v-bind="props" icon variant="flat" class="mr-1"
                     @click="showFilterDialog = true" aria-label="Filters" title="Filters">
                <i class="fa-solid fa-filter"></i>
              </v-btn>
            </template>
          </v-tooltip>

          <!-- ICON-ONLY: Export -->
          <v-tooltip text="Export Excel" location="bottom">
            <template #activator="{ props }">
              <v-btn v-bind="props" :loading="exporting" icon color="success" variant="flat"
                     @click="exportExcel" aria-label="Export Excel" title="Export Excel">
                <i class="fa-regular fa-file-excel"></i>
              </v-btn>
            </template>
          </v-tooltip>
        </template>

        <!-- Mobile search + Refresh + Filters -->
        <v-sheet v-if="!mdAndUp" class="px-3 pt-3 pb-1 bg-transparent">
          <div class="d-flex align-center gap-2">
            <v-text-field
              v-model="q" density="compact" :placeholder="tkm('Search (type, menu, note, requester)')"
              clearable hide-details variant="outlined" class="flex-grow-1"
              @keyup.enter="load"
            />

            <!-- Refresh (FA icon) -->
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
                >
                  <i class="fa-solid fa-rotate-right"></i>
                </v-btn>
              </template>
            </v-tooltip>

            <!-- NEW: Filters (FA icon) -->
            <v-tooltip text="Filters" location="bottom">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon
                  color="primary"
                  variant="flat"
                  @click="showFilterDialog = true"
                  aria-label="Filters"
                  title="Filters"
                >
                  <i class="fa-solid fa-filter"></i>
                </v-btn>
              </template>
            </v-tooltip>
          </div>
        </v-sheet>

      </v-toolbar>

      <!-- Mobile Filters dialog (English labels) -->
      <v-dialog v-model="showFilterDialog" fullscreen transition="dialog-bottom-transition">
        <v-card>
          <v-toolbar density="comfortable" color="primary" class="text-white">
            <v-btn icon variant="text" class="text-white" @click="showFilterDialog=false">
              <v-icon>mdi-close</v-icon>
            </v-btn>
            <v-toolbar-title>Filters</v-toolbar-title>
            <v-spacer />
            <v-btn variant="text" class="text-white" @click="resetFilters">
              <v-icon start>mdi-restore</v-icon> Reset
            </v-btn>
          </v-toolbar>

          <v-card-text>
            <v-row dense>
              <v-col cols="12">
                <v-select v-model="status" :items="statuses" label="Status"
                          variant="outlined" density="comfortable" hide-details />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field v-model="fromDate" type="date" label="From"
                              variant="outlined" density="comfortable" hide-details />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field v-model="toDate" type="date" label="To"
                              variant="outlined" density="comfortable" hide-details />
              </v-col>
              <v-col cols="12" sm="6">
                <v-select v-model="perPage" :items="perPageOptions" label="Rows per page"
                          variant="outlined" density="comfortable" hide-details />
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

      <v-divider />

      <v-card-text class="pa-0">
        <div class="table-wrap">
          <v-table density="comfortable" class="min-width-table">
            <thead>
              <tr>
                <th><div class="hdr-2l"><div class="en">{{ tkm('Status') }}</div><div class="km">{{ tkm('Status') }}</div></div></th>
                <th style="width:320px;"><div class="hdr-2l"><div class="en">Actions</div><div class="km">{{ tkm('Actions') }}</div></div></th>
                <th><div class="hdr-2l"><div class="en">Requester (ID & Name)</div><div class="km">{{ tkm('Requester (ID & Name)') }}</div></div></th>
                <th><div class="hdr-2l"><div class="en">Order Date</div><div class="km">{{ tkm('Order Date') }}</div></div></th>
                <th><div class="hdr-2l"><div class="en">Eat Date</div><div class="km">{{ tkm('Eat Date') }}</div></div></th>
                <th><div class="hdr-2l"><div class="en">Time</div><div class="km">{{ tkm('Time') }}</div></div></th>
                <th class="d-none d-sm-table-cell"><div class="hdr-2l"><div class="en">Dept</div><div class="km">{{ tkm('Dept') }}</div></div></th>
                <th class="d-none d-md-table-cell"><div class="hdr-2l"><div class="en">Order Type</div><div class="km">{{ tkm('Type') }}</div></div></th>
                <th><div class="hdr-2l"><div class="en">Meals</div><div class="km">អាហារ</div></div></th>
                <th><div class="hdr-2l"><div class="en">Qty</div><div class="km">{{ tkm('Qty') }}</div></div></th>
              </tr>
            </thead>

            <tbody>
              <template v-for="r in pagedRows" :key="r._id">
                <tr>
                  <td>
                    <v-chip :color="COLOR[r.status]" size="small" label>
                      <div class="chip-2l">
                        <div class="en">{{ r.status }}</div>
                        <div class="km">{{ tkm(r.status) }}</div>
                      </div>
                    </v-chip>
                  </td>
                  <td>
                    <div class="mb-2">
                      <v-btn
                        v-for="s in nextSteps(r.status)" :key="s"
                        size="small" class="mr-1 mb-1"
                        :color="s==='CANCELED' ? 'red' : (s==='DELIVERED' ? 'green' : 'primary')"
                        variant="tonal"
                        :disabled="!r._id"
                        @click="updateStatus(r, s)"
                      >
                        <div class="cell-2l">
                          <div class="en">{{ s }}</div>
                          <div class="km">{{ tkm(s) }}</div>
                        </div>
                      </v-btn>
                    </div>
                    <v-btn size="small" variant="text" color="secondary" @click="toggleExpanded(r._id)">
                      <span class="en">{{ isExpanded(r._id) ? 'Hide details' : 'Details' }}</span>
                      <span class="km ml-1">({{ isExpanded(r._id) ? tkm('Hide details') : tkm('Details') }})</span>
                    </v-btn>
                  </td>

                  <td>
                    <div class="cell-2l">
                      <div class="en">{{ r.employee?.employeeId || '—' }} — {{ r.employee?.name || '—' }}</div>
                      <div class="km">{{ tkm('Requester (ID & Name)') }}</div>
                    </div>
                  </td>

                  <td>{{ fmtDate(r.orderDate) }}</td>
                  <td>{{ fmtDate(r.eatDate) }}</td>

                  <td>
                    <div class="cell-2l">
                      <div class="en">{{ r.eatTimeStart || '—' }}<span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span></div>
                      <div class="km">{{ tkm('Time') }}</div>
                    </div>
                  </td>

                  <td class="d-none d-sm-table-cell">{{ r.employee?.department || '—' }}</td>
                  <td class="d-none d-md-table-cell">{{ r.orderType }}</td>
                  <td>
                    <div class="cell-2l">
                      <div class="en">{{ (r.meals || []).join(', ') || '—' }}</div>
                      <div class="km">{{ mealListKM(r.meals) }}</div>
                    </div>
                  </td>
                  <td>{{ r.quantity }}</td>
                </tr>

                <!-- Details row -->
                <tr v-if="isExpanded(r._id)" class="details-row">
                  <td colspan="9">
                    <v-expand-transition>
                      <div class="px-3 py-2">
                        <div class="tree">
                          <div class="tree-node root">
                            <div class="node-label two-lines">
                              <div class="en"><strong>{{ tkm('Quantity') }}</strong> {{ r.quantity }}</div>
                              <div class="km">{{ tkm('Quantity') }}</div>
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

              <tr v-if="!pagedRows.length && !loading">
                <td colspan="9" class="text-center py-6 text-medium-emphasis">
                  {{ tkm('No requests found.') }}
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card-text>

      <v-divider />
      <div class="d-flex flex-wrap align-center justify-space-between px-4 py-3 gap-2">
        <div class="text-caption text-medium-emphasis">
          Showing
          <b>{{ perPage === 'All' ? 1 : Math.min((page - 1) * perPage + 1, totalItems) }}</b>
          -
          <b>{{ perPage === 'All' ? totalItems : Math.min(page * perPage, totalItems) }}</b>
          of <b>{{ totalItems }}</b>
        </div>
        <v-select v-if="!mdAndUp" v-model="perPage" :items="perPageOptions" density="compact"
                  label="Rows" hide-details variant="outlined" style="max-width: 140px" />
        <v-pagination v-if="perPage !== 'All'" v-model="page" :length="totalPages" :total-visible="7" density="comfortable" />
      </div>
    </v-card>
  </v-container>
</template>

<style scoped>
.table-wrap{ overflow-x:auto; display:block; }

/* Tighter inputs */
:deep(.v-field__input){ min-height: 36px; }

/* Title clamp so controls stay visible */
.title-clamp {
  max-width: 38vw;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
@media (max-width: 420px){
  .title-clamp { max-width: 48vw; }
}

/* Table min widths; shrink on phones */
.min-width-table th,.min-width-table td{ min-width:120px; white-space:nowrap; }
@media (max-width: 600px){
  .min-width-table th,.min-width-table td{ min-width: 90px; }
  .v-toolbar{ padding-left: .5rem; padding-right: .5rem; }
}

/* bilingual headers */
.hdr-2l .en{ font-weight:600; }
.hdr-2l .km{ font-size:.82rem; opacity:.85; }

/* two-line cells/chips */
.cell-2l{ display:flex; flex-direction:column; line-height:1.1; }
.cell-2l .km{ font-size:.86rem; opacity:.9; }
.chip-2l{ display:flex; flex-direction:column; line-height:1; }
.chip-2l .km{ font-size:.78em; opacity:.9; }

/* Details tree */
.details-row{ background: rgba(0,0,0,0.02); }
.tree{ font-size:.96rem; line-height:1.4; }
.tree .node-label{ display:inline-flex; align-items:center; gap:.4rem; padding:.2rem .5rem; border-radius:.5rem; }
.tree .root>.node-label{ background: rgba(16,185,129,.12); }
.tree .tree-node .node-label{ background: rgba(59,130,246,.10); }
.tree .leaf .node-label{ background: rgba(234,179,8,.12); }
.arrow{ font-weight:700; } .arrow.small{ opacity:.9; }
.children{ margin-left:1.2rem; padding-left:.6rem; border-left:2px dashed rgba(0,0,0,.15); margin-top:.35rem; }
.ok{ color:#16a34a; } .warn{ color:#dc2626; }

/* Display utility for small screens */
.d-none{ display:none !important; }
@media (min-width: 600px){ .d-sm-table-cell{ display: table-cell !important; } }
@media (min-width: 960px){ .d-md-table-cell{ display: table-cell !important; } }

/* Khmer font helper (for KM spans) */
.km{
  font-family: 'Kantumruy Pro', system-ui, -apple-system, Segoe UI, Roboto,
               'Helvetica Neue', Arial, 'Noto Sans Khmer', sans-serif;
}

/* Font Awesome icons inside Vuetify icon buttons */
:deep(.v-btn--icon i.fa-solid),
:deep(.v-btn--icon i.fa-regular){
  font-size: 1.05rem;
  line-height: 1;
}
</style>
