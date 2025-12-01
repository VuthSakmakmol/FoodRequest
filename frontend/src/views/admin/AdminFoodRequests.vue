<!-- src/views/admin/AdminFoodRequests.vue -->
<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import dayjs from 'dayjs'
import Swal from 'sweetalert2'
import api from '@/utils/api'
import { useAuth } from '@/store/auth'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'
import { useDisplay } from 'vuetify'
import * as XLSX from 'xlsx'

const { mdAndUp } = useDisplay()
const isMobile = computed(() => !mdAndUp.value)

const auth  = useAuth()
const route = useRoute()

/* ───────── i18n maps still kept for future use (but NOT rendered) ───────── */
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

/* Khmer labels for menu/allergen (only used for logic / export if needed) */
const MENU_KM_MAP = {
  Standard: 'ញាំទូទៅ',
  Vegetarian: 'មិនញាំសាច់',
  Vegan: 'ញាំបួស',
  'No pork': 'មិនញាំសាច់ជ្រូក',
  'No beef': 'មិនញាំសាច់គោ',
}
const ALLERGEN_KM_MAP = {
  Peanut: 'មិនញាំសណ្តែកដី',
  Shellfish: 'មិនញាំសត្វសំបកសមុទ្រ',
  Egg: 'មិនញាំស៊ុត',
  Gluten: 'គ្លុយតែន',
  'Dairy/Lactose': 'មិនញាំទឹកដោះគោ/ឡាក់តូស',
  Soy: 'មិនញាំសណ្តែកសៀង',
  Others: 'ផ្សេងទៀត',
}

/* Khmer labels for order type (not rendered) */
const ORDER_TYPE_KM_MAP = {
  'Daily meal': 'អាហារប្រចាំថ្ងៃ',
  'Meeting catering': 'អាហារប្រជុំ',
  'Visitor meal': 'អាហារភ្ញៀវ',
}

const mealKMRow = {
  Breakfast: 'អាហារពេលព្រឹក',
  Lunch: 'អាហារថ្ងៃត្រង់',
  Dinner: 'អាហារពេលល្ងាច',
  Snack: 'អាហារសម្រន់',
}

const orderTypeKM = (en) => ORDER_TYPE_KM_MAP[en] || en
const menuKM = (en) => MENU_KM_MAP[en] || en
const allergenKM = (en) => ALLERGEN_KM_MAP[en] || en
const mealListKM = (arr = []) => arr.map(m => mealKMRow[m] || m).join(', ')

/* ───────── state ───────── */
const loading = ref(false)
const rows    = ref([])
const q       = ref('')
const status  = ref('ALL')
const fromDate = ref('')
const toDate   = ref('')
const showFilterDialog = ref(false)

const page    = ref(1)
const perPage = ref(20)
const perPageOptions = [20, 50, 100, 'All']

const statuses = ['ACTIVE','ALL','NEW','ACCEPTED','COOKING','READY','DELIVERED','CANCELED']
const COLOR = {
  NEW:'grey', ACCEPTED:'primary', COOKING:'orange',
  READY:'teal', DELIVERED:'green', CANCELED:'red'
}

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

  // date from calendar → focus a single day, else today
  const qDate = route.query.date
  if (qDate) {
    const dStr = dayjs(qDate).isValid()
      ? dayjs(qDate).format('YYYY-MM-DD')
      : String(qDate)
    fromDate.value = dStr
    toDate.value   = dStr
  } else {
    const today = dayjs().format('YYYY-MM-DD')
    fromDate.value = today
    toDate.value   = today
  }

  const focus = route.query.focus
  if (focus) {
    const s = new Set(expanded.value)
    s.add(String(focus))
    expanded.value = s
  }

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

watch(
  () => route.query.date,
  (val) => {
    if (!val) return
    const dStr = dayjs(val).isValid()
      ? dayjs(val).format('YYYY-MM-DD')
      : String(val)
    fromDate.value = dStr
    toDate.value   = dStr
  }
)
watch(
  () => route.query.focus,
  (val) => {
    if (!val) return
    const s = new Set(expanded.value)
    s.add(String(val))
    expanded.value = s
  }
)

