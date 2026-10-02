# WhatsApp Gateway API Documentation

Base URL: `http://localhost:3000`

## Autentikasi

Semua request membutuhkan header berikut jika `API_KEY` di-set di environment:

```
X-API-Key: <your-api-key>
```

Tanpa header yang valid, server akan mengembalikan:
```json
{ "success": false, "error": "Unauthorized" }
```

---

## Session Management

### Buat Session Baru

```
POST /session
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Ya | Nama session |
| `engine` | string | Ya | `"baileys"` atau `"wwjs"` |

### List Semua Session

```
GET /session
```

### Detail Session

```
GET /session/:id
```

### Dapatkan QR Code

```
GET /session/:id/qr
```

QR hanya tersedia saat status `qr_pending`. Setelah scan, status berubah ke `connected`.

### Pairing Code (tanpa QR scan)

```
POST /session/:id/pairing
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | string | Ya | Nomor HP (digits only, dengan kode negara) |

### Connect Session

```
POST /session/:id/connect
```

### Disconnect Session

```
POST /session/:id/disconnect
```

### Hapus Session

```
DELETE /session/:id
```

### Session Status

| Status | Deskripsi |
|--------|-----------|
| `created` | Session baru dibuat, belum connect |
| `qr_pending` | QR code tersedia, menunggu scan |
| `authenticating` | Sedang proses autentikasi |
| `connected` | Terhubung ke WhatsApp |
| `disconnected` | Terputus dari WhatsApp |
| `error` | Autentikasi gagal |

---

## Message

### Check Nomor WhatsApp

```
GET /message/check/:sessionId/:phone
```

### Kirim Pesan

```
POST /message/send
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Ya | ID session |
| `to` | string | Ya | Nomor tujuan atau JID |
| `text` | string | Teks: Ya | Isi pesan teks (max 4096) |
| `mediaUrl` | string | Media: Ya | URL file media |
| `mediaType` | string | Media: Ya | `"image"` `"video"` `"document"` `"audio"` |
| `caption` | string | Tidak | Caption untuk media |
| `location` | object | Tidak | `{ "lat": number, "lng": number }` |
| `reaction` | object | Tidak | `{ "text": "💖", "messageId": "..." }` |
| `poll` | object | Tidak | `{ "name": "...", "values": ["A","B"], "selectableCount": 1 }` |
| `contacts` | object | Tidak | `{ "displayName": "...", "contacts": [{ name, phone }] }` |
| `pin` | object | Tidak | `{ "messageId": "...", "type": 1, "time": 86400 }` |
| `forward` | object | Tidak | `{ "messageId": "...", "chatJid": "..." }` |
| `disappearingMessages` | object | Tidak | `{ "enabled": true, "duration": 86400 }` |
| `mentions` | string[] | Tidak | Array nomor HP untuk mention |
| `quoted` | object | Tidak | `{ "messageId": "...", "chatJid": "..." }` |
| `ephemeralExpiration` | number | Tidak | Detik agar pesan self-destruct |

### Hapus Pesan

```
POST /message/delete
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `chatJid` | string | Ya |
| `messageId` | string | Ya |

### Edit Pesan (Baileys only)

```
POST /message/edit
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `chatJid` | string | Ya |
| `messageId` | string | Ya |
| `text` | string | Ya |

### Mark as Read

```
POST /message/read
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `chatJid` | string | Ya |
| `messageIds` | string[] | Ya |

### Presence (Typing Indicator)

```
POST /message/presence
```

| Field | Type | Required | Value |
|-------|------|----------|-------|
| `sessionId` | string | Ya | |
| `chatJid` | string | Ya | |
| `presence` | string | Ya | `"available"` `"unavailable"` `"composing"` `"recording"` `"paused"` |

### Subscribe Presence Updates

```
POST /message/presence/subscribe
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `chatJid` | string | Ya |

### Download Media

```
POST /message/download
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `msg` | object | Ya | Message object dari event |
| `type` | string | Tidak | `"buffer"` (default) atau `"stream"` |

---

## Chats

### List Chats

```
GET /chats/:sessionId
```

### Riwayat Pesan

```
GET /chats/:sessionId/:chatJid/messages?limit=50&offset=0
```

### Statistik

```
GET /chats/:sessionId/stats
```

### Profile Picture

```
GET /chats/:sessionId/:chatJid/profile
```

### Archive Chat

```
POST /chats/archive
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `chatJid` | string | Ya |
| `archive` | boolean | Ya |

### Mute Chat

```
POST /chats/mute
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | Ya | |
| `chatJid` | string | Ya | |
| `durationMs` | number | Tidak | Durasi mute (ms). Kosongkan untuk unmute |

### Pin Chat

