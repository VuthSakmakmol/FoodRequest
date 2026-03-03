<!-- src/views/auth/ChangePassword.vue
  ✅ STRICT IT POLICY
  - New password MUST:
    ✅ min 13 chars
    ✅ uppercase
    ✅ lowercase
    ✅ number
    ✅ symbol
    ✅ no spaces
  - Realtime checklist while typing
  - Confirm must match
  - Submit disabled until all pass
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

/* ───────────────── password policy (realtime) ───────────────── */
const policy = computed(() => {
  const s = String(newPassword.value || '')

  const rules = {
    minLen: s.length >= 13,
    upper: /[A-Z]/.test(s),
    lower: /[a-z]/.test(s),
    number: /[0-9]/.test(s),
    symbol: /[^A-Za-z0-9]/.test(s),
    noSpace: !/\s/.test(s),
  }

  const ok = Object.values(rules).every(Boolean)
  return { rules, ok }
})

const confirmOk = computed(() => {
  if (!confirmPassword.value) return false
  return newPassword.value === confirmPassword.value
})

const diffOk = computed(() => {
  if (!oldPassword.value || !newPassword.value) return true
  return oldPassword.value !== newPassword.value
})

const showPolicyBox = computed(() => {
  // show once user starts typing new password or confirm
  return !!newPassword.value || !!confirmPassword.value
})

const canSubmit = computed(() => {
  if (!oldPassword.value || !newPassword.value || !confirmPassword.value) return false
  if (!diffOk.value) return false
  if (!policy.value.ok) return false
  if (!confirmOk.value) return false
  return true
})

