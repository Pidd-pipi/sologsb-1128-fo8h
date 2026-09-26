import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../db';
import { toPlain, uid } from '../utils/format';
import { emptyPortFilter, type FishingPort, type PortFilter, type SupplyCapability } from '../types/port';
import type { Berth, BerthStatus } from '../types/berth';
import type { CallDraft, PortCall } from '../types/call';
import { buildBerthRecords } from '../db/berth';

export interface PortInput {
  name: string;
  level: FishingPort['level'];
  longitude: number;
  latitude: number;
  berthCount: number;
  berthDepth: number;
  wharfLength: number;
  shelterLevel: number;
  supply: SupplyCapability;
  manager: string;
}

export const usePortStore = defineStore('port', () => {
  const ports = ref<FishingPort[]>([]);
  const berths = ref<Berth[]>([]);
  const calls = ref<PortCall[]>([]);
  const loading = ref(false);
  const filter = ref<PortFilter>(emptyPortFilter());

  const filteredPorts = computed(() => {
    const f = filter.value;
    const keyword = f.keyword.trim();
    return ports.value.filter((p) => {
      if (f.level && p.level !== f.level) return false;
      if (f.minShelterLevel !== null && p.shelterLevel < f.minShelterLevel) return false;
      if (keyword && !p.name.includes(keyword) && !p.manager.includes(keyword)) return false;
      return true;
    });
  });

  const callsSorted = computed(() =>
    [...calls.value].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()),
  );

  function portById(id: string): FishingPort | undefined {
    return ports.value.find((p) => p.id === id);
  }

  function berthsOf(portId: string): Berth[] {
    return berths.value.filter((b) => b.portId === portId).sort((a, b) => a.berthNo.localeCompare(b.berthNo));
  }

  function callsOfVessel(vesselId: string): PortCall[] {
    return callsSorted.value.filter((c) => c.vesselId === vesselId);
  }

  function resetFilter(): void {
    filter.value = emptyPortFilter();
  }

  async function loadAll(): Promise<void> {
    loading.value = true;
    try {
      const [p, b, c] = await Promise.all([db.ports.toArray(), db.berths.toArray(), db.calls.toArray()]);
      ports.value = p;
      berths.value = b;
      calls.value = c;
    } finally {
      loading.value = false;
    }
  }

  async function createPort(input: PortInput): Promise<FishingPort> {
    const port: FishingPort = {
      id: uid('p'),
      name: input.name.trim(),
      level: input.level,
      longitude: Number(input.longitude),
      latitude: Number(input.latitude),
      berthCount: Number(input.berthCount),
      berthDepth: Number(input.berthDepth),
      wharfLength: Number(input.wharfLength),
      shelterLevel: Number(input.shelterLevel),
      supply: { ...input.supply },
      manager: input.manager.trim(),
      createdAt: new Date().toISOString(),
    };
    // 写库前脱代理，避免 DataCloneError
    await db.ports.put(toPlain(port));
    const records = buildBerthRecords(port, []);
    await db.berths.bulkPut(toPlain(records));
    ports.value = [...ports.value, port];
    berths.value = [...berths.value, ...records];
    return port;
  }

  async function addBerth(portId: string, berthNo: string, designDepth: number): Promise<Berth | null> {
    const port = portById(portId);
    if (!port) return null;
    const no = berthNo.trim().toUpperCase();
    if (!no) return null;
    if (berthsOf(portId).some((b) => b.berthNo === no)) return null;
    const berth: Berth = {
      id: `${portId}-${no}`,
      portId,
      berthNo: no,
      vesselId: null,
      vesselName: null,
      berthAt: null,
      leaveAt: null,
      status: '空闲',
      designDepth: Number(designDepth) || port.berthDepth,
    };
    await db.berths.put(toPlain(berth));
    berths.value = [...berths.value, berth];
    const nextCount = berthsOf(portId).length;
    await updatePort(portId, { berthCount: nextCount });
    return berth;
  }

  async function setBerthStatus(berthId: string, status: BerthStatus): Promise<void> {
    const hit = berths.value.find((b) => b.id === berthId);
    if (!hit) return;
    const next: Berth = {
      ...hit,
      status,
      vesselId: status === '占用' ? hit.vesselId : null,
      vesselName: status === '占用' ? hit.vesselName : null,
      berthAt: status === '占用' ? hit.berthAt ?? new Date().toISOString() : hit.berthAt,
      leaveAt: status === '空闲' ? new Date().toISOString() : null,
    };
    await db.berths.put(toPlain(next));
    berths.value = berths.value.map((b) => (b.id === berthId ? next : b));
  }

  async function updatePort(portId: string, patch: Partial<FishingPort>): Promise<void> {
    const hit = portById(portId);
    if (!hit) return;
    const next: FishingPort = { ...hit, ...patch };
    await db.ports.put(toPlain(next));
    ports.value = ports.value.map((p) => (p.id === portId ? next : p));
  }

  /**
   * 登记一条进出港记录，并同步泊位占用状态（进港 → 占用，出港 → 释放）。
   */
  async function registerCall(draft: CallDraft, vesselName: string, portId: string): Promise<PortCall> {
    const call: PortCall = {
      id: uid('c'),
      vesselId: draft.vesselId,
      vesselName,
      type: draft.type,
      time: draft.time ? new Date(draft.time).toISOString() : new Date().toISOString(),
      berthNo: draft.berthNo,
      iceKg: Number(draft.iceKg) || 0,
      fuelL: Number(draft.fuelL) || 0,
      unloadKg: Number(draft.unloadKg) || 0,
      visaStatus: draft.visaStatus,
      createdAt: new Date().toISOString(),
    };
    await db.calls.put(toPlain(call));
    calls.value = [...calls.value, call];

    const berth = berths.value.find((b) => b.portId === portId && b.berthNo === draft.berthNo);
    if (berth) {
      const next: Berth =
        draft.type === '进港'
          ? {
              ...berth,
              status: '占用',
              vesselId: draft.vesselId,
              vesselName,
              berthAt: call.time,
              leaveAt: null,
            }
          : {
              ...berth,
              status: '空闲',
              vesselId: null,
              vesselName: null,
              berthAt: null,
              leaveAt: call.time,
            };
      await db.berths.put(toPlain(next));
      berths.value = berths.value.map((b) => (b.id === berth.id ? next : b));
    }
    return call;
  }

  /**
   * 登记一条移泊记录：原泊位释放为空闲，新泊位记到该船与移泊时间。
   * 任一前置条件不满足都会抛出带原因的错误，且不写入任何数据（原记录保留）：
   * - 原泊位已被释放或不再由该船占用
   * - 两处泊位不属于同一渔港
   * - 新泊位已被占用（或处于维修中）
   * - 新泊位与原泊位相同
   */
  async function registerShift(input: {
    vesselId: string;
    vesselName: string;
    fromPortId: string;
    fromBerthNo: string;
    toPortId: string;
    toBerthNo: string;
    time: string;
  }): Promise<PortCall> {
    const fromBerth = berths.value.find((b) => b.portId === input.fromPortId && b.berthNo === input.fromBerthNo);
    if (!fromBerth) throw new Error('原泊位不存在，请重新选择');
    if (fromBerth.status !== '占用' || !fromBerth.vesselId) {
      throw new Error(`原泊位 ${input.fromBerthNo} 已被释放，无法移泊`);
    }
    if (fromBerth.vesselId !== input.vesselId) {
      throw new Error(`原泊位 ${input.fromBerthNo} 当前由 ${fromBerth.vesselName ?? '其他船舶'} 占用，并非所选渔船`);
    }

    if (input.toPortId !== input.fromPortId) {
      throw new Error('新泊位与原泊位不在同一渔港，不能登记移泊');
    }

    if (input.toBerthNo === input.fromBerthNo) {
      throw new Error('新泊位与原泊位相同，无需移泊');
    }

    const toBerth = berths.value.find((b) => b.portId === input.toPortId && b.berthNo === input.toBerthNo);
    if (!toBerth) throw new Error('新泊位不存在，请重新选择');
    if (toBerth.status === '占用' || toBerth.vesselId) {
      throw new Error(`新泊位 ${input.toBerthNo} 已被占用，请选择空闲泊位`);
    }
    if (toBerth.status === '维修') {
      throw new Error(`新泊位 ${input.toBerthNo} 正在维修，不能移泊`);
    }

    const time = input.time ? new Date(input.time).toISOString() : new Date().toISOString();
    const call: PortCall = {
      id: uid('c'),
      vesselId: input.vesselId,
      vesselName: input.vesselName,
      type: '移泊',
      time,
      berthNo: input.toBerthNo,
      fromBerthNo: input.fromBerthNo,
      toBerthNo: input.toBerthNo,
      iceKg: 0,
      fuelL: 0,
      unloadKg: 0,
      visaStatus: '待签证',
      createdAt: new Date().toISOString(),
    };

    const released: Berth = {
      ...fromBerth,
      status: '空闲',
      vesselId: null,
      vesselName: null,
      berthAt: null,
      leaveAt: time,
    };
    const occupied: Berth = {
      ...toBerth,
      status: '占用',
      vesselId: input.vesselId,
      vesselName: input.vesselName,
      berthAt: time,
      leaveAt: null,
    };

    // 校验全部通过后才在单事务内落库，保证流水与两个泊位状态一致
    await db.transaction('rw', db.calls, db.berths, async () => {
      await db.calls.put(toPlain(call));
      await db.berths.bulkPut([toPlain(released), toPlain(occupied)]);
    });

    calls.value = [...calls.value, call];
    berths.value = berths.value.map((b) =>
      b.id === released.id ? released : b.id === occupied.id ? occupied : b,
    );
    return call;
  }

  return {
    ports,
    berths,
    calls,
    loading,
    filter,
    filteredPorts,
    callsSorted,
    portById,
    berthsOf,
    callsOfVessel,
    resetFilter,
    loadAll,
    createPort,
    addBerth,
    setBerthStatus,
    updatePort,
    registerCall,
    registerShift,
  };
});
