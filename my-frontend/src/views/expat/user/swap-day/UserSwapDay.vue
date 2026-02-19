<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'UserSwapDay' })

const { showToast } = useToast()
const route = useRoute()
const router = useRouter()

const id = route.params.id
const isEdit = !!id
const loading = ref(false)

const form = ref({
  originalDate: '',
  swapDate: '',
  reason: ''
})

async function fetchDetail() {
  try {
    const res = await api.get(`/leave/swap-working-day/${id}`)
    form.value = {
      originalDate: res.data.originalDate,
      swapDate: res.data.swapDate,
      reason: res.data.reason || ''
    }
  } catch {
    showToast({ type: 'error', message: 'Failed to load request.' })
  }
}

async function submit() {
  try {
    loading.value = true
    if (isEdit) {
      await api.put(`/leave/swap-working-day/${id}`, form.value)
    } else {
      await api.post('/leave/swap-working-day', form.value)
    }

    showToast({ type: 'success', message: isEdit ? 'Updated successfully.' : 'Created successfully.' })
    router.push({ name:'leave-user-swap-day' })

  } catch (e) {
    showToast({
      type:'error',
      message: e?.response?.data?.message || 'Submit failed.'
    })
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (isEdit) fetchDetail()
})
</script>

<template>
  <div class="ui-page">
    <div class="ui-container py-2">
      <div class="ui-card overflow-hidden">

        <div class="ui-hero-gradient">
          <div class="text-sm font-extrabold">
            {{ isEdit ? 'Edit Swap Working Day' : 'New Swap Working Day' }}
          </div>
        </div>

        <div class="p-4 space-y-4">

          <div class="ui-card p-4 space-y-3">

            <div class="ui-field">
              <label class="ui-label">Original Working Date</label>
              <input type="date" v-model="form.originalDate" class="ui-date" />
            </div>

            <div class="ui-field">
              <label class="ui-label">Swap To Date</label>
              <input type="date" v-model="form.swapDate" class="ui-date" />
            </div>

            <div class="ui-field">
              <label class="ui-label">Reason</label>
              <textarea v-model="form.reason" rows="3" class="ui-textarea" placeholder="Optional..." />
            </div>

            <div class="flex justify-end gap-2 pt-2">
              <button class="ui-btn ui-btn-ghost" @click="router.back()">Cancel</button>
              <button class="ui-btn ui-btn-primary" :disabled="loading" @click="submit">
                <i v-if="loading" class="fa-solid fa-spinner animate-spin text-[11px]" />
                {{ isEdit ? 'Update' : 'Submit' }}
              </button>
            </div>

          </div>

        </div>
      </div>
    </div>
  </div>
</template>