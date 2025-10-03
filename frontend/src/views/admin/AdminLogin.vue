<!-- frontend/src/views/admin/AdminLogin.vue -->
<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/store/auth'
import Swal from 'sweetalert2'

const router = useRouter()
const auth = useAuth()

const loginId  = ref('')
const password = ref('')
const loading  = ref(false)

const showPwd = ref(false)
const capsOn  = ref(false)

function onCapsCheck(evt) {
  // Works on keydown/keyup; safe-guarded for browsers that lack getModifierState
  const get = evt?.getModifierState?.bind(evt)
  capsOn.value = !!(get && get('CapsLock'))
}

onMounted(() => {
  // restore last used loginId (optional)
  const last = localStorage.getItem('lastLoginId') || ''
  if (last) loginId.value = last
})

async function submit() {
  loading.value = true
  try {
    const id = loginId.value.trim()
    localStorage.setItem('lastLoginId', id)
    await auth.login(id, password.value)
    await Swal.fire({ icon: 'success', title: 'Welcome', timer: 900, showConfirmButton: false })

    // Route by role
    const role = auth.user?.role
    if (role === 'DRIVER')       router.push({ name: 'driver-home' })
    else if (role === 'MESSENGER') router.push({ name: 'messenger-home' })
    else                          router.push({ name: 'admin-requests' }) // ADMIN/CHEF
  } catch (e) {
    await Swal.fire({
      icon: 'error',
      title: 'Login failed',
      text: e?.response?.data?.message || e.message
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <v-container class="d-flex align-center justify-center login-bg" style="min-height: 100vh">
    <v-card class="pa-10 login-card" max-width="440" elevation="6" rounded="xl">
      <!-- Header -->
      <div class="text-center mb-6">
        <v-avatar size="68" class="mb-3" color="primary" variant="tonal">
          <i class="fa-solid fa-user-shield fa-lg text-primary-dark"></i>
        </v-avatar>
        <div class="text-h5 font-weight-bold">Sign in</div>
        <div class="text-subtitle-2 text-grey mt-1">Admin • Chef • Driver • Messenger</div>
      </div>

      <!-- Login ID -->
      <v-text-field
        v-model="loginId"
        label="Login ID"
        variant="outlined"
        density="comfortable"
        class="mb-3"
      >
        <template #prepend-inner>
          <i class="fa-solid fa-user text-muted"></i>
        </template>
      </v-text-field>

      <!-- Password with show/hide + CapsLock hint -->
      <v-text-field
        v-model="password"
        :type="showPwd ? 'text' : 'password'"
        label="Password"
        variant="outlined"
        density="comfortable"
        class="mb-1"
        @keydown="onCapsCheck"
        @keyup="onCapsCheck"
        :hint="capsOn ? 'Caps Lock is ON' : ''"
        persistent-hint
      >
        <template #prepend-inner>
          <i class="fa-solid fa-lock text-muted"></i>
        </template>

        <template #append-inner>
          <v-btn
            variant="text"
            icon
            @click="showPwd = !showPwd"
            :aria-label="showPwd ? 'Hide password' : 'Show password'"
          >
            <i :class="showPwd ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'"></i>
          </v-btn>
        </template>
      </v-text-field>

      <!-- Submit -->
      <v-btn
        :loading="loading"
        color="primary"
        block
        rounded="lg"
        size="large"
        class="mt-4"
        @click="submit"
      >
        <i class="fa-solid fa-right-to-bracket me-2"></i>
        Login
      </v-btn>

      <!-- Footer -->
      <div class="text-caption text-center text-grey mt-6">
        © 2025 Food Request System
      </div>
    </v-card>
  </v-container>
</template>

<style scoped>
.login-bg {
  background: linear-gradient(135deg, #eef2ff, #ecfdf5);
}
.login-card {
  background: #fff;
  border: 1px solid rgba(100, 116, 139, 0.15);
}
.text-muted { opacity: 0.7; }
.text-primary-dark { color: rgba(51, 65, 85, 0.9); }
.me-2 { margin-inline-end: .5rem; }
</style>
