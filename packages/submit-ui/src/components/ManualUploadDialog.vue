<script setup lang="ts">
import { computed, onMounted, reactive, ref, useTemplateRef } from 'vue'
import { messageOf, type PendingMonth, UnauthorizedError } from '../api'
import { formatMonth } from '../format'
import {
  consumerIdsIn,
  fetchMonthReport,
  prefilledFormUrl,
  reportFileName,
  saveFile,
} from '../manual-upload'

const props = defineProps<{ months: PendingMonth[]; uploadFormUrl: string }>()
const emit = defineEmits<{ close: []; unauthorized: [] }>()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')

/** What one month's report says about the consumer ID, once it has been read. */
type MonthIds = { status: 'loaded'; ids: string[] } | { status: 'failed'; error: string }

/** A month with no entry is still being read. */
const idsByMonth = reactive<Record<string, MonthIds>>({})
const downloadingMonth = ref('')
const downloadError = ref('')

interface MonthRow {
  pending: PendingMonth
  loading: boolean
  error: string
  ids: string[]
  url: string | null
}

const rows = computed<MonthRow[]>(() =>
  props.months.map((pending) => {
    const entry = idsByMonth[pending.month]
    const ids = entry?.status === 'loaded' ? entry.ids : []
    return {
      pending,
      loading: entry === undefined,
      error: entry?.status === 'failed' ? entry.error : '',
      ids,
      // Only a month whose report was read gets a link, so no link lacks its own ID.
      url:
        entry?.status === 'loaded'
          ? prefilledFormUrl(props.uploadFormUrl, pending.month, ids)
          : null,
    }
  }),
)

/** One read per month. The IDs and the download use the same text, so they always agree. */
const reportReads = new Map<string, Promise<string>>()

function readReport(pending: PendingMonth): Promise<string> {
  let read = reportReads.get(pending.month)
  if (read === undefined) {
    read = fetchMonthReport(pending)
    reportReads.set(pending.month, read)
    // A failed read is not kept, so the next attempt reads again.
    read.catch(() => reportReads.delete(pending.month))
  }
  return read
}

async function loadIds(pending: PendingMonth): Promise<void> {
  try {
    const ids = consumerIdsIn(await readReport(pending))
    idsByMonth[pending.month] = { status: 'loaded', ids }
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      emit('unauthorized')
      return
    }
    idsByMonth[pending.month] = { status: 'failed', error: messageOf(error) }
  }
}

async function download(pending: PendingMonth): Promise<void> {
  downloadingMonth.value = pending.month
  downloadError.value = ''
  try {
    saveFile(await readReport(pending), reportFileName(pending.month))
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      emit('unauthorized')
      return
    }
    downloadError.value = messageOf(error)
  } finally {
    downloadingMonth.value = ''
  }
}

function closeDialog(): void {
  dialog.value?.close()
}

onMounted(() => {
  dialog.value?.showModal()
  for (const pending of props.months) {
    void loadIds(pending)
  }
})
</script>

<template>
  <dialog
    ref="dialog"
    class="manual-upload"
    aria-labelledby="manual-upload-title"
    @close="emit('close')"
  >
    <h2 id="manual-upload-title">Upload the usage data manually</h2>
    <p>
      This browser could not send the data to n8n. For each month, download the file and upload it
      with the form.
    </p>
    <p v-if="downloadError" class="banner error" role="alert">{{ downloadError }}</p>

    <ol class="months">
      <li v-for="row in rows" :key="row.pending.month" class="month">
        <div class="month-head">
          <h3>{{ formatMonth(row.pending.month) }}</h3>
          <button
            type="button"
            class="secondary"
            :disabled="downloadingMonth !== ''"
            :aria-label="'Download ' + formatMonth(row.pending.month)"
            @click="download(row.pending)"
          >
            <span
              v-if="downloadingMonth === row.pending.month"
              class="spinner small"
              aria-hidden="true"
            ></span>
            Download
          </button>
        </div>

        <p v-if="row.loading" class="muted">Reading the consumer ID…</p>
        <p v-else-if="row.error" class="banner error" role="alert">{{ row.error }}</p>
        <template v-else>
          <p v-if="row.ids.length === 0" class="muted">
            This report has no consumer ID. Enter the consumer ID from n8n in the form.
          </p>
          <p v-else-if="row.ids.length === 1">
            Consumer ID: <code>{{ row.ids[0] }}</code>
          </p>
          <template v-else>
            <p class="muted">
              This report has several consumer IDs. Choose the one that applies in the form:
            </p>
            <ul class="consumer-ids">
              <li v-for="id in row.ids" :key="id">
                <code>{{ id }}</code>
              </li>
            </ul>
          </template>
          <p>
            <a :href="row.url ?? undefined" target="_blank" rel="noopener noreferrer"
              >Open the upload form for {{ formatMonth(row.pending.month) }}</a
            >
          </p>
          <p class="muted url">{{ row.url }}</p>
        </template>
      </li>
    </ol>

    <p class="muted">Months that you upload here stay pending on this page.</p>

    <div class="buttons">
      <button type="button" class="secondary" @click="closeDialog">Close</button>
    </div>
  </dialog>
</template>

<style scoped>
h2 {
  margin-bottom: 8px;
}

h3 {
  margin: 0;
  font-size: 0.95rem;
}

.months {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* The page's section rule adds a large top margin, which a dialog does not need. */
.month {
  margin-top: 20px;
}

.month-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.consumer-ids {
  margin: 0;
  padding: 0;
  list-style: none;
}

.consumer-ids code {
  user-select: all;
}

.url {
  display: block;
  overflow-wrap: anywhere;
}
</style>
