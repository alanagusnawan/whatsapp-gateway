export type EngineType = "baileys" | "wwjs"

export type SessionStatus =
  | "created"
  | "qr_pending"
  | "authenticating"
  | "connected"
  | "disconnected"
  | "error"

export interface Session {
  id: string
  name: string
  engine: EngineType
  status: SessionStatus
  phone?: string
  createdAt: string
  updatedAt: string
}

export interface SendMessagePayload {
  sessionId: string
  to: string

  // Text
  text?: string

  // Media
  mediaUrl?: string
  mediaType?: "image" | "video" | "document" | "audio"
  caption?: string

  // Location
  location?: { lat: number; lng: number }

  // Reaction
  reaction?: { text: string; messageId: string }

  // Poll
  poll?: {
    name: string
    values: string[]
    selectableCount: number
  }

  // Contact (vCard)
  contacts?: {
    displayName: string
    contacts: Array<{
      name: string
      phone: string
      organization?: string
    }>
  }

  // Pin message
  pin?: {
    messageId: string
    type: 0 | 1
    time?: number
  }

  // Forward message
  forward?: { messageId: string; chatJid: string }

  // Disappearing messages (enable/disable for chat)
  disappearingMessages?: {
    enabled: boolean
    duration?: number
  }

  // Mention users (array of phone numbers)
  mentions?: string[]

  // Quoting a message
  quoted?: { messageId: string; chatJid: string }

  // Disappear this specific message
  ephemeralExpiration?: number
}

export interface Contact {
  id: string
  name?: string
  pushName?: string
  phone: string
  isGroup: boolean
}

export interface Chat {
  id: string
  name?: string
  phone?: string
  isGroup: boolean
  lastMessage?: {
    text?: string
    timestamp: number
  }
  unreadCount: number
}

export interface WebhookConfig {
  id: string
  url: string
  events: WebhookEvent[]
  secret?: string
  active: boolean
  createdAt: string
}

export type WebhookEvent =
  | "message.received"
  | "message.sent"
  | "message.status"
  | "session.qr"
  | "session.connected"
  | "session.disconnected"
  | "session.auth_failed"

export interface GatewayEvent {
  type: WebhookEvent
  sessionId: string
  timestamp: number
  data: Record<string, unknown>
}

export interface QRCodeData {
  sessionId: string
  qr: string
}
