# TCP/IP 기반 스마트 팩토리 자동화 시스템

ESP32(Lolin D32 + ESP32-CAM), LattePanda, React Native, Node.js를 연동한 IoT 공장 설비 원격 제어 시스템입니다.

## 시스템 구성도

![시스템 구성도](docs/images/시스템%20구성도.png)

## 하드웨어 구성도

![하드웨어 구성도](docs/images/하드웨어%20구성도.png)

---

## 전체 동작 흐름

```
[관리자 앱] ──HTTP──▶ [Node.js 중계 서버] ──TCP 8888──▶ [Lolin D32 ESP32]
                                                               ├─ GPIO 25  → 릴레이 (조명/설비 전원)
                                                               ├─ GPIO 13  → 서보모터 1 (차단기/게이트)
                                                               └─ GPIO 16  → 서보모터 2 (차단기/게이트)

[LattePanda] ──OpenCV QR 인식──▶ ──TCP 8888──▶ [Lolin D32 ESP32]

[ESP32-CAM] ──MJPEG 스트림──▶ [LattePanda] (현장 카메라 피드 → QR 코드 디코딩)
```

---

## 주요 기능

### 1. TCP 소켓 서버 (ESP32 Firmware)
- lwIP POSIX Socket API로 포트 **8888**에서 원격 명령 수신 및 응답
- 수신 타임아웃 · Wi-Fi 자동 재연결 로직 포함
- FreeRTOS **Server Task / Executor Task** 분리로 생산자-소비자 패턴 구현
  - 두 클라이언트(PC QR 인식 · 관리자 앱)가 동시에 명령을 보내도 Queue를 통해 순서대로 충돌 없이 처리

### 2. GPIO 릴레이 제어
- `esp-idf driver/gpio` API로 **GPIO 25** 릴레이 직접 제어
- 공장 조명 / 설비 전원 ON / OFF 구현

### 3. LEDC PWM 서보모터 2채널 제어
- 50 Hz, 14-bit 해상도 PWM 신호로 서보모터 2개(**GPIO 13, GPIO 16**) 정밀 제어
- 공장 게이트 / 차단기 개폐 동작 구현

### 4. ESP32-CAM 실시간 MJPEG 스트리밍
- ESP-IDF HTTP 서버 + 멀티파트 스트림으로 현장 실시간 영상 제공
- JPEG 스냅샷 엔드포인트 구현

![ESP32CAM 스트리밍](docs/images/ESP32CAM%20%EC%8A%A4%ED%8A%B8%EB%A6%AC%EB%B0%8D.png)

### 5. OpenCV QR 코드 인식 (C++, LattePanda)
- LattePanda에서 ESP32-CAM MJPEG 스트림을 수신하여 실시간 QR 코드 디코딩
- 인식된 명령(`light_on`, `curtain_open` 등)을 TCP 소켓으로 Lolin D32에 즉시 전송

### 6. Node.js TCP 중계 서버
- 관리자 앱의 HTTP 요청 → ESP32 TCP 소켓으로 변환하는 중계 서버 (`server/index.js`)
- ESP32 응답 타임아웃 7초, BUSY 응답 처리
- `GET /health` 로 서버 상태 확인, `POST /command` 로 명령 전송
- 자동 IP 감지 기능 포함 (서버 시작 시 로컬 IP 출력)

### 7. React Native 관리자 모바일 앱
- EAS Build로 Android APK 빌드 및 배포
- 3개 탭 구성: **Dashboard · QR Scan · History**

---

## 관리자 모바일 앱 상세

### Dashboard 탭

![관리자 앱 대시보드](docs/images/관리자%20모바일%20앱%20대시보드.png)

**서버 연결 상태 표시**
- 상단에 Lolin D32의 ONLINE / OFFLINE 상태를 실시간으로 표시
- 새로고침 버튼으로 서버 상태 즉시 재확인 (`GET /health` 호출)