/* ───────── paging ───────── */
const totalItems = computed(() => rows.value.length)
const totalPages = computed(() => perPage.value === 'All'
  ? 1
  : Math.max(1, Math.ceil(totalItems.value / perPage.value))
)
const pagedRows = computed(() => {
  if (perPage.value === 'All') return rows.value
  const start = (page.value - 1) * perPage.value
  return rows.value.slice(start, start + perPage.value)
})

/* ───────── workflow ───────── */
const nextSteps = (s) => {
  switch (s) {
    case 'NEW':       return ['ACCEPTED','CANCELED']
    case 'ACCEPTED':  return ['COOKING','CANCELED']
    case 'COOKING':   return ['READY','CANCELED']
    case 'READY':     return ['DELIVERED','CANCELED']
    default:          return []
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
  const today = dayjs().format('YYYY-MM-DD')
  fromDate.value = today
  toDate.value   = today
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
      <!-- Toolbar with gradient header like calendar -->
      <v-toolbar flat density="comfortable" class="px-2 ka-toolbar">
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
                <v-icon icon="mdi-refresh" size="20" />
              </v-btn>
            </template>
          </v-tooltip>

          <v-tooltip text="Filters" location="bottom">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon
                variant="flat"
                class="mr-1"
                @click="showFilterDialog = true"
                aria-label="Filters"
                title="Filters"
              >
                <v-icon icon="mdi-filter-variant" size="20" />
              </v-btn>
            </template>
          </v-tooltip>

          <v-tooltip text="Export Excel" location="bottom">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                :loading="exporting"
                icon
                color="success"
                variant="flat"
                @click="exportExcel"
                aria-label="Export Excel"
                title="Export Excel"
              >
                <v-icon icon="mdi-file-excel-outline" size="20" />
              </v-btn>
            </template>
          </v-tooltip>
        </template>

        <!-- Mobile search + Refresh + Filters -->
        <v-sheet v-if="!mdAndUp" class="px-3 pt-3 pb-1 bg-transparent">
          <div class="d-flex align-center gap-2">
            <v-text-field
              v-model="q" density="compact" placeholder="Search"
              clearable hide-details variant="outlined" class="flex-grow-1" style="width: 180px;"
              @keyup.enter="load"
            />
            <v-tooltip text="Refresh" location="bottom">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  :loading="loading"
                  icon
                  size="small"
                  variant="tonal"
                  @click="load"
                  style="margin: 5px;"
                >
                  <v-icon icon="mdi-refresh" size="20" />
                </v-btn>
              </template>
            </v-tooltip>
            <v-tooltip text="Filters" location="bottom">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon
                  color="primary"
                  variant="flat"
                  size="small"
                  @click="showFilterDialog = true"
                >
                  <v-icon icon="mdi-filter-variant" size="20" />
                </v-btn>
              </template>
            </v-tooltip>
          </div>
        </v-sheet>
      </v-toolbar>

      <!-- Mobile Filters dialog -->
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
        <!-- MOBILE: CARD LIST (English only) -->
        <div v-if="isMobile" class="mobile-list-wrap">
          <v-skeleton-loader
            v-if="loading"
            type="card@3"
            class="mb-2"
          />
          <template v-else>
            <div v-if="!pagedRows.length" class="text-center py-6 text-medium-emphasis">
              No requests found.
            </div>

            <div v-else class="req-card-list">
              <v-card
                v-for="r in pagedRows"
                :key="r._id"
                class="req-card"
                rounded="xl"
                elevation="2"
                :class="{ 'highlight-row': route.query.focus === r._id }"
              >
                <v-card-text class="py-3 px-3">
                  <!-- top: status + dates/time -->
                  <div class="card-top">
                    <div>
                      <v-chip
                        :color="COLOR[r.status]"
                        size="small"
                        label
                      >
                        {{ r.status }}
                      </v-chip>
                      <div class="text-caption text-medium-emphasis mt-1">
                        {{ fmtDate(r.orderDate) }} → {{ fmtDate(r.eatDate) }}
                      </div>
                    </div>
                    <div class="text-right">
                      <div class="card-time">
                        {{ r.eatTimeStart || '—' }}
                        <span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span>
                      </div>
                      <div class="text-caption text-medium-emphasis">
                        {{ r.employee?.department || '—' }}
                      </div>
                    </div>
                  </div>

                  <v-divider class="my-2" />

                  <!-- requester -->
                  <div class="card-row">
                    <div class="lbl">Requester (ID & Name)</div>
                    <div class="val">
                      {{ r.employee?.name || '—' }}
                      <div class="text-caption text-medium-emphasis">
                        ID {{ r.employee?.employeeId || '—' }}
                      </div>
                    </div>
                  </div>

                  <!-- order type -->
                  <div class="card-row">
                    <div class="lbl">Order Type</div>
                    <div class="val">
                      {{ r.orderType || '—' }}
                    </div>
                  </div>

                  <!-- meals / qty -->
                  <div class="card-row">
                    <div class="lbl">Meals</div>
                    <div class="val">
                      {{ (r.meals || []).join(', ') || '—' }}
                      <div class="text-caption text-medium-emphasis mt-1">
                        Qty: {{ r.quantity }}
                      </div>
                    </div>
                  </div>

                  <!-- location -->
                  <div class="card-row">
                    <div class="lbl">Location</div>
                    <div class="val">
                      {{ r?.location?.kind || '—' }}
                      <span v-if="r?.location?.other"> — {{ r.location.other }}</span>
                    </div>
                  </div>

                  <!-- actions: status buttons -->
                  <div class="card-actions-row">
                    <div class="mb-2">
                      <v-btn
                        v-for="s in nextSteps(r.status)" :key="s"
                        size="small" class="mr-1 mb-1"
                        :color="s==='CANCELED' ? 'red' : (s==='DELIVERED' ? 'green' : 'primary')"
                        variant="tonal"
                        style="height: 35px;"
                        :disabled="!r._id"
                        @click="updateStatus(r, s)"
                      >
                        {{ s }}
                      </v-btn>
                    </div>

                    <v-btn
                      size="small"
                      variant="text"
                      color="primary"
                      @click="toggleExpanded(r._id)"
                    >
                      {{ isExpanded(r._id) ? 'Hide details' : 'Details' }}
                    </v-btn>
                  </div>

                  <!-- details tree inside card (English only) -->
                  <v-expand-transition>
                    <div v-if="isExpanded(r._id)" class="mt-2 card-details-tree">
                      <div class="tree">
                        <div class="tree-node root">
                          <div class="node-label two-lines">
                            <div><strong>Quantity</strong> {{ r.quantity }}</div>
                          </div>
                          <div class="children">
                            <template v-for="[menuName, menuCnt] in menuMap(r)" :key="menuName">
                              <div class="tree-node">
                                <div class="node-label two-lines">
                                  <div>
                                    <span class="arrow">→</span>
                                    <strong>{{ menuName }}</strong> ×{{ menuCnt }}
                                  </div>
                                </div>
                                <div
                                  class="children"
                                  v-if="
                                    Array.from(
                                      (dietaryByMenu(r).get(menuName) || new Map()).entries()
                                    ).length
                                  "
                                >
                                  <div
                                    class="tree-node leaf"
                                    v-for="[allergen, aCnt] in Array.from(
                                      (dietaryByMenu(r).get(menuName) || new Map()).entries()
                                    )"
                                    :key="menuName + '_' + allergen"
                                  >
                                    <div class="node-label two-lines">
                                      <div>
                                        <span class="arrow small">↳</span>
                                        {{ allergen }} ×{{ aCnt }}
                                      </div>
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
                </v-card-text>
              </v-card>
            </div>
          </template>
        </div>

        <!-- DESKTOP/TABLE (English only) -->
        <div v-else class="table-wrap">
          <v-table density="comfortable" class="min-width-table align-left comfy-cells row-hover">
            <thead>
              <tr>
                <th><span class="hdr-en">Status</span></th>
                <th style="width:320px;"><span class="hdr-en">Actions</span></th>
                <th><span class="hdr-en">Requester (ID & Name)</span></th>
                <th><span class="hdr-en">Order Date</span></th>
                <th><span class="hdr-en">Eat Date</span></th>
                <th><span class="hdr-en">Time</span></th>
                <th class="d-none d-sm-table-cell"><span class="hdr-en">Dept</span></th>
                <th class="d-none d-md-table-cell"><span class="hdr-en">Order Type</span></th>
                <th><span class="hdr-en">Meals</span></th>
                <th><span class="hdr-en">Qty</span></th>
              </tr>
            </thead>

            <tbody>
              <template v-for="r in pagedRows" :key="r._id">
                <tr :class="{ 'highlight-row': route.query.focus === r._id }">
                  <td>
                    <v-chip :color="COLOR[r.status]" size="small" label>
                      {{ r.status }}
                    </v-chip>
                  </td>
                  <td>
                    <div class="mb-2">
                      <v-btn
                        v-for="s in nextSteps(r.status)" :key="s"
                        size="small" class="mr-1 mb-1"
                        :color="s==='CANCELED' ? 'red' : (s==='DELIVERED' ? 'green' : 'primary')"
                        variant="tonal"
                        style="height: 35px;"
                        :disabled="!r._id"
                        @click="updateStatus(r, s)"
                      >
                        {{ s }}
                      </v-btn>
                    </div>
                    <v-btn size="small" variant="text" color="secondary" @click="toggleExpanded(r._id)">
                      {{ isExpanded(r._id) ? 'Hide details' : 'Details' }}
                    </v-btn>
                  </td>

                  <td>
                    {{ r.employee?.employeeId || '—' }} — {{ r.employee?.name || '—' }}
                  </td>

                  <td>{{ fmtDate(r.orderDate) }}</td>
                  <td>{{ fmtDate(r.eatDate) }}</td>

                  <td>
                    {{ r.eatTimeStart || '—' }}
                    <span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span>
                  </td>

                  <td class="d-none d-sm-table-cell">{{ r.employee?.department || '—' }}</td>
                  <td class="d-none d-md-table-cell">
                    {{ r.orderType }}
                  </td>
                  <td>
                    {{ (r.meals || []).join(', ') || '—' }}
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
                              <div><strong>Quantity</strong> {{ r.quantity }}</div>
                            </div>
                            <div class="children">
                              <template v-for="[menuName, menuCnt] in menuMap(r)" :key="menuName">
                                <div class="tree-node">
                                  <div class="node-label two-lines">
                                    <div>
                                      <span class="arrow">→</span>
                                      <strong>{{ menuName }}</strong> ×{{ menuCnt }}
                                    </div>
                                  </div>
                                  <div
                                    class="children"
                                    v-if="Array.from((dietaryByMenu(r).get(menuName) || new Map()).entries()).length"
                                  >
                                    <div
                                      class="tree-node leaf"
                                      v-for="[allergen, aCnt] in Array.from(
                                        (dietaryByMenu(r).get(menuName) || new Map()).entries()
                                      )"
                                      :key="menuName + '_' + allergen"
                                    >
                                      <div class="node-label two-lines">
                                        <div>
                                          <span class="arrow small">↳</span>
                                          {{ allergen }} ×{{ aCnt }}
                                        </div>
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
                  No requests found.
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card-text>

      <v-divider />
      <div class="d-flex flex-wrap align-center justify-space-between px-4 py-3 gap-2">

        <!-- <v-select v-if="!mdAndUp" v-model="perPage" :items="perPageOptions" density="compact"
                  label="Rows" hide-details variant="outlined" style="max-width: 140px" /> -->
        <v-pagination v-if="perPage !== 'All'" v-model="page" :length="totalPages" :total-visible="7" density="comfortable" />
      </div>
    </v-card>
  </v-container>
