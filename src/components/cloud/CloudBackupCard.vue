<template>
  <q-card flat bordered class="q-mb-md">
    <q-card-section class="row items-center">
      <div class="text-subtitle1">Cloud backup</div>
      <q-space />
      <q-chip v-if="store.supported" dense :color="chip.color" text-color="white" :label="chip.label" />
    </q-card-section>

    <q-card-section v-if="!store.available || !store.supported" class="text-body2 text-grey">
      {{ store.status?.reason || 'Cloud backup is only available inside the desktop app.' }}
    </q-card-section>

    <!-- not connected -->
    <q-card-section v-else-if="!store.connected" class="q-gutter-y-sm">
      <div class="text-body2 text-grey">
        Every sale is also saved to your own server. If this PC is lost or its disk fails, a new PC can restore everything.
        Selling never waits for the internet: with no connection, changes queue up and upload by themselves later.
      </div>
      <q-input v-model="form.serverUrl" filled dense label="Server address" placeholder="https://erp.yourdomain.com" />
      <q-input v-model="form.enrollmentKey" filled dense label="Enrollment key" :type="showKey ? 'text' : 'password'">
        <template #append><q-icon :name="showKey ? 'visibility_off' : 'visibility'" class="cursor-pointer" @click="showKey = !showKey" /></template>
      </q-input>
      <q-input v-model="form.deviceName" filled dense label="Name of this PC" placeholder="Front counter" />
      <q-option-group v-model="mode" :options="modeOptions" color="primary" />

      <div v-if="mode === 'replace'" class="q-mt-sm">
        <q-btn outline no-caps icon="search" label="Find PCs on the server" :loading="finding" @click="findDevices" />
        <q-option-group v-if="devices.length" v-model="form.adoptDeviceId" :options="deviceOptions" color="primary" class="q-mt-sm" />
        <div v-else-if="searched" class="text-caption text-grey q-mt-xs">No PCs found on that server.</div>
      </div>

      <q-btn color="primary" no-caps icon="cloud_upload" label="Connect and back up" :loading="store.busy" :disable="!canConnect" @click="connect" />
    </q-card-section>

    <!-- connected -->
    <q-card-section v-else class="q-gutter-y-sm">
      <div class="text-body2">{{ store.summary }}</div>
      <div class="text-caption text-grey">
        {{ store.status.serverUrl }} &middot; this PC: {{ store.status.deviceName || '-' }}
        <span v-if="store.status.lastSyncAt"> &middot; last upload {{ new Date(store.status.lastSyncAt).toLocaleString() }}</span>
      </div>
      <q-banner v-if="store.status.state === 'error' || store.status.state === 'offline'" dense rounded class="bg-orange-1 text-dark">
        {{ store.status.lastError }}
      </q-banner>
      <q-banner v-if="store.status.canRestore" dense rounded class="bg-blue-1 text-dark">
        This PC is empty. If you are replacing a lost PC, restore your data from the cloud now.
        <template #action>
          <q-btn flat no-caps color="primary" label="Restore from cloud" :loading="store.busy" @click="restore" />
        </template>
      </q-banner>
      <q-banner v-if="store.status.rejected" dense rounded class="bg-red-1 text-dark">
        {{ store.status.rejected }} change(s) were refused by the server.
        <template #action>
          <q-btn flat no-caps label="Details" @click="showRejected" />
          <q-btn flat no-caps label="Try again" @click="retryRejected" />
        </template>
      </q-banner>

      <div class="row q-gutter-sm">
        <q-btn outline no-caps icon="sync" label="Sync now" :loading="store.busy" @click="syncNow" />
        <q-btn outline no-caps icon="cloud_upload" label="Upload everything again" :disable="store.busy" @click="uploadAll" />
        <q-btn flat no-caps color="negative" icon="link_off" label="Disconnect" :disable="store.busy" @click="disconnect" />
      </div>
    </q-card-section>

    <q-dialog v-model="restoring" persistent>
      <q-card style="min-width: 380px">
        <q-card-section class="text-h6">Restoring from the cloud</q-card-section>
        <q-card-section>
          <div class="text-body2 q-mb-sm">{{ store.progress ? `${store.progress.entity}: ${store.progress.done} / ${store.progress.total}` : 'Starting...' }}</div>
          <q-linear-progress indeterminate />
          <div class="text-caption text-grey q-mt-sm">Do not close the app until this finishes.</div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-card>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useCloudSyncStore } from 'src/stores/cloudSync';