```
POST /chats/pin
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `chatJid` | string | Ya |
| `pin` | boolean | Ya |

### Hapus Chat

```
POST /chats/delete
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `chatJid` | string | Ya |

### Star/Unstar Pesan

```
POST /chats/star
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `chatJid` | string | Ya |
| `messageId` | string | Ya |
| `fromMe` | boolean | Ya |
| `star` | boolean | Ya |

### Update Profile Name

```
POST /chats/profile-name
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `name` | string | Ya |

### Update Profile Status

```
POST /chats/profile-status
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `status` | string | Ya |

### Fetch History (On-demand)

```
POST /chats/fetch-history
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `count` | number | Ya | Max 50 |
| `oldestMsgKey` | object | Ya | `{ remoteJid, id }` |
| `oldestMsgTimestamp` | number | Ya | Unix timestamp |

---

## Contacts

### List Kontak

```
GET /contacts/:sessionId
```

---

## Groups

### Buat Grup

```
POST /groups/create
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `subject` | string | Ya |
| `participants` | string[] | Ya | Array nomor HP |

### Group Metadata

```
GET /groups/:sessionId/:jid/metadata
```

### Add/Remove/Promote/Demote

```
POST /groups/participants
```

| Field | Type | Required | Value |
|-------|------|----------|-------|
| `sessionId` | string | Ya | |
| `jid` | string | Ya | Group JID |
| `participants` | string[] | Ya | Array nomor HP |
| `action` | string | Ya | `"add"` `"remove"` `"promote"` `"demote"` |

### Update Nama Grup

```
POST /groups/subject
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `jid` | string | Ya |
| `subject` | string | Ya |

### Update Deskripsi Grup

```
POST /groups/description
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `jid` | string | Ya |
| `description` | string | Ya |

### Update Settings

```
POST /groups/settings
```

| Field | Type | Required | Value |
|-------|------|----------|-------|
| `setting` | string | Ya | `"announcement"` `"not_announcement"` `"locked"` `"unlocked"` |

### Leave Grup

```
POST /groups/leave
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `jid` | string | Ya |

### Dapatkan Invite Code

```
GET /groups/:sessionId/:jid/invite
```

### Revoke Invite

```
POST /groups/invite/revoke
```

### Join via Invite Code

```
POST /groups/invite/join
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `code` | string | Ya | Code saja, tanpa URL |

### Invite Info

```
GET /groups/invite/info/:sessionId/:code
```

### Toggle Ephemeral Messages

```
POST /groups/ephemeral
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `duration` | number | Ya | `0` off, `86400` 24h, `604800` 7d, `7776000` 90d |

### Member Add Mode

```
POST /groups/member-add-mode
```

| Field | Type | Required | Value |
|-------|------|----------|-------|
| `mode` | string | Ya | `"all_member_add"` atau `"admin_add"` |

### Fetch All Groups

```
GET /groups/:sessionId/all
```

### Join Requests

```
GET /groups/:sessionId/:jid/requests
```

### Approve/Reject Requests

```
POST /groups/requests
```

| Field | Type | Required | Value |
|-------|------|----------|-------|
| `action` | string | Ya | `"approve"` atau `"reject"` |

---

## Broadcast & Status (Stories)

### Kirim Broadcast

```
POST /broadcast/send
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `jid` | string | Ya | Broadcast list JID (`1234@broadcast`) |
| `text` | string | Teks | |
| `mediaUrl` | string | Media | |
| `mediaType` | string | Media | `"image"` `"video"` `"audio"` |
| `caption` | string | Tidak | |
| `backgroundColor` | string | Tidak | Untuk text status |
| `font` | number | Tidak | Font style |

### Kirim Status/Stories

```
POST /broadcast/status
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `statusJidList` | string[] | Ya | Array JID kontak yang bisa melihat |
| `text` | string | Teks | |
| `mediaUrl` | string | Media | |
| `mediaType` | string | Media | |
| `backgroundColor` | string | Tidak | |
| `font` | number | Tidak | |

### Broadcast List Info

```
GET /broadcast/info/:sessionId/:jid
```

---

## Privacy

### Get Privacy Settings

```
GET /privacy/:sessionId
```

### Get Blocklist

```
GET /privacy/:sessionId/blocklist
```

### Block/Unblock User

```
POST /privacy/block
POST /privacy/unblock
```

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | Ya |
| `jid` | string | Ya |

### Last Seen Privacy

```
POST /privacy/last-seen
```

| Field | Type | Required | Value |
|-------|------|----------|-------|
| `value` | string | Ya | `"all"` `"contacts"` `"contact_blacklist"` `"none"` |

### Online Privacy

```
POST /privacy/online
```

| Field | Type | Required | Value |
|-------|------|----------|-------|
| `value` | string | Ya | `"all"` `"match_last_seen"` |

### Profile Picture Privacy

