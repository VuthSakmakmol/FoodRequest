<!-- src/views/auth/ChangePassword.vue
  ✅ Compact + premium header
  ✅ MORE padding (as requested)
  ✅ Eye buttons smaller (h-8 w-8 + icon text-[11px])
  ✅ Responsive: max-w-xl, mobile stacks, desktop 2 cols
  ✅ Calls: POST /api/auth/change-password
  ✅ Success: toast + logout + redirect login
-->
<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import api from '@/utils/api'
import { useAuth } from '@/store/auth'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'ChangePassword' })

const router = useRouter()
const route = useRoute()
const auth = useAuth()
const { showToast } = useToast()

const loading = ref(false)

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

const showOld = ref(false)
const showNew = ref(false)
const showConfirm = ref(false)

const isLeavePortal = computed(() => String(route.path || '').startsWith('/leave'))

const errorText = computed(() => {
  if (!oldPassword.value && !newPassword.value && !confirmPassword.value) return ''
  if (newPassword.value && newPassword.value.length < 8) return 'New password must be at least 8 characters.'
  if (newPassword.value && confirmPassword.value && newPassword.value !== confirmPassword.value)
    return 'Confirm password does not match.'
  if (oldPassword.value && newPassword.value && oldPassword.value === newPassword.value)
    return 'New password must be different from old password.'
  return ''
})

const canSubmit = computed(() => {
  if (!oldPassword.value || !newPassword.value || !confirmPassword.value) return false
  if (newPassword.value.length < 8) return false
  if (newPassword.value !== confirmPassword.value) return false
  if (oldPassword.value === newPassword.value) return false
  return true
})

function clearForm() {
  oldPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
}

async function submit() {
  if (!canSubmit.value) {
    showToast({
      type: 'warning',
      message: errorText.value || 'Please complete the form.',
    })
    return
  }

  loading.value = true
  try {
    await api.post('/auth/change-password', {
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    })

    showToast({
      type: 'success',
      message: 'Password updated. Please login again.',
    })

    auth.logout?.()
    clearForm()
    await router.replace({ name: isLeavePortal.value ? 'leave-login' : 'admin-login' })
  } catch (e) {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.error ||
      e?.message ||
      'Old password is incorrect.'

    showToast({
      type: 'error',
      message: String(msg),
    })
  } finally {
    loading.value = false
  }
}

function back() {
  const b = route.query?.back
  if (b) return router.push(String(b))
  router.back()
}
</script>

