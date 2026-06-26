/**
 * ============================================================
 * Lolin D32 - 스마트 팩토리 액추에이터 컨트롤러 v2
 * ESP-IDF v5.x  /  FreeRTOS  /  lwIP
 * ============================================================
 *
 * [v2 변경사항 - 명령 큐 도입]
 *
 * 문제: 두 클라이언트(PC final.cpp, Node.js 서버)가 동시에
 *       TCP :8888 에 접속하면 충돌 발생.
 *       서보 동작(최대 4.5초) 중 새 연결이 들어오면 거절됨.
 *
 * 해결:
 *   - TCP Server Task  : 명령 수신 → Queue 등록 → 즉시 "OK" 응답
 *                        (소켓 처리만 담당, 블로킹 없음 ~5ms)
 *   - Executor Task    : Queue에서 명령을 꺼내 순서대로 실행
 *                        (GPIO, PWM, 부저 등 하드웨어 제어)
 *
 * 두 클라이언트가 동시에 접속해도:
 *   1. 첫 번째 → 수신 → Queue 등록 → "OK" 즉시 반환 (~5ms)
 *   2. 두 번째 → 수신 → Queue 등록 → "OK" 즉시 반환 (~5ms)
 *   3. Executor가 순서대로 처리
 *
 * [아키텍처]
 *   [PC final.cpp]  ─┐
 *                     ├─ TCP :8888 ─→ [Server Task]
 *   [Node.js 서버]  ─┘                    ↓ xQueueSend
 *                                    [Command Queue (10개)]
 *                                          ↓ xQueueReceive
 *                                    [Executor Task]
 *                                          ↓
 *                               GPIO · LEDC · FreeRTOS Task
 */

#include <string.h>
#include <stdio.h>
#include <errno.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/event_groups.h"

#include "esp_system.h"
#include "esp_log.h"
#include "esp_err.h"
#include "nvs_flash.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"

#include "driver/gpio.h"
#include "driver/ledc.h"

#include "lwip/sockets.h"
#include "lwip/netdb.h"

/* ─── Wi-Fi 설정 ─────────────────────────────────────────── */
#define WIFI_SSID        "YOUR_SSID"
#define WIFI_PASS        "YOUR_PASSWORD"
#define WIFI_MAX_RETRY   5

/* ─── 핀 설정 ────────────────────────────────────────────── */
#define RELAY_GPIO       GPIO_NUM_25
#define BUZZER_GPIO      GPIO_NUM_26
#define SERVO1_GPIO      GPIO_NUM_13
#define SERVO2_GPIO      GPIO_NUM_16

/* ─── TCP 서버 ───────────────────────────────────────────── */
#define TCP_PORT         8888

/* ─── 명령 큐 ────────────────────────────────────────────── */
#define CMD_QUEUE_SIZE   10    /* 최대 대기 명령 수 */
#define CMD_MAX_LEN      32    /* 명령 문자열 최대 길이 */

/* ─── LEDC 설정 ──────────────────────────────────────────── */
#define SERVO_TIMER      LEDC_TIMER_0
#define SERVO_MODE       LEDC_LOW_SPEED_MODE
#define SERVO1_CH        LEDC_CHANNEL_0
#define SERVO2_CH        LEDC_CHANNEL_1
#define SERVO_FREQ_HZ    50
#define SERVO_RES        LEDC_TIMER_14_BIT
#define SERVO_MAX_TICK   16384U

#define BUZZER_TIMER     LEDC_TIMER_1
#define BUZZER_CH        LEDC_CHANNEL_2
#define BUZZER_RES       LEDC_TIMER_10_BIT

/* 각도 → duty 변환 (500µs ~ 2400µs) */
#define ANGLE_TO_DUTY(deg) \
    ((uint32_t)(((500UL + (uint32_t)((deg) * 1900UL / 180UL)) * SERVO_MAX_TICK) / 20000UL))

/* ─── Wi-Fi 이벤트 그룹 ──────────────────────────────────── */
#define WIFI_CONNECTED_BIT  BIT0
#define WIFI_FAIL_BIT       BIT1

static const char *TAG = "LolinD32";

/* ─── 전역 핸들 ──────────────────────────────────────────── */
static EventGroupHandle_t s_wifi_eg;
static QueueHandle_t      s_cmd_queue;   /* ★ 명령 큐 */
static int                s_retry = 0;

/* ═══════════════════════════════════════════════════════════
   GPIO 초기화 (릴레이)
═══════════════════════════════════════════════════════════ */
static void gpio_init_relay(void)
{
    gpio_config_t cfg = {
        .pin_bit_mask = (1ULL << RELAY_GPIO),
        .mode         = GPIO_MODE_OUTPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&cfg));
    gpio_set_level(RELAY_GPIO, 0);
    ESP_LOGI(TAG, "GPIO 초기화 완료");
}

