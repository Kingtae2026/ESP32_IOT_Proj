export interface CommandEntry {
  id: string;
  date: string;   // 'YYYY. MM. DD.' 형식
  time: string;   // 'HH:MM:SS' 형식
  cmd: string;
  result: 'OK' | 'FAIL';
  latency: number;
}

export type RelayStatus  = 'ON' | 'OFF';
export type ServoStatus  = 'OPEN' | 'CLOSED';
export type BuzzerStatus = 'ACTIVE' | 'IDLE';

export interface DeviceState {
  relay:  RelayStatus;
  servo:  ServoStatus;
  buzzer: BuzzerStatus;
}
