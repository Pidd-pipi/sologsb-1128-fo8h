<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { usePortStore } from '../stores/portStore';
import { useVesselStore } from '../stores/vesselStore';
import { useLocalDraft } from '../hooks/useLocalDraft';
import { useBerthStatus } from '../hooks/useBerthStatus';
import BerthGrid from '../components/common/BerthGrid.vue';
import EmptyState from '../components/common/EmptyState.vue';
import type { Berth } from '../types/berth';
import { CALL_TYPES, VISA_STATUSES, callBerthLabel, emptyCallDraft, type CallDraft } from '../types/call';
import { formatDateTime, formatNumber, isToday, nowLocalInputValue, toPlain } from '../utils/format';

interface CallForm extends CallDraft {
  /** 进 / 出港登记时所选泊位所属渔港 */
  portId: string;
  /** 移泊登记：原泊位所属渔港（即该船当前占用泊位所在渔港） */
  fromPortId: string;
  /** 移泊登记：新泊位所属渔港（与原泊位同港） */
  toPortId: string;
}

function createForm(): CallForm {
  return {
    ...emptyCallDraft(),
    portId: '',
    fromPortId: '',
    toPortId: '',
    time: nowLocalInputValue(),
  };
}

const router = useRouter();
const portStore = usePortStore();
const vesselStore = useVesselStore();

const { draft, restored, savedAt, storageKey, persist, restore, clearDraft } = useLocalDraft<CallForm>('call-board', createForm);
const form = draft;

const formRef = ref<FormInstance>();
const submitting = ref(false);
const focusPortId = ref('');

const isShift = computed(() => form.value.type === '移泊');

const rules = computed<FormRules>(() => {
  const base: FormRules = {
    vesselId: [{ required: true, message: '请选择渔船', trigger: 'change' }],
    time: [{ required: true, message: '请选择时间', trigger: 'change' }],
  };
  if (isShift.value) {
    return {
      ...base,
      fromBerthNo: [{ required: true, message: '请选择原泊位', trigger: 'change' }],
      toBerthNo: [{ required: true, message: '请选择新泊位', trigger: 'change' }],
    };
  }
  return {
    ...base,
    portId: [{ required: true, message: '请选择泊位', trigger: 'change' }],
  };
});

const vesselOptions = computed(() => vesselStore.vessels);

const selectedVessel = computed(() => vesselStore.vesselById(form.value.vesselId));