/* ═══════════════════════════════════════════════════════════
   LEDC 초기화 (서보 2채널 + 부저 1채널)
═══════════════════════════════════════════════════════════ */
static void ledc_init_all(void)
{
    /* 서보 타이머 (50Hz, 14-bit) */
    ledc_timer_config_t st = {
        .speed_mode      = SERVO_MODE,
        .duty_resolution = SERVO_RES,
        .timer_num       = SERVO_TIMER,
        .freq_hz         = SERVO_FREQ_HZ,
        .clk_cfg         = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&st));

    /* 서보1 채널 */
    ledc_channel_config_t ch0 = {
        .gpio_num   = SERVO1_GPIO,
        .speed_mode = SERVO_MODE,
        .channel    = SERVO1_CH,
        .timer_sel  = SERVO_TIMER,
        .duty       = ANGLE_TO_DUTY(90),
        .hpoint     = 0,
    };
    ESP_ERROR_CHECK(ledc_channel_config(&ch0));

    /* 서보2 채널 */
    ledc_channel_config_t ch1 = ch0;
    ch1.gpio_num = SERVO2_GPIO;
    ch1.channel  = SERVO2_CH;
    ESP_ERROR_CHECK(ledc_channel_config(&ch1));

    /* 부저 타이머 (1kHz, 10-bit) */
    ledc_timer_config_t bt = {
        .speed_mode      = SERVO_MODE,
        .duty_resolution = BUZZER_RES,
        .timer_num       = BUZZER_TIMER,
        .freq_hz         = 1000,
        .clk_cfg         = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&bt));

    /* 부저 채널 (초기: 무음) */
    ledc_channel_config_t bc = {
        .gpio_num   = BUZZER_GPIO,
        .speed_mode = SERVO_MODE,
        .channel    = BUZZER_CH,
        .timer_sel  = BUZZER_TIMER,
        .duty       = 0,
        .hpoint     = 0,
    };
    ESP_ERROR_CHECK(ledc_channel_config(&bc));
    ESP_LOGI(TAG, "LEDC 초기화 완료");
}

/* ═══════════════════════════════════════════════════════════
   서보 제어 (Executor Task 내부에서만 호출)
═══════════════════════════════════════════════════════════ */
static void servo_write(ledc_channel_t ch, int angle)
{
    ledc_set_duty(SERVO_MODE, ch, ANGLE_TO_DUTY(angle));
    ledc_update_duty(SERVO_MODE, ch);
}

static void servo_rotate(ledc_channel_t ch, int angle, int ms)
{
    servo_write(ch, angle);
    vTaskDelay(pdMS_TO_TICKS(ms));
    servo_write(ch, 90); /* 중립 복귀 */
}

/* ═══════════════════════════════════════════════════════════
   부저 태스크 (비동기 FreeRTOS Task)
   Executor Task에서 xTaskCreate로 생성
═══════════════════════════════════════════════════════════ */
static void buzzer_task(void *arg)
{
    for (int i = 0; i < 10; i++) {
        uint32_t freq = (i % 2 == 0) ? 1000 : 2000;
        ledc_set_freq(SERVO_MODE, BUZZER_TIMER, freq);
        ledc_set_duty(SERVO_MODE, BUZZER_CH, 512); /* 50% duty */
        ledc_update_duty(SERVO_MODE, BUZZER_CH);
        vTaskDelay(pdMS_TO_TICKS(500));

        ledc_set_duty(SERVO_MODE, BUZZER_CH, 0);   /* 무음 */
        ledc_update_duty(SERVO_MODE, BUZZER_CH);
        vTaskDelay(pdMS_TO_TICKS(50));
    }
    vTaskDelete(NULL);
}

static inline void buzzer_beep_async(void)
{
    xTaskCreate(buzzer_task, "buzzer", 2048, NULL, 5, NULL);
}

