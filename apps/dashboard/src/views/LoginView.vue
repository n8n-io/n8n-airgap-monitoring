<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const { logIn } = useAuth()
const router = useRouter()
const route = useRoute()

const candidate = ref('')
const isSubmitting = ref(false)
const error = ref<string | null>(null)

async function onSubmit(): Promise<void> {
  isSubmitting.value = true
  error.value = null

  try {
    const success = await logIn(candidate.value)
    if (!success) {
      error.value = 'Incorrect secret.'
      return
    }

    const redirect = route.query.redirect
    await router.replace(typeof redirect === 'string' ? redirect : { name: 'dashboard' })
  } catch {
    error.value = 'Could not reach the server. Please try again.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <main class="login">
    <form class="login-form" @submit.prevent="onSubmit">
      <h1>Sign in</h1>
      <label for="secret">Dashboard secret</label>
      <input
        id="secret"
        v-model="candidate"
        type="password"
        autocomplete="current-password"
        required
        autofocus
      />
      <button type="submit" :disabled="isSubmitting || candidate === ''">
        {{ isSubmitting ? 'Signing in…' : 'Sign in' }}
      </button>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>
  </main>
</template>

<style scoped>
.login {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 20rem;
}

.error {
  color: #b91c1c;
  margin: 0;
}
</style>
