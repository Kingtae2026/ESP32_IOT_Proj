import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from 'react';
import { Alert } from 'react-native';
import { sendCommand, checkHealth } from '../utils/api';
import { appendEntry } from '../utils/storage';
import { CommandEntry, RelayStatus, ServoStatus, BuzzerStatus } from '../types';

interface DeviceContextType {
  relay: RelayStatus;
  servo: ServoStatus;
  buzzer: BuzzerStatus;
  dashLog: CommandEntry[];       // 대시보드용 최근 10개 (롤링)
  serverOnline: boolean;
  isSending: boolean;
  dispatch: (cmd: string) => Promise<void>;
  pingServer: () => Promise<void>;
}

const DeviceContext = createContext<DeviceContextType | null>(null);

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [relay,  setRelay]  = useState<RelayStatus>('OFF');
  const [servo,  setServo]  = useState<ServoStatus>('CLOSED');
  const [buzzer, setBuzzer] = useState<BuzzerStatus>('IDLE');
  const [dashLog, setDashLog]   = useState<CommandEntry[]>([]);
  const [serverOnline, setServerOnline] = useState(false);
  const [isSending, setIsSending]       = useState(false);
  const buzzerTimer = useRef<ReturnType<typeof setTimeout>>();

  // 디바이스 상태 업데이트
  const applyStatus = useCallback((cmd: string) => {
    switch (cmd) {
      case 'light_on':     setRelay('ON');     break;
      case 'light_off':    setRelay('OFF');    break;
      case 'curtain_open': setServo('OPEN');   break;
      case 'curtain_close':setServo('CLOSED'); break;
      case 'all_active':
        setRelay('ON'); setServo('OPEN');
        setBuzzer('ACTIVE');
        clearTimeout(buzzerTimer.current);
        buzzerTimer.current = setTimeout(() => setBuzzer('IDLE'), 3000);
        break;
      case 'all_deactive':
        setRelay('OFF'); setServo('CLOSED');
        setBuzzer('ACTIVE');
        clearTimeout(buzzerTimer.current);
        buzzerTimer.current = setTimeout(() => setBuzzer('IDLE'), 3000);
        break;
    }
  }, []);

  // 명령 전송 (API → 상태 업데이트 → 기록 저장)
  const dispatch = useCallback(async (cmd: string) => {
    if (isSending) return;
    setIsSending(true);

    try {
      const { latency } = await sendCommand(cmd);
      const now = new Date();
      const entry: CommandEntry = {
        id:      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        date:    now.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }),
        time:    now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        cmd,
        result:  'OK',
        latency,
      };

      applyStatus(cmd);
      setDashLog(prev => [entry, ...prev].slice(0, 10)); // 최대 10개 롤링
      setServerOnline(true);
      await appendEntry(entry);  // AsyncStorage 저장
    } catch (err: any) {
      setServerOnline(false);
      Alert.alert(
        '전송 실패',
        err.message ?? '알 수 없는 오류가 발생했습니다.',
        [{ text: '확인' }]
      );
    } finally {
      setIsSending(false);
    }
  }, [isSending, applyStatus]);

  // 서버 상태 확인
  const pingServer = useCallback(async () => {
    const online = await checkHealth();
    setServerOnline(online);
  }, []);

  return (
    <DeviceContext.Provider
      value={{ relay, servo, buzzer, dashLog, serverOnline, isSending, dispatch, pingServer }}
    >
      {children}
    </DeviceContext.Provider>
  );
}

export function useDevice(): DeviceContextType {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useDevice must be used within DeviceProvider');
  return ctx;
}