/* ═══════════════════════════════════════════════════════════
   명령 실행 함수
   ★ TCP Server Task가 아닌 Executor Task에서 호출됨
═══════════════════════════════════════════════════════════ */
static void execute_command(const char *cmd)
{
    ESP_LOGI(TAG, "[Executor] 실행 시작: %s", cmd);

    if (strcmp(cmd, "light_on") == 0) {
        gpio_set_level(RELAY_GPIO, 1);
        ESP_LOGI(TAG, "[Executor] 조명 ON");
    }
    else if (strcmp(cmd, "light_off") == 0) {
        gpio_set_level(RELAY_GPIO, 0);
        ESP_LOGI(TAG, "[Executor] 조명 OFF");
    }
    else if (strcmp(cmd, "gate_open") == 0) {
        ESP_LOGI(TAG, "[Executor] 게이트 열기 시작 (약 5초 소요)");
        servo_rotate(SERVO1_CH, 120, 650);
        servo_rotate(SERVO2_CH, 130, 4500);
    }
    else if (strcmp(cmd, "gate_close") == 0) {
        ESP_LOGI(TAG, "[Executor] 게이트 닫기 시작 (약 5초 소요)");
        servo_rotate(SERVO1_CH, 70, 650);
        servo_rotate(SERVO2_CH, 60, 4500);
    }
    else if (strcmp(cmd, "all_active") == 0) {
        ESP_LOGI(TAG, "[Executor] 전체 활성화");
        buzzer_beep_async();
        servo_rotate(SERVO1_CH, 120, 650);
        servo_rotate(SERVO2_CH, 130, 4500);
        gpio_set_level(RELAY_GPIO, 1);
    }
    else if (strcmp(cmd, "all_deactive") == 0) {
        ESP_LOGI(TAG, "[Executor] 전체 비활성화");
        buzzer_beep_async();
        servo_rotate(SERVO1_CH, 70, 650);
        servo_rotate(SERVO2_CH, 60, 4500);
        gpio_set_level(RELAY_GPIO, 0);
    }
    else {
        ESP_LOGW(TAG, "[Executor] 알 수 없는 명령: %s", cmd);
    }

    ESP_LOGI(TAG, "[Executor] 실행 완료: %s | 큐 대기: %lu개",
             cmd, (unsigned long)uxQueueMessagesWaiting(s_cmd_queue));
}

/* ═══════════════════════════════════════════════════════════
   ★ Executor Task
   큐에서 명령을 꺼내 순서대로 실행
   서보 동작(4.5초) 중에도 Server Task는 새 명령 수신 가능
═══════════════════════════════════════════════════════════ */
static void executor_task(void *arg)
{
    char cmd[CMD_MAX_LEN];
    ESP_LOGI(TAG, "[Executor Task] 시작 - 큐 대기 중...");

    while (1) {
        /* 큐에 명령이 올 때까지 무한 대기 (CPU 점유 없음) */
        if (xQueueReceive(s_cmd_queue, cmd, portMAX_DELAY) == pdTRUE) {
            execute_command(cmd);
        }
    }
    /* 도달 불가 */
    vTaskDelete(NULL);
}

/* ═══════════════════════════════════════════════════════════
   ★ TCP Server Task (v2 - 수신 전담)
   명령을 받아 큐에 넣고 즉시 응답 (~5ms)
   서보 동작 중에도 새 연결 처리 가능
═══════════════════════════════════════════════════════════ */
static void tcp_server_task(void *arg)
{
    struct sockaddr_in sa, ca;
    socklen_t ca_len = sizeof(ca);
    char buf[CMD_MAX_LEN + 4];

    /* 소켓 생성 */
    int srv = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (srv < 0) {
        ESP_LOGE(TAG, "[Server] socket() 실패: %d", errno);
        vTaskDelete(NULL); return;
    }

    int opt = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    memset(&sa, 0, sizeof(sa));
    sa.sin_family      = AF_INET;
    sa.sin_addr.s_addr = INADDR_ANY;
    sa.sin_port        = htons(TCP_PORT);

    if (bind(srv, (struct sockaddr *)&sa, sizeof(sa)) < 0) {
        ESP_LOGE(TAG, "[Server] bind() 실패: %d", errno);
        close(srv); vTaskDelete(NULL); return;
    }

    if (listen(srv, 5) < 0) {  /* backlog=5: 동시 연결 대기 허용 */
        ESP_LOGE(TAG, "[Server] listen() 실패: %d", errno);
        close(srv); vTaskDelete(NULL); return;
    }

    ESP_LOGI(TAG, "[Server] TCP 대기 중 (포트 %d) | 큐 크기: %d",
             TCP_PORT, CMD_QUEUE_SIZE);

    while (1) {
        int cli = accept(srv, (struct sockaddr *)&ca, &ca_len);
        if (cli < 0) {
            ESP_LOGW(TAG, "[Server] accept() 실패: %d", errno);
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        ESP_LOGI(TAG, "[Server] 클라이언트 연결: %s", inet_ntoa(ca.sin_addr));

        /* 수신 타임아웃 3초 */
        struct timeval tv = { .tv_sec = 3, .tv_usec = 0 };
        setsockopt(cli, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

        /* 개행 기준으로 명령 수신 */
        int idx = 0;
        memset(buf, 0, sizeof(buf));

        while (idx < CMD_MAX_LEN - 1) {
            if (recv(cli, &buf[idx], 1, 0) <= 0) break;
            if (buf[idx] == '\n') {
                buf[idx] = '\0';
                /* \r 제거 */
                while (idx > 0 && buf[idx - 1] == '\r')
                    buf[--idx] = '\0';
                break;
            }
            idx++;
        }

        if (idx > 0) {
            /* ★ 핵심: 큐에 등록하고 즉시 응답 */
            if (xQueueSend(s_cmd_queue, buf, pdMS_TO_TICKS(200)) == pdTRUE) {
                send(cli, "OK\n", 3, 0);
                ESP_LOGI(TAG, "[Server] 큐 등록 완료: '%s' | 대기: %lu개",
                         buf, (unsigned long)uxQueueMessagesWaiting(s_cmd_queue));
            } else {
                /* 큐가 가득 찬 경우 */
                send(cli, "BUSY\n", 5, 0);
                ESP_LOGW(TAG, "[Server] 큐 가득참, 명령 거절: '%s'", buf);
            }
        }

        close(cli);
        ESP_LOGI(TAG, "[Server] 클라이언트 연결 해제");
    }

    close(srv);
    vTaskDelete(NULL);
}

/* ═══════════════════════════════════════════════════════════
   Wi-Fi 이벤트 핸들러
═══════════════════════════════════════════════════════════ */
static void wifi_handler(void *arg, esp_event_base_t base,
                         int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    }
    else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry < WIFI_MAX_RETRY) {
            esp_wifi_connect();
            ESP_LOGW(TAG, "Wi-Fi 재연결 중... (%d/%d)", ++s_retry, WIFI_MAX_RETRY);
        } else {
            xEventGroupSetBits(s_wifi_eg, WIFI_FAIL_BIT);
        }
    }
    else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "Wi-Fi 연결 성공! IP: " IPSTR, IP2STR(&e->ip_info.ip));
        s_retry = 0;
        xEventGroupSetBits(s_wifi_eg, WIFI_CONNECTED_BIT);
    }
}