**기기 상태 카드 (3종)**

| 카드 | GPIO | 상태값 |
|---|---|---|
| Relay | GPIO 25 | ON / OFF |
| Servo | GPIO 13/16 | OPEN / CLOSED |
| Buzzer | GPIO 26 | ACTIVE / IDLE |

- 명령 전송 즉시 카드 상태가 갱신됨 (서버 응답 확인 후 업데이트)
- `all_active` / `all_deactive` 명령 시 Buzzer는 3초 후 자동으로 IDLE로 복귀

**빠른 제어 버튼 (6종)**

| 명령 | 동작 | 아이콘 |
|---|---|---|
| `light_on` | 설비 전원 켜기 (릴레이 ON) | 태양 |
| `light_off` | 설비 전원 끄기 (릴레이 OFF) | 달 |
| `gate_open` | 게이트 열기 (서보모터) | 확장 |
| `gate_close` | 게이트 닫기 (서보모터) | 축소 |
| `all_active` | 전체 설비 활성화 | 번개 |
| `all_deactive` | 전체 설비 비활성화 | 전원 |

- 명령 전송 중 버튼 전체 비활성화(중복 전송 방지) + ActivityIndicator 표시

**최근 명령 로그 (롤링 10개)**
- 명령 전송 성공 시 대시보드 로그에 실시간 추가 (앱 메모리, 최대 10개 유지)
- 각 행: `시각` · `명령어` · `OK 배지` · `응답 지연(ms)` 표시

---

### QR Scan 탭

![관리자 앱 QR 스캔](docs/images/관리자%20모바일%20앱%20QR%20%EC%8A%A4%EC%BA%94.png)

**카메라 뷰파인더**
- expo-camera의 `CameraView`로 후면 카메라를 열어 QR 코드를 실시간 스캔
- 화면 네 모서리에 흰색 코너 마커를 렌더링하여 스캔 영역을 시각적으로 안내

**QR 코드 인식 및 명령 전송 흐름**
1. QR 코드에 인코딩된 텍스트가 유효한 명령(`VALID_COMMANDS` 목록)인지 확인
2. 유효하면 즉시 중계 서버로 HTTP POST 전송
3. 전송 중: 카메라 위에 반투명 오버레이 + ActivityIndicator 표시
4. 전송 완료: 체크 아이콘 + 명령어 이름 + "전송 완료 ✓" 표시
5. **4초 쿨다운** 후 다음 QR 스캔 재개 (연속 중복 인식 방지)

**수동 명령 전송 패널 (접이식)**
- 화면 하단의 "수동 명령 전송" 토글을 누르면 6개의 명령 버튼이 펼쳐짐
- QR 코드 없이도 카메라 화면에서 직접 명령 전송 가능

---

### History 탭

![관리자 앱 기록](docs/images/관리자%20모바일%20앱%20기록.png)

**날짜별 명령 기록 조회**
- 탭에 포커스될 때마다 AsyncStorage에서 기록을 자동으로 새로고침
  - 다른 탭(Dashboard, QR)에서 명령을 보낸 후 전환해도 즉시 반영됨
- 날짜별로 섹션 헤더(`yyyy. mm. dd.`)와 해당 날짜의 명령 수를 표시
- 최신 날짜가 가장 위에 오도록 역순 정렬

**기록 항목 구성**

| 항목 | 설명 |
|---|---|
| 시각 | 명령을 전송한 시간 (HH:MM:SS) |
| 명령어 | `light_on`, `curtain_open` 등 |
| 결과 배지 | `OK` (초록) / `FAIL` (빨강) |
| 응답 지연 | 중계 서버까지의 왕복 시간(ms) |

**저장 및 관리**
- `AsyncStorage`에 키 `shc_history_v1`로 JSON 저장, 최대 **500개** 누적 보관
- 헤더 우측 "전체 삭제" 버튼으로 기록 초기화 (확인 Alert 포함)

