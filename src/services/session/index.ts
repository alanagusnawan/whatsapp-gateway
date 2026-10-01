import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { EventEmitter } from "node:events"
import { createEngine } from "../../engines/index.js"
import type { WhatsAppEngine } from "../../engines/types.js"
import { sessionStore } from "./store.js"
import { config } from "../../config/index.js"
import type {
  Session,
  EngineType,
  SendMessagePayload,
  Contact,
  Chat,
  GatewayEvent,
  QRCodeData,
} from "../../schemas/index.js"
import { logger } from "../../utils/logger.js"

class SessionManager extends EventEmitter {
  private engines = new Map<string, WhatsAppEngine>()
  private _eventLog: GatewayEvent[] = []
  private _maxEventLog = 1000

  get eventLog(): GatewayEvent[] {
    return [...this._eventLog]
  }

  private logEvent(event: GatewayEvent) {
    this._eventLog.push(event)
    if (this._eventLog.length > this._maxEventLog) {
      this._eventLog = this._eventLog.slice(-this._maxEventLog)
    }
  }

  async createSession(
    name: string,
    engineType: EngineType
  ): Promise<Session> {
    const id = randomUUID().slice(0, 8)
    const now = new Date().toISOString()

    const session: Session = {
      id,
      name,
      engine: engineType,
      status: "created",
      createdAt: now,
      updatedAt: now,
    }

    await sessionStore.create(session)

    const engine = createEngine(engineType, id, config.storage.dataDir)
    this.engines.set(id, engine)

    this.setupEngineEvents(engine)

    logger.info({ sessionId: id, name, engine: engineType }, "Session created")
    return session
  }

  private setupEngineEvents(engine: WhatsAppEngine) {
    engine.on("qr", (data: QRCodeData) => {
      const event: GatewayEvent = {
        type: "session.qr",
        sessionId: data.sessionId,
        timestamp: Date.now(),
        data: { qr: data.qr },
      }
      sessionStore.updateStatus(data.sessionId, "qr_pending").catch((err) => {
        logger.error({ err }, "Failed to update session status")
      })
      this.logEvent(event)
      this.emit("event", event)
    })

    engine.on("connected", (sessionId: string) => {
      const phone = engine.getPhone()
      const event: GatewayEvent = {
        type: "session.connected",
        sessionId,
        timestamp: Date.now(),
        data: { phone },
      }
      sessionStore.updateStatus(sessionId, "connected", phone || undefined).catch((err) => {
        logger.error({ err }, "Failed to update session status")
      })
      this.logEvent(event)
      this.emit("event", event)
    })

    engine.on("disconnected", (sessionId: string, reason?: string) => {
      const event: GatewayEvent = {
        type: "session.disconnected",
        sessionId,
        timestamp: Date.now(),
        data: { reason },
      }
      sessionStore.updateStatus(sessionId, "disconnected").catch((err) => {
        logger.error({ err }, "Failed to update session status")
      })
      this.logEvent(event)
      this.emit("event", event)
    })

    engine.on("auth_failed", (sessionId: string, error: Error) => {
      const event: GatewayEvent = {
        type: "session.auth_failed",
        sessionId,
        timestamp: Date.now(),
        data: { error: error.message },
      }
      sessionStore.updateStatus(sessionId, "error").catch((err) => {
        logger.error({ err }, "Failed to update session status")
      })
      this.logEvent(event)
      this.emit("event", event)
    })

    engine.on("message_received", (sessionId: string, data: Record<string, unknown>) => {
      const event: GatewayEvent = {
        type: "message.received",
        sessionId,
        timestamp: Date.now(),
        data,
      }
      this.logEvent(event)
      this.emit("event", event)
    })

    engine.on("message_status", (sessionId: string, status: string) => {
      const event: GatewayEvent = {
        type: "message.status",
        sessionId,
        timestamp: Date.now(),
        data: { status },
      }
      this.logEvent(event)
      this.emit("event", event)
    })
  }