/* ═══════════════════════════════════════════════════════════
   Wi-Fi 초기화
═══════════════════════════════════════════════════════════ */
static void wifi_init(void)
{
    s_wifi_eg = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t h1, h2;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_handler, NULL, &h1));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_handler, NULL, &h2));

    wifi_config_t wc = {
        .sta = {
            .ssid               = WIFI_SSID,
            .password           = WIFI_PASS,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        }
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());

    EventBits_t bits = xEventGroupWaitBits(
        s_wifi_eg,
        WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
        pdFALSE, pdFALSE, portMAX_DELAY);

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Wi-Fi 연결 완료");
    } else {
        ESP_LOGE(TAG, "Wi-Fi 연결 실패 (최대 재시도 초과)");
    }

    esp_event_handler_instance_unregister(IP_EVENT, IP_EVENT_STA_GOT_IP, h2);
    esp_event_handler_instance_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID, h1);
    vEventGroupDelete(s_wifi_eg);
}

/* ═══════════════════════════════════════════════════════════
   app_main
═══════════════════════════════════════════════════════════ */
void app_main(void)
{
    /* NVS 초기화 */
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    ESP_LOGI(TAG, "========================================");
    ESP_LOGI(TAG, " Lolin D32 스마트 팩토리 컨트롤러 v2");
    ESP_LOGI(TAG, " 명령 큐 크기: %d | 포트: %d", CMD_QUEUE_SIZE, TCP_PORT);
    ESP_LOGI(TAG, "========================================");

    /* 하드웨어 초기화 */
    gpio_init_relay();
    ledc_init_all();

    /* ★ 명령 큐 생성 */
    s_cmd_queue = xQueueCreate(CMD_QUEUE_SIZE, CMD_MAX_LEN);
    if (s_cmd_queue == NULL) {
        ESP_LOGE(TAG, "큐 생성 실패! 재시작...");
        esp_restart();
    }
    ESP_LOGI(TAG, "명령 큐 생성 완료 (크기: %d)", CMD_QUEUE_SIZE);

    /* Wi-Fi 연결 */
    wifi_init();

    /* ★ Executor Task 시작 (큐에서 명령 꺼내 실행) */
    xTaskCreate(executor_task, "executor", 4096, NULL, 6, NULL);

    /* ★ TCP Server Task 시작 (명령 수신 전담) */
    xTaskCreate(tcp_server_task, "tcp_server", 4096, NULL, 5, NULL);

    ESP_LOGI(TAG, "모든 태스크 시작 완료 - 명령 대기 중");
}
