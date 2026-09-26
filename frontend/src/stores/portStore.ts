import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../db';
import { toPlain, uid } from '../utils/format';
import { emptyPortFilter, type FishingPort, type PortFilter, type SupplyCapability } from '../types/port';
import type { Berth, BerthStatus } from '../types/berth';
import type { CallDraft, PortCall, ShiftDraft } from '../types/call';
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
   * 登记一次移泊：同一渔港内把船从原泊位置换到新泊位。
   * 在同一事务内完成「写流水 + 释放原泊位 + 占用新泊位」，任一校验失败整体回滚、保留原记录。
   * @throws Error 带中文原因：原泊位已释放 / 不属该船 / 两泊位不在同一渔港 / 新泊位被占用
   */
  async function registerShift(draft: ShiftDraft, vesselName: string): Promise<PortCall> {
    // 用对象承载事务内产物：TS 控制流不跟踪闭包内对 let 的赋值，但会保留对象属性类型
    const result: { call?: PortCall; freed?: Berth; occupied?: Berth } = {};
    await db.transaction('rw', db.calls, db.berths, async () => {
      // 事务内从库里重新读取，避免页面数据过期导致误判
      const fromBerth = await db.berths.get(`${draft.fromPortId}-${draft.fromBerthNo}`);
      const toBerth = await db.berths.get(`${draft.toPortId}-${draft.toBerthNo}`);

      if (!fromBerth || fromBerth.status !== '占用') {
        throw new Error(`原泊位 ${draft.fromBerthNo} 已被释放，当前不是占用状态`);
      }
      if (fromBerth.vesselId !== draft.vesselId) {
        throw new Error(`原泊位 ${draft.fromBerthNo} 上不是该船（当前为 ${fromBerth.vesselName ?? '其他船舶'}），不能代为移泊`);
      }
      if (!toBerth || toBerth.portId !== fromBerth.portId) {
        throw new Error('两处泊位不在同一渔港，不能办理移泊');
      }
      if (fromBerth.berthNo === toBerth.berthNo) {
        throw new Error('原泊位与新泊位相同，无需移泊');
      }
      if (toBerth.status !== '空闲') {
        throw new Error(`新泊位 ${toBerth.berthNo} 已被占用${toBerth.vesselName ? `（${toBerth.vesselName}）` : ''}，请改选空闲泊位`);
      }

      const time = draft.time ? new Date(draft.time).toISOString() : new Date().toISOString();
      const call: PortCall = {
        id: uid('c'),
        vesselId: draft.vesselId,
        vesselName,
        type: '移泊',
        time,
        berthNo: toBerth.berthNo,
        fromBerthNo: fromBerth.berthNo,
        iceKg: 0,
        fuelL: 0,
        unloadKg: 0,
        visaStatus: draft.visaStatus,
        createdAt: new Date().toISOString(),
      };
      await db.calls.put(toPlain(call));

      const freed: Berth = {
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
        vesselId: draft.vesselId,
        vesselName,
        berthAt: time,
        leaveAt: null,
      };
      await db.berths.put(toPlain(freed));
      await db.berths.put(toPlain(occupied));
      result.call = call;
      result.freed = freed;
      result.occupied = occupied;
    });
    // 事务提交成功后再同步内存状态；校验失败时事务回滚，原有占用关系原样保留
    const { call, freed: nextFrom, occupied: nextTo } = result;
    if (!call || !nextFrom || !nextTo) throw new Error('移泊登记未完成，请重试');
    berths.value = berths.value.map((b) =>
      b.id === nextFrom.id ? nextFrom : b.id === nextTo.id ? nextTo : b,
    );
    calls.value = [...calls.value, call];
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
