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
    class="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-3"
  >
    <!-- 🔔 Toast stack -->
    <div class="fixed top-3 right-3 z-50 flex flex-col gap-2 max-w-xs text-xs">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="rounded-xl border px-3 py-2 shadow-lg bg-slate-900/95 flex gap-2"
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
          <p class="leading-snug">
            {{ t.message }}
          </p>
        </div>
        <button
          type="button"
          class="ml-1 opacity-70 hover:opacity-100"
          @click="removeToast(t.id)"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Card -->
    <div
      class="w-full max-w-sm bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl backdrop-blur-md p-6 sm:p-7"
    >
      <!-- Header -->
      <div class="flex flex-col items-center mb-4">
        <div
          class="h-12 w-12 rounded-2xl bg-[oklch(60%_0.118_184.704)] flex items-center justify-center shadow-md mb-2"
        >
          <font-awesome-icon icon="user" class="text-slate-950 text-xl" />
        </div>
        <h1 class="text-lg sm:text-xl font-bold tracking-wide">
          Admin Sign In
        </h1>
        <p class="mt-1 text-[11px] text-slate-400 text-center">
          Admin • Chef • Driver • Messenger • Leave
        </p>
      </div>

      <!-- Form -->
      <form @submit.prevent="submit" class="space-y-3">
        <!-- Login ID -->
        <div class="space-y-1">
          <label class="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Login ID
          </label>
          <div class="relative">
            <span
              class="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 text-xs"
            >
              <font-awesome-icon icon="user" />
            </span>
            <input
              v-model="loginId"
              type="text"
              autocomplete="username"
              class="block w-full bg-slate-900/60 border border-slate-700 rounded-xl py-2 pl-8 pr-3
                     text-[16px] leading-tight
                     outline-none text-slate-100 placeholder-slate-500
                     focus:ring-2 focus:ring-[oklch(60%_0.118_184.704)]/80 focus:border-[oklch(60%_0.118_184.704)] transition"
              placeholder="Enter your login ID"
            />
          </div>
        </div>

        <!-- Password -->
        <div class="space-y-1">
          <label class="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Password
          </label>
          <div class="relative">
            <input
              v-model="password"
              :type="showPwd ? 'text' : 'password'"
              autocomplete="current-password"
              class="block w-full bg-slate-900/60 border border-slate-700 rounded-xl py-2 px-3 pr-18
                     text-[16px] leading-tight
                     outline-none text-slate-100 placeholder-slate-500
                     focus:ring-2 focus:ring-[oklch(60%_0.118_184.704)]/80 focus:border-[oklch(60%_0.118_184.704)] transition"
              placeholder="••••••••"
              @keydown="onCapsCheck"
              @keyup="onCapsCheck"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-0 px-3 text-[11px] font-semibold text-[oklch(80%_0.118_184.704)] hover:text-white uppercase tracking-wide"
              @click="showPwd = !showPwd"
            >
              {{ showPwd ? 'Hide' : 'Show' }}
            </button>
          </div>
          <p
            v-if="capsOn"
            class="text-[11px] text-amber-300 mt-0.5 flex items-center gap-1"
          >
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-amber-300" />
            Caps Lock is ON
          </p>
        </div>

        <!-- Submit button -->
        <button
          type="submit"
          :disabled="loading"
          class="mt-2 inline-flex w-full items-center justify-center rounded-xl
                 bg-[oklch(60%_0.118_184.704)] text-slate-950 font-semibold text-sm py-2
                 shadow-[0_10px_25px_rgba(15,118,110,0.5)]
                 hover:bg-[oklch(65%_0.118_184.704)] hover:shadow-[0_14px_35px_rgba(15,118,110,0.6)]
                 disabled:opacity-60 disabled:cursor-not-allowed
                 transition-transform duration-150 active:scale-[0.98]"
        >
          <span class="inline-flex items-center gap-2">
            <font-awesome-icon icon="right-to-bracket" class="text-sm" />
            <span>{{ loading ? 'Logging in...' : 'Login' }}</span>
            <span
              v-if="loading"
              class="h-3 w-3 border-2 border-slate-900/40 border-t-slate-900 rounded-full animate-spin"
            />
          </span>
        </button>
      </form>

      <!-- Footer -->
      <p class="mt-4 text-[10px] text-center text-slate-500">
        Trax Apparel Cambodia
      </p>
    </div>
  </div>
</template>
