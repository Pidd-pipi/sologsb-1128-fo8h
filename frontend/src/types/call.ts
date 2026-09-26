/** 进出港类型 */
export type CallType = '进港' | '出港' | '移泊';

export const CALL_TYPES: CallType[] = ['进港', '出港', '移泊'];

/** 签证状态 */
export type VisaStatus = '已签证' | '待签证' | '免签';

export const VISA_STATUSES: VisaStatus[] = ['已签证', '待签证', '免签'];

/** 进出港记录 */
export interface PortCall {
  id: string;
  /** 渔船 id */
  vesselId: string;
  /** 渔船名（冗余，便于流水展示） */
  vesselName: string;
  /** 类型：进港 / 出港 / 移泊 */
  type: CallType;
  /** 时间（ISO 字符串） */
  time: string;
  /** 泊位号；移泊时为新泊位号 */
  berthNo: string;
  /** 移泊前的原泊位号（仅移泊流水有值） */
  fromBerthNo?: string | null;
  /** 加冰 kg */
  iceKg: number;
  /** 加油 L */
  fuelL: number;
  /** 卸货量 kg */
  unloadKg: number;
  /** 签证状态 */
  visaStatus: VisaStatus;
  createdAt: string;
}

/** 进出港登记表单模型 */
export interface CallDraft {
  vesselId: string;
  type: CallType;
  time: string;
  berthNo: string;
  iceKg: number;
  fuelL: number;
  unloadKg: number;
  visaStatus: VisaStatus;
}

/** 移泊登记表单模型：同一渔港内原泊位 → 新泊位 */
export interface ShiftDraft {
  vesselId: string;
  time: string;
  /** 原泊位所属渔港 id */
  fromPortId: string;
  /** 原泊位号 */
  fromBerthNo: string;
  /** 新泊位所属渔港 id（必须与 fromPortId 相同） */
  toPortId: string;
  /** 新泊位号 */
  toBerthNo: string;
  visaStatus: VisaStatus;
}

export function emptyCallDraft(berthNo = ''): CallDraft {
  return {
    vesselId: '',
    type: '进港',
    time: '',
    berthNo,
    iceKg: 0,
    fuelL: 0,
    unloadKg: 0,
    visaStatus: '待签证',
  };
}

/** 流水泊位展示文本：移泊显示「B01→B02」，进港 / 出港显示泊位号 */
export function callBerthText(call: Pick<PortCall, 'type' | 'berthNo' | 'fromBerthNo'>): string {
  if (call.type === '移泊' && call.fromBerthNo) return `${call.fromBerthNo}→${call.berthNo}`;
  return call.berthNo;
}
