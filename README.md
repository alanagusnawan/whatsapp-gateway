# WhatsApp Gateway

Backend WhatsApp gateway dengan Elysia.js, mendukung dua engine (Baileys + whatsapp-web.js) melalui abstraction layer.

## Fitur

- **Multi Engine**: Baileys (recommended) atau whatsapp-web.js
- **Multi Session**: Jalankan beberapa nomor WhatsApp sekaligus
- **REST API**: Kirim pesan, ambil kontak, kelola session
- **WebSocket**: Real-time chat masuk & keluar, sinkron di semua device per session
- **Webhook**: Kirim event ke URL yang dikonfigurasi
- **SSE**: Real-time event stream via Server-Sent Events
- **PostgreSQL**: Database untuk session & webhook metadata
- **File System**: Storage untuk auth state WhatsApp
- **Redis**: Cache layer
- **API Key Auth**: Autentikasi via header X-API-Key
- **Docker**: Siap deploy dengan Docker

## Requirements

- **Node.js 20+** (Baileys butuh native WebSocket support — tidak jalan di Bun)
- PostgreSQL 14+
- Redis (opsional, untuk cache)
- Chrome/Chromium (hanya untuk engine `wwjs`)

## Setup

### Instalasi Lokal

```bash
# Install dependencies
npm install

# Untuk engine wwjs, pastikan Chrome terpasang
npx puppeteer browsers install chrome

# Copy env
cp .env.example .env

# Edit .env sesuai kebutuhan
# Pastikan PostgreSQL dan Redis berjalan (atau pakai docker-compose)

# Development (hot reload)
npm run dev

# Production
npm run build && npm start
```

> **Catatan runtime:** Baileys membutuhkan WebSocket native Node (`ws.upgrade()`).
> Bun belum mengimplementasikan ini, sehingga session langsung disconnect
> sebelum QR sempat dibuat. Karena itu project ini berjalan di Node.js.

### Docker

```bash
# Build & run
docker-compose up -d

# Atau build manual
docker build -t whatsapp-gateway .
docker run -p 3000:3000 -e API_KEY=your-key whatsapp-gateway
```

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
| `DATA_DIR` | `./data` | Direktori penyimpanan auth state |
| `LOG_LEVEL` | `info` | Log level |
| `WEBHOOK_TIMEOUT` | `5000` | Webhook timeout (ms) |
| `WEBHOOK_RETRIES` | `3` | Webhook retry count |

> `.env` dibaca otomatis saat server start (`process.loadEnvFile()`).

## API Reference

Semua request butuh header `X-API-Key: <your-key>` (kalau API_KEY di-set).

### Session

```bash
# Buat session baru
POST /session
{ "name": "My Bot", "engine": "baileys" }

# List semua session
GET /session

# Detail session
GET /session/:id

# Dapatkan QR code (untuk scan)
GET /session/:id/qr

# Connect session
POST /session/:id/connect

# Disconnect session
POST /session/:id/disconnect

# Hapus session
DELETE /session/:id
```

### Message

```bash
# Kirim pesan teks
POST /message/send
{
  "sessionId": "abc123",
  "to": "6281234567890",
  "text": "Hello!"
}

# Kirim gambar
POST /message/send
{
  "sessionId": "abc123",
  "to": "6281234567890",
  "mediaUrl": "https://example.com/image.jpg",
  "mediaType": "image",
  "caption": "Ini gambar"
}

# Kirim lokasi
POST /message/send
{
  "sessionId": "abc123",
  "to": "6281234567890",
  "location": { "lat": -6.2088, "lng": 106.8456 }
}
```

### Contacts & Chats

```bash
# List kontak
GET /contacts/:sessionId

# List chat (termasuk field phone untuk chat private)
GET /chats/:sessionId

# Riwayat pesan per chat — tiap pesan menyertakan field `phone`
# (nomor HP kontak/pengirim, di-resolve dari LID→PN)
GET /chats/:sessionId/:chatJid/messages?limit=50&offset=0

# Contoh:
GET /chats/abc123/6281234567890%40s.whatsapp.net/messages?limit=20
# → { success: true, messages: [{ ..., phone: "6281234567890" }] }
```

