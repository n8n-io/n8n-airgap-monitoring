<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  fetchOverview,
  messageOf,
  type MonthRow,
  type PendingMonth,
  type SendState,
  type SubmissionsOverview,
  setToken,
  UnauthorizedError,
} from './api'
import ManualUploadDialog from './components/ManualUploadDialog.vue'
import MonthRowItem from './components/MonthRow.vue'
import { formatMonth } from './format'
import { DestinationError, sendMonth } from './send'

/** Set once the service accepted the read token; a page load starts without it. */
const authenticated = ref(false)
const tokenInput = ref('')
const loginError = ref('')
const loggingIn = ref(false)
const overview = ref<SubmissionsOverview>()
const loadError = ref('')
const sendError = ref('')
/** True when the last Submit failed at n8n, so the page offers a manual upload. */
const destinationFailed = ref(false)
const manualUploadOpen = ref(false)
/** The months the dialog offers. Fixed when the dialog opens, so a failed reload cannot change them. */
const manualUploadMonths = ref<PendingMonth[]>([])
const progress = ref('')
const sending = ref(false)
const confirming = ref(false)
const sendStates = reactive<Record<string, SendState>>({})
/** When n8n acknowledged a month in this visit, until the reload brings the server's time. */
const sentAt = reactive<Record<string, string>>({})

const destination = computed(() => overview.value?.destination ?? null)
/** Null when the service has no upload form URL, so a failed send offers no manual upload. */
const uploadFormUrl = computed(() => overview.value?.uploadFormUrl ?? null)
const pendingCount = computed(() => overview.value?.pending.length ?? 0)
const canSubmit = computed(() => destination.value !== null && pendingCount.value > 0)

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
    ...upcoming.map((month): MonthRow => ({
      kind: 'upcoming',
      month: month.month,
      upcoming: month,
    })),
    ...pending.map((month): MonthRow => ({ kind: 'pending', month: month.month, pending: month })),
    ...submitted.map((month): MonthRow => ({
      kind: 'submitted',
      month: month.month,
      submittedAt: month.submittedAt,
    })),
  ].sort((a, b) => b.month.localeCompare(a.month))
})

const incompleteMonths = computed(
  () =>
    overview.value?.pending.filter((month) => month.waiting.length + month.stale.length > 0) ?? [],
)

const incompleteSummary = computed(() =>
  incompleteMonths.value
    .map(
      (month) =>
        `${formatMonth(month.month)}: ${month.instances - month.complete} of ${month.instances} instances`,
    )
    .join(', '),
)

/** Back to the token prompt, e.g. after the operator rotated the token. */
function logOut(): void {
  authenticated.value = false
  manualUploadOpen.value = false
  overview.value = undefined
  // After the next login the history shows the server's time for months sent in this visit.
  for (const month of Object.keys(sendStates)) {
    delete sendStates[month]
  }
  for (const month of Object.keys(sentAt)) {
    delete sentAt[month]
  }
  loginError.value = 'The read token was not accepted. Enter it again.'
}

/** Months from the overview that were not sent in this visit. */
function unsentMonths(): PendingMonth[] {
  return (overview.value?.pending ?? []).filter((month) => sendStates[month.month] !== 'sent')
}

function openManualUpload(): void {
  manualUploadMonths.value = unsentMonths()
  manualUploadOpen.value = true
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
    // An error from an earlier failed reload would otherwise hide the page after this login.
    loadError.value = ''
    authenticated.value = true
    tokenInput.value = ''
  } catch (error) {
    loginError.value =
      error instanceof UnauthorizedError
        ? 'This is not the read token of this service.'
        : messageOf(error)
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
  const target = destination.value
  if (target === null) {
    return
  }
  confirming.value = false
  sending.value = true
  sendError.value = ''
  destinationFailed.value = false
  progress.value = ''
  for (const month of Object.keys(sendStates)) {
    delete sendStates[month]
  }

  let current = ''
  try {
    for (const month of [...(overview.value?.pending ?? [])]) {
      current = month.month
      sendStates[current] = 'sending'
      await sendMonth(month, target)
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
    destinationFailed.value = error instanceof DestinationError
  } finally {
    // Taken before the reload, which replaces the overview and the send states.
    const unsent = unsentMonths()
    // After a rejected token the page is back at the prompt, nothing to reload.
    if (authenticated.value) {
      await load()
      // The dialog opens only after the reload, with the months that were not sent.
      manualUploadMonths.value = unsent
      manualUploadOpen.value = destinationFailed.value && uploadFormUrl.value !== null
      // Sent months are in the history now, which carries the server's own time.
      for (const [month, state] of Object.entries(sendStates)) {
        if (state === 'sent') {
          delete sendStates[month]
          delete sentAt[month]
        }
      }
    }
    // Only now: until the reload, the overview still lists the months just sent.
    sending.value = false
  }
}
</script>

<template>
  <main>
    <header class="hero">
      <p class="eyebrow"><span class="logo" aria-hidden="true">n8n</span> Airgap monitoring</p>
      <h1>Submit usage to n8n</h1>
      <p class="lead">
        Sends the usage report of every finished month to n8n, exactly as this service reports it.
        The data leaves through this browser, the monitoring service itself makes no outbound
        request.
      </p>
    </header>

    <form v-if="!authenticated" class="login" @submit.prevent="logIn">
      <label for="token">Read token</label>
      <p class="muted">
        The value of <code>N8N_MONITORING_READ_TOKEN</code> this service runs with.
      </p>
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
          <p v-else-if="destination === null" class="status">
            Not configured: set <code>N8N_MONITORING_REPORT_DESTINATION</code> and
            <code>N8N_MONITORING_REPORT_DESTINATION_AUTH_TOKEN</code> on this service.
          </p>
          <p v-else-if="pendingCount === 0 && !sending" class="status">
            Every month that can be submitted has been sent.
          </p>
        </div>
        <div v-if="sendError" class="banner error" role="alert">
          <p>{{ sendError }}</p>
          <div v-if="destinationFailed && uploadFormUrl !== null" class="buttons">
            <button type="button" class="secondary" @click="openManualUpload">
              Upload manually
            </button>
          </div>
        </div>
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

    <ManualUploadDialog
      v-if="authenticated && manualUploadOpen && uploadFormUrl !== null"
      :months="manualUploadMonths"
      :upload-form-url="uploadFormUrl"
      @close="manualUploadOpen = false"
      @unauthorized="logOut"
    />
  </main>
</template>
