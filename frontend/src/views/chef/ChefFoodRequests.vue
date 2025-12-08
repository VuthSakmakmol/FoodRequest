<!-- src/views/chef/ChefFoodBooking.vue -->
<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import dayjs from 'dayjs'
import Swal from 'sweetalert2'
import api from '@/utils/api'
import { useAuth } from '@/store/auth'
import socket, { subscribeRoleIfNeeded } from '@/utils/socket'
import { useDisplay } from 'vuetify'

const { mdAndUp } = useDisplay()
const isMobile = computed(() => !mdAndUp.value)

const auth = useAuth()
const route = useRoute()

/* ───────── focus from calendar ───────── */
const focusId = ref('')        // id coming from calendar ?focus=
const focusedRowId = ref('')   // row currently highlighted
const didInitialFocus = ref(false)

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
const ALLERGEN_KM_MAP = {
  Peanut: 'មិនញាំសណ្តែកដី',
  Shellfish: 'មិនញាំសត្វសំបកសមុទ្រ',
  Egg: 'មិនញាំស៊ុត',
  Gluten: 'គ្លុយតែន',
  'Dairy/Lactose': 'មិនញាំទឹកដោះគោ/ឡាក់តូស',
  Soy: 'មិនញាំសណ្តែកសៀង',
  Others: 'ផ្សេងទៀត',
}

/* Khmer labels for order type (table cell) */
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
const rows = ref([])
const q = ref('')
const status = ref('ALL')

/* 🔹 DEFAULT: show only TODAY (or one date from calendar) */
const todayStr = dayjs().format('YYYY-MM-DD')
const filterDate = ref(todayStr)

const page = ref(1)
const perPage = ref(10)
const perPageOptions = [10, 20, 50, 100, 'All']

const statuses = ['ACTIVE', 'ALL', 'NEW', 'ACCEPTED', 'COOKING', 'READY', 'DELIVERED', 'CANCELED']
const COLOR = { NEW: 'grey', ACCEPTED: 'primary', COOKING: 'orange', READY: 'teal', DELIVERED: 'green', CANCELED: 'red' }

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

