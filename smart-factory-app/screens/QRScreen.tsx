import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useDevice } from '../context/DeviceContext';
import { Colors, COMMAND_META, VALID_COMMANDS, CommandName } from '../config';

const COOLDOWN_MS = 4000; // 같은 QR 연속 인식 방지 (4초)

export default function QRScreen() {
  const { dispatch, isSending } = useDevice();
  const [permission, requestPermission] = useCameraPermissions();
  const [lastDetected, setLastDetected] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const isProcessing = useRef(false);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout>>();

  // QR 스캔 처리
  const handleBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (isProcessing.current) return;

      // 유효한 명령인지 확인
      const validCmds: readonly string[] = VALID_COMMANDS;
      if (!validCmds.includes(data)) return;

      isProcessing.current = true;
      setLastDetected(data);

      dispatch(data).finally(() => {
        clearTimeout(cooldownTimer.current);
        cooldownTimer.current = setTimeout(() => {
          isProcessing.current = false;
          setLastDetected(null);
        }, COOLDOWN_MS);
      });
    },
    [dispatch]
  );

  // ── 카메라 권한 미허용 ───────────────────────────────────────
  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.center}>
          <Ionicons name="camera-outline" size={60} color={Colors.subtext} />
          <Text style={styles.permTitle}>카메라 권한 필요</Text>
          <Text style={styles.permSub}>QR 코드를 스캔하려면 카메라 접근 권한이 필요합니다.</Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>권한 허용</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── 메인 QR 화면 ─────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>

      {/* 카메라 뷰파인더 */}
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={isProcessing.current ? undefined : handleBarcodeScanned}
        />

        {/* 뷰파인더 모서리 */}
        {(['tl', 'tr', 'bl', 'br'] as const).map(pos => (
          <View
            key={pos}
            style={[
              styles.corner,
              pos === 'tl' && styles.cornerTL,
              pos === 'tr' && styles.cornerTR,
              pos === 'bl' && styles.cornerBL,
              pos === 'br' && styles.cornerBR,
            ]}
          />
        ))}

        {/* 스캔 결과 오버레이 */}
        {lastDetected && (
          <View style={styles.detectedOverlay}>
            {isSending ? (
              <ActivityIndicator color="#fff" size="large" />
            ) : (
              <Ionicons name="checkmark-circle" size={48} color="#5DCAA5" />
            )}
            <Text style={styles.detectedCmd}>{lastDetected}</Text>
            <Text style={styles.detectedSub}>
              {isSending ? '전송 중...' : '전송 완료 ✓'}
            </Text>
          </View>
        )}

        {/* 안내 텍스트 */}
        {!lastDetected && (
          <View style={styles.scanGuide}>
            <Text style={styles.scanGuideText}>QR 코드를 사각형 안에 맞춰주세요</Text>
          </View>
        )}
      </View>

      {/* 수동 명령 전송 (접이식) */}
      <View style={styles.manualSection}>
        <TouchableOpacity
          style={styles.manualToggle}
          onPress={() => setManualOpen(o => !o)}
        >
          <Ionicons name="list-outline" size={16} color={Colors.subtext} />
          <Text style={styles.manualToggleText}>수동 명령 전송</Text>
          <Ionicons
            name={manualOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
            size={16}
            color={Colors.subtext}
          />
        </TouchableOpacity>

        {manualOpen && (
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
                  <Ionicons name={meta.icon as any} size={16} color={meta.color} />
                  <Text style={styles.cmdText}>{item}</Text>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;
const CORNER_COLOR = 'rgba(255,255,255,0.85)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: Colors.background },

  // 카메라
  cameraWrap: { flex: 1, position: 'relative', overflow: 'hidden' },

  // 모서리 마커
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: CORNER_COLOR,
    borderStyle: 'solid',
  },
  cornerTL: { top: 40, left: 40, borderTopWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS, borderTopLeftRadius: 4 },
  cornerTR: { top: 40, right: 40, borderTopWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS, borderTopRightRadius: 4 },
  cornerBL: { bottom: 40, left: 40, borderBottomWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 40, right: 40, borderBottomWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS, borderBottomRightRadius: 4 },

  // 결과 오버레이
  detectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  detectedCmd: { color: '#fff', fontSize: 18, fontWeight: '600', fontFamily: 'Courier' },
  detectedSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },

  // 안내
  scanGuide:     { position: 'absolute', bottom: 20, left: 0, right: 0, alignItems: 'center' },
  scanGuideText: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },

  // 수동 제어 섹션
  manualSection: { backgroundColor: Colors.card },
  manualToggle:  {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 14, borderTopWidth: 0.5, borderTopColor: Colors.border,
  },
  manualToggleText: { flex: 1, fontSize: 13, color: Colors.subtext },

  cmdRow: { gap: 8, paddingHorizontal: 12, marginBottom: 8 },
  cmdBtn: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: Colors.border,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cmdText: { fontSize: 10, color: Colors.text, fontFamily: 'Courier', flex: 1 },

  // 권한 요청
  permTitle:   { fontSize: 18, fontWeight: '600', color: Colors.text, marginTop: 16, marginBottom: 8 },
  permSub:     { fontSize: 14, color: Colors.subtext, textAlign: 'center', marginBottom: 24 },
  permBtn:     { backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 12 },
  permBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