</template>

<style scoped>
.table-wrap{ overflow-x:auto; display:block; }

/* Toolbar gradient, same feel as calendar header */
.ka-toolbar{
  background: linear-gradient(90deg, #0f719e 0%, #b3b4df 60%, #ae9aea 100%);
  color: #000000;
}

/* Tighter inputs */
:deep(.v-field__input){ min-height: 36px; }

/* Table min widths; shrink on phones */
.min-width-table th,.min-width-table td{ min-width:120px; white-space:nowrap; }
@media (max-width: 600px){
  .min-width-table th,.min-width-table td{ min-width: 90px; }
  .v-toolbar{ padding-left: .5rem; padding-right: .5rem; }
}

/* simple header text */
.hdr-en{
  font-weight: 600;
}

/* Details tree */
.details-row{ background: rgba(0,0,0,0.02); }
.tree{ font-size:.96rem; line-height:1.4; }
.tree .node-label{ display:inline-flex; align-items:center; gap:.4rem; padding:.2rem .5rem; border-radius:.5rem; }
.tree .root>.node-label{ background: rgba(16,185,129,.12); }
.tree .tree-node .node-label{ background: rgba(59,130,246,.10); }
.tree .leaf .node-label{ background: rgba(234,179,8,.12); }
.arrow{ font-weight:700; } .arrow.small{ opacity:.9; }
.children{ margin-left:1.2rem; padding-left:.6rem; border-left:2px dashed rgba(0,0,0,.15); margin-top:.35rem; }

/* Display utility for small screens */
.d-none{ display:none !important; }
@media (min-width: 600px){ .d-sm-table-cell{ display: table-cell !important; } }
@media (min-width: 960px){ .d-md-table-cell{ display: table-cell !important; } }

/* Left alignment + comfy spacing + hover */
.align-left :deep(table thead th),
.align-left :deep(table tbody td){
  text-align: left !important;
}
.comfy-cells :deep(table tbody td){
  vertical-align: top;
  padding-top: 10px !important;
  padding-bottom: 10px !important;
}
.comfy-cells :deep(table thead th){
  padding-top: 10px !important;
  padding-bottom: 10px !important;
}
.row-hover :deep(table tbody tr:not(.details-row):hover){
  background: rgba(59,130,246,0.08);
  transition: background 120ms ease;
}
.min-width-table :deep(td > *){
  justify-content: flex-start !important;
  text-align: left !important;
}

/* Highlight focused row from calendar (table or card) */
.highlight-row{
  background-color: #fff8e1 !important;
}

/* ---------- MOBILE CARD LAYOUT ---------- */
.mobile-list-wrap{
  padding: 8px 8px 4px;
}
.req-card-list{
  display:flex;
  flex-direction:column;
  gap:10px;
}
.req-card{
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  background: radial-gradient(circle at top left, #eff6ff 0, #ffffff 38%, #f8fafc 100%);
  box-shadow: 0 10px 24px rgba(15,23,42,0.14);
}
.card-top{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:8px;
}
.card-time{
  font-size:.9rem;
  font-weight:600;
}
.card-row{
  display:flex;
  align-items:flex-start;
  gap:8px;
  margin-top:6px;
}
.card-row .lbl{
  min-width:90px;
  font-size:.78rem;
  color:#64748b;
  padding-top:2px;
}
.card-row .val{
  font-weight:500;
  font-size:.9rem;
}
.card-actions-row{
  margin-top:10px;
}
.card-details-tree{
  margin-top:4px;
}

/* Small margin helper */
.mr-1{ margin-right: .25rem; }
</style>
