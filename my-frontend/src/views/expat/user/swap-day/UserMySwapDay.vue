<script setup>
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useRouter } from 'vue-router'

defineOptions({ name: 'UserMySwapDay' })

const { showToast } = useToast()
const router = useRouter()

const loading = ref(false)
const rows = ref([])
const search = ref('')
const statusFilter = ref('ALL')

const STATUS_LABEL = {
  ALL: 'All',
  PENDING_MANAGER: 'Pending (Mgr)',
  PENDING_GM: 'Pending (GM)',
  PENDING_COO: 'Pending (COO)',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

function statusBadgeUiClass(s) {
  const st = String(s || '').toUpperCase()
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'CANCELLED') return 'ui-badge'
  if (st.includes('PENDING')) return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

async function fetchData() {
  try {
    loading.value = true
    const res = await api.get('/leave/swap-working-day/my')
    rows.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    showToast({
      type: 'error',
      message: e?.response?.data?.message || 'Failed to load swap requests'
    })
  } finally {
    loading.value = false
  }
}

async function cancelRequest(item) {
  try {
    await api.post(`/leave/swap-working-day/${item._id}/cancel`)
    showToast({ type: 'success', message: 'Swap request cancelled.' })
    fetchData()
  } catch (e) {
    showToast({
      type: 'error',
      message: e?.response?.data?.message || 'Cancel failed.'
    })
  }
}

const filteredRows = computed(() => {
  let result = [...rows.value]

  if (statusFilter.value !== 'ALL') {
    result = result.filter(r => r.status === statusFilter.value)
  }

  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    result = result.filter(r =>
      (r.reason || '').toLowerCase().includes(q) ||
      (r.status || '').toLowerCase().includes(q)
    )
  }

  return result
})

onMounted(fetchData)
</script>

<template>
  <div class="ui-page">
    <div class="ui-container py-2">
      <div class="ui-card overflow-hidden">

        <!-- Hero -->
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">

            <div>
              <div class="text-sm font-extrabold">My Swap Working Day</div>
            </div>

            <div class="grid w-full gap-2 md:w-auto md:grid-cols-[260px_220px_auto] md:items-end">

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Search</label>
                <div class="flex items-center rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px]">
                  <i class="fa-solid fa-magnifying-glass mr-2 text-white/80" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Reason or status..."
                    class="w-full bg-transparent text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Status</label>
                <select
                  v-model="statusFilter"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px] text-white outline-none"
                >
                  <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">
                    {{ label }}
                  </option>
                </select>
              </div>

              <button
                type="button"
                class="ui-btn ui-btn-primary"
                @click="router.push({ name: 'leave-user-swap-day-new' })"
              >
                <i class="fa-solid fa-plus text-[11px]" />
                New Request
              </button>
            </div>
          </div>
        </div>

        <!-- Body -->
        <div class="p-3">

          <div v-if="loading" class="ui-skeleton h-14 w-full" />

          <div v-else-if="!filteredRows.length" class="ui-frame p-4 text-center text-[12px] text-slate-500">
            No swap requests found.
          </div>

          <!-- Desktop table -->
          <div v-else class="ui-table-wrap">
            <table class="ui-table">
              <thead>
                <tr>
                  <th class="ui-th">Created</th>
                  <th class="ui-th">Work Date</th>
                  <th class="ui-th">Swap Date</th>
                  <th class="ui-th">Status</th>
                  <th class="ui-th">Reason</th>
                  <th class="ui-th">Actions</th>
                </tr>
              </thead>

              <tbody>
                <tr v-for="item in filteredRows" :key="item._id" class="ui-tr-hover">
                  <td class="ui-td">
                    {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                  </td>

                  <td class="ui-td font-mono">
                    {{ item.originalDate }}
                  </td>

                  <td class="ui-td font-mono">
                    {{ item.swapDate }}
                  </td>

                  <td class="ui-td">
                    <span :class="statusBadgeUiClass(item.status)">
                      {{ STATUS_LABEL[item.status] || item.status }}
                    </span>
                  </td>

                  <td class="ui-td text-left truncate">
                    {{ item.reason || '—' }}
                  </td>

                  <td class="ui-td">
                    <div class="flex items-center gap-2">
                      <button
                        v-if="item.status?.includes('PENDING')"
                        class="ui-btn ui-btn-soft ui-btn-xs"
                        @click="router.push({ name:'leave-user-swap-day-edit', params:{ id:item._id } })"
                      >
                        Edit
                      </button>

                      <button
                        v-if="item.status?.includes('PENDING')"
                        class="ui-btn ui-btn-rose ui-btn-xs"
                        @click="cancelRequest(item)"
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>