import { useAccountingUi } from 'src/composables/useAccountingUi';

const store = useCloudSyncStore();
const { $q, ok, fail, confirm } = useAccountingUi();

const form = reactive({ serverUrl: '', enrollmentKey: '', deviceName: '', adoptDeviceId: null });
const mode = ref('new');
const showKey = ref(false);
const devices = ref([]);
const finding = ref(false);
const searched = ref(false);
const restoring = ref(false);

const modeOptions = [
  { label: 'This is a new PC: back up its data', value: 'new' },
  { label: 'This PC replaces a lost one: bring the old data back', value: 'replace' },
];
const deviceOptions = computed(() => devices.value.map((d) => ({ label: d.name, value: d.id })));
const canConnect = computed(
  () => form.serverUrl && form.enrollmentKey && (mode.value === 'new' || form.adoptDeviceId),
);
const chip = computed(
  () => ({ off: { color: 'grey', label: 'Off' }, ok: { color: 'positive', label: 'Backed up' }, working: { color: 'primary', label: 'Uploading' }, waiting: { color: 'orange', label: 'Offline' }, error: { color: 'negative', label: 'Attention' } })[store.tone],
);

async function findDevices() {
  finding.value = true;
  try {
    devices.value = (await store.listDevices({ serverUrl: form.serverUrl, enrollmentKey: form.enrollmentKey })).devices || [];
    searched.value = true;
  } catch (err) {
    fail(err);
  } finally {
    finding.value = false;
  }
}

async function connect() {
  try {
    await store.connect({
      serverUrl: form.serverUrl,
      enrollmentKey: form.enrollmentKey,
      deviceName: form.deviceName,
      adoptDeviceId: mode.value === 'replace' ? form.adoptDeviceId : null,
    });
    form.enrollmentKey = '';
    ok(mode.value === 'replace' ? 'Connected. Now restore your data.' : 'Connected. Your data is uploading.');
  } catch (err) {
    fail(err);
  }
}

const run = async (fn, message) => {
  try {
    await fn();
    if (message) ok(message);
  } catch (err) {
    fail(err);
  }
};
const syncNow = () => run(() => store.syncNow());
const retryRejected = () => run(() => store.retryRejected(), 'Queued again');
const uploadAll = async () => {
  if (await confirm('Upload every record from this PC again? This replaces the cloud copy with what is on this PC.')) await run(() => store.uploadAll(), 'Uploading everything');
};
const disconnect = async () => {
  if (await confirm('Disconnect this PC? Nothing is deleted on the server, but new sales stop being backed up until you connect again.')) await run(() => store.disconnect(), 'Disconnected');
};

async function showRejected() {
  try {
    const rows = await store.rejected();
    $q.dialog({ title: 'Refused changes', message: rows.map((r) => `${r.entity} #${r.row_key}: ${r.reject_reason}`).join('<br>'), html: true });
  } catch (err) {
    fail(err);
  }
}

async function restore() {
  if (!(await confirm('Restore all data from the cloud onto this PC? This only works on a new, empty installation.'))) return;
  restoring.value = true;
  try {
    const res = await store.restore();
    ok(`Restored. ${res.foreignKeyProblems ? `${res.foreignKeyProblems} link problems found - tell support.` : 'Reloading...'}`);
    setTimeout(() => window.location.reload(), 1200);
  } catch (err) {
    fail(err);
  } finally {
    restoring.value = false;
  }
}

onMounted(() => store.init());
</script>
