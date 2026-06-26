import React, { useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDevice } from '../context/DeviceContext';
import { Colors, COMMAND_META, VALID_COMMANDS, CommandName } from '../config';
import { CommandEntry, RelayStatus, ServoStatus, BuzzerStatus } from '../types';

// ─── 상태 배지 ───────────────────────────────────────────────
type AnyStatus = RelayStatus | ServoStatus | BuzzerStatus;

const STATUS_COLOR: Record<AnyStatus, { bg: string; text: string }> = {
  ON:     { bg: Colors.green_light, text: Colors.success },
  OFF:    { bg: '#f2f2f7',           text: Colors.subtext  },
  OPEN:   { bg: Colors.blue_light,  text: Colors.primary  },
  CLOSED: { bg: '#f2f2f7',           text: Colors.subtext  },
  ACTIVE: { bg: Colors.amber_light, text: Colors.warning  },
  IDLE:   { bg: '#f2f2f7',           text: Colors.subtext  },
};

function StatusBadge({ status }: { status: AnyStatus }) {
  const { bg, text } = STATUS_COLOR[status];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: text }]}>{status}</Text>
    </View>
  );
}

// ─── 디바이스 카드 ───────────────────────────────────────────
function DeviceCard({
  title, sub, status, accentColor,
}: {
  title: string; sub: string; status: AnyStatus; accentColor: string;
}) {
  return (
    <View style={[styles.deviceCard, { borderTopColor: accentColor }]}>
      <Text style={styles.cardTitle}>{title}</Text>
      <StatusBadge status={status} />
      <Text style={styles.cardSub}>{sub}</Text>
    </View>
  );
}

// ─── 명령 기록 행 ────────────────────────────────────────────
function LogRow({ item, isLast }: { item: CommandEntry; isLast: boolean }) {
  return (
    <View style={[styles.logRow, !isLast && styles.logRowBorder]}>
      <Text style={styles.logTime}>{item.time}</Text>
      <Text style={styles.logCmd}>{item.cmd}</Text>
      <View style={styles.okBadge}>
        <Text style={styles.okText}>OK</Text>
      </View>
      <Text style={styles.logLatency}>{item.latency}ms</Text>
    </View>
  );
}

// ─── 메인 화면 ───────────────────────────────────────────────
export default function DashboardScreen() {
  const { relay, servo, buzzer, dashLog, serverOnline, isSending, dispatch, pingServer } = useDevice();

  useEffect(() => {
    pingServer();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* 서버 연결 상태 */}
        <View style={styles.serverRow}>
          <View style={[styles.dot, { backgroundColor: serverOnline ? Colors.success : '#ff3b30' }]} />
          <Text style={styles.serverText}>
            LOLIN D32  ·  {serverOnline ? 'ONLINE' : 'OFFLINE'}
          </Text>
          <TouchableOpacity onPress={pingServer} style={styles.refreshBtn}>
            <Ionicons name="refresh-outline" size={16} color={Colors.subtext} />
          </TouchableOpacity>
        </View>

        {/* 디바이스 상태 카드 */}
        <Text style={styles.sectionTitle}>기기 상태</Text>
        <View style={styles.cardRow}>
          <DeviceCard title="Relay" sub="GPIO 25" status={relay}  accentColor={Colors.success} />
          <DeviceCard title="Servo" sub="GPIO 13/16" status={servo}  accentColor={Colors.primary} />
          <DeviceCard title="Buzzer" sub="GPIO 26" status={buzzer} accentColor={Colors.warning} />
        </View>

        {/* 빠른 제어 */}
        <Text style={styles.sectionTitle}>빠른 제어</Text>
        <FlatList
          data={VALID_COMMANDS}
          keyExtractor={item => item}
          numColumns={2}
          scrollEnabled={false}
          columnWrapperStyle={styles.cmdRow}
          renderItem={({ item }) => {
            const meta = COMMAND_META[item as CommandName];
            return (
              <TouchableOpacity
                style={styles.cmdBtn}
                onPress={() => dispatch(item)}
                disabled={isSending}
                activeOpacity={0.7}
              >
                {isSending ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <Ionicons name={meta.icon as any} size={18} color={meta.color} />
                )}
                <Text style={styles.cmdText}>{item}</Text>
              </TouchableOpacity>
            );
          }}
        />

        {/* 최근 명령 (롤링 10개) */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>최근 명령</Text>
          <Text style={styles.sectionSub}>최대 10개</Text>
        </View>
        <View style={styles.logCard}>
          {dashLog.length === 0 ? (
            <Text style={styles.emptyText}>아직 명령을 전송하지 않았습니다</Text>
          ) : (
            dashLog.map((item, index) => (
              <LogRow key={item.id} item={item} isLast={index === dashLog.length - 1} />
            ))
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.background },
  scroll:      { padding: 16, paddingBottom: 32 },

  serverRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  dot:         { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  serverText:  { fontSize: 12, color: Colors.subtext, flex: 1 },
  refreshBtn:  { padding: 4 },

  sectionTitle:{ fontSize: 14, fontWeight: '600', color: Colors.text, marginBottom: 10 },
  sectionSub:  { fontSize: 11, color: Colors.subtext },
  sectionHeader:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 4 },

  cardRow:     { flexDirection: 'row', gap: 8, marginBottom: 20 },
  deviceCard:  {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 10,
    borderTopWidth: 3,
    borderWidth: 0.5,
    borderColor: Colors.border,
  },
  cardTitle:   { fontSize: 12, fontWeight: '600', color: Colors.text, marginBottom: 6 },
  cardSub:     { fontSize: 10, color: Colors.subtext, marginTop: 6 },

  badge:       { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText:   { fontSize: 10, fontWeight: '600' },

  cmdRow:      { gap: 8, marginBottom: 8 },
  cmdBtn:      {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: Colors.border,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cmdText:     { fontSize: 11, color: Colors.text, fontFamily: 'Courier', flex: 1 },

  logCard:     { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 0.5, borderColor: Colors.border, overflow: 'hidden', marginBottom: 20 },
  logRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 12, gap: 6 },
  logRowBorder:{ borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  logTime:     { fontSize: 10, color: Colors.subtext, width: 50 },
  logCmd:      { fontSize: 11, color: Colors.primary, flex: 1, fontFamily: 'Courier' },
  logLatency:  { fontSize: 10, color: Colors.subtext, width: 36, textAlign: 'right' },

  okBadge:     { backgroundColor: Colors.green_light, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  okText:      { fontSize: 10, color: Colors.success, fontWeight: '600' },

  emptyText:   { padding: 16, textAlign: 'center', fontSize: 12, color: Colors.subtext },
});
