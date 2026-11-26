<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import { messageOf, type PendingMonth } from '../api'
import { formatMonth } from '../format'
import {
  consumerIdsIn,
  fetchMonthReport,
  prefilledFormUrl,
  reportFileName,
  saveFile,
} from '../manual-upload'

const props = defineProps<{ months: PendingMonth[]; uploadFormUrl: string | null }>()
const emit = defineEmits<{ close: [] }>()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')

/** Report texts already fetched, by month, so each month comes from this service once. */
const reportTexts = new Map<string, string>()

type ConsumerIdStatus = 'loading' | 'loaded' | 'failed'
const consumerIdStatus = ref<ConsumerIdStatus>('loading')
const consumerIds = ref<string[]>([])
const consumerIdError = ref('')

const downloadingMonth = ref('')
const downloadError = ref('')

async function reportOf(pending: PendingMonth): Promise<string> {
  const known = reportTexts.get(pending.month)
  if (known !== undefined) {
    return known
  }
  const text = await fetchMonthReport(pending)
  reportTexts.set(pending.month, text)
  return text
}

/** The oldest month is the first one the user uploads, so its report holds the consumer IDs shown. */
async function loadConsumerIds(): Promise<void> {
  const oldest = props.months[0]
  if (oldest === undefined) {
    consumerIdStatus.value = 'loaded'
    return
  }
  try {
    consumerIds.value = consumerIdsIn(await reportOf(oldest))
    consumerIdStatus.value = 'loaded'
  } catch (error) {
    consumerIdError.value = messageOf(error)
    consumerIdStatus.value = 'failed'
  }
}

async function download(pending: PendingMonth): Promise<void> {
  downloadingMonth.value = pending.month
  downloadError.value = ''
  try {
    saveFile(await reportOf(pending), reportFileName(pending.month))
  } catch (error) {
    downloadError.value = messageOf(error)
  } finally {
    downloadingMonth.value = ''
  }
}

/** Empty until the consumer ID is known, so a link is never opened without it. */
const formLinks = computed(() => {
  const formUrl = props.uploadFormUrl
  if (formUrl === null || consumerIdStatus.value === 'loading') {
    return []
  }
  return props.months.map(({ month }) => ({
    month,
    url: prefilledFormUrl(formUrl, month, consumerIds.value),
  }))
})

function closeDialog(): void {
  dialog.value?.close()
}

onMounted(() => {
  dialog.value?.showModal()
  void loadConsumerIds()
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
      This browser could not send the data to n8n. Download each month and upload it with the form.
    </p>

    <section>
      <h3>Consumer ID</h3>
      <p v-if="consumerIdStatus === 'loading'" class="muted">Loading…</p>
      <p v-else-if="consumerIdStatus === 'failed'" class="banner error" role="alert">
        {{ consumerIdError }}
      </p>
      <ul v-else-if="consumerIds.length > 0" class="consumer-ids">
        <li v-for="id in consumerIds" :key="id">
          <code>{{ id }}</code>
        </li>
      </ul>
      <p v-else class="muted">
        These reports have no license consumer ID. Ask n8n for your consumer ID.
      </p>
    </section>

    <section>
      <h3>Download</h3>
      <ul class="downloads">
        <li v-for="month in months" :key="month.month">
          <button
            type="button"
            class="secondary"
            :disabled="downloadingMonth !== ''"
            @click="download(month)"
          >
            <span
              v-if="downloadingMonth === month.month"
              class="spinner small"
              aria-hidden="true"
            ></span>
            Download {{ formatMonth(month.month) }}
          </button>
        </li>
      </ul>
      <p v-if="downloadError" class="banner error" role="alert">{{ downloadError }}</p>
    </section>

    <section>
      <h3>Upload form</h3>
      <p v-if="uploadFormUrl === null" class="muted">Ask n8n for the link to the upload form.</p>
      <p v-else-if="consumerIdStatus === 'loading'" class="muted">Loading…</p>
      <template v-else>
        <p>
          Each link fills in the month, and the consumer ID when there is one. Attach the downloaded
          file.
        </p>
        <ul class="form-links">
          <li v-for="link in formLinks" :key="link.month">
            <a :href="link.url" target="_blank" rel="noopener noreferrer"
              >Open the form for {{ formatMonth(link.month) }}</a
            >
            <span class="muted url">{{ link.url }}</span>
          </li>
        </ul>
      </template>
    </section>

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
  margin: 0 0 8px;
  font-size: 0.95rem;
}

/* The page's section rule adds a large top margin, which a dialog does not need. */
section {
  margin-top: 20px;
}

.consumer-ids,
.downloads {
  margin: 0;
  padding: 0;
  list-style: none;
}

.consumer-ids code {
  user-select: all;
}

.downloads {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.form-links {
  margin: 0;
  padding: 0;
  list-style: none;
}

.form-links li + li {
  margin-top: 12px;
}

.url {
  display: block;
  overflow-wrap: anywhere;
}
</style>
