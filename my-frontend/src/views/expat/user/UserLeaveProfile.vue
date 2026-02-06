<!-- src/views/expat/user/UserLeaveProfile.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import UserLeavePreviewModal from '@/views/expat/user/components/UserLeavePreviewModal.vue'

defineOptions({ name: 'UserLeaveProfile' })

const auth = useAuth()
const { showToast } = useToast()

const loading = ref(false)
const error = ref('')
const profile = ref(null)
const meta = ref({ contracts: [] })

const previewOpen = ref(false)

const contracts = computed(() => (Array.isArray(meta.value?.contracts) ? meta.value.contracts : []))

const meForPreview = computed(() => ({
  employeeId: profile.value?.employeeId || auth.user?.employeeId || auth.user?.id || auth.user?.loginId,
  name: profile.value?.name || auth.user?.name,
  department: profile.value?.department,
  joinDate: profile.value?.joinDate,
  contractDate: profile.value?.contractDate,
  contractEndDate: profile.value?.contractEndDate,
}))

async function fetchProfile() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await api.get('/leave/user/profile', { params: { ts: Date.now() } })
    profile.value = data?.profile || null
    meta.value = data?.meta || { contracts: [] }
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to load profile.'
    showToast({ type: 'error', title: 'Profile failed', message: error.value })
  } finally {
    loading.value = false
  }
}

onMounted(fetchProfile)
</script>

<template>
  <div class="w-full min-h-[calc(100vh-56px)] px-2 sm:px-3 py-2 space-y-3">
    <!-- Header card -->
    <div
      class="rounded-2xl border border-slate-200 bg-gradient-to-r from-amber-50 via-white to-emerald-50
             p-4 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-[14px] font-bold text-slate-900 dark:text-slate-50">
            My Leave Profile
          </div>
          <div class="mt-0.5 text-[12px] text-slate-600 dark:text-slate-400">
            {{ profile?.name || auth.user?.name || auth.user?.loginId || 'User' }}
            <span class="mx-1">·</span>
            {{ profile?.department || '—' }}
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800
                   dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 disabled:opacity-60"
            :disabled="loading"
            @click="fetchProfile"
          >
            <i class="fa-solid fa-rotate-right text-[11px]" />
            Refresh
          </button>

          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50
                   dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900 disabled:opacity-60"
            :disabled="loading || !profile"
            @click="previewOpen = true"
          >
            <i class="fa-solid fa-eye text-[11px]" />
            Preview Record (PDF)
          </button>
        </div>
      </div>

      <div v-if="error" class="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
        {{ error }}
      </div>
    </div>

    <!-- Body -->
    <div class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      <div v-if="loading" class="py-8 text-center text-[12px] text-slate-500 dark:text-slate-400">
        Loading...
      </div>
      <div v-else class="text-[12px] text-slate-700 dark:text-slate-200">
        <!-- keep your existing profile UI here -->
        <div class="text-[11px] text-slate-500 dark:text-slate-400">
          Contracts: {{ contracts.length }}
        </div>
      </div>
    </div>

    <!-- Preview Modal -->
    <UserLeavePreviewModal
      :open="previewOpen"
      :me="meForPreview"
      :contracts="contracts"
      @close="previewOpen = false"
    />
  </div>
</template>
