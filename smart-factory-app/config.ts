// ============================================================
//  ⚙️  설정 파일 - IP 주소만 변경하면 됩니다
// ============================================================

// PC의 IP 주소를 입력하세요 (cmd에서 ipconfig 실행 후 확인)
// 예: 'http://192.168.0.23:3000'
export const SERVER_URL = 'http://192.168.0.23:3000';

// ============================================================

export const VALID_COMMANDS = [
  'light_on',
  'light_off',
  'gate_open',
  'gate_close',
  'all_active',
  'all_deactive',
] as const;

export type CommandName = (typeof VALID_COMMANDS)[number];

export interface CommandMeta {
  label: string;
  icon: string;
  color: string;
}

export const COMMAND_META: Record<CommandName, CommandMeta> = {
  light_on:     { label: '조명 ON',   icon: 'sunny-outline',    color: '#1a9e6b' },
  light_off:    { label: '조명 OFF',  icon: 'moon-outline',     color: '#636363' },
  gate_open:  { label: '게이트 열기', icon: 'expand-outline',   color: '#185fa5' },
  gate_close: { label: '게이트 닫기', icon: 'contract-outline', color: '#636363' },
  all_active:   { label: '전체 ON',   icon: 'flash-outline',    color: '#ba7517' },
  all_deactive: { label: '전체 OFF',  icon: 'power-outline',    color: '#a32d2d' },
};

export const Colors = {
  primary:    '#185fa5',
  success:    '#1a9e6b',
  warning:    '#ba7517',
  danger:     '#a32d2d',
  background: '#f2f2f7',
  card:       '#ffffff',
  text:       '#000000',
  subtext:    '#6e6e73',
  border:     '#c6c6c8',
  blue_light: '#e6f1fb',
  green_light:'#e1f5ee',
  amber_light:'#faeeda',
};
