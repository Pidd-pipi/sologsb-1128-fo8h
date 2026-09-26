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
  /** 泊位号（移泊时为新泊位号） */
  berthNo: string;
  /** 移泊前泊位号（仅 type === '移泊' 时有值） */
  fromBerthNo?: string;
  /** 移泊后泊位号（仅 type === '移泊' 时有值，与 berthNo 相同） */
  toBerthNo?: string;
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
  /** 移泊前泊位号（仅移泊登记使用） */
  fromBerthNo?: string;
  /** 移泊后泊位号（仅移泊登记使用） */
  toBerthNo?: string;
  iceKg: number;
  fuelL: number;
  unloadKg: number;
  visaStatus: VisaStatus;
}

/** 流水泊位号展示：移泊显示「B01→B02」，其余类型显示单个泊位号 */
export function callBerthLabel(call: Pick<PortCall, 'type' | 'berthNo' | 'fromBerthNo' | 'toBerthNo'>): string {
  if (call.type === '移泊') {
    const to = call.toBerthNo || call.berthNo;
    return call.fromBerthNo && to ? `${call.fromBerthNo}→${to}` : to || '—';
  }
  return call.berthNo || '—';
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
