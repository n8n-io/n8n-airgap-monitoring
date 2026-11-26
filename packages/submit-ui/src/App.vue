<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  fetchOverview,
  type MonthRow,
  type SendState,
  type SubmissionsOverview,
  setToken,
  UnauthorizedError,
} from './api'
import MonthRowItem from './components/MonthRow.vue'
import { formatMonth } from './format'
import { SUBMIT_ENDPOINT, sendMonth } from './send'

/** Set once the service accepted the read token; a page load starts without it. */
const authenticated = ref(false)
const tokenInput = ref('')
const loginError = ref('')
const loggingIn = ref(false)
const overview = ref<SubmissionsOverview>()
const loadError = ref('')
const sendError = ref('')
const progress = ref('')
const sending = ref(false)
const confirming = ref(false)
const sendStates = reactive<Record<string, SendState>>({})
/** When n8n acknowledged a month in this visit, until the reload brings the server's time. */
const sentAt = reactive<Record<string, string>>({})

const pendingCount = computed(() => overview.value?.pending.length ?? 0)
const canSubmit = computed(() => SUBMIT_ENDPOINT !== null && pendingCount.value > 0)

const submitLabel = computed(() =>
  pendingCount.value === 1 ? 'Submit 1 month' : `Submit ${pendingCount.value} months`,
)

/** Every month in one list, newest first: the one in progress, the pending ones, the sent ones. */
const rows = computed<MonthRow[]>(() => {
  if (overview.value === undefined) {
    return []
  }
  const { upcoming, pending, submitted } = overview.value
  return [
    ...upcoming.map((month): MonthRow => ({ kind: 'upcoming', month: month.month, upcoming: month })),
    ...pending.map((month): MonthRow => ({ kind: 'pending', month: month.month, pending: month })),
    ...submitted.map((month): MonthRow => ({ kind: 'submitted', month: month.month, submittedAt: month.submittedAt })),
  ].sort((a, b) => b.month.localeCompare(a.month))
})

const incompleteMonths = computed(
  () => overview.value?.pending.filter((month) => month.waiting.length + month.stale.length > 0) ?? [],
)

const incompleteSummary = computed(() =>
  incompleteMonths.value
    .map((month) => `${formatMonth(month.month)}: ${month.instances - month.complete} of ${month.instances} instances`)
    .join(', '),
)

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Back to the token prompt, e.g. after the operator rotated the token. */
function logOut(): void {
  authenticated.value = false
  overview.value = undefined
  loginError.value = 'The read token was not accepted. Enter it again.'
}

async function load(): Promise<void> {
  try {
    overview.value = await fetchOverview()
    loadError.value = ''
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      logOut()
      return
    }
    loadError.value = messageOf(error)
  }
}

async function logIn(): Promise<void> {
  loggingIn.value = true
  loginError.value = ''
  setToken(tokenInput.value)
  try {
    overview.value = await fetchOverview()
    authenticated.value = true
    tokenInput.value = ''
  } catch (error) {
    loginError.value =
      error instanceof UnauthorizedError ? 'This is not the read token of this service.' : messageOf(error)
  } finally {
    loggingIn.value = false
  }
}

function onSubmit(): void {
  if (incompleteMonths.value.length > 0) {
    confirming.value = true
    return
  }
  void submitAll()
}

/** Oldest month first; stops at the first failure, which leaves that month and the later ones pending. */
async function submitAll(): Promise<void> {
  const endpoint = SUBMIT_ENDPOINT
  if (endpoint === null) {
    return
  }
  confirming.value = false
  sending.value = true
  sendError.value = ''
  progress.value = ''
  for (const month of Object.keys(sendStates)) {
    delete sendStates[month]
  }

  let current = ''
  try {
    for (const month of [...(overview.value?.pending ?? [])]) {
      current = month.month
      sendStates[current] = 'sending'
      await sendMonth(month, endpoint)
      sendStates[current] = 'sent'
      sentAt[current] = new Date().toISOString()
    }
    progress.value = 'Every pending month was sent to n8n.'
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      delete sendStates[current]
      logOut()
      return
    }
    sendStates[current] = 'failed'
    sendError.value = messageOf(error)
  } finally {
    sending.value = false
    // After a rejected token the page is back at the prompt, nothing to reload.
    if (authenticated.value) {
      await load()
      // Sent months are in the history now, which carries the server's own time.
      for (const [month, state] of Object.entries(sendStates)) {
        if (state === 'sent') {
          delete sendStates[month]
          delete sentAt[month]
        }
      }
    }
  }
}

</script>

<template>
  <main>
    <header class="hero">
      <p class="eyebrow"><span class="logo" aria-hidden="true">n8n</span> Airgap monitoring</p>
      <h1>Submit usage to n8n</h1>
      <p class="lead">
        Sends the usage report of every finished month to n8n, exactly as this service reports it. The
        data leaves through this browser, the monitoring service itself makes no outbound request.
      </p>
      <p class="destination">
        <span class="destination-label">Destination</span>
        <code v-if="SUBMIT_ENDPOINT">{{ SUBMIT_ENDPOINT }}</code>
        <span v-else class="not-configured">Not configured, set N8N_MONITORING_REPORT_DESTINATION when building this page</span>
      </p>
    </header>

    <form v-if="!authenticated" class="login" @submit.prevent="logIn">
      <label for="token">Read token</label>
      <p class="muted">The value of <code>N8N_MONITORING_READ_TOKEN</code> this service runs with.</p>
      <div class="login-row">
        <input
          id="token"
          v-model="tokenInput"
          type="password"
          autocomplete="current-password"
          required
          autofocus
          :disabled="loggingIn"
        />
        <button type="submit" class="primary" :disabled="loggingIn || tokenInput.trim() === ''">
          <span v-if="loggingIn" class="spinner" aria-hidden="true"></span>
          Open
        </button>
      </div>
      <p v-if="loginError" class="banner error" role="alert">{{ loginError }}</p>
    </form>
    <p v-else-if="loadError" class="banner error" role="alert">{{ loadError }}</p>
    <p v-else-if="!overview" class="muted">Loading…</p>
    <template v-else>
      <div class="actions">
        <div v-if="confirming" class="banner warning" role="alert">
          <p>
            <strong>Some instances have not delivered the whole month yet.</strong>
            {{ incompleteSummary }}. Their data for those months will not be sent later.
          </p>
          <div class="buttons">
            <button type="button" class="primary" @click="submitAll">Send anyway</button>
            <button type="button" class="secondary" @click="confirming = false">Cancel</button>
          </div>
        </div>
        <div v-else class="action-bar">
          <button
            type="button"
            class="primary large"
            :disabled="sending || !canSubmit"
            @click="onSubmit"
          >
            <span v-if="sending" class="spinner" aria-hidden="true"></span>
            {{ sending ? 'Sending…' : pendingCount === 0 ? 'Nothing to submit' : submitLabel }}
          </button>
          <p v-if="progress" class="status" role="status">{{ progress }}</p>
          <p v-else-if="pendingCount === 0 && !sending" class="status">
            Every month that can be submitted has been sent.
          </p>
        </div>
        <p v-if="sendError" class="banner error" role="alert">{{ sendError }}</p>
      </div>

      <ol class="months">
        <MonthRowItem
          v-for="row in rows"
          :key="row.month"
          :row="row"
          :state="sendStates[row.month]"
          :sent-at="sentAt[row.month]"
        />
      </ol>
    </template>
  </main>
</template>