/* ───────── helpers for realtime filter matching ───────── */
function matchesFilters(doc) {
  const term = q.value.trim().toLowerCase()
  const eatStr = doc.eatDate ? dayjs(doc.eatDate).format('YYYY-MM-DD') : null

  // Date filter: single day
  if (filterDate.value && eatStr && eatStr !== filterDate.value) {
    return false
  }

  // Status filter
  if (status.value === 'ACTIVE') {
    if (['DELIVERED', 'CANCELED'].includes(doc.status)) return false
  } else if (status.value && status.value !== 'ALL') {
    if (doc.status !== status.value) return false
  }

  // Search filter (rough but good enough)
  if (term) {
    const haystack = [
      doc.employee?.name,
      doc.employee?.employeeId,
      doc.employee?.department,
      doc.orderType,
      (doc.meals || []).join(', '),
      (doc.menuChoices || []).join(', '),
      doc.specialInstructions,
      doc.requestId
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    if (!haystack.includes(term)) return false
  }

  return true
}

/* ───────── CRUD / data load ───────── */
const BASE = '/chef/food-requests' // chef namespace (mirrors admin endpoints)

function upsertRow(doc) {
  const d = normalize(doc)
  const idx = rows.value.findIndex(r => r._id === d._id)

  // If this doc does NOT match current filters → ensure it’s removed from the list
  if (!matchesFilters(d)) {
    if (idx !== -1) {
      rows.value.splice(idx, 1)
    }
    expanded.value.delete(d._id)
    return
  }

  // Otherwise, insert/update
  if (idx === -1) {
    rows.value.unshift(d)
  } else {
    rows.value[idx] = d
  }
}

function removeRowById(id) {
  const i = rows.value.findIndex(r => r._id === id)
  if (i !== -1) rows.value.splice(i, 1)
  expanded.value.delete(id)
}

/* focus helper after data load */
async function applyInitialFocus() {
  if (!focusId.value || didInitialFocus.value) return

  const idx = rows.value.findIndex(r => r._id === focusId.value)
  if (idx === -1) return

  if (perPage.value !== 'All') {
    const size = typeof perPage.value === 'number' ? perPage.value : 20
    page.value = Math.floor(idx / size) + 1
  }

  await nextTick()

  focusedRowId.value = focusId.value
  expanded.value = new Set([...expanded.value, focusId.value])

  const el = document.querySelector(`tr[data-id="${focusId.value}"]`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  didInitialFocus.value = true

  setTimeout(() => {
    if (focusedRowId.value === focusId.value) {
      focusedRowId.value = ''
    }
  }, 5000)
}

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (q.value.trim()) params.set('q', q.value.trim())
    if (status.value && status.value !== 'ALL' && status.value !== 'ACTIVE') params.set('status', status.value)
    if (filterDate.value) {
      // use same date as from & to so backend still works
      params.set('from', filterDate.value)
      params.set('to', filterDate.value)
    }

    const { data } = await api.get(`${BASE}?${params.toString()}`)
    let list = Array.isArray(data) ? data : (data?.rows || data?.data || [])
    if (status.value === 'ACTIVE') list = list.filter(r => !['DELIVERED', 'CANCELED'].includes(r.status))
    rows.value = list.map(normalize)
    page.value = 1

    await applyInitialFocus()
  } finally { loading.value = false }
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  if (!auth.user) await auth.fetchMe()
  localStorage.setItem('authRole', auth.user?.role || '')
  subscribeRoleIfNeeded()

  const qFocus = route.query.focus
  const qDate  = route.query.date
  if (qFocus) focusId.value = String(qFocus)
  if (qDate) {
    // calendar → force that single date
    filterDate.value = String(qDate)
  }

  await load()

  // realtime bindings
  socket.on('foodRequest:created', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:updated', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:statusChanged', (doc) => doc && upsertRow(doc))
  socket.on('foodRequest:deleted', ({ _id }) => removeRowById(String(_id || '')))
})

onBeforeUnmount(() => {
  socket.off('foodRequest:created')
  socket.off('foodRequest:updated')
  socket.off('foodRequest:statusChanged')
  socket.off('foodRequest:deleted')
})

// whenever filters change → reload from server
watch([q, status, filterDate], () => { page.value = 1; load() })

/* ───────── paging ───────── */
const totalItems = computed(() => rows.value.length)
const totalPages = computed(() =>
  perPage.value === 'All' ? 1 : Math.max(1, Math.ceil(totalItems.value / perPage.value))
)
const pagedRows = computed(() => {
  if (perPage.value === 'All') return rows.value
  const start = (page.value - 1) * perPage.value
  return rows.value.slice(start, start + perPage.value)
})

/* ───────── workflow ───────── */
const nextSteps = (s) => {
  switch (s) {
    case 'NEW':
      return ['ACCEPTED']
    case 'ACCEPTED':
      return ['COOKING']
    case 'COOKING':
      return ['READY']
    case 'READY':
      return ['DELIVERED']
    default:
      return []
  }
}

async function updateStatus(row, target) {
  if (!row?._id) {
    await Swal.fire({ icon: 'error', title: 'Missing _id', text: 'This row has no Mongo _id. Cannot update.' })
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
    const url = `${BASE}/${encodeURIComponent(row._id)}/status`
    const { data: updated } = await api.patch(url, { status: target, reason })
    upsertRow(updated)
    await Swal.fire({ icon: 'success', title: 'Updated', timer: 900, showConfirmButton: false })
  } catch (e) {
    upsertRow(before)
    await Swal.fire({ icon: 'error', title: 'Failed', text: e?.response?.data?.message || e.message || 'Request failed' })
  }
}