```
POST /privacy/profile-picture
```

| Field | Type | Required | Value |
|-------|------|----------|-------|
| `value` | string | Ya | `"all"` `"contacts"` `"contact_blacklist"` `"none"` |

### Status Privacy

```
POST /privacy/status
```

| Field | Type | Required | Value |
|-------|------|----------|-------|
| `value` | string | Ya | `"all"` `"contacts"` `"contact_blacklist"` `"none"` |

### Read Receipts Privacy

```
POST /privacy/read-receipts
```

| Field | Type | Required | Value |
|-------|------|----------|-------|
| `value` | string | Ya | `"all"` `"none"` |

### Groups Add Privacy

```
POST /privacy/groups-add
```

| Field | Type | Required | Value |
|-------|------|----------|-------|
| `value` | string | Ya | `"all"` `"contacts"` `"contact_blacklist"` |

### Default Disappearing Mode

```
POST /privacy/disappearing-mode
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `duration` | number | Ya | `0` off, `86400` 24h, `604800` 7d, `7776000` 90d |

---

## Webhook

### Buat Webhook

```
POST /webhook
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Ya | URL endpoint |
| `events` | string[] | Ya | Daftar event |
| `secret` | string | Tidak | Secret untuk HMAC |

### List Webhooks

```
GET /webhook
```

### Detail Webhook

```
GET /webhook/:id
```

### Update Webhook

```
PATCH /webhook/:id
```

| Field | Type | Required |
|-------|------|----------|
| `url` | string | Tidak |
| `events` | string[] | Tidak |
| `active` | boolean | Tidak |

### Hapus Webhook

```
DELETE /webhook/:id
```

---

## Webhook Event Types

| Event | Deskripsi |
|-------|-----------|
| `message.received` | Pesan baru diterima |
| `message.sent` | Pesan berhasil dikirim |
| `message.status` | Status delivery/read |
| `session.qr` | QR code tersedia |
| `session.connected` | Session terhubung |
| `session.disconnected` | Session terputus |
| `session.auth_failed` | Autentikasi gagal |

### Webhook Payload

```json
{
  "type": "message.received",
  "sessionId": "a1b2c3d4",
  "timestamp": 1727491200000,
  "data": {
    "id": "msg_id",
    "from": "6281234567890",
    "text": "Halo!",
    "timestamp": 1727491200,
    "pushName": "John",
    "hasMedia": false,
    "mediaType": null
  }
}
```

### HMAC Signature

Header: `X-Webhook-Signature: <hex-hmac-sha256>`

---

## Template Pesan Chat (AI Generator)

Kelola template pesan chat rumah sakit yang siap dipakai di halaman chat. Template
dibuat manual atau dihasilkan AI Gemini. Endpoint generate hanya menghasilkan
draf — penyimpanan dilakukan terpisah (`POST /message-templates`) setelah ditinjau
dan diedit. Tidak ada pesan WhatsApp/chat yang dikirim otomatis dari proses ini.

Semua endpoint membutuhkan auth seperti endpoint lainnya. Header opsional
`X-Created-By` mencatat pembuat template (default: `api`).

### Kategori & Gaya Bahasa

```
GET /message-templates/categories
```

Response berisi `categories` (10 kategori, dapat dikembangkan di
`src/services/template/constants.ts`) dan `tones`:

| Value Tone | Label | Deskripsi |
|------------|-------|-----------|
| `formal` | Formal | Profesional, sopan, komunikasi resmi rumah sakit |
| `ramah` | Ramah | Sopan, hangat, empatik |
| `friendly` | Friendly | Santai, natural, tetap sopan |
| `singkat` | Singkat | Langsung pada inti informasi |

Kategori: `sapaan_pasien_baru`, `follow_up_customer`, `pemberitahuan_poli_tutup`,
`pengingat_kunjungan`, `ucapan_terima_kasih`, `survei_kepuasan`, `promo_dan_acara`,
`layanan_pelanggan`, `informasi_layanan_rs`, `lainnya`.

### List Template (filter & pencarian)

```
GET /message-templates?q=sapaan&category=sapaan_pasien_baru&tone=formal&active=true&limit=50&offset=0
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | Tidak | Kata kunci pencarian di nama/isi template |
| `category` | string | Tidak | Filter kategori (value slug) |
| `tone` | string | Tidak | Filter gaya bahasa |
| `active` | string | Tidak | `true`/`false` — filter status aktif/nonaktif |
| `limit` | number | Tidak | Default 50, maksimal 100 |
| `offset` | number | Tidak | Default 0 |

```json
{ "success": true, "templates": [ /* ... */ ], "total": 1 }
```

### Detail Template

```
GET /message-templates/:id
```

### Buat Template Manual

```
POST /message-templates
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Ya | Nama template, 3–100 karakter |
| `category` | string | Ya | Value kategori (lihat `/categories`) |
| `tone` | string | Ya | `formal` / `ramah` / `friendly` / `singkat` |
| `content` | string | Ya | Isi pesan, maksimal 2000 karakter. Mendukung placeholder `{{nama_pasien}}`, `{{nama_poli}}`, `{{tanggal_kunjungan}}`, `{{jam_kunjungan}}` |
| `purpose` | string | Tidak | Tujuan pesan, 3–500 karakter |
| `additionalInstructions` | string | Tidak | Instruksi tambahan untuk AI, maksimal 500 karakter |
| `isActive` | boolean | Tidak | Default `true` |

