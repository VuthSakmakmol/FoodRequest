<!-- src/views/admin/AdminLogin.vue -->
<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const route  = useRoute()
const auth   = useAuth()

// 🔔 shared toast system
const { toasts, showToast, removeToast } = useToast()

const loginId  = ref('')
const password = ref('')
const loading  = ref(false)

const showPwd = ref(false)
const capsOn  = ref(false)

function onCapsCheck(evt) {
  const get = evt?.getModifierState?.bind(evt)
  capsOn.value = !!(get && get('CapsLock'))
}

onMounted(() => {
  const last = localStorage.getItem('lastLoginId') || ''
  if (last) loginId.value = last
})

async function submit() {
  if (loading.value) return
  loading.value = true
  try {
    const id = loginId.value.trim()
    localStorage.setItem('lastLoginId', id)
    await auth.login(id, password.value)

    showToast({
      type: 'success',
      title: 'Success',
      message: 'Login successful.',
      timeout: 2500,
    })

    const role   = auth.user?.role
    const portal = route.meta?.portal || 'admin' // 'admin' or 'leave'

    if (portal === 'leave') {
      if (role === 'LEAVE_ADMIN' || role === 'ADMIN') {
        router.push({ name: 'leave-admin-types' })
      } else if (role === 'LEAVE_MANAGER') {
        router.push({ name: 'leave-manager-inbox' })
      } else if (role === 'LEAVE_GM') {
        router.push({ name: 'leave-gm-inbox' })
      } else if (role === 'LEAVE_USER') {
        router.push({ name: 'leave-user-request' })
      } else {
        router.push({ name: 'employee-request' })
      }
    } else {
      if (role === 'CHEF') {
        router.push({ name: 'chef-requests' })
      } else if (role === 'DRIVER') {
        router.push({ name: 'driver-car-booking' })
      } else if (role === 'MESSENGER') {
        router.push({ name: 'messenger-assignment' })
      } else {
        router.push({ name: 'admin-requests' })
      }
    }
  } catch (e) {
    const msg = e?.response?.data?.message || e.message || 'Login failed.'
    showToast({
      type: 'error',
      title: 'Error',
      message: msg,
      timeout: 5000,
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 px-4"
  >
    <!-- 🔔 Toast stack (uses global composable) -->
    <div class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-xs">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="rounded-xl border px-3.5 py-2.5 text-sm shadow-xl bg-slate-900/95 flex gap-2"
        :class="{
          'border-emerald-400/70 text-emerald-100': t.type === 'success',
          'border-red-400/70 text-red-100': t.type === 'error',
          'border-amber-400/70 text-amber-100': t.type === 'warning',
        }"
      >
        <div class="flex-1">
          <div class="font-semibold mb-0.5">
            {{ t.title || (t.type === 'success' ? 'Success' : t.type === 'error' ? 'Error' : 'Notice') }}
          </div>
          <p class="text-xs leading-snug">
            {{ t.message }}
          </p>
        </div>
        <button
          type="button"
          class="ml-1 text-xs opacity-70 hover:opacity-100"
          @click="removeToast(t.id)"
        >
          ✕
        </button>
      </div>
    </div>

    <div
      class="w-full max-w-md bg-slate-900/80 border border-slate-700/70 rounded-2xl shadow-2xl backdrop-blur-xl p-8 sm:p-10 text-slate-50"
    >
      <!-- Header -->
      <div class="flex flex-col items-center mb-6">
        <div
          class="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center shadow-lg mb-3"
        >
          <font-awesome-icon icon="user" class="text-slate-900 text-2xl" />
        </div>
        <h1 class="text-xl sm:text-2xl font-bold tracking-wide">
          Sign in
        </h1>
        <p class="mt-1 text-xs sm:text-sm text-slate-400 text-center">
          Admin • Chef • Driver • Messenger • Leave Portal
        </p>
      </div>

      <!-- Form -->
      <form @submit.prevent="submit" class="space-y-4">
        <!-- Login ID -->
        <div class="space-y-1">
          <label class="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Login ID
          </label>
          <div class="relative">
            <span
              class="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 text-sm"
            >
              <font-awesome-icon icon="user" />
            </span>
            <input
              v-model="loginId"
              type="text"
              autocomplete="username"
              class="block w-full bg-slate-900/60 border border-slate-700 rounded-xl py-2.5 pl-9 pr-3 text-sm outline-none text-slate-100 placeholder-slate-500
                     focus:ring-2 focus:ring-amber-400/80 focus:border-amber-300 transition"
              placeholder="Enter your login ID"
            />
          </div>
        </div>

        <!-- Password -->
        <div class="space-y-1">
          <label class="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Password
          </label>
          <div class="relative">
            <input
              v-model="password"
              :type="showPwd ? 'text' : 'password'"
              autocomplete="current-password"
              class="block w-full bg-slate-900/60 border border-slate-700 rounded-xl py-2.5 px-3 pr-20 text-sm outline-none text-slate-100 placeholder-slate-500
                     focus:ring-2 focus:ring-amber-400/80 focus:border-amber-300 transition"
              placeholder="••••••••"
              @keydown="onCapsCheck"
              @keyup="onCapsCheck"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-0 px-3 text-xs sm:text-[11px] font-semibold text-amber-300 hover:text-amber-200 uppercase tracking-wide"
              @click="showPwd = !showPwd"
            >
              {{ showPwd ? 'Hide' : 'Show' }}
            </button>
          </div>
          <p
            v-if="capsOn"
            class="text-[11px] text-amber-300 mt-1 flex items-center gap-1"
          >
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-amber-300" />
            Caps Lock is ON
          </p>
        </div>

        <!-- Submit button -->
        <button
          type="submit"
          :disabled="loading"
          class="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-amber-400 text-slate-900 font-semibold text-sm py-2.5
                 shadow-[0_12px_30px_rgba(245,158,11,0.45)] hover:bg-amber-300 hover:shadow-[0_16px_40px_rgba(245,158,11,0.6)]
                 disabled:opacity-60 disabled:cursor-not-allowed transition-transform duration-150 active:scale-[0.98]"
        >
          <span class="inline-flex items-center gap-2">
            <font-awesome-icon icon="home" class="text-base" />
            <span>{{ loading ? 'Logging in...' : 'Login' }}</span>
            <span
              v-if="loading"
              class="h-3 w-3 border-2 border-slate-900/40 border-t-slate-900 rounded-full animate-spin"
            />
          </span>
        </button>
      </form>

      <!-- Footer -->
      <p class="mt-6 text-[11px] text-center text-slate-500">
        © 2025 Food Request System
      </p>
    </div>
  </div>
</template>