---

## 상태 관리 구조 (`DeviceContext`)

앱 전체 상태를 React Context로 중앙 관리합니다.

```
DeviceContext
├── relay:        RelayStatus   ('ON' | 'OFF')
├── servo:        ServoStatus   ('OPEN' | 'CLOSED')
├── buzzer:       BuzzerStatus  ('ACTIVE' | 'IDLE')
├── dashLog:      CommandEntry[]  (최근 10개 롤링)
├── serverOnline: boolean
├── isSending:    boolean
├── dispatch(cmd) → API 호출 → 상태 업데이트 → AsyncStorage 저장
└── pingServer()  → /health 체크 → serverOnline 갱신
```

명령 전송 시 흐름:
1. `dispatch(cmd)` 호출 → `isSending = true` (중복 전송 차단)
2. `POST /command` → 중계 서버 → ESP32 TCP 전송 → 응답 수신
3. 성공 시: 기기 상태 업데이트 + dashLog 앞에 추가 + AsyncStorage 저장
4. 실패 시: `serverOnline = false` + Alert 팝업

---

## 디렉터리 구조

```
ESP32_IOT/
├── esp32-firmware/
│   ├── lolin_d32/
│   │   └── main/main.c          # TCP 소켓 서버, GPIO 릴레이, LEDC PWM, FreeRTOS Queue
│   └── esp32_cam/
│       └── main/main.c          # MJPEG 스트리밍 HTTP 서버, 카메라 초기화
├── smart-factory-app/           # React Native 앱 + Node.js 중계 서버
│   ├── App.tsx                  # 탭 네비게이터 (Dashboard / QR / History)
│   ├── config.ts                # SERVER_URL · 명령 목록 · 색상 테마
│   ├── types.ts                 # CommandEntry · 상태 타입 정의
│   ├── screens/
│   │   ├── DashboardScreen.tsx  # 기기 상태 카드 · 빠른 제어 · 최근 로그
│   │   ├── QRScreen.tsx         # QR 스캔 카메라 · 수동 명령 패널
│   │   └── HistoryScreen.tsx    # 날짜별 명령 기록 · 전체 삭제
│   ├── context/
│   │   └── DeviceContext.tsx    # 전역 상태 관리 (React Context)
│   ├── utils/
│   │   ├── api.ts               # HTTP 통신 (sendCommand / checkHealth)
│   │   └── storage.ts           # AsyncStorage 기록 저장·조회·날짜 그룹핑
│   └── server/
│       └── index.js             # Node.js TCP 중계 서버 (포트 3000)
└── docs/
    └── images/                  # 시스템 구성도 · 하드웨어 · 앱 스크린샷
```

---

## 기술 스택

| 구분 | 기술 |
|---|---|
| ESP32 펌웨어 | ESP-IDF, FreeRTOS Queue, lwIP POSIX Socket, LEDC PWM |
| 영상 처리 | ESP32-CAM MJPEG 스트리밍, OpenCV (C++), QR 코드 인식 |
| 중계 서버 | Node.js, Express, TCP Socket (`net` 모듈) |
| 관리자 앱 | React Native (Expo), TypeScript, React Context, AsyncStorage |
| 빌드/배포 | EAS Build (Android APK) |
| 하드웨어 | Lolin D32, ESP32-CAM, LattePanda, 릴레이, 서보모터 |

---

## 실행 방법

### Node.js 중계 서버
```bash
cd smart-factory-app/server
npm install
# index.js 상단의 ESP32_IP를 Lolin D32의 실제 IP로 수정 후
node index.js
# 콘솔에 출력된 서버 주소를 config.ts의 SERVER_URL에 입력
```

### React Native 앱
```bash
cd smart-factory-app
npm install
# config.ts의 SERVER_URL을 중계 서버 IP:3000으로 수정 후
npx expo start
```
