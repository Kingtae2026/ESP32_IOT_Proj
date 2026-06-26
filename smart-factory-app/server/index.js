/**
 * Smart Factory Relay Server
 * 역할: 모바일 앱(HTTP) ↔ Lolin D32(TCP 8888) 중계
 *
 * 실행: node index.js
 * 포트: 3000
 */

const express = require('express');
const cors    = require('cors');
const net     = require('net');

const app = express();
app.use(cors());
app.use(express.json());

// ─── 설정 ────────────────────────────────────────────────────
const ESP32_IP   = '172.20.197.235'; // ← Lolin D32 IP
const ESP32_PORT = 8888;
const SERVER_PORT = 3000;

const VALID_COMMANDS = new Set([
  'light_on', 'light_off',
  'gate_open', 'gate_close',
  'all_active', 'all_deactive',
]);

// ─── ESP32 TCP 통신 ──────────────────────────────────────────
function sendToESP32(cmd) {
  return new Promise((resolve, reject) => {
    const start  = Date.now();
    const socket = new net.Socket();
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      socket.destroy();
      reject(new Error('ESP32 응답 없음 (7초 초과)'));
    }, 7000);

    socket.connect(ESP32_PORT, ESP32_IP, () => {
      socket.write(cmd + '\n');
    });

    socket.on('data', (buf) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({
        response: buf.toString().trim(),
        latency:  Date.now() - start,
      });
    });

    socket.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`ESP32 연결 실패: ${err.message}`));
    });

    socket.on('close', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error('ESP32 연결이 예기치 않게 종료되었습니다'));
    });
  });
}

// ─── 라우트 ──────────────────────────────────────────────────

// 서버 상태 확인
app.get('/health', (req, res) => {
  res.json({ ok: true, esp32: `${ESP32_IP}:${ESP32_PORT}` });
});

// 명령 전송
app.post('/command', async (req, res) => {
  const { cmd } = req.body ?? {};

  if (!cmd || typeof cmd !== 'string') {
    return res.status(400).json({ ok: false, error: '명령이 없습니다' });
  }

  if (!VALID_COMMANDS.has(cmd)) {
    return res.status(400).json({ ok: false, error: `알 수 없는 명령: ${cmd}` });
  }

  console.log(`[${new Date().toLocaleTimeString()}] ▶ ${cmd}`);

  try {
    const { response, latency } = await sendToESP32(cmd);
    console.log(`[${new Date().toLocaleTimeString()}] ✓ ${response} (${latency}ms)`);
    res.json({ ok: true, response, latency });
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] ✗ ${err.message}`);
    res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── 서버 시작 ───────────────────────────────────────────────
app.listen(SERVER_PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIP = 'x.x.x.x';

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
        break;
      }
    }
  }

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║     Smart Factory Relay Server  v1.0        ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  서버 주소:  http://${localIP}:${SERVER_PORT}  `);
  console.log(`║  ESP32 주소: ${ESP32_IP}:${ESP32_PORT}          `);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  📱 config.ts의 SERVER_URL을 위 주소로   ║');
  console.log('║     변경하세요                            ║');
  console.log('╚══════════════════════════════════════════╝\n');
});