const errorText = computed(() => {
  if (!oldPassword.value && !newPassword.value && !confirmPassword.value) return ''
  if (oldPassword.value && newPassword.value && !diffOk.value) return 'New password must be different from old password.'
  if (showPolicyBox.value && !policy.value.ok) return 'New password does not meet IT policy.'
  if (confirmPassword.value && !confirmOk.value) return 'Confirm password does not match.'
  return ''
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
      'Password update failed.'

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

/* small helper for policy row UI */
function rowClass(ok) {
  return ok
    ? 'text-emerald-700 dark:text-emerald-300'
    : 'text-slate-600 dark:text-slate-300'
}
function iconClass(ok) {
  return ok ? 'fa-circle-check' : 'fa-circle'
}
</script>

<template>
  <div class="ui-page">
    <div class="mx-auto w-full max-w-xl px-3 sm:px-0">
      <div class="ui-card overflow-hidden">
        <!-- Header -->
        <div class="px-5 sm:px-7 py-5 sm:py-6 border-b" style="border-color: rgb(var(--ui-border))">
          <div
            class="rounded-3xl px-5 sm:px-6 py-4 sm:py-5 border
                   bg-gradient-to-r from-sky-50 via-white to-emerald-50
                   dark:from-slate-900/40 dark:via-slate-950/30 dark:to-emerald-950/20"
            style="border-color: rgb(var(--ui-border))"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="flex items-center gap-4 min-w-0">
                <div
                  class="grid h-12 w-12 place-items-center rounded-3xl border bg-white/70 dark:bg-slate-950/40"
                  style="border-color: rgb(var(--ui-border))"
                >
                  <i class="fa-solid fa-key text-[15px] text-sky-700 dark:text-sky-200"></i>
                </div>

                <div class="min-w-0">
                  <div class="truncate text-[16px] font-extrabold text-slate-900 dark:text-slate-50">
                    Change Password
                  </div>
                  <div class="truncate text-[12px] text-slate-600 dark:text-slate-300">
                    Follow IT policy to update your password
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

                <button
                  type="button"
                  class="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center
                         rounded-xl border bg-white/60 text-slate-600 hover:bg-slate-100 hover:text-slate-800
                         dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-800/60"
                  style="border-color: rgb(var(--ui-border))"
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

                  <button
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center
                           rounded-xl border bg-white/60 text-slate-600 hover:bg-slate-100 hover:text-slate-800
                           dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-800/60"
                    style="border-color: rgb(var(--ui-border))"
                    @click="showNew = !showNew"
                    :disabled="loading"
                    aria-label="Toggle new password visibility"
                  >
                    <i class="fa-solid text-[11px]" :class="showNew ? 'fa-eye-slash' : 'fa-eye'"></i>
                  </button>
                </div>

                <div class="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Min 13 chars + upper/lower/number/symbol
                </div>
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

                  <button
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center
                           rounded-xl border bg-white/60 text-slate-600 hover:bg-slate-100 hover:text-slate-800
                           dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-800/60"
                    style="border-color: rgb(var(--ui-border))"
                    @click="showConfirm = !showConfirm"
                    :disabled="loading"
                    aria-label="Toggle confirm password visibility"
                  >
                    <i class="fa-solid text-[11px]" :class="showConfirm ? 'fa-eye-slash' : 'fa-eye'"></i>
                  </button>
                </div>
              </div>
            </div>

            <!-- ✅ IT Policy checklist (realtime) -->
            <div v-if="showPolicyBox" class="rounded-2xl border bg-white/60 p-4 dark:bg-slate-950/20"
                 style="border-color: rgb(var(--ui-border))">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-[12px] font-extrabold text-slate-800 dark:text-slate-100">
                    IT Password Policy
                  </div>
                </div>

                <div
                  class="shrink-0 inline-flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-[11px]
                         bg-white/70 dark:bg-slate-950/30"
                  style="border-color: rgb(var(--ui-border))"
                >
                  <i class="fa-solid" :class="policy.ok ? 'fa-shield-check text-emerald-600 dark:text-emerald-300' : 'fa-shield text-slate-500 dark:text-slate-300'"></i>
                  <span class="font-semibold" :class="policy.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'">
                    {{ policy.ok ? 'Policy OK' : 'Not yet' }}
                  </span>
                </div>
              </div>

              <div class="mt-3 grid gap-2 sm:grid-cols-2">
                <div class="flex items-center gap-2 text-[12px]" :class="rowClass(policy.rules.minLen)">
                  <i class="fa-solid text-[13px]" :class="iconClass(policy.rules.minLen)"></i>
                  <span>At least 13 characters</span>
                </div>

                <div class="flex items-center gap-2 text-[12px]" :class="rowClass(policy.rules.noSpace)">
                  <i class="fa-solid text-[13px]" :class="iconClass(policy.rules.noSpace)"></i>
                  <span>No spaces</span>
                </div>

                <div class="flex items-center gap-2 text-[12px]" :class="rowClass(policy.rules.upper)">
                  <i class="fa-solid text-[13px]" :class="iconClass(policy.rules.upper)"></i>
                  <span>1 uppercase (A-Z)</span>
                </div>

                <div class="flex items-center gap-2 text-[12px]" :class="rowClass(policy.rules.lower)">
                  <i class="fa-solid text-[13px]" :class="iconClass(policy.rules.lower)"></i>
                  <span>1 lowercase (a-z)</span>
                </div>

                <div class="flex items-center gap-2 text-[12px]" :class="rowClass(policy.rules.number)">
                  <i class="fa-solid text-[13px]" :class="iconClass(policy.rules.number)"></i>
                  <span>1 number (0-9)</span>
                </div>

                <div class="flex items-center gap-2 text-[12px]" :class="rowClass(policy.rules.symbol)">
                  <i class="fa-solid text-[13px]" :class="iconClass(policy.rules.symbol)"></i>
                  <span>1 symbol (!@#...)</span>
                </div>

                <div class="sm:col-span-2 flex items-center gap-2 text-[12px]" :class="rowClass(diffOk)">
                  <i class="fa-solid text-[13px]" :class="iconClass(diffOk)"></i>
                  <span>Different from current password</span>
                </div>

                <div class="sm:col-span-2 flex items-center gap-2 text-[12px]" :class="rowClass(confirmOk)">
                  <i class="fa-solid text-[13px]" :class="iconClass(confirmOk)"></i>
                  <span>Confirm matches</span>
                </div>
              </div>
            </div>

            <!-- Validation (top-level) -->
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