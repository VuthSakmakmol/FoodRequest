<!-- frontend/src/views/admin/AdminLogin.vue -->
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/store/auth'
import Swal from 'sweetalert2'

const router = useRouter()
const auth = useAuth()
const loginId = ref('')
const password = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    await auth.login(loginId.value, password.value)
    await Swal.fire({ icon:'success', title:'Welcome', timer:1000, showConfirmButton:false })
    router.push({ name:'admin-requests' })
  } catch (e) {
    await Swal.fire({ icon:'error', title:'Login failed', text: e?.response?.data?.message || e.message })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <v-container
    class="d-flex align-center justify-center login-bg"
    style="min-height: 100vh"
  >
    <v-card class="pa-12 login-card" max-width="420" elevation="6" rounded="xl">
      <!-- Icon / header -->
      <div class="text-center mb-4">
        <v-avatar size="64" class="mb-2" color="primary" variant="tonal">
          <v-icon size="32" color="primary-darken-2">mdi-account-lock</v-icon>
        </v-avatar>
        <div class="text-h5 font-weight-bold">Admin / Chef Login</div>
        <div class="text-subtitle-2 text-grey mt-1">
          Sign in to manage food requests
        </div>
      </div>

      <!-- Form -->
      <v-text-field
        v-model="loginId"
        label="Login ID"
        density="comfortable"
        variant="outlined"
        prepend-inner-icon="mdi-account"
        class="mb-3"
      />
      <v-text-field
        v-model="password"
        type="password"
        label="Password"
        density="comfortable"
        variant="outlined"
        prepend-inner-icon="mdi-lock"
        class="mb-4"
      />

      <!-- Button -->
      <v-btn
        :loading="loading"
        color="primary"
        block
        rounded="lg"
        size="large"
        class="mb-2"
        @click="submit"
      >
        <v-icon start>mdi-login</v-icon>
        Login
      </v-btn>

      <!-- Small footer -->
      <div class="text-caption text-center text-grey mt-2">
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
</style>