/** 进港只能选空闲泊位；出港只能选已占用泊位 */
const berthOptions = computed(() => {
  const wanted = form.value.type === '进港' ? '空闲' : '占用';
  return portStore.berths
    .filter((b) => b.status === wanted)
    .map((b) => ({
      value: `${b.portId}|${b.berthNo}`,
      label: `${portStore.portById(b.portId)?.name ?? b.portId} · ${b.berthNo}`,
      portId: b.portId,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

/** 移泊原泊位候选：这艘船当前正在占用的泊位 */
const vesselOccupiedBerths = computed(() =>
  form.value.vesselId
    ? portStore.berths.filter((b) => b.status === '占用' && b.vesselId === form.value.vesselId)
    : [],
);

const shiftFromOptions = computed(() =>
  vesselOccupiedBerths.value.map((b) => ({
    value: `${b.portId}|${b.berthNo}`,
    label: `${portStore.portById(b.portId)?.name ?? b.portId} · ${b.berthNo}`,
  })),
);

/** 移泊新泊位候选：原泊位所在渔港的空闲泊位 */
const shiftToOptions = computed(() =>
  form.value.fromPortId
    ? portStore.berths
        .filter((b) => b.portId === form.value.fromPortId && b.status === '空闲')
        .map((b) => ({ value: `${b.portId}|${b.berthNo}`, label: b.berthNo }))
    : [],
);

const berthKey = computed({
  get: () => (form.value.portId && form.value.berthNo ? `${form.value.portId}|${form.value.berthNo}` : ''),
  set: (key: string) => {
    const [portId, berthNo] = String(key).split('|');
    form.value.portId = portId ?? '';
    form.value.berthNo = berthNo ?? '';
    focusPortId.value = portId ?? '';
  },
});

const shiftFromKey = computed({
  get: () => (form.value.fromPortId && form.value.fromBerthNo ? `${form.value.fromPortId}|${form.value.fromBerthNo}` : ''),
  set: (key: string) => {
    const [portId, berthNo] = String(key).split('|');
    form.value.fromPortId = portId ?? '';
    form.value.fromBerthNo = berthNo ?? '';
    focusPortId.value = portId ?? '';
    // 原泊位变更后，新泊位必须重新选择（原候选可能已不属于同一渔港）
    form.value.toPortId = '';
    form.value.toBerthNo = '';
  },
});

const shiftToKey = computed({
  get: () => (form.value.toPortId && form.value.toBerthNo ? `${form.value.toPortId}|${form.value.toBerthNo}` : ''),
  set: (key: string) => {
    const [portId, berthNo] = String(key).split('|');
    form.value.toPortId = portId ?? '';
    form.value.toBerthNo = berthNo ?? '';
    form.value.berthNo = berthNo ?? '';
  },
});

const focusBerths = computed<Berth[]>(() =>
  focusPortId.value ? portStore.berthsOf(focusPortId.value) : [],
);

const berthRef = computed(() => portStore.berths);
const { summary } = useBerthStatus(berthRef, computed(() => focusPortId.value));

const todayCalls = computed(() => portStore.callsSorted.filter((c) => isToday(c.time)));

const todayStats = computed(() => ({
  inbound: todayCalls.value.filter((c) => c.type === '进港').length,
  outbound: todayCalls.value.filter((c) => c.type === '出港').length,
  ice: todayCalls.value.reduce((sum, c) => sum + c.iceKg, 0),
  fuel: todayCalls.value.reduce((sum, c) => sum + c.fuelL, 0),
  unload: todayCalls.value.reduce((sum, c) => sum + c.unloadKg, 0),
}));

function hasContent(value: CallForm): boolean {
  return (
    Boolean(value.vesselId) ||
    Boolean(value.berthNo) ||
    Boolean(value.fromBerthNo) ||
    Boolean(value.toBerthNo) ||
    Number(value.iceKg) > 0 ||
    Number(value.fuelL) > 0 ||
    Number(value.unloadKg) > 0
  );
}

onMounted(async () => {
  if (!portStore.ports.length) await portStore.loadAll();
  if (!vesselStore.vessels.length) await vesselStore.loadAll();
  if (restore()) {
    if (hasContent(form.value)) {
      ElMessage.info(`已恢复本地草稿（保存于 ${formatDateTime(savedAt.value)}）`);
    } else {
      // 空草稿没有恢复价值，直接清掉，避免误报「已恢复草稿」
      clearDraft();
    }
  }
  focusPortId.value = isShift.value ? form.value.fromPortId : form.value.portId;
});

watch(
  () => toPlain(form.value),
  (value) => {
    // 只有存在有效输入时才落草稿；提交后表单被重置，草稿同步清空
    if (hasContent(value)) persist();
    else clearDraft();
  },
  { deep: true },
);

watch(
  () => form.value.type,
  () => {
    // 切换登记类型后清空泊位选择，避免把进 / 出港泊位带到移泊表单
    form.value.portId = '';
    form.value.berthNo = '';
    form.value.fromPortId = '';
    form.value.fromBerthNo = '';
    form.value.toPortId = '';
    form.value.toBerthNo = '';
    focusPortId.value = '';
  },
);

// 更换渔船后，原泊位候选随之变化，已选移泊泊位不再可信
watch(
  () => form.value.vesselId,
  () => {
    if (!isShift.value) return;
    const valid = vesselOccupiedBerths.value.some(
      (b) => b.portId === form.value.fromPortId && b.berthNo === form.value.fromBerthNo,
    );
    if (!valid) {
      form.value.fromPortId = '';
      form.value.fromBerthNo = '';
      form.value.toPortId = '';
      form.value.toBerthNo = '';
      focusPortId.value = '';
    }
  },
);

function selectBerth(berth: Berth): void {
  if (isShift.value) {
    // 网格只用于辅助查看与填原泊位；新泊位必须通过下拉从同港空闲位中选择
    if (berth.status !== '占用' || berth.vesselId !== form.value.vesselId) {
      ElMessage.warning('原泊位必须是这艘船当前正在占用的泊位');
      return;
    }
    shiftFromKey.value = `${berth.portId}|${berth.berthNo}`;
    ElMessage.info(`已选择原泊位 ${berth.berthNo}`);
    return;
  }
  berthKey.value = `${berth.portId}|${berth.berthNo}`;
  ElMessage.info(`已选择 ${berth.berthNo}`);
}

function resetForm(): void {
  Object.assign(form.value, createForm());
  focusPortId.value = '';
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  if (!selectedVessel.value) {
    ElMessage.warning('请选择有效的渔船');
    return;
  }
  submitting.value = true;
  try {
    if (isShift.value) {
      const call = await portStore.registerShift({
        vesselId: form.value.vesselId,
        vesselName: selectedVessel.value.name,
        fromPortId: form.value.fromPortId,
        fromBerthNo: form.value.fromBerthNo ?? '',
        toPortId: form.value.toPortId,
        toBerthNo: form.value.toBerthNo ?? '',
        time: form.value.time,
      });
      ElMessage.success(`已登记 ${call.vesselName} 移泊 ${callBerthLabel(call)}`);
    } else {
      const payload: CallDraft = {
        vesselId: form.value.vesselId,
        type: form.value.type,
        time: form.value.time,
        berthNo: form.value.berthNo,
        iceKg: Number(form.value.iceKg) || 0,
        fuelL: Number(form.value.fuelL) || 0,
        unloadKg: Number(form.value.unloadKg) || 0,
        visaStatus: form.value.visaStatus,
      };
      const call = await portStore.registerCall(payload, selectedVessel.value.name, form.value.portId);
      ElMessage.success(`已登记 ${call.vesselName} ${call.type} · 泊位 ${call.berthNo}`);
    }
    // 只有登记成功才清空草稿与表单；校验失败时保留原记录与已填内容
    clearDraft();
    resetForm();
  } catch (error) {
    ElMessage.error(`登记失败：${(error as Error).message}`);
  } finally {
    submitting.value = false;
  }
}

function openVessel(vesselId: string): void {
  void router.push(`/vessels/${vesselId}`);
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h1>进出港登记</h1>
        <p class="page__sub">
          选择渔船与登记类型：进 / 出港填写泊位号与补给量，同港换泊位可登记「移泊」，提交后自动同步泊位占用状态
        </p>
      </div>
    </header>

    <el-alert
      v-if="restored"
      type="info"
      show-icon
      :closable="false"
      title="已从浏览器本地草稿恢复未提交的表单"
      data-testid="draft-alert"
      class="draft-alert"
    >
      <template #default>
        草稿保存在 localStorage（键 {{ storageKey }}），提交成功后会清空。
      </template>
    </el-alert>

    <el-row :gutter="16">
      <el-col :lg="13" :md="24">
        <el-card shadow="never" class="detail-card">
          <template #header><span class="card-title">登记表单</span></template>
          <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" data-testid="call-form">
            <el-form-item label="渔船" prop="vesselId">
              <el-select id="call-vessel" v-model="form.vesselId" placeholder="请选择渔船" filterable style="width: 100%">
                <el-option
                  v-for="v in vesselOptions"
                  :key="v.id"
                  :label="`${v.name}（${v.homePort} · ${formatNumber(v.enginePower, 0)}kW）`"
                  :value="v.id"
                />
              </el-select>
            </el-form-item>

            <el-form-item label="登记类型" prop="type">
              <el-radio-group v-model="form.type" data-testid="call-type">
                <el-radio-button v-for="t in CALL_TYPES" :key="t" :value="t">{{ t }}</el-radio-button>
              </el-radio-group>
            </el-form-item>

            <el-form-item label="时间" prop="time">
              <el-date-picker
                id="call-time"
                v-model="form.time"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm"
                placeholder="选择时间"
                style="width: 100%"
              />
            </el-form-item>

            <!-- 移泊：原泊位（该船正在占用的位置）+ 新泊位（同港空闲位置） -->
            <template v-if="isShift">
              <el-form-item label="原泊位" prop="fromBerthNo">
                <el-select
                  id="shift-from-berth"
                  v-model="shiftFromKey"
                  :placeholder="vesselOccupiedBerths.length ? '选择该船当前占用的泊位' : '该船当前没有占用泊位'"
                  :disabled="!vesselOccupiedBerths.length"
                  style="width: 100%"
                  data-testid="shift-from-berth"
                >
                  <el-option v-for="opt in shiftFromOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
              </el-form-item>

              <el-form-item label="新泊位" prop="toBerthNo">
                <el-select
                  id="shift-to-berth"
                  v-model="shiftToKey"
                  :placeholder="form.fromPortId ? '选择同港空闲泊位' : '请先选择原泊位'"
                  :disabled="!form.fromPortId"
                  style="width: 100%"
                  data-testid="shift-to-berth"
                >
                  <el-option v-for="opt in shiftToOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
              </el-form-item>
            </template>

            <el-form-item v-else label="泊位号" prop="portId">
              <el-select
                id="call-berth"
                v-model="berthKey"
                :placeholder="form.type === '进港' ? '选择空闲泊位' : '选择已占用泊位'"
                style="width: 100%"
                data-testid="call-berth"
              >
                <el-option v-for="opt in berthOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </el-form-item>

            <el-row v-if="!isShift" :gutter="12">
              <el-col :span="8">
                <el-form-item label="加冰 kg" prop="iceKg">
                  <el-input-number id="call-ice" v-model="form.iceKg" :min="0" :max="20000" :step="50" style="width: 100%" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="加油 L" prop="fuelL">
                  <el-input-number id="call-fuel" v-model="form.fuelL" :min="0" :max="20000" :step="50" style="width: 100%" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="卸货量 kg" prop="unloadKg">
                  <el-input-number id="call-unload" v-model="form.unloadKg" :min="0" :max="200000" :step="100" style="width: 100%" />
                </el-form-item>
              </el-col>
            </el-row>

            <el-form-item v-if="!isShift" label="签证状态" prop="visaStatus">
              <el-select id="call-visa" v-model="form.visaStatus" style="width: 100%">
                <el-option v-for="s in VISA_STATUSES" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>

            <el-form-item>
              <el-button type="primary" :loading="submitting" data-testid="submit-call" @click="submit">保存登记</el-button>
              <el-button data-testid="clear-draft" @click="clearDraft(); ElMessage.success('草稿已清空')">清空草稿</el-button>
              <el-button v-if="selectedVessel" text type="primary" @click="openVessel(selectedVessel.id)">查看渔船档案</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :lg="11" :md="24">
        <el-card shadow="never" class="detail-card">
          <template #header>
            <span class="card-title">今日统计</span>
          </template>
          <div class="stat-row">
            <div class="stat"><span class="stat__label">进港</span><b>{{ todayStats.inbound }}</b></div>
            <div class="stat"><span class="stat__label">出港</span><b>{{ todayStats.outbound }}</b></div>
            <div class="stat"><span class="stat__label">加冰 kg</span><b>{{ formatNumber(todayStats.ice, 0) }}</b></div>
            <div class="stat"><span class="stat__label">加油 L</span><b>{{ formatNumber(todayStats.fuel, 0) }}</b></div>
            <div class="stat"><span class="stat__label">卸货 kg</span><b>{{ formatNumber(todayStats.unload, 0) }}</b></div>
          </div>
        </el-card>

        <el-card shadow="never" class="detail-card">
          <template #header>
            <span class="card-title">
              泊位占用网格{{ focusPortId ? ` · ${portStore.portById(focusPortId)?.name ?? ''}` : isShift ? '（选择原泊位后聚焦对应渔港）' : '（选择泊位后聚焦对应渔港）' }}
            </span>
          </template>
          <BerthGrid v-if="focusBerths.length" :berths="focusBerths" @select="selectBerth" />
          <EmptyState v-else title="尚未选择渔港泊位" description="在左侧表单选择泊位，或直接点击泊位网格中的方块。">
            <el-button type="primary" @click="focusPortId = portStore.ports[0]?.id ?? ''">聚焦第一座渔港</el-button>
          </EmptyState>
          <p v-if="focusBerths.length" class="detail-hint">
            占用率 {{ (summary.occupancyRate * 100).toFixed(1) }}% · 占用 {{ summary.occupied }} · 空闲 {{ summary.free }} · 维修 {{ summary.maintenance }}
          </p>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="detail-card">
      <template #header><span class="card-title">今日流水（{{ todayCalls.length }} 条）</span></template>
      <el-table :data="todayCalls" size="small" border empty-text="今日暂无进出港流水" data-testid="today-calls">
        <el-table-column prop="vesselName" label="船名" min-width="130" />
        <el-table-column prop="type" label="类型" width="80" />
        <el-table-column label="时间" min-width="150">
          <template #default="scope">{{ formatDateTime(scope.row.time) }}</template>
        </el-table-column>
        <el-table-column label="泊位号" min-width="100">
          <template #default="scope">{{ callBerthLabel(scope.row) }}</template>
        </el-table-column>
        <el-table-column label="加冰 kg" min-width="100">
          <template #default="scope">{{ formatNumber(scope.row.iceKg, 0) }}</template>
        </el-table-column>
        <el-table-column label="加油 L" min-width="100">
          <template #default="scope">{{ formatNumber(scope.row.fuelL, 0) }}</template>
        </el-table-column>
        <el-table-column label="卸货 kg" min-width="110">
          <template #default="scope">{{ formatNumber(scope.row.unloadKg, 0) }}</template>
        </el-table-column>
        <el-table-column prop="visaStatus" label="签证状态" width="110" />
      </el-table>
    </el-card>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.page__head h1 {
  margin: 0;
  font-size: 22px;
  color: #17324d;
}
.page__sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: #6b7c8c;
}
.detail-card {
  border-radius: 10px;
  margin-bottom: 16px;
}
.card-title {
  font-weight: 600;
  color: #17324d;
}
.draft-alert {
  border-radius: 10px;
}
.stat-row {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat__label {
  font-size: 12px;
  color: #7b8a99;
}
.stat b {
  font-size: 18px;
  color: #17324d;
}
.detail-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #6b7c8c;
}
</style>