  async connectSession(sessionId: string): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    await engine.connect()
  }

  async disconnectSession(sessionId: string): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    await engine.disconnect()
  }

  async deleteSession(sessionId: string): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (engine) {
      await engine.disconnect()
      this.engines.delete(sessionId)
    }

    await sessionStore.delete(sessionId)

    const sessionDir = resolve(config.storage.dataDir, sessionId)
    if (existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true, force: true })
    }

    logger.info({ sessionId }, "Session deleted")
  }

  getEngine(sessionId: string): WhatsAppEngine | undefined {
    return this.engines.get(sessionId)
  }

  getQr(sessionId: string): string | null {
    const engine = this.engines.get(sessionId)
    return engine?.getQr() || null
  }

  async listSessions(): Promise<Session[]> {
    return sessionStore.getAll()
  }

  async getSession(id: string): Promise<Session | null> {
    return sessionStore.getById(id)
  }

  async requestPairingCode(sessionId: string, phone: string): Promise<string> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.requestPairingCode(phone)
  }

  async sendMessage(payload: SendMessagePayload): Promise<{ id: string }> {
    const engine = this.engines.get(payload.sessionId)
    if (!engine) throw new Error(`Session ${payload.sessionId} not found`)
    if (engine.getStatus() !== "connected") {
      throw new Error(`Session ${payload.sessionId} is not connected`)
    }
    const result = await engine.sendMessage(payload)

    const chatJid = payload.to.includes("@")
      ? payload.to
      : `${payload.to.replace(/[^0-9]/g, "")}@s.whatsapp.net`

    const event: GatewayEvent = {
      type: "message.sent",
      sessionId: payload.sessionId,
      timestamp: Date.now(),
      data: {
        messageId: result.id,
        to: payload.to,
        chatJid,
        phone: payload.to.includes("@") ? undefined : payload.to.replace(/[^0-9]/g, ""),
        text: payload.text || payload.caption || null,
        mediaType: payload.mediaType || null,
      },
    }
    this.logEvent(event)
    this.emit("event", event)

    return result
  }

  async isRegistered(sessionId: string, phone: string): Promise<boolean> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    if (engine.getStatus() !== "connected") {
      throw new Error(`Session ${sessionId} is not connected`)
    }
    return engine.isRegistered(phone)
  }

  async deleteMessage(sessionId: string, chatJid: string, messageId: string): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.deleteMessage(chatJid, messageId)
  }

  async editMessage(sessionId: string, chatJid: string, messageId: string, text: string): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.editMessage(chatJid, messageId, text)
  }

  async markRead(sessionId: string, chatJid: string, messageIds: string[]): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.markRead(chatJid, messageIds)
  }

  async sendPresence(sessionId: string, chatJid: string, presence: "available" | "unavailable" | "composing" | "recording" | "paused"): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.sendPresence(chatJid, presence)
  }

  async presenceSubscribe(sessionId: string, chatJid: string): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.presenceSubscribe(chatJid)
  }

  async archiveChat(sessionId: string, chatJid: string, archive: boolean): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.archiveChat(chatJid, archive)
  }

  async muteChat(sessionId: string, chatJid: string, durationMs: number | null): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.muteChat(chatJid, durationMs)
  }

  async pinChat(sessionId: string, chatJid: string, pin: boolean): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.pinChat(chatJid, pin)
  }

  async deleteChat(sessionId: string, chatJid: string): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.deleteChat(chatJid)
  }

  async starMessage(sessionId: string, chatJid: string, messageId: string, fromMe: boolean, star: boolean): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.starMessage(chatJid, messageId, fromMe, star)
  }

  async getProfilePicture(sessionId: string, chatJid: string): Promise<string | null> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.getProfilePicture(chatJid)
  }

  async updateProfileName(sessionId: string, name: string): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.updateProfileName(name)
  }

  async updateProfileStatus(sessionId: string, status: string): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.updateProfileStatus(status)
  }

  async groupCreate(sessionId: string, subject: string, participants: string[]): Promise<{ gid: string }> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupCreate(subject, participants)
  }

  async groupMetadata(sessionId: string, jid: string): Promise<any> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupMetadata(jid)
  }

  async groupParticipantsUpdate(sessionId: string, jid: string, participants: string[], action: "add" | "remove" | "promote" | "demote"): Promise<any> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupParticipantsUpdate(jid, participants, action)
  }

  async groupUpdateSubject(sessionId: string, jid: string, subject: string): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupUpdateSubject(jid, subject)
  }

  async groupUpdateDescription(sessionId: string, jid: string, description: string): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupUpdateDescription(jid, description)
  }

  async groupSettingUpdate(sessionId: string, jid: string, setting: "announcement" | "not_announcement" | "locked" | "unlocked"): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupSettingUpdate(jid, setting)
  }

  async groupLeave(sessionId: string, jid: string): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupLeave(jid)
  }

  async groupInviteCode(sessionId: string, jid: string): Promise<string> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupInviteCode(jid)
  }

  async groupRevokeInvite(sessionId: string, jid: string): Promise<string> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupRevokeInvite(jid)
  }

  async groupAcceptInvite(sessionId: string, code: string): Promise<string> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupAcceptInvite(code)
  }

  async groupGetInviteInfo(sessionId: string, code: string): Promise<any> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupGetInviteInfo(code)
  }

  async groupToggleEphemeral(sessionId: string, jid: string, duration: number): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupToggleEphemeral(jid, duration)
  }

  async groupMemberAddMode(sessionId: string, jid: string, mode: "all_member_add" | "admin_add"): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupMemberAddMode(jid, mode)
  }

  async groupFetchAllParticipating(sessionId: string): Promise<Record<string, any>> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupFetchAllParticipating()
  }

  async groupRequestParticipantsList(sessionId: string, jid: string): Promise<any[]> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupRequestParticipantsList(jid)
  }

  async groupRequestParticipantsUpdate(sessionId: string, jid: string, participants: string[], action: "approve" | "reject"): Promise<any> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.groupRequestParticipantsUpdate(jid, participants, action)
  }

  async updateBlockStatus(sessionId: string, jid: string, status: "block" | "unblock"): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.updateBlockStatus(jid, status)
  }

  async fetchBlocklist(sessionId: string): Promise<string[]> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.fetchBlocklist()
  }

  async fetchPrivacySettings(sessionId: string, refresh?: boolean): Promise<any> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.fetchPrivacySettings(refresh)
  }

  async updateLastSeenPrivacy(sessionId: string, value: "all" | "contacts" | "contact_blacklist" | "none"): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.updateLastSeenPrivacy(value)
  }

  async updateOnlinePrivacy(sessionId: string, value: "all" | "match_last_seen"): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.updateOnlinePrivacy(value)
  }

  async updateProfilePicturePrivacy(sessionId: string, value: "all" | "contacts" | "contact_blacklist" | "none"): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.updateProfilePicturePrivacy(value)
  }

  async updateStatusPrivacy(sessionId: string, value: "all" | "contacts" | "contact_blacklist" | "none"): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.updateStatusPrivacy(value)
  }

  async updateReadReceiptsPrivacy(sessionId: string, value: "all" | "none"): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.updateReadReceiptsPrivacy(value)
  }

  async updateGroupsAddPrivacy(sessionId: string, value: "all" | "contacts" | "contact_blacklist"): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.updateGroupsAddPrivacy(value)
  }

  async updateDefaultDisappearingMode(sessionId: string, duration: number): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.updateDefaultDisappearingMode(duration)
  }

  async sendBroadcast(sessionId: string, jid: string, content: any, options?: any): Promise<{ id: string }> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.sendBroadcast(jid, content, options)
  }

  async sendStatus(sessionId: string, content: any, statusJidList: string[], options?: any): Promise<{ id: string }> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.sendStatus(content, statusJidList, options)
  }

  async getBroadcastListInfo(sessionId: string, jid: string): Promise<any> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.getBroadcastListInfo(jid)
  }

  async fetchMessageHistory(sessionId: string, count: number, oldestMsgKey: any, oldestMsgTimestamp: number): Promise<void> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.fetchMessageHistory(count, oldestMsgKey, oldestMsgTimestamp)
  }

  async downloadMedia(sessionId: string, msg: any, type?: "buffer" | "stream"): Promise<any> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.downloadMedia(msg, type)
  }

  async getContacts(sessionId: string): Promise<Contact[]> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.getContacts()
  }

  async getChats(sessionId: string): Promise<Chat[]> {
    const engine = this.engines.get(sessionId)
    if (!engine) throw new Error(`Session ${sessionId} not found`)
    return engine.getChats()
  }
}

export const sessionManager = new SessionManager()
