import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, SectionList, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { loadHistory, clearHistory, groupByDate } from '../utils/storage';
import { CommandEntry } from '../types';
import { Colors } from '../config';

type Section = { title: string; data: CommandEntry[] };

export default function HistoryScreen() {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // 화면 포커스될 때마다 새로고침 (다른 탭에서 명령 보냈을 때 반영)
  useFocusEffect(
    useCallback(() => {
      fetchHistory();
    }, [])
  );

  async function fetchHistory() {
    setLoading(true);
    const entries = await loadHistory();
    setTotalCount(entries.length);
    setSections(groupByDate(entries));
    setLoading(false);
  }

  function handleClear() {
    Alert.alert(
      '기록 삭제',
      '모든 명령 기록을 삭제할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            await clearHistory();
            setSections([]);
            setTotalCount(0);
          },
        },
      ]
    );
  }

  // ── 섹션 헤더 (날짜) ─────────────────────────────────────────
  function renderSectionHeader({ section }: { section: Section }) {
    return (
      <View style={styles.sectionHeader}>
        <Ionicons name="calendar-outline" size={13} color={Colors.subtext} />
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Text style={styles.sectionCount}>{section.data.length}건</Text>
      </View>
    );
  }

  // ── 명령 행 ──────────────────────────────────────────────────
  function renderItem({ item, index, section }: { item: CommandEntry; index: number; section: Section }) {
    const isLast = index === section.data.length - 1;
    return (
      <View style={[styles.row, !isLast && styles.rowBorder]}>
        <Text style={styles.time}>{item.time}</Text>
        <Text style={styles.cmd}>{item.cmd}</Text>
        <View style={item.result === 'OK' ? styles.okBadge : styles.failBadge}>
          <Text style={item.result === 'OK' ? styles.okText : styles.failText}>
            {item.result}
          </Text>
        </View>
        <Text style={styles.latency}>{item.latency}ms</Text>
      </View>
    );
  }

  // ── 로딩 ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>

      {/* 헤더 */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>명령 기록</Text>
          <Text style={styles.headerSub}>총 {totalCount}개</Text>
        </View>
        {sections.length > 0 && (
          <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
            <Ionicons name="trash-outline" size={15} color={Colors.danger} />
            <Text style={styles.clearText}>전체 삭제</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 기록 없음 */}
      {sections.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="time-outline" size={56} color={Colors.border} />
          <Text style={styles.emptyTitle}>기록이 없습니다</Text>
          <Text style={styles.emptySub}>QR 스캔 또는 대시보드에서{'\n'}명령을 전송해보세요.</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          renderSectionHeader={renderSectionHeader}
          renderItem={renderItem}
          renderSectionFooter={() => <View style={styles.sectionGap} />}
          ItemSeparatorComponent={null}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.card,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 16, fontWeight: '600', color: Colors.text },
  headerSub:   { fontSize: 12, color: Colors.subtext, marginTop: 2 },
  clearBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  clearText:   { fontSize: 13, color: Colors.danger },

  listContent: { padding: 16, paddingBottom: 32 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 12, fontWeight: '600', color: Colors.subtext, flex: 1 },
  sectionCount: { fontSize: 11, color: Colors.subtext },
  sectionGap:   { height: 16 },

  row:       {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: Colors.card,
    gap: 6,
  },
  rowBorder: { borderBottomWidth: 0.5, borderBottomColor: Colors.border },

  // 첫 행에 상단 radius, 마지막 행에 하단 radius 적용은 SectionList 특성상
  // 섹션 전체를 감싸는 방식으로 처리
  time:    { fontSize: 11, color: Colors.subtext, width: 52 },
  cmd:     { fontSize: 11, color: Colors.primary, flex: 1, fontFamily: 'Courier' },
  latency: { fontSize: 10, color: Colors.subtext, width: 36, textAlign: 'right' },

  okBadge:   { backgroundColor: Colors.green_light, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  okText:    { fontSize: 10, color: Colors.success, fontWeight: '600' },
  failBadge: { backgroundColor: '#ffebe8', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  failText:  { fontSize: 10, color: Colors.danger, fontWeight: '600' },

  emptyTitle: { fontSize: 16, fontWeight: '600', color: Colors.subtext },
  emptySub:   { fontSize: 13, color: Colors.border, textAlign: 'center', marginTop: 4 },
});
