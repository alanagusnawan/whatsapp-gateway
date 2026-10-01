import type { EventEmitter } from "node:events"
import type {
  Contact,
  Chat,
  SendMessagePayload,
  GatewayEvent,
  QRCodeData,
  EngineType,
  SessionStatus,
} from "../schemas/index.js"

export interface EngineEvents {
  qr: (data: QRCodeData) => void
  connected: (sessionId: string) => void
  disconnected: (sessionId: string, reason?: string) => void
  authenticated: (sessionId: string) => void
  auth_failed: (sessionId: string, error: Error) => void
  message_received: (sessionId: string, message: GatewayEvent["data"]) => void
  message_status: (sessionId: string, status: string) => void
}

export interface WhatsAppEngine {
  readonly engineType: EngineType
  readonly sessionId: string

  connect(): Promise<void>
  disconnect(): Promise<void>
  requestPairingCode(phone: string): Promise<string>
  sendMessage(payload: SendMessagePayload): Promise<{ id: string }>
  deleteMessage(chatJid: string, messageId: string): Promise<void>
  editMessage(chatJid: string, messageId: string, text: string): Promise<void>
  markRead(chatJid: string, messageIds: string[]): Promise<void>
  sendPresence(chatJid: string, presence: "available" | "unavailable" | "composing" | "recording" | "paused"): Promise<void>
  presenceSubscribe(chatJid: string): Promise<void>
  archiveChat(chatJid: string, archive: boolean): Promise<void>
  muteChat(chatJid: string, durationMs: number | null): Promise<void>
  pinChat(chatJid: string, pin: boolean): Promise<void>
  deleteChat(chatJid: string): Promise<void>
  starMessage(chatJid: string, messageId: string, fromMe: boolean, star: boolean): Promise<void>
  getProfilePicture(chatJid: string): Promise<string | null>
  updateProfileName(name: string): Promise<void>
  updateProfileStatus(status: string): Promise<void>
  groupCreate(subject: string, participants: string[]): Promise<{ gid: string }>
  groupMetadata(jid: string): Promise<any>
  groupParticipantsUpdate(jid: string, participants: string[], action: "add" | "remove" | "promote" | "demote"): Promise<any>
  groupUpdateSubject(jid: string, subject: string): Promise<void>
  groupUpdateDescription(jid: string, description: string): Promise<void>
  groupSettingUpdate(jid: string, setting: "announcement" | "not_announcement" | "locked" | "unlocked"): Promise<void>
  groupLeave(jid: string): Promise<void>
  groupInviteCode(jid: string): Promise<string>
  groupRevokeInvite(jid: string): Promise<string>
  groupAcceptInvite(code: string): Promise<string>
  groupGetInviteInfo(code: string): Promise<any>
  groupToggleEphemeral(jid: string, duration: number): Promise<void>
  groupMemberAddMode(jid: string, mode: "all_member_add" | "admin_add"): Promise<void>
  groupFetchAllParticipating(): Promise<Record<string, any>>
  groupRequestParticipantsList(jid: string): Promise<any[]>
  groupRequestParticipantsUpdate(jid: string, participants: string[], action: "approve" | "reject"): Promise<any>
  updateBlockStatus(jid: string, status: "block" | "unblock"): Promise<void>
  fetchBlocklist(): Promise<string[]>
  fetchPrivacySettings(refresh?: boolean): Promise<any>
  updateLastSeenPrivacy(value: "all" | "contacts" | "contact_blacklist" | "none"): Promise<void>
  updateOnlinePrivacy(value: "all" | "match_last_seen"): Promise<void>
  updateProfilePicturePrivacy(value: "all" | "contacts" | "contact_blacklist" | "none"): Promise<void>
  updateStatusPrivacy(value: "all" | "contacts" | "contact_blacklist" | "none"): Promise<void>
  updateReadReceiptsPrivacy(value: "all" | "none"): Promise<void>
  updateGroupsAddPrivacy(value: "all" | "contacts" | "contact_blacklist"): Promise<void>
  updateDefaultDisappearingMode(duration: number): Promise<void>
  sendBroadcast(jid: string, content: any, options?: any): Promise<{ id: string }>
  sendStatus(content: any, statusJidList: string[], options?: any): Promise<{ id: string }>
  getBroadcastListInfo(jid: string): Promise<any>
  fetchMessageHistory(count: number, oldestMsgKey: any, oldestMsgTimestamp: number): Promise<void>
  downloadMedia(msg: any, type?: "buffer" | "stream"): Promise<any>
  isRegistered(phone: string): Promise<boolean>
  getContacts(): Promise<Contact[]>
  getChats(): Promise<Chat[]>

  getStatus(): SessionStatus
  getQr(): string | null
  getPhone(): string | null

  on<K extends keyof EngineEvents>(
    event: K,
    listener: EngineEvents[K]
  ): void
  off<K extends keyof EngineEvents>(
    event: K,
    listener: EngineEvents[K]
  ): void
}

export interface EngineFactory {
  create(sessionId: string, dataDir: string): WhatsAppEngine
}
