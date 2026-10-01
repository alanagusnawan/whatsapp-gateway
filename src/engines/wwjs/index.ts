// whatsapp-web.js is CommonJS; interop through the default export
// so named ESM imports resolve under NodeNext.
import wwebjs from "whatsapp-web.js"
import { EventEmitter } from "node:events"
import type {
  Contact,
  Chat,
  SendMessagePayload,
  QRCodeData,
  SessionStatus,
} from "../../schemas/index.js"
import { logger } from "../../utils/logger.js"

const { Client, LocalAuth, MessageMedia, Location } = wwebjs as any

type WwjsClient = InstanceType<typeof Client>

export class WwjsEngine extends EventEmitter {
  readonly engineType = "wwjs" as const
  private client: WwjsClient | null = null
  private _status: SessionStatus = "created"
  private _qr: string | null = null
  private _phone: string | null = null
  private _authDir: string
  private _reconnectAttempts = 0
  private _maxReconnects = 5

  constructor(
    readonly sessionId: string,
    dataDir: string
  ) {
    super()
    this._authDir = `${dataDir}/${sessionId}/wwjs`
  }

  getStatus(): SessionStatus {
    return this._status
  }

  getQr(): string | null {
    return this._qr
  }

  getPhone(): string | null {
    return this._phone
  }