/* ───────── helpers ───────── */
function resetFilters() {
  q.value = ''
  status.value = 'ALL'
  filterDate.value = dayjs().format('YYYY-MM-DD')
  page.value = 1
  load()
}
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card elevation="1" class="rounded-lg chef-shell">
      <!-- Gradient HERO filter bar -->
      <div class="chef-hero">
        <v-text-field
          v-model="q"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          placeholder="Search name / ID / dept"
          class="fh-field fh-search"
          @keyup.enter="load"
        />
        <v-select
          v-model="status"
          :items="statuses"
          density="compact"
          variant="outlined"
          hide-details
          label="Status"
          class="fh-field fh-status"
        />
        <v-text-field
          v-model="filterDate"
          type="date"
          density="compact"
          variant="outlined"
          hide-details
          label="Eat date"
          class="fh-field fh-date"
        />

        <div class="hero-actions">
          <v-btn
            size="small"
            variant="tonal"
            color="grey"
            @click="resetFilters"
          >
            <v-icon size="18" class="mr-1">mdi-calendar-today</v-icon>
            Today
          </v-btn>
        </div>
      </div>

      <v-card-text class="pa-0">
        <!-- MOBILE: CARD LIST -->
        <div v-if="isMobile" class="chef-mobile-wrap">
          <v-skeleton-loader
            v-if="loading"
            type="card@3"
            class="mb-2"
          />
          <template v-else>
            <div v-if="!pagedRows.length" class="text-center py-6 text-medium-emphasis">
              {{ tkm('No requests found.') }}
            </div>

            <div v-else class="chef-card-list">
              <v-card
                v-for="r in pagedRows"
                :key="r._id"
                class="chef-card"
                rounded="xl"
                elevation="2"
                :class="{ 'focused-row': r._id === focusedRowId }"
              >
                <v-card-text class="py-3 px-3">
                  <!-- top: status + time/eat date -->
                  <div class="card-top">
                    <div>
                      <v-chip :color="COLOR[r.status]" size="small" label>
                        <div class="chip-2l">
                          <div class="en">{{ r.status }}</div>
                          <div class="km">{{ tkm(r.status) }}</div>
                        </div>
                      </v-chip>
                      <div class="text-caption text-medium-emphasis mt-1">
                        {{ fmtDate(r.orderDate) }} →
                        {{ fmtDate(r.eatDate) }}
                      </div>
                    </div>
                    <div class="text-right">
                      <div class="card-time">
                        {{ r.eatTimeStart || '—' }}<span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span>
                      </div>
                      <div class="text-caption text-medium-emphasis">
                        {{ orderTypeKM(r.orderType) }}
                      </div>
                    </div>
                  </div>

                  <v-divider class="my-2" />

                  <!-- requester -->
                  <div class="card-row">
                    <div class="lbl">អ្នកស្នើ</div>
                    <div class="val">
                      {{ r.employee?.name || '—' }}
                      <div class="text-caption text-medium-emphasis">
                        ID {{ r.employee?.employeeId || '—' }} • {{ r.employee?.department || '—' }}
                      </div>
                    </div>
                  </div>

                  <!-- meals / qty -->
                  <div class="card-row">
                    <div class="lbl">អាហារ</div>
                    <div class="val">
                      {{ mealListKM(r.meals) || '—' }}
                      <div class="text-caption text-medium-emphasis">
                        {{ tkm('Qty') }}: {{ r.quantity }}
                      </div>
                    </div>
                  </div>

                  <!-- special instructions -->
                  <div class="card-row" v-if="r.specialInstructions">
                    <div class="lbl">{{ tkm('Special instruction') }}</div>
                    <div class="val notes-val">
                      {{ r.specialInstructions }}
                    </div>
                  </div>

                  <!-- actions -->
                  <div class="card-actions-row">
                    <div class="mb-1">
                      <v-btn
                        v-for="s in nextSteps(r.status)"
                        :key="s"
                        size="small"
                        class="mr-1 mb-1"
                        :color="s==='CANCELED' ? 'red' : (s==='DELIVERED' ? 'green' : 'primary')"
                        variant="tonal"
                        :disabled="!r._id"
                        @click="updateStatus(r, s)"
                      >
                        <span class="en">{{ s }}</span>
                        <span class="km ml-1">{{ tkm(s) }}</span>
                      </v-btn>
                    </div>

                    <v-btn
                      size="small"
                      variant="text"
                      color="primary"
                      @click="toggleExpanded(r._id)"
                    >
                      <span class="en">{{ isExpanded(r._id) ? 'Hide details' : 'Details' }}</span>
                      <span class="km ml-1">
                        ({{ isExpanded(r._id) ? tkm('Hide details') : tkm('Details') }})
                      </span>
                    </v-btn>
                  </div>

                  <!-- details tree inside card -->
                  <v-expand-transition>
                    <div v-if="isExpanded(r._id)" class="mt-2 card-details-tree">
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
                                <div
                                  class="children"
                                  v-if="Array.from((dietaryByMenu(r).get(menuName) || new Map()).entries()).length"
                                >
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
                </v-card-text>
              </v-card>
            </div>
          </template>
        </div>

        <!-- DESKTOP/TABLET: TABLE -->
        <div v-else class="table-wrap">
          <v-table density="comfortable" class="min-width-table align-left comfy-cells row-hover">
            <thead>
              <tr>
                <th>
                  <div class="hdr-2l">
                    <div class="en">{{ tkm('Status') }}</div>
                    <div class="km">{{ tkm('Status') }}</div>
                  </div>
                </th>
                <th style="width:320px;">
                  <div class="hdr-2l">
                    <div class="en">Actions</div>
                    <div class="km">{{ tkm('Actions') }}</div>
                  </div>
                </th>
                <th>
                  <div class="hdr-2l">
                    <div class="en">Requester (ID & Name)</div>
                    <div class="km">{{ tkm('Requester (ID & Name)') }}</div>
                  </div>
                </th>
                <th>
                  <div class="hdr-2l">
                    <div class="en">Order Date</div>
                    <div class="km">{{ tkm('Order Date') }}</div>
                  </div>
                </th>
                <th>
                  <div class="hdr-2l">
                    <div class="en">Eat Date</div>
                    <div class="km">{{ tkm('Eat Date') }}</div>
                  </div>
                </th>
                <th>
                  <div class="hdr-2l">
                    <div class="en">Time</div>
                    <div class="km">{{ tkm('Time') }}</div>
                  </div>
                </th>
                <th class="d-none d-sm-table-cell">
                  <div class="hdr-2l">
                    <div class="en">Dept</div>
                    <div class="km">{{ tkm('Dept') }}</div>
                  </div>
                </th>
                <th class="d-none d-md-table-cell">
                  <div class="hdr-2l">
                    <div class="en">Order Type</div>
                    <div class="km">{{ tkm('Type') }}</div>
                  </div>
                </th>
                <th>
                  <div class="hdr-2l">
                    <div class="en">Meals</div>
                    <div class="km">អាហារ</div>
                  </div>
                </th>
                <th>
                  <div class="hdr-2l">
                    <div class="en">Qty</div>
                    <div class="km">{{ tkm('Qty') }}</div>
                  </div>
                </th>
              </tr>
            </thead>

            <tbody>
              <template v-for="r in pagedRows" :key="r._id">
                <tr
                  :data-id="r._id"
                  :class="{ 'focused-row': r._id === focusedRowId }"
                >
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
                        style="height: 35px;"
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
                    </div>
                  </td>

                  <td>{{ fmtDate(r.orderDate) }}</td>
                  <td>{{ fmtDate(r.eatDate) }}</td>

                  <td>
                    <div class="cell-2l">
                      <div class="en">
                        {{ r.eatTimeStart || '—' }}
                        <span v-if="r.eatTimeEnd"> – {{ r.eatTimeEnd }}</span>
                      </div>
                    </div>
                  </td>

                  <td class="d-none d-sm-table-cell">{{ r.employee?.department || '—' }}</td>
                  <td class="d-none d-md-table-cell">
                    <div class="cell-2l">
                      <div class="en">{{ r.orderType }}</div>
                      <div class="km">{{ orderTypeKM(r.orderType) }}</div>
                    </div>
                  </td>
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
        <v-pagination
          v-if="perPage !== 'All'"
          v-model="page"
          :length="totalPages"
          :total-visible="7"
          density="comfortable"
        />
      </div>
    </v-card>
  </v-container>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@400;500;600;700&display=swap');
