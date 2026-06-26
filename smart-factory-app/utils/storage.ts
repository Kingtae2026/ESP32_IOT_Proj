import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommandEntry } from '../types';

const STORAGE_KEY = 'shc_history_v1';
const MAX_ENTRIES = 500;

export async function loadHistory(): Promise<CommandEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CommandEntry[];
  } catch {
    return [];
  }
}

export async function appendEntry(entry: CommandEntry): Promise<void> {
  try {
    const existing = await loadHistory();
    const updated = [entry, ...existing].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // 저장 실패는 무시 (앱 동작에 영향 없음)
  }
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

// 날짜별로 그룹핑 (최신 날짜 먼저)
export function groupByDate(
  entries: CommandEntry[]
): { title: string; data: CommandEntry[] }[] {
  const map: Record<string, CommandEntry[]> = {};
  for (const e of entries) {
    if (!map[e.date]) map[e.date] = [];
    map[e.date].push(e);
  }
  return Object.keys(map)
    .sort()
    .reverse()
    .map(date => ({ title: date, data: map[date] }));
}