### Webhook

```bash
# Buat webhook
POST /webhook
{
  "url": "https://your-app.com/webhook",
  "events": ["message.received", "session.connected"],
  "secret": "optional-hmac-secret"
}

# List webhooks
GET /webhook

# Update webhook
PATCH /webhook/:id
{ "active": false }

# Hapus webhook
DELETE /webhook/:id
```

### Events (SSE)

```bash
# Subscribe ke real-time events
GET /events

# Mendapat event log
GET /events/log?limit=50&offset=0
```

### WebSocket

Endpoint `/ws` untuk sinkronisasi chat masuk & keluar di semua device
dengan session yang sama. Setiap koneksi bisa filter per session.

```bash
# Connect — semua event (atau filter via query param)
ws://localhost:3000/ws
ws://localhost:3000/ws?sessionId=abc123

# Dengan API key (browser WS tidak bisa set header, pakai query param)
ws://localhost:3000/ws?sessionId=abc123&apiKey=your-secret-api-key
```

Protocol (JSON text frames):

```jsonc
// Saat connect, server kirim:
{ "type": "connected", "sessionId": "abc123" }

// Subscribe ke session tertentu (ganti filter saat runtime):
{ "type": "subscribe", "sessionId": "abc123" }
// → { "type": "subscribed", "sessionId": "abc123" }

// Kembali terima semua session:
{ "type": "unsubscribe" }
// → { "type": "subscribed", "sessionId": null }

// Event gateway diterima langsung (chat masuk & keluar):
{ "type": "message.received", "sessionId": "abc123", "timestamp": 1712345678901,
  "data": { "id": "3EB0...", "from": "6281234567890", "phone": "6281234567890",
            "jid": "6281234567890@s.whatsapp.net", "text": "Halo", "pushName": "Budi", ... } }

{ "type": "message.sent", "sessionId": "abc123", "timestamp": 1712345678901,
  "data": { "messageId": "3EB0...", "to": "6281234567890", "chatJid": "6281234567890@s.whatsapp.net",
            "phone": "6281234567890", "text": "Balasan", "mediaType": null } }

{ "type": "message.status", "sessionId": "abc123", "data": { "status": "3" } }
```

Contoh client (Node):

```js
import WebSocket from "ws"

const ws = new WebSocket("ws://localhost:3000/ws?sessionId=abc123&apiKey=your-key")
ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", sessionId: "abc123" })))
ws.on("message", (raw) => {
  const event = JSON.parse(raw)
  if (event.type === "message.received") console.log("CHAT MASUK:", event.data.phone, event.data.text)
  if (event.type === "message.sent")     console.log("CHAT KELUAR:", event.data.phone, event.data.text)
})
```

> Pesan keluar (via `POST /message/send`) juga di-persist ke DB sehingga
> riwayat chat lengkap dan konsisten di semua device.

## Event Types

| Event | Deskripsi |
|-------|-----------|
| `message.received` | Pesan baru diterima |
| `message.sent` | Pesan berhasil dikirim |
| `message.status` | Status pesan berubah |
| `session.qr` | QR code tersedia untuk scan |
| `session.connected` | Session terhubung ke WhatsApp |
| `session.disconnected` | Session terputus |
| `session.auth_failed` | Autentikasi gagal |

## Arsitektur

```
src/
├── index.ts                 # Entry point (Elysia + Node adapter)
├── config/                  # Konfigurasi
├── engines/                 # WhatsApp engine abstraction
│   ├── types.ts             # Interface
│   ├── baileys/             # Baileys implementation
│   └── wwjs/                # whatsapp-web.js implementation
├── services/                # Business logic
├── routes/                  # REST API endpoints
├── storage/                 # PostgreSQL, File, Redis
├── events/                  # Event bus & webhook dispatcher
├── plugins/                 # Auth, error, CORS
└── schemas/                 # Shared type definitions
```

## License

MIT