### Update Template

```
PATCH /message-templates/:id
```

Semua field opsional (sama seperti create). Kirim `isActive: false` untuk
menonaktifkan template.

### Hapus Template

```
DELETE /message-templates/:id
```

```json
{ "success": true, "message": "Template pesan dihapus" }
```

### Duplikasi Template

```
POST /message-templates/:id/duplicate
```

Membuat salinan template; nama diakhiri `(Salinan)`.

### Generate Draf via AI Gemini

```
POST /message-templates/generate
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | string | Ya | Kategori template |
| `tone` | string | Ya | Gaya bahasa |
| `purpose` | string | Ya | Tujuan pesan, 3–500 karakter |
| `additionalInstructions` | string | Tidak | Instruksi tambahan, maksimal 500 karakter |
| `context` | string | Tidak | Konteks informasi (tanpa data sensitif), maksimal 2000 karakter |

Response sukses:

```json
{
  "success": true,
  "draft": {
    "name": "Pengingat Kunjungan Besok",
    "category": "pengingat_kunjungan",
    "tone": "formal",
    "content": "Halo {{nama_pasien}}, ..."
  }
}
```

AI menghasilkan pesan berbahasa Indonesia yang siap dipakai, wajib memakai
placeholder untuk data yang belum tersedia, dan dilarang mengarang jadwal, tarif,
promo, kebijakan, atau klaim medis. Hasil divalidasi dan distabilkan backend
(tag HTML dihapus, panjang dibatasi) sebelum dikembalikan sebagai draf.

Error khas endpoint ini:

| HTTP Status | Deskripsi |
|-------------|-----------|
| `400` | Input tidak valid (kategori/tone/purpose, dsb.) |
| `429` | Rate limit AI tercapai (`TPL_MAX_PER_MINUTE`, default 10/menit) |
| `502` | Kesalahan upstream Gemini (timeout, rate limit Google, respons kosong/tidak valid) |
| `503` | `GEMINI_API_KEY` belum dikonfigurasi |

---

## Server-Sent Events (SSE)

### Subscribe Event Stream

```
GET /events
```

### Event Log

```
GET /events/log?limit=50&offset=0
```

---

## Health Check

```
GET /
```

---

## Error Response

| HTTP Status | Deskripsi |
|-------------|-----------|
| `400` | Request invalid |
| `401` | API key tidak valid |
| `404` | Resource tidak ditemukan |
| `429` | Rate limit |
| `500` | Internal server error |
| `502` | Kesalahan upstream AI Gemini (endpoint template) |
| `503` | Session tidak connected / fitur AI belum dikonfigurasi |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port server |
| `HOST` | `0.0.0.0` | Host bind |
| `WA_ENGINE` | `baileys` | Engine: `baileys` atau `wwjs` |
| `API_KEY` | - | API key untuk auth |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `postgres` | PostgreSQL user |
| `DB_PASSWORD` | `postgres` | PostgreSQL password |
| `DB_NAME` | `whatsapp_gateway` | PostgreSQL database |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | - | Redis password |
| `REDIS_DB` | `0` | Redis database index |
| `DATA_DIR` | `./data` | Direktori auth state |
| `MSG_MIN_DELAY` | `3000` | Delay minimal antar pesan (ms) |
| `MSG_MAX_DELAY` | `5000` | Delay maksimal antar pesan (ms) |
| `MSG_MAX_PER_MINUTE` | `10` | Max pesan per menit |
| `MSG_MAX_PER_HOUR` | `200` | Max pesan per jam |
| `WEBHOOK_TIMEOUT` | `5000` | Webhook timeout (ms) |
| `LOG_LEVEL` | `info` | Log level |
| `GEMINI_API_KEY` | - | API key Google Gemini untuk AI generator template |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Model Gemini yang digunakan |
| `GEMINI_TIMEOUT_MS` | `20000` | Timeout request ke Gemini (ms) |
| `GEMINI_MAX_OUTPUT_TOKENS` | `1024` | Batas output token Gemini |
| `TPL_MAX_PER_MINUTE` | `10` | Rate limit endpoint generate AI per menit |
