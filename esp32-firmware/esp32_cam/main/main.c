/**
 * ============================================================
 * ESP32-CAM - MJPEG 스트리밍 + QR 코드 인식 지원
 * ESP-IDF v5.x  /  esp32-camera component
 * ============================================================
 *
 * 역할:
 *   - MJPEG 스트림 제공 (포트 81, /stream)
 *   - 스냅샷 제공 (포트 80, /capture)
 *   - PC의 final.cpp (OpenCV)가 이 스트림에서 QR 코드 인식
 *
 * [필수 컴포넌트 - idf_component_manager로 추가]
 *   espressif/esp32-camera
 */

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_log.h"
#include "esp_err.h"
#include "nvs_flash.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_http_server.h"
#include "esp_camera.h"

static const char *TAG = "ESP32-CAM";

/* ─── Wi-Fi 설정 ─────────────────────────────── */
#define WIFI_SSID        "YOUR_SSID"
#define WIFI_PASS        "YOUR_PASSWORD"
#define WIFI_MAX_RETRY   5

/* ─── AI Thinker ESP32-CAM 핀 매핑 ──────────── */
#define CAM_PIN_PWDN     32
#define CAM_PIN_RESET    -1
#define CAM_PIN_XCLK      0
#define CAM_PIN_SIOD     26
#define CAM_PIN_SIOC     27
#define CAM_PIN_D7       35
#define CAM_PIN_D6       34
#define CAM_PIN_D5       39
#define CAM_PIN_D4       36
#define CAM_PIN_D3       21
#define CAM_PIN_D2       19
#define CAM_PIN_D1       18
#define CAM_PIN_D0        5
#define CAM_PIN_VSYNC    25
#define CAM_PIN_HREF     23
#define CAM_PIN_PCLK     22

/* MJPEG 스트림 헤더 */
#define STREAM_CONTENT_TYPE \
    "multipart/x-mixed-replace;boundary=frame"
#define STREAM_BOUNDARY    "\r\n--frame\r\n"
#define STREAM_PART        "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n"

/* Wi-Fi 이벤트 그룹 */
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
static EventGroupHandle_t s_wifi_eg;
static int s_retry = 0;

/* ═══════════════════════════════════════════════
   카메라 초기화
═══════════════════════════════════════════════ */
static esp_err_t camera_init(void)
{
    camera_config_t config = {
        .pin_pwdn     = CAM_PIN_PWDN,
        .pin_reset    = CAM_PIN_RESET,
        .pin_xclk     = CAM_PIN_XCLK,
        .pin_sccb_sda = CAM_PIN_SIOD,
        .pin_sccb_scl = CAM_PIN_SIOC,
        .pin_d7       = CAM_PIN_D7,
        .pin_d6       = CAM_PIN_D6,
        .pin_d5       = CAM_PIN_D5,
        .pin_d4       = CAM_PIN_D4,
        .pin_d3       = CAM_PIN_D3,
        .pin_d2       = CAM_PIN_D2,
        .pin_d1       = CAM_PIN_D1,
        .pin_d0       = CAM_PIN_D0,
        .pin_vsync    = CAM_PIN_VSYNC,
        .pin_href     = CAM_PIN_HREF,
        .pin_pclk     = CAM_PIN_PCLK,
        .xclk_freq_hz = 20000000,
        .ledc_timer   = LEDC_TIMER_0,
        .ledc_channel = LEDC_CHANNEL_0,
        .pixel_format = PIXFORMAT_JPEG,
        /* PSRAM 유무에 따라 해상도 자동 선택 */
        .frame_size   = psramFound() ? FRAMESIZE_VGA : FRAMESIZE_SVGA,
        .jpeg_quality = psramFound() ? 10 : 12,
        .fb_count     = psramFound() ? 2  : 1,
        .fb_location  = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM,
        .grab_mode    = CAMERA_GRAB_WHEN_EMPTY,
    };

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "카메라 초기화 실패: 0x%x", err);
        return err;
    }

    /* 화질 설정 */
    sensor_t *s = esp_camera_sensor_get();
    if (s) {
        s->set_brightness(s, 0);
        s->set_contrast(s, 0);
        s->set_saturation(s, 0);
        s->set_whitebal(s, 1);
        s->set_awb_gain(s, 1);
        s->set_exposure_ctrl(s, 1);
        s->set_aec2(s, 0);
        /* QR 코드 인식을 위해 선명도 향상 */
        s->set_sharpness(s, 1);
    }

    ESP_LOGI(TAG, "카메라 초기화 성공 (PSRAM: %s, 해상도: %s)",
             psramFound() ? "있음" : "없음",
             psramFound() ? "VGA(640x480)" : "SVGA(800x600)");
    return ESP_OK;
}

