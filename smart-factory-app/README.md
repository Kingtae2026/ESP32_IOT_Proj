# Smart Factory App

ESP32 IoT 제어 시스템용 React Native 모바일 앱

---

## 구조

```
[모바일 앱] → HTTP → [Node.js 서버 (PC)] → TCP:8888 → [Lolin D32]
                                         ↕
                              [ESP32-CAM :81/stream]
```

---

## 실행 순서

### 1단계: PC IP 확인

Windows cmd에서:
```
ipconfig
```
`IPv4 주소` 항목 확인 (예: 192.168.1.100)

### 2단계: config.ts 수정

```typescript
// config.ts
export const SERVER_URL = 'http://192.168.1.100:3000';  // ← PC IP로 변경
```

### 3단계: 서버 실행 (PC)

```bash
cd server
npm install
npm start
```

서버가 시작되면 터미널에 접속 주소가 표시됩니다.

### 4단계: 앱 실행 (휴대폰)

```bash
# 앱 루트 폴더에서
npm install
npx expo start
```

QR 코드가 나오면 Expo Go 앱으로 스캔하거나,
`a` 키를 눌러 Android 에뮬레이터에서 실행합니다.

---

## 주의사항

- PC와 휴대폰이 **같은 Wi-Fi**에 연결되어 있어야 합니다
- PC에서 서버를 **먼저** 실행한 후 앱을 켜야 합니다
- `server/index.js`의 `ESP32_IP`가 Lolin D32의 실제 IP와 일치해야 합니다

---

## 앱 기능

| 탭 | 기능 |
|---|---|
| Dashboard | 기기 상태 + 빠른 제어 + 최근 10개 롤링 로그 |
| QR 스캔 | 카메라로 QR 스캔 → 자동 명령 전송 |
| History | 날짜별 전체 명령 기록 (영구 저장) |