.table-wrap{ overflow-x:auto; display:block; }

/* Tighter inputs */
:deep(.v-field__input){ min-height: 36px; }

/* Table min widths; shrink on phones */
.min-width-table th,.min-width-table td{ min-width:120px; white-space:nowrap; }
@media (max-width: 600px){
  .min-width-table th,.min-width-table td{ min-width: 90px; }
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

/* Display utility */
.d-none{ display:none !important; }
@media (min-width: 600px){ .d-sm-table-cell{ display: table-cell !important; } }
@media (min-width: 960px){ .d-md-table-cell{ display: table-cell !important; } }

/* Khmer font helper */
.km{
  font-family: 'Kantumruy Pro', system-ui, -apple-system, Segoe UI, Roboto,
               'Helvetica Neue', Arial, 'Noto Sans Khmer', sans-serif;
}

/* ---------- Focus row from calendar ---------- */
.focused-row{
  background: rgba(56,189,248,0.18) !important;
}
.focused-row td{
  box-shadow: inset 0 0 0 1px rgba(14,165,233,0.9);
}

/* ---------- Left alignment + comfy spacing + hover ---------- */
.align-left :deep(table thead th),
.align-left :deep(table tbody td){ text-align: left !important; }

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
.min-width-table :deep(td > *){ justify-content: flex-start !important; text-align: left !important; }

/* ---------- HERO (gradient filters like Driver/Messenger) ---------- */
.chef-shell{
  overflow: hidden;
  font-family: 'Kantumruy Pro', system-ui, -apple-system, Segoe UI, Roboto,
               'Helvetica Neue', Arial, 'Noto Sans Khmer', sans-serif;
}
.chef-hero{
  display:flex;
  align-items:flex-end;
  justify-content:flex-start;
  flex-wrap:wrap;
  gap:12px;
  padding:14px 18px;
  background: linear-gradient(90deg, #0f719e 0%, #b3b4df 60%, #ae9aea 100%);
  color:#0f172a;
  border-bottom:1px solid rgba(0, 0, 0, 0.28);
}
.fh-field{
  min-width: 200px;
  flex: 1 1 150px;
}
.fh-search{
  min-width: 220px;
  max-width: 260px;
}
.fh-status{
  max-width: 180px;
}
.fh-date{
  max-width: 160px;
}
.hero-actions{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:6px;
  flex: 0 0 auto;
}
@media (max-width: 960px){
  .chef-hero{
    flex-direction:column;
    align-items:stretch;
  }
  .fh-field{
    min-width:0;
    width:100%;
    max-width:100%;
    flex:1 1 100%;
  }
  .hero-actions{
    justify-content:flex-start;
    flex-wrap:wrap;
  }
}

/* ---------- MOBILE CARD LAYOUT ---------- */
.chef-mobile-wrap{
  padding: 8px 8px 4px;
}
.chef-card-list{
  display:flex;
  flex-direction:column;
  gap:10px;
}
.chef-card{
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
  min-width:82px;
  font-size:.78rem;
  color:#64748b;
  padding-top:2px;
}
.card-row .val{
  font-weight:500;
  font-size:.9rem;
}
.notes-val{
  white-space: pre-wrap;
}
.card-actions-row{
  margin-top:10px;
  display:flex;
  flex-direction:column;
  gap:4px;
}
.card-details-tree{
  margin-top:4px;
}
</style>