  async connect(): Promise<void> {
    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: this._authDir }),
      puppeteer: {
        // Puppeteer >= 21 maps `true` to the new headless mode, which runs
        // without any display server (no X11 / Wayland needed).
        headless: true,
        // Respect a user-provided binary (e.g. Ubuntu's system Chromium) so the
        // container does not need to download its own copy of Chrome.
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          // Sandbox is unavailable for root in containers; must be disabled.
          "--no-sandbox",
          "--disable-setuid-sandbox",
          // /dev/shm is tiny (64MB) in Docker by default — Chrome crashes
          // without this when WhatsApp Web allocates buffers.
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-gpu-compositing",
          "--disable-software-rasterizer",
          // Headless servers have no compositor / animation budget.
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-features=site-per-process,IsolateOrigins,TranslateUI",
          "--disable-ipc-flooding-protection",
          "--disable-accelerated-2d-canvas",
          "--disable-accelerated-video-decode",
          // Deterministic font rendering without a fontconfig cache on servers.
          "--font-render-hinting=none",
          "--disable-lcd-text",
          "--no-first-run",
          "--no-default-browser-check",
          "--mute-audio",
          "--hide-scrollbars",
          "--autoplay-policy=no-user-gesture-required",
          "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ],
        ignoreHTTPSErrors: true,
      },
    })

    this.client.on("qr", (qr: string) => {
      this._status = "qr_pending"
      this._qr = qr
      this.emit("qr", { sessionId: this.sessionId, qr })
    })

    this.client.on("ready", () => {
      this._status = "connected"
      this._qr = null
      this._reconnectAttempts = 0
      const info = this.client?.info
      if (info) {
        this._phone = info.wid.user
      }
      this.emit("connected", this.sessionId)
    })

    this.client.on("authenticated", () => {
      this._status = "authenticating"
      this.emit("authenticated", this.sessionId)
    })

    this.client.on("auth_failure", (msg: string) => {
      this._status = "error"
      this.emit("auth_failed", this.sessionId, new Error(msg))
    })

    this.client.on("disconnected", (reason: string) => {
      this._status = "disconnected"
      this.emit("disconnected", this.sessionId, reason)
    })

    this.client.on("message", async (msg: any) => {
      this.emit("message_received", this.sessionId, {
        id: msg.id._serialized,
        from: msg.from?.split("@")[0] || "",
        text: msg.body,
        timestamp: msg.timestamp,
        pushName: (msg as any)._data?.notifyName || "",
        hasMedia: msg.hasMedia,
        mediaType: msg.type !== "chat" ? msg.type : null,
      })
    })

    this.client.on("message_ack", (msg: any, ack: any) => {
      this.emit("message_status", this.sessionId, String(ack))
    })

    await this.client.initialize()
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.destroy()
      this.client = null
    }
    this._status = "disconnected"
  }

  async requestPairingCode(phone: string): Promise<string> {
    throw new Error("Pairing code not supported on whatsapp-web.js. Use QR code instead.")
  }

  async isRegistered(phone: string): Promise<boolean> {
    if (!this.client) throw new Error("Engine not connected")
    try {
      return await this.client.isRegisteredUser(phone)
    } catch {
      return false
    }
  }

  async sendMessage(payload: SendMessagePayload): Promise<{ id: string }> {
    if (!this.client) throw new Error("Engine not connected")

    const chatId = payload.to.includes("@")
      ? payload.to
      : payload.to.includes("-")
        ? `${payload.to}@g.us`
        : `${payload.to}@c.us`

    const options: Record<string, any> = {}
    if (payload.quoted) {
      const chat = await this.client.getChatById(payload.quoted.chatJid)
      const msgs = await chat.fetchMessages({ limit: 100 })
      const quotedMsg = msgs.find((m: any) => m.id._serialized === payload.quoted!.messageId)
      if (quotedMsg) options.quotedMessageId = quotedMsg.id._serialized
    }
    if (payload.mentions && payload.mentions.length > 0) {
      options.mentions = payload.mentions.map((p) => `${p}@c.us`)
    }
    if (payload.ephemeralExpiration) {
      options.ephemeralExpiration = payload.ephemeralExpiration
    }

    // ── Text ──────────────────────────────────────────────────
    if (payload.text) {
      const sent = await this.client.sendMessage(chatId, payload.text, options)
      return { id: sent.id._serialized }
    }

    // ── Media ─────────────────────────────────────────────────
    if (payload.mediaUrl && payload.mediaType) {
      const media = await MessageMedia.fromUrl(payload.mediaUrl, { unsafeMime: true })
      if (payload.caption) options.caption = payload.caption
      const sent = await this.client.sendMessage(chatId, media, options)
      return { id: sent.id._serialized }
    }

    // ── Location ──────────────────────────────────────────────
    if (payload.location) {
      const location = new Location(payload.location.lat, payload.location.lng)
      const sent = await this.client.sendMessage(chatId, location as any)
      return { id: sent.id._serialized }
    }

    // ── Reaction ──────────────────────────────────────────────
    if (payload.reaction) {
      const msg = await this.client.getMessageById(payload.reaction.messageId)
      if (msg) {
        await msg.react(payload.reaction.text)
        return { id: payload.reaction.messageId }
      }
      throw new Error("Message to react to not found")
    }

    // ── Contact (vCard) ──────────────────────────────────────
    if (payload.contacts) {
      const vcards = payload.contacts.contacts.map((c: any) => {
        const phone = c.phone.replace(/[^0-9]/g, "")
        return [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `FN:${c.name}`,
          c.organization ? `ORG:${c.organization}` : "",
          `TEL;type=CELL;type=VOICE;waid=${phone}:+${phone}`,
          "END:VCARD",
        ].filter(Boolean).join("\n")
      }).join("\n")
      const sent = await this.client.sendMessage(chatId, vcards)
      return { id: sent.id._serialized }
    }

    // ── Forward ───────────────────────────────────────────────
    if (payload.forward) {
      const msg = await this.client.getMessageById(payload.forward.messageId)
      if (msg) {
        const sent = await msg.forward(chatId) as any
        return { id: sent?.id?._serialized || payload.forward.messageId }
      }
      throw new Error("Message to forward not found")
    }

    throw new Error("No message content provided")
  }

  async deleteMessage(chatJid: string, messageId: string): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const msg = await this.client.getMessageById(messageId)
    if (msg) await msg.delete(true)
  }

  async editMessage(chatJid: string, messageId: string, text: string): Promise<void> {
    throw new Error("Edit message not supported on whatsapp-web.js")
  }

  async markRead(chatJid: string, messageIds: string[]): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(chatJid)
    await chat.sendSeen()
  }

  async sendPresence(chatJid: string, presence: "available" | "unavailable" | "composing" | "recording" | "paused"): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(chatJid)
    if (presence === "composing") await chat.sendStateTyping()
    else if (presence === "recording") await chat.sendStateRecording()
    else if (presence === "paused") await chat.clearState()
    else if (presence === "available") await this.client.sendPresenceAvailable()
    else if (presence === "unavailable") await this.client.sendPresenceUnavailable()
  }

  async presenceSubscribe(chatJid: string): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    // whatsapp-web.js doesn't have explicit presenceSubscribe
    // presence updates are received automatically
  }

  async archiveChat(chatJid: string, archive: boolean): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(chatJid)
    await chat.archive()
  }

  async muteChat(chatJid: string, durationMs: number | null): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(chatJid)
    if (durationMs) await chat.mute()
    else await chat.unmute()
  }

  async pinChat(chatJid: string, pin: boolean): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(chatJid)
    if (pin) await chat.pin()
    else await chat.unpin()
  }

  async deleteChat(chatJid: string): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(chatJid)
    await chat.delete()
  }

  async starMessage(chatJid: string, messageId: string, fromMe: boolean, star: boolean): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const msg = await this.client.getMessageById(messageId)
    if (msg) {
      if (star) await msg.star()
      else await msg.unstar()
    }
  }

  async getProfilePicture(chatJid: string): Promise<string | null> {
    if (!this.client) throw new Error("Engine not connected")
    try {
      const contact = await this.client.getContactById(chatJid)
      return await contact.getProfilePicUrl() || null
    } catch {
      return null
    }
  }

  async updateProfileName(name: string): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    await (this.client as any).setProfileName?.(name)
  }

  async updateProfileStatus(status: string): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    await (this.client as any).setProfileStatus?.(status)
  }

  async groupCreate(subject: string, participants: string[]): Promise<{ gid: string }> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.createGroup(subject, participants) as any
    return { gid: chat?.id?._serialized || chat?.gid || "" }
  }

  async groupMetadata(jid: string): Promise<any> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(jid) as any
    return await chat.groupMetadata?.() || {}
  }

  async groupParticipantsUpdate(jid: string, participants: string[], action: "add" | "remove" | "promote" | "demote"): Promise<any> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(jid) as any
    if (action === "add") return await chat.addParticipants?.(participants)
    if (action === "remove") return await chat.removeParticipants?.(participants)
    if (action === "promote") return await chat.promoteParticipants?.(participants)
    if (action === "demote") return await chat.demoteParticipants?.(participants)
  }

  async groupUpdateSubject(jid: string, subject: string): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(jid) as any
    await chat.setSubject?.(subject)
  }

  async groupUpdateDescription(jid: string, description: string): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(jid) as any
    await chat.setDescription?.(description)
  }

  async groupSettingUpdate(jid: string, setting: "announcement" | "not_announcement" | "locked" | "unlocked"): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(jid) as any
    if (setting === "announcement") await chat.setMessagesAdminsOnly?.(true)
    else if (setting === "not_announcement") await chat.setMessagesAdminsOnly?.(false)
    else if (setting === "locked") await chat.setInfoAdminsOnly?.(true)
    else if (setting === "unlocked") await chat.setInfoAdminsOnly?.(false)
  }

  async groupLeave(jid: string): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(jid) as any
    await chat.leave?.()
  }

  async groupInviteCode(jid: string): Promise<string> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(jid) as any
    return await chat.getInviteCode?.() || ""
  }

  async groupRevokeInvite(jid: string): Promise<string> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(jid) as any
    return await chat.revokeInvite?.() || ""
  }

  async groupAcceptInvite(code: string): Promise<string> {
    if (!this.client) throw new Error("Engine not connected")
    const result = await this.client.acceptInvite(code)
    return result || ""
  }

  async groupGetInviteInfo(code: string): Promise<any> {
    if (!this.client) throw new Error("Engine not connected")
    return await this.client.getInviteInfo(code)
  }

  async groupToggleEphemeral(jid: string, duration: number): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(jid) as any
    await chat.setEphemeralDuration?.(duration / 1000)
  }

  async groupMemberAddMode(jid: string, mode: "all_member_add" | "admin_add"): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(jid) as any
    await chat.setMemberAddMode?.(mode)
  }

  async groupFetchAllParticipating(): Promise<Record<string, any>> {
    if (!this.client) throw new Error("Engine not connected")
    const chats = await this.client.getChats()
    const groups: Record<string, any> = {}
    for (const chat of chats) {
      if (chat.isGroup) {
        groups[chat.id._serialized] = {
          id: chat.id._serialized,
          name: chat.name,
          isGroup: true,
        }
      }
    }
    return groups
  }

  async groupRequestParticipantsList(jid: string): Promise<any[]> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(jid) as any
    return await chat.getRequestParticipants?.() || []
  }

  async groupRequestParticipantsUpdate(jid: string, participants: string[], action: "approve" | "reject"): Promise<any> {
    if (!this.client) throw new Error("Engine not connected")
    const chat = await this.client.getChatById(jid) as any
    if (action === "approve") return await chat.approveRequestParticipants?.(participants)
    return await chat.rejectRequestParticipants?.(participants)
  }

  async updateBlockStatus(jid: string, status: "block" | "unblock"): Promise<void> {
    if (!this.client) throw new Error("Engine not connected")
    const contact = await this.client.getContactById(jid)
    if (status === "block") await contact.block()
    else await contact.unblock()
  }

  async fetchBlocklist(): Promise<string[]> {
    if (!this.client) throw new Error("Engine not connected")
    const contacts = await this.client.getBlockedContacts()
    return contacts.map((c: any) => c.id._serialized)
  }

  async fetchPrivacySettings(refresh?: boolean): Promise<any> {
    throw new Error("fetchPrivacySettings not supported on whatsapp-web.js")
  }

  async updateLastSeenPrivacy(value: "all" | "contacts" | "contact_blacklist" | "none"): Promise<void> {
    throw new Error("updateLastSeenPrivacy not supported on whatsapp-web.js")
  }

  async updateOnlinePrivacy(value: "all" | "match_last_seen"): Promise<void> {
    throw new Error("updateOnlinePrivacy not supported on whatsapp-web.js")
  }

  async updateProfilePicturePrivacy(value: "all" | "contacts" | "contact_blacklist" | "none"): Promise<void> {
    throw new Error("updateProfilePicturePrivacy not supported on whatsapp-web.js")
  }

  async updateStatusPrivacy(value: "all" | "contacts" | "contact_blacklist" | "none"): Promise<void> {
    throw new Error("updateStatusPrivacy not supported on whatsapp-web.js")
  }

  async updateReadReceiptsPrivacy(value: "all" | "none"): Promise<void> {
    throw new Error("updateReadReceiptsPrivacy not supported on whatsapp-web.js")
  }

  async updateGroupsAddPrivacy(value: "all" | "contacts" | "contact_blacklist"): Promise<void> {
    throw new Error("updateGroupsAddPrivacy not supported on whatsapp-web.js")
  }

  async updateDefaultDisappearingMode(duration: number): Promise<void> {
    throw new Error("updateDefaultDisappearingMode not supported on whatsapp-web.js")
  }

  async sendBroadcast(jid: string, content: any, options?: any): Promise<{ id: string }> {
    if (!this.client) throw new Error("Engine not connected")
    const sent = await this.client.sendMessage(jid, content.text || "", options)
    return { id: sent.id._serialized }
  }

  async sendStatus(content: any, statusJidList: string[], options?: any): Promise<{ id: string }> {
    throw new Error("Status/Stories not supported on whatsapp-web.js")
  }

  async getBroadcastListInfo(jid: string): Promise<any> {
    throw new Error("getBroadcastListInfo not supported on whatsapp-web.js")
  }

  async fetchMessageHistory(count: number, oldestMsgKey: any, oldestMsgTimestamp: number): Promise<void> {
    throw new Error("fetchMessageHistory not supported on whatsapp-web.js")
  }

  async downloadMedia(msg: any, type: "buffer" | "stream" = "buffer"): Promise<any> {
    if (!this.client) throw new Error("Engine not connected")
    const media = await msg.downloadMedia()
    return type === "buffer" ? Buffer.from(media.data, "base64") : media.data
  }

  async getContacts(): Promise<Contact[]> {
    if (!this.client) throw new Error("Engine not connected")

    const contacts = await this.client.getContacts()
    return contacts
      .filter((c: any) => !c.isGroup)
            .map((c: any) => ({        id: c.id._serialized,
        name: c.name || c.pushname,
        pushName: c.pushname,
        phone: c.number || c.id.user,
        isGroup: false,
      }))
  }

  async getChats(): Promise<Chat[]> {
    if (!this.client) throw new Error("Engine not connected")

    const chats = await this.client.getChats()
    return chats.map((c: any) => ({
      id: c.id._serialized,
      name: c.name,
      isGroup: c.isGroup,
      lastMessage: c.lastMessage
        ? {
            text: c.lastMessage.body,
            timestamp: c.lastMessage.timestamp,
          }
        : undefined,
      unreadCount: c.unreadCount,
    }))
  }
}