/* ═══════════════════════════════════════════════
   HTTP 핸들러: MJPEG 스트리밍 GET /stream
   final.cpp (OpenCV)가 이 주소로 프레임 수신
═══════════════════════════════════════════════ */
static esp_err_t stream_handler(httpd_req_t *req)
{
    esp_err_t res;
    camera_fb_t *fb;
    char part_buf[64];

    res = httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
    if (res != ESP_OK) return res;

    /* chunked 전송으로 무한 스트리밍 */
    while (true) {
        fb = esp_camera_fb_get();
        if (!fb) {
            ESP_LOGE(TAG, "프레임 버퍼 획득 실패");
            res = ESP_FAIL;
            break;
        }

        /* boundary 전송 */
        res = httpd_resp_send_chunk(req, STREAM_BOUNDARY,
                                    strlen(STREAM_BOUNDARY));
        if (res != ESP_OK) { esp_camera_fb_return(fb); break; }

        /* JPEG 헤더 전송 */
        size_t hlen = snprintf(part_buf, sizeof(part_buf),
                               STREAM_PART, fb->len);
        res = httpd_resp_send_chunk(req, part_buf, hlen);
        if (res != ESP_OK) { esp_camera_fb_return(fb); break; }

        /* JPEG 데이터 전송 */
        res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
        esp_camera_fb_return(fb);
        if (res != ESP_OK) break;
    }
    return res;
}

/* ═══════════════════════════════════════════════
   HTTP 핸들러: 스냅샷 GET /capture
═══════════════════════════════════════════════ */
static esp_err_t capture_handler(httpd_req_t *req)
{
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }
    httpd_resp_set_type(req, "image/jpeg");
    httpd_resp_set_hdr(req, "Content-Disposition",
                       "inline; filename=capture.jpg");
    esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    return res;
}

/* ═══════════════════════════════════════════════
   HTTP 서버 시작
═══════════════════════════════════════════════ */
static void start_http_server(void)
{
    /* 스트리밍 서버 (포트 81) */
    httpd_handle_t stream_server = NULL;
    httpd_config_t scfg = HTTPD_DEFAULT_CONFIG();
    scfg.server_port      = 81;
    scfg.ctrl_port        = 32769;
    scfg.max_uri_handlers = 2;

    if (httpd_start(&stream_server, &scfg) == ESP_OK) {
        httpd_uri_t uri = {
            .uri     = "/stream",
            .method  = HTTP_GET,
            .handler = stream_handler,
        };
        httpd_register_uri_handler(stream_server, &uri);
        ESP_LOGI(TAG, "스트리밍 서버: http://<IP>:81/stream");
        ESP_LOGI(TAG, "  → final.cpp stream_url을 위 주소로 설정하세요");
    }

    /* 스냅샷 서버 (포트 80) */
    httpd_handle_t snap_server = NULL;
    httpd_config_t ncfg = HTTPD_DEFAULT_CONFIG();
    ncfg.server_port      = 80;
    ncfg.ctrl_port        = 32770;
    ncfg.max_uri_handlers = 2;

    if (httpd_start(&snap_server, &ncfg) == ESP_OK) {
        httpd_uri_t uri = {
            .uri     = "/capture",
            .method  = HTTP_GET,
            .handler = capture_handler,
        };
        httpd_register_uri_handler(snap_server, &uri);
        ESP_LOGI(TAG, "스냅샷 서버: http://<IP>:80/capture");
    }
}

/* ═══════════════════════════════════════════════
   Wi-Fi 이벤트 핸들러
═══════════════════════════════════════════════ */
static void wifi_handler(void *arg, esp_event_base_t base,
                         int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry < WIFI_MAX_RETRY) {
            esp_wifi_connect();
            ESP_LOGW(TAG, "Wi-Fi 재연결 중 (%d/%d)", ++s_retry, WIFI_MAX_RETRY);
        } else {
            xEventGroupSetBits(s_wifi_eg, WIFI_FAIL_BIT);
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "Wi-Fi 연결! IP: " IPSTR, IP2STR(&e->ip_info.ip));
        s_retry = 0;
        xEventGroupSetBits(s_wifi_eg, WIFI_CONNECTED_BIT);
    }
}

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

    xEventGroupWaitBits(s_wifi_eg,
        WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
        pdFALSE, pdFALSE, portMAX_DELAY);

    esp_event_handler_instance_unregister(IP_EVENT, IP_EVENT_STA_GOT_IP, h2);
    esp_event_handler_instance_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID, h1);
    vEventGroupDelete(s_wifi_eg);
}

/* ═══════════════════════════════════════════════
   app_main
═══════════════════════════════════════════════ */
void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    ESP_LOGI(TAG, "========================================");
    ESP_LOGI(TAG, " ESP32-CAM 스트리밍 서버");
    ESP_LOGI(TAG, " QR 코드 인식: final.cpp (PC OpenCV)");
    ESP_LOGI(TAG, "========================================");

    ESP_ERROR_CHECK(camera_init());
    wifi_init();
    start_http_server();
}
