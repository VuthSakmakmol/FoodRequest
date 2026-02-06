<!-- src/views/expat/gm/GmTeamLeaveProfiles.vue
  ✅ GM list: only employees where gmLoginId = me AND approvalMode = GM_ONLY
-->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { subscribeUserIfNeeded, onSocket } from '@/utils/socket'
import { useAuth } from '@/store/auth'

defineOptions({ name: 'GmTeamLeaveProfiles' })

const router = useRouter()
const { showToast } = useToast()
const auth = useAuth()

const s = (v) => String(v ?? '').trim()
const ymd = (v) => {
  const t = s(v)
  if (!t) return ''
  const d = dayjs(t)
  return d.isValid() ? d.format('YYYY-MM-DD') : t
}

const ui = {
  wrap: 'w-full min-h-screen px-4 sm:px-6 py-5 bg-slate-950 text-slate-100',
  card: 'rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur',
  th: 'px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-300 whitespace-nowrap',
  td: 'px-3 py-2.5 text-[12px] text-slate-100 align-middle',
  table: 'min-w-full border-collapse text-[12px] table-fixed',
  input:
    'h-9 w-full rounded-xl border border-slate-700 bg-slate-950/40 px-3 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-slate-500 focus:ring-2 focus:ring-slate-800/60',
  btn: 'inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold',
  btnGhost:
    'border border-slate-700 bg-slate-950/40 hover:bg-slate-900/60 text-slate-100 disabled:opacity-60 disabled:cursor-not-allowed',
}

const loading = ref(false)
const error = ref('')
const rows = ref([])
const q = ref('')

const filtered = computed(() => {
  const kw = s(q.value).toLowerCase()
  if (!kw) return rows.value
  return rows.value.filter((r) => `${r.employeeId} ${r.name} ${r.department}`.toLowerCase().includes(kw))
})

async function fetchRows() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.get('/leave/user/profile/gm-managed', { params: { ts: Date.now() } })
    rows.value = Array.isArray(res?.data?.rows) ? res.data.rows : []
  } catch (e) {
    console.error('fetch gm rows error', e)
    error.value = e?.response?.data?.message || e?.message || 'Failed to load staff profiles.'
    showToast({ type: 'error', title: 'Failed', message: error.value })
  } finally {
    loading.value = false
  }
}

function openProfile(r) {
  router.push({ name: 'TeamEmployeeLeaveProfile', params: { employeeId: s(r.employeeId) } })
}

const off = []
onMounted(async () => {
  await fetchRows()

  const myLoginId = s(auth.user?.loginId || auth.user?.id || localStorage.getItem('loginId') || '')
  if (myLoginId) subscribeUserIfNeeded(myLoginId)

  off.push(
    onSocket('leave:profile', () => fetchRows()),
    onSocket('leave:request', () => fetchRows())
  )
})
onBeforeUnmount(() => off.forEach((fn) => fn && fn()))
</script>

<template>
  <div :class="ui.wrap">
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="text-[22px] font-black">My GM Staff Leave Profiles</div>
        <div class="text-[12px] text-slate-400">GM view · Only approvalMode = GM_ONLY</div>
      </div>

      <button :class="[ui.btn, ui.btnGhost]" :disabled="loading" @click="fetchRows">
        <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
        Refresh
      </button>
    </div>

    <div class="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
      <div :class="ui.card" class="p-4 lg:col-span-2">
        <div class="text-[12px] font-extrabold">Search</div>
        <div class="mt-2">
          <input v-model="q" :class="ui.input" placeholder="Search by Employee ID, name, department..." />
        </div>
      </div>

      <div :class="ui.card" class="p-4">
        <div class="text-[12px] font-extrabold">Total</div>
        <div class="mt-2 text-[26px] font-black">{{ filtered.length }}</div>
        <div class="text-[11px] text-slate-400">Staff under you</div>
      </div>
    </div>

    <div v-if="error" class="mt-3 rounded-xl border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-[12px] text-rose-100">
      <b>Failed:</b> {{ error }}
    </div>

    <div class="mt-4" :class="ui.card">
      <div class="overflow-x-auto">
        <table class="min-w-full border-collapse text-[12px] table-fixed">
          <colgroup>
            <col style="width: 140px" />
            <col style="width: 240px" />
            <col />
            <col style="width: 220px" />
            <col style="width: 140px" />
          </colgroup>

          <thead class="border-b border-slate-800 bg-slate-950/40">
            <tr>
              <th class="px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-300 whitespace-nowrap">Employee</th>
              <th class="px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-300 whitespace-nowrap">Name</th>
              <th class="px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-300 whitespace-nowrap">Department</th>
              <th class="px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-300 whitespace-nowrap">Contract</th>
              <th class="px-3 py-2 text-right text-[11px] font-extrabold uppercase tracking-wide text-slate-300 whitespace-nowrap">Action</th>
            </tr>
          </thead>

          <tbody>
            <tr v-for="r in filtered" :key="r.employeeId" class="border-b border-slate-800 hover:bg-slate-950/40">
              <td class="px-3 py-2.5 text-[12px] text-slate-100 align-middle font-mono font-bold">{{ r.employeeId }}</td>
              <td class="px-3 py-2.5 text-[12px] text-slate-100 align-middle font-semibold">{{ r.name || '—' }}</td>
              <td class="px-3 py-2.5 text-[12px] text-slate-100 align-middle">{{ r.department || '—' }}</td>
              <td class="px-3 py-2.5 text-[12px] text-slate-100 align-middle font-mono text-[11px] text-slate-300">
                {{ ymd(r.contractDate) || '—' }} → {{ ymd(r.contractEndDate) || '—' }}
              </td>
              <td class="px-3 py-2.5 text-[12px] text-slate-100 align-middle text-right">
                <button :class="[ui.btn, ui.btnGhost]" @click="openProfile(r)">
                  <i class="fa-solid fa-id-card text-[11px]" />
                  Open
                </button>
              </td>
            </tr>

            <tr v-if="!filtered.length && !loading">
              <td colspan="5" class="py-10 text-center text-[12px] text-slate-400">
                No GM_ONLY staff found under your GM account.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