<template>
  <div class="ui-page">
    <div class="mx-auto w-full max-w-xl px-3 sm:px-0">
      <div class="ui-card overflow-hidden">
        <!-- Header -->
        <div class="px-5 sm:px-7 py-5 sm:py-6 border-b" style="border-color: rgb(var(--ui-border));">
          <div
            class="rounded-3xl px-5 sm:px-6 py-4 sm:py-5 border
                   bg-gradient-to-r from-sky-50 via-white to-emerald-50
                   dark:from-slate-900/40 dark:via-slate-950/30 dark:to-emerald-950/20"
            style="border-color: rgb(var(--ui-border));"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="flex items-center gap-4 min-w-0">
                <div
                  class="grid h-12 w-12 place-items-center rounded-3xl border bg-white/70 dark:bg-slate-950/40"
                  style="border-color: rgb(var(--ui-border));"
                >
                  <i class="fa-solid fa-key text-[15px] text-sky-700 dark:text-sky-200"></i>
                </div>

                <div class="min-w-0">
                  <div class="truncate text-[16px] font-extrabold text-slate-900 dark:text-slate-50">
                    Change Password
                  </div>
                  <div class="truncate text-[12px] text-slate-600 dark:text-slate-300">
                    Verify current password to continue
                  </div>
                </div>
              </div>

              <button class="ui-btn ui-btn-ghost h-9 px-4 text-[12px]" type="button" @click="back">
                <i class="fa-solid fa-arrow-left mr-2"></i>
                Back
              </button>
            </div>
          </div>
        </div>

        <!-- Body -->
        <div class="ui-card-body !p-5 sm:!p-7">
          <div class="space-y-5">
            <!-- Current password -->
            <div>
              <label class="ui-label text-[11px] tracking-wide uppercase text-slate-500 dark:text-slate-400">
                Current password
              </label>

              <div class="relative mt-1.5">
                <input
                  class="ui-input pr-12"
                  :type="showOld ? 'text' : 'password'"
                  v-model="oldPassword"
                  autocomplete="current-password"
                  placeholder="Enter current password"
                  :disabled="loading"
                />

                <!-- ✅ Smaller eye button -->
                <button
                  type="button"
                  class="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center
                         rounded-xl border bg-white/60 text-slate-600 hover:bg-slate-100 hover:text-slate-800
                         dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-800/60"
                  style="border-color: rgb(var(--ui-border));"
                  @click="showOld = !showOld"
                  :disabled="loading"
                  aria-label="Toggle current password visibility"
                >
                  <i class="fa-solid text-[11px]" :class="showOld ? 'fa-eye-slash' : 'fa-eye'"></i>
                </button>
              </div>
            </div>

            <!-- New + Confirm -->
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="ui-label text-[11px] tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  New password
                </label>

                <div class="relative mt-1.5">
                  <input
                    class="ui-input pr-12"
                    :type="showNew ? 'text' : 'password'"
                    v-model="newPassword"
                    autocomplete="new-password"
                    placeholder="New password"
                    :disabled="loading"
                  />

                  <!-- ✅ Smaller eye button -->
                  <button
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center
                           rounded-xl border bg-white/60 text-slate-600 hover:bg-slate-100 hover:text-slate-800
                           dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-800/60"
                    style="border-color: rgb(var(--ui-border));"
                    @click="showNew = !showNew"
                    :disabled="loading"
                    aria-label="Toggle new password visibility"
                  >
                    <i class="fa-solid text-[11px]" :class="showNew ? 'fa-eye-slash' : 'fa-eye'"></i>
                  </button>
                </div>

                <div class="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">Min 8 characters</div>
              </div>

              <div>
                <label class="ui-label text-[11px] tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  Confirm
                </label>

                <div class="relative mt-1.5">
                  <input
                    class="ui-input pr-12"
                    :type="showConfirm ? 'text' : 'password'"
                    v-model="confirmPassword"
                    autocomplete="new-password"
                    placeholder="Confirm password"
                    :disabled="loading"
                  />

                  <!-- ✅ Smaller eye button -->
                  <button
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center
                           rounded-xl border bg-white/60 text-slate-600 hover:bg-slate-100 hover:text-slate-800
                           dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-800/60"
                    style="border-color: rgb(var(--ui-border));"
                    @click="showConfirm = !showConfirm"
                    :disabled="loading"
                    aria-label="Toggle confirm password visibility"
                  >
                    <i class="fa-solid text-[11px]" :class="showConfirm ? 'fa-eye-slash' : 'fa-eye'"></i>
                  </button>
                </div>
              </div>
            </div>

            <!-- Validation -->
            <div v-if="errorText" class="ui-alert ui-alert-warn text-[12px]">
              <i class="fa-solid fa-triangle-exclamation"></i>
              <span>{{ errorText }}</span>
            </div>

            <!-- Actions -->
            <div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between pt-1">
              <div class="text-[11px] text-slate-500 dark:text-slate-400">
                You will be logged out after updating.
              </div>

              <div class="flex gap-2 sm:justify-end">
                <button
                  class="ui-btn ui-btn-ghost h-10 px-4 text-[12px]"
                  type="button"
                  @click="clearForm"
                  :disabled="loading"
                >
                  <i class="fa-solid fa-eraser mr-2"></i>
                  Clear
                </button>

                <button
                  class="ui-btn ui-btn-primary h-10 px-5 text-[12px]"
                  type="button"
                  @click="submit"
                  :disabled="loading || !canSubmit"
                >
                  <i class="fa-solid fa-key mr-2"></i>
                  <span v-if="!loading">Update</span>
                  <span v-else>Updating...</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        <!-- /Body -->
      </div>
    </div>
  </div>
</template>