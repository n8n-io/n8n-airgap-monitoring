import { ref } from 'vue'

const STORAGE_KEY = 'dashboard.secret'

/**
 * The dashboard secret, owned by the api-client layer so that requests can pick
 * it up themselves instead of having every caller thread it through.
 *
 * Module-level state: every importer shares the same secret.
 */
export const secret = ref(sessionStorage.getItem(STORAGE_KEY) ?? '')

export function setSecret(value: string): void {
  secret.value = value
  sessionStorage.setItem(STORAGE_KEY, value)
}

export function clearSecret(): void {
  secret.value = ''
  sessionStorage.removeItem(STORAGE_KEY)
}
