import { computed } from 'vue'
import { clearSecret, secret, setSecret } from '@/api-client/auth-state'
import { ApiError, checkAuth } from '@/api-client/client'

const isAuthenticated = computed(() => secret.value !== '')

async function logIn(candidate: string): Promise<boolean> {
  try {
    await checkAuth(candidate)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return false
    }

    throw error
  }

  setSecret(candidate)

  return true
}

function logOut(): void {
  clearSecret()
}

export function useAuth() {
  return { secret, isAuthenticated, logIn, logOut }
}
