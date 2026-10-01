import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidGroup,
  isJidBroadcast,
  isJidNewsletter,
  isPnUser,
  jidNormalizedUser,
  jidDecode,
  jidEncode,
  areJidsSameUser,
  WASocket,
  getContentType,
  Browsers,
  proto,
} from "@whiskeysockets/baileys"
import type { Boom } from "@hapi/boom"
import pino from "pino"
import { EventEmitter } from "node:events"
import type {
  Contact,
  Chat,
  SendMessagePayload,
  QRCodeData,
  SessionStatus,
} from "../../schemas/index.js"
import { contactStore } from "../../storage/contact-store.js"
import { chatStore } from "../../storage/chat-store.js"
import { messageStore } from "../../storage/message-store.js"
import { canonicalJid, getPhoneFromJid, normalizeJid, pnJid, isImmutableJid } from "../../utils/jid.js"
import { logger } from "../../utils/logger.js"

const log = pino({ level: "silent" })

function buildJid(phone: string): string {
  const clean = phone.replace(/[^0-9]/g, "")
  return jidEncode(clean, "s.whatsapp.net")
}

function buildGroupJid(groupId: string): string {
  return groupId.includes("@") ? groupId : `${groupId}@g.us`
}

export class BaileysEngine extends EventEmitter {
  readonly engineType = "baileys" as const
  private sock: WASocket | null = null
  private _status: SessionStatus = "created"
  private _qr: string | null = null
  private _phone: string | null = null
  private _authDir: string
  private _reconnectAttempts = 0
  private _maxReconnects = 3
  private _historySyncing = false

  constructor(
    readonly sessionId: string,
    dataDir: string
  ) {
    super()
    this._authDir = `${dataDir}/${sessionId}/baileys`
  }

  getStatus(): SessionStatus { return this._status }
  getQr(): string | null { return this._qr }
  getPhone(): string | null { return this._phone }

  // Cache LID→PN per engine (populated dari lid-mapping.update, history sync, resolve)
  private lidPnCache = new Map<string, string>()

  // Jid kanonik = <phone>@s.whatsapp.net ketika nomor diketahui.
  // Tanpa ini, incoming (LID) dan outgoing (PN) menulis dua baris chat berbeda.
  private async resolveCanonicalJid(rawJid: string, altJid?: string | null): Promise<string> {
    if (!rawJid) return ""
    if (isImmutableJid(rawJid)) return rawJid

    const direct = canonicalJid(rawJid, altJid, this.lidPnCache)
    if (!direct.endsWith("@lid")) return direct

    // LID belum ada di cache → tanya Baileys LID mapping store
    if (this.sock?.signalRepository?.lidMapping) {
      try {
        const pn = await this.sock.signalRepository.lidMapping.getPNForLID(rawJid)
        const phone = getPhoneFromJid(pn || "")
        if (phone) {
          const canonical = pnJid(phone)
          this.lidPnCache.set(normalizeJid(rawJid), canonical)
          return canonical
        }
      } catch {}
    }
    return rawJid
  }

  // Merge baris chat/contact/pesan LID yang sudah ada di DB ke jid PN.
  // Dipanggil saat connect — memperbaiki data split yang sudah terlanjur tersimpan.
  private async reconcileJids(): Promise<void> {
    if (!this.sock?.signalRepository?.lidMapping) return
    const lidMapping = this.sock.signalRepository.lidMapping
    const jids = [
      ...new Set([
        ...(await chatStore.getLidJids(this.sessionId)),
        ...(await contactStore.getLidJids(this.sessionId)),
      ]),
    ]
    if (jids.length === 0) return
    try {
      const mappings = await lidMapping.getPNsForLIDs(jids)
      for (const m of mappings || []) {
        const phone = getPhoneFromJid(m.pn)
        if (!phone) continue
        const lid = normalizeJid(m.lid)
        const canonical = pnJid(phone)
        this.lidPnCache.set(lid, canonical)
        await chatStore.mergeJid(this.sessionId, lid, canonical)
        await messageStore.mergeJid(this.sessionId, lid, canonical)
        await contactStore.mergeJid(this.sessionId, lid, canonical)
        await chatStore.updatePhone(this.sessionId, canonical, phone)
        await contactStore.updatePhoneByJid(this.sessionId, canonical, phone)
      }
      if (mappings?.length) {
        logger.info({ sessionId: this.sessionId, count: mappings.length }, "JID reconcile done (LID→PN merge)")
      }
    } catch (err) {
      logger.debug({ err, sessionId: this.sessionId }, "JID reconcile failed")
    }
  }

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this._authDir)
    const { version } = await fetchLatestBaileysVersion()

    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, log),
      },
      // NOTE: Browsers.macOS("Desktop") is rejected by WhatsApp with a 428
      // "Connection Terminated" close, which kills the socket before any QR is
      // emitted. The macOS/Chrome identity connects reliably; history still
      // arrives through messaging-history.set because syncFullHistory is on.
      browser: Browsers.macOS("Chrome"),
      syncFullHistory: true,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      logger: log,
      connectTimeoutMs: 20_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 30_000,
      shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidNewsletter(jid),
      cachedGroupMetadata: async (jid) => {
        // Try to get from DB first
        try {
          const meta = await this.sock?.groupMetadata(jid)
          return meta
        } catch {
          return undefined
        }
      },
      getMessage: async (key) => {
        // Fetch from DB for retry/poll support — coba jid kanonik dulu, fallback raw
        try {
          const raw = key.remoteJid || ""
          const canonical = await this.resolveCanonicalJid(raw, (key as any).remoteJidAlt)
          let rows = await messageStore.getByChat(this.sessionId, canonical, 50, 0)
          let msg = rows.find((r) => r.message_id === key.id)
          if (!msg && canonical !== raw) {
            rows = await messageStore.getByChat(this.sessionId, raw, 50, 0)
            msg = rows.find((r) => r.message_id === key.id)
          }
          if (msg?.raw) return msg.raw as proto.IMessage
        } catch {}
        return proto.Message.create({ conversation: "" })
      },
    })

    this.sock.ev.process(async (events) => {
      // ── Connection ──────────────────────────────────────────
      if (events["connection.update"]) {
        const { connection, lastDisconnect, qr } = events["connection.update"]

        if (qr) {
          this._status = "qr_pending"
          this._qr = qr
          this.emit("qr", { sessionId: this.sessionId, qr })
        }

        if (connection === "close") {
          const code = (lastDisconnect?.error as Boom)?.output?.statusCode
          const shouldReconnect = code !== DisconnectReason.loggedOut

          // restartRequired: WA forcefully disconnects after QR scan, reconnect immediately
          if (code === DisconnectReason.restartRequired) {
            logger.info({ sessionId: this.sessionId }, "Baileys restart required, reconnecting")
            this._reconnectAttempts = 0
            setTimeout(() => this.connect(), 1000)
          } else if (shouldReconnect && this._reconnectAttempts < this._maxReconnects) {
            this._reconnectAttempts++
            const backoff = Math.min(30000, 2000 * Math.pow(2, this._reconnectAttempts - 1))
            logger.info({ sessionId: this.sessionId, attempt: this._reconnectAttempts, backoff: `${backoff}ms` }, "Baileys reconnecting")
            setTimeout(() => this.connect(), backoff)
          } else {
            this._status = "disconnected"
            this.emit("disconnected", this.sessionId, code === DisconnectReason.loggedOut ? "logged_out" : "max_retries")
          }
        }

        if (connection === "open") {
          this._status = "connected"
          this._qr = null
          this._reconnectAttempts = 0
          const me = this.sock?.user
          if (me) {
            this._phone = getPhoneFromJid(me.id)
          }
          this.emit("connected", this.sessionId)
          // Merge chat/contact/pesan LID yang terpecah di DB ke jid PN
          this.reconcileJids().catch(() => {})
        }
      }

      // ── Credentials ─────────────────────────────────────────
      if (events["creds.update"]) {
        await saveCreds()
      }

      // ── History sync (saat pertama kali connect) ────────────
      if (events["messaging-history.set"]) {
        this._historySyncing = true
        const { chats, contacts, messages, isLatest, lidPnMappings } = events["messaging-history.set"]
        logger.info({ sessionId: this.sessionId, chats: chats.length, contacts: contacts.length, messages: messages.length, isLatest }, "History sync start")

        // LID↔PN mappings dari history sync → cache + merge baris lama
        const lidPnJidMap = new Map<string, string>()
        for (const m of lidPnMappings || []) {
          const phone = getPhoneFromJid(m.pn)
          if (!phone) continue
          const lid = normalizeJid(m.lid)
          const canonical = pnJid(phone)
          lidPnJidMap.set(lid, canonical)
          this.lidPnCache.set(lid, canonical)
        }
        for (const [lid, canonical] of lidPnJidMap) {
          await chatStore.mergeJid(this.sessionId, lid, canonical)
          await messageStore.mergeJid(this.sessionId, lid, canonical)
          await contactStore.mergeJid(this.sessionId, lid, canonical)
        }

        // Simpan contacts ke DB (id kanonik = PN ketika nomor diketahui)
        if (contacts.length > 0) {
          const contactList: Contact[] = contacts
          .filter((c: any) => c.id)
          .map((c: any) => {
            const phone = getPhoneFromJid(c.phoneNumber || "") || getPhoneFromJid(c.id) || getPhoneFromJid(lidPnJidMap.get(jidNormalizedUser(c.id)) || "") || ""
            const id = phone && !isJidGroup(c.id) ? pnJid(phone) : jidNormalizedUser(c.id)
            return {
              id,
              name: c.name || undefined,
              pushName: c.notify || undefined,
              phone,
              isGroup: isJidGroup(c.id) || false,
            }
          })
          await contactStore.upsertBulk(this.sessionId, contactList)
          logger.info({ sessionId: this.sessionId, count: contactList.length }, "Contacts synced to DB")
        }

        // Simpan chats ke DB (id kanonik = PN — proto Conversation punya pnJid)
        if (chats.length > 0) {
          const chatList: Chat[] = (chats as any[]).map((c: any) => {
            const phone = getPhoneFromJid(c.pnJid || "") || getPhoneFromJid(lidPnJidMap.get(jidNormalizedUser(c.id)) || "") || ""
            const id = phone && !isJidGroup(c.id) ? pnJid(phone) : c.id
            return {
              id,
              name: c.name || undefined,
              phone,
              isGroup: isJidGroup(c.id) || false,
              unreadCount: c.unreadCount || 0,
              lastMessage: c.lastMessage
                ? { text: c.lastMessage.conversation || "", timestamp: c.lastMessageTimestamp || 0 }
                : undefined,
            }
          })
          await chatStore.upsertBulk(this.sessionId, chatList)
          logger.info({ sessionId: this.sessionId, count: chatList.length }, "Chats synced to DB")
        }

        // Simpan messages ke DB (chat_jid/from_jid di-kanonikasi)
        if (messages.length > 0) {
          const count = await messageStore.upsertBulk(
            this.sessionId,
            messages,
            (jid, alt) => canonicalJid(jid, alt, this.lidPnCache)
          )
          logger.info({ sessionId: this.sessionId, count }, "Messages synced to DB")
        }

        this._historySyncing = false
        logger.info({ sessionId: this.sessionId }, "History sync done")
      }

      // ── Incoming messages ───────────────────────────────────
      if (events["messages.upsert"]) {
        const { messages, type } = events["messages.upsert"]
        if (type === "notify") {
          for (const msg of messages) {
            const rawChatJid = msg.key.remoteJid || ""
            // Jid kanonik: LID di-resolve ke PN supaya incoming & outgoing
            // menulis ke baris chat yang sama
            const chatJid = await this.resolveCanonicalJid(rawChatJid, msg.key.remoteJidAlt)
            const text = msg.message?.conversation
              || (msg.message as any)?.extendedTextMessage?.text
              || (msg.message as any)?.imageMessage?.caption
              || (msg.message as any)?.videoMessage?.caption
              || ""
            const hasMedia = !!(msg.message as any)?.imageMessage
              || !!(msg.message as any)?.videoMessage
              || !!(msg.message as any)?.documentMessage
              || !!(msg.message as any)?.audioMessage
            const mediaType = (msg.message as any)?.imageMessage ? "image"
              : (msg.message as any)?.videoMessage ? "video"
              : (msg.message as any)?.documentMessage ? "document"
              : (msg.message as any)?.audioMessage ? "audio"
              : null

            const isGroup = isJidGroup(chatJid)
            const senderJid = await this.resolveCanonicalJid(
              msg.key.participant || rawChatJid,
              msg.key.participantAlt || msg.key.remoteJidAlt
            )
            const phone = isGroup ? "" : getPhoneFromJid(chatJid) || getPhoneFromJid(senderJid)

            // Simpan message ke DB (selalu, termasuk saat history sync)
            await messageStore.insert(this.sessionId, {
              messageId: msg.key.id || "",
              chatJid,
              fromJid: senderJid,
              fromMe: !!msg.key.fromMe,
              type: mediaType || "text",
              text,
              timestamp: Number(msg.messageTimestamp) || 0,
              raw: msg.message || undefined,
            })

            // Update chat terakhir
            await chatStore.updateLastMessage(this.sessionId, chatJid, text, Number(msg.messageTimestamp) || 0)

            // Simpan nomor HP asli ke chat (private chat) & contact
            if (phone) {
              if (!isGroup) {
                await chatStore.updatePhone(this.sessionId, chatJid, phone)
              }
              await contactStore.upsertBulk(this.sessionId, [{
                id: senderJid,
                phone,
                pushName: msg.pushName || undefined,
                isGroup: false,
              }])
            }

            // Increment unread kalau bukan dari kita
            if (!msg.key.fromMe) {
              await chatStore.incrementUnread(this.sessionId, chatJid)
            }

            // Skip event emission saat history sync (hemat memory & CPU)
            if (this._historySyncing) continue

            // Emit event (hanya untuk pesan baru, bukan history)
            if (!msg.key.fromMe) {
              const decoded = jidDecode(chatJid)
              this.emit("message_received", this.sessionId, {
                id: msg.key.id,
                from: phone || decoded?.user || chatJid,
                phone: phone || undefined,
                jid: isGroup ? senderJid : chatJid,
                text,
                timestamp: Number(msg.messageTimestamp),
                pushName: msg.pushName,
                hasMedia,
                mediaType,
              })
            }
          }
        }
      }

      // ── Message status updates (delivered/read) ─────────────
      if (events["messages.update"]) {
        for (const { key, update } of events["messages.update"]) {
          if (update.status) {
            this.emit("message_status", this.sessionId, String(update.status))
          }
        }
      }

      // ── Group participants ──────────────────────────────────
      if (events["group-participants.update"]) {
        const { id, participants, action } = events["group-participants.update"]
        logger.info({ sessionId: this.sessionId, group: id, action, participants }, "Group update")
      }

      // ── Chats upsert (new chats from real-time) ────────────
      if (events["chats.upsert"]) {
        const chats = events["chats.upsert"]
        if (!this._historySyncing && chats.length > 0) {
          const list: Chat[] = []
          for (const raw of chats as any[]) {
            const canonical = await this.resolveCanonicalJid(raw.id || "", raw.pnJid)
            const phone = getPhoneFromJid(canonical) || getPhoneFromJid(raw.pnJid || "")
            list.push({
              id: canonical,
              name: raw.name || undefined,
              phone,
              isGroup: !!isJidGroup(canonical),
              unreadCount: raw.unreadCount || 0,
              lastMessage: raw.lastMessage
                ? { text: raw.lastMessage.conversation || "", timestamp: raw.lastMessageTimestamp || 0 }
                : undefined,
            })
          }
          await chatStore.upsertBulk(this.sessionId, list)
        }
      }

      // ── Chats update (unread count, last message, etc) ─────
      if (events["chats.update"]) {
        const updates = events["chats.update"]
        if (!this._historySyncing) {
          for (const u of updates as any[]) {
            if (u.unreadCount !== undefined) {
              // Reset unread when user opens chat
              const canonical = await this.resolveCanonicalJid(u.id || "", u.pnJid)
              await chatStore.resetUnread(this.sessionId, canonical)
            }
          }
        }
      }

      // ── Contacts upsert ────────────────────────────────────
      if (events["contacts.upsert"]) {
        const contacts = events["contacts.upsert"]
        if (!this._historySyncing && contacts.length > 0) {
          const list: Contact[] = []
          for (const c of contacts) {
            if (!c.id) continue
            const phone = getPhoneFromJid(c.phoneNumber || "") || getPhoneFromJid(c.id)
            const id = phone && !isJidGroup(c.id) ? pnJid(phone) : await this.resolveCanonicalJid(c.id, c.phoneNumber)
            list.push({
              id,
              name: c.name || undefined,
              pushName: c.notify || undefined,
              phone,
              isGroup: isJidGroup(c.id) || false,
            })
          }
          await contactStore.upsertBulk(this.sessionId, list)
        }
      }

      // ── Contacts update (name, profile pic, etc) ───────────
      if (events["contacts.update"]) {
        const updates = events["contacts.update"]
        if (!this._historySyncing && updates.length > 0) {
          const list: Contact[] = []
          for (const c of updates) {
            if (!c.id) continue
            const phone = getPhoneFromJid(c.phoneNumber || "") || getPhoneFromJid(c.id)
            const id = phone && !isJidGroup(c.id) ? pnJid(phone) : await this.resolveCanonicalJid(c.id, c.phoneNumber)
            list.push({
              id,
              name: c.name || undefined,
              pushName: c.notify || undefined,
              phone,
              isGroup: isJidGroup(c.id) || false,
            })
          }
          await contactStore.upsertBulk(this.sessionId, list)
        }
      }

      // ── LID↔PN mapping (WhatsApp kirim mapping saat ketahui) ──
      if (events["lid-mapping.update"]) {
        const { lid, pn } = events["lid-mapping.update"]
        const phone = getPhoneFromJid(pn)
        if (phone) {
          const lidJid = normalizeJid(lid)
          const canonical = pnJid(phone)
          this.lidPnCache.set(lidJid, canonical)
          // Merge baris yang tersimpan dengan jid LID ke jid PN
          await chatStore.mergeJid(this.sessionId, lidJid, canonical)
          await messageStore.mergeJid(this.sessionId, lidJid, canonical)
          await contactStore.mergeJid(this.sessionId, lidJid, canonical)
          await chatStore.updatePhone(this.sessionId, canonical, phone)
          await contactStore.updatePhoneByJid(this.sessionId, canonical, phone)
        }
      }

      // ── Calls (auto-reject) ────────────────────────────────
      if (events["call"]) {
        const calls = events["call"]
        for (const call of calls) {
          if (call.status === "offer") {
            try {
              await this.sock?.rejectCall(call.id, call.from)
              logger.info({ sessionId: this.sessionId, from: call.from }, "Call auto-rejected")
            } catch {
              // ignore reject errors
            }
          }
        }
      }

      // ── Presence updates ────────────────────────────────────
      if (events["presence.update"]) {
        const { id, presences } = events["presence.update"]
        for (const [jid, data] of Object.entries(presences)) {
          this.emit("presence", this.sessionId, {
            chatJid: id,
            participant: jid,
            presence: (data as any).lastKnownPresence,
            lastSeen: (data as any).lastSeen,
          })
        }
      }
    })

    return
  }

  async disconnect(): Promise<void> {
    this.sock?.end(undefined)
    this.sock = null
    this._status = "disconnected"
  }

  async requestPairingCode(phone: string): Promise<string> {
    if (!this.sock) throw new Error("Engine not connected")
    const clean = phone.replace(/[^0-9]/g, "")
    if (clean.length < 10) throw new Error("Phone must include country code, digits only")
    const code = await this.sock.requestPairingCode(clean)
    logger.info({ sessionId: this.sessionId, phone: clean }, "Pairing code requested")
    return code
  }

  async isRegistered(phone: string): Promise<boolean> {
    if (!this.sock) throw new Error("Engine not connected")
    try {
      const result = await this.sock.onWhatsApp(phone)
      return result?.[0]?.exists ?? false
    } catch {
      return false
    }
  }

  async sendMessage(payload: SendMessagePayload): Promise<{ id: string }> {
    if (!this.sock) throw new Error("Engine not connected")

    const jid = payload.to.includes("@")
      ? payload.to
      : isJidGroup(payload.to)
        ? buildGroupJid(payload.to)
        : buildJid(payload.to)

    // Build options (quoted, mentions, ephemeral)
    const options: Record<string, any> = {}
    if (payload.quoted) {
      options.quoted = {
        key: {
          remoteJid: payload.quoted.chatJid,
          id: payload.quoted.messageId,
        },
        message: {},
      }
    }
    if (payload.mentions && payload.mentions.length > 0) {
      options.mentions = payload.mentions.map((p) => buildJid(p))
    }
    if (payload.ephemeralExpiration) {
      options.ephemeralExpiration = payload.ephemeralExpiration
    }

    let result: any

    // ── Text ──────────────────────────────────────────────────
    if (payload.text) {
      result = await this.sock.sendMessage(jid, { text: payload.text }, options)
    }

    // ── Media ─────────────────────────────────────────────────
    else if (payload.mediaUrl && payload.mediaType) {
      const isHttp = payload.mediaUrl.startsWith("http")
      const mediaSource = isHttp ? { url: payload.mediaUrl } : { url: `file://${payload.mediaUrl}` }

      let content: any
      switch (payload.mediaType) {
        case "image": content = { image: mediaSource, caption: payload.caption }; break
        case "video": content = { video: mediaSource, caption: payload.caption }; break
        case "document":
          content = { document: mediaSource, fileName: payload.caption || "document", caption: payload.caption }
          break
        case "audio":
          content = { audio: mediaSource, mimetype: "audio/ogg; codecs=opus", ptt: true }
          break
      }
      result = await this.sock.sendMessage(jid, content, options)
    }

    // ── Location ──────────────────────────────────────────────
    else if (payload.location) {
      result = await this.sock.sendMessage(jid, {
        location: {
          degreesLatitude: payload.location.lat,
          degreesLongitude: payload.location.lng,
        },
      }, options)
    }

    // ── Reaction ──────────────────────────────────────────────
    else if (payload.reaction) {
      result = await this.sock.sendMessage(jid, {
        react: {
          text: payload.reaction.text,
          key: { remoteJid: jid, id: payload.reaction.messageId },
        },
      })
    }

    // ── Poll ──────────────────────────────────────────────────
    else if (payload.poll) {
      result = await this.sock.sendMessage(jid, {
        poll: {
          name: payload.poll.name,
          values: payload.poll.values,
          selectableCount: payload.poll.selectableCount || 1,
        },
      }, options)
    }

    // ── Contact (vCard) ──────────────────────────────────────
    else if (payload.contacts) {
      const vcards = payload.contacts.contacts.map((c) => {
        const phone = c.phone.replace(/[^0-9]/g, "")
        return [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `FN:${c.name}`,
          c.organization ? `ORG:${c.organization}` : "",
          `TEL;type=CELL;type=VOICE;waid=${phone}:+${phone}`,
          "END:VCARD",
        ].filter(Boolean).join("\n")
      })
      result = await this.sock.sendMessage(jid, {
        contacts: {
          displayName: payload.contacts.displayName,
          contacts: vcards.map((vcard) => ({ vcard })),
        },
      }, options)
    }

    // ── Pin message ───────────────────────────────────────────
    else if (payload.pin) {
      result = await this.sock.sendMessage(jid, {
        pin: {
          type: payload.pin.type,
          time: payload.pin.time || 86400,
        },
      } as any)
    }

    // ── Forward message ───────────────────────────────────────
    else if (payload.forward) {
      const msgs = await (this.sock as any).store?.messages?.get?.(payload.forward.chatJid)
      const msg = msgs?.get?.(payload.forward.messageId)
      if (msg) {
        result = await this.sock.sendMessage(jid, { forward: msg })
      } else {
        throw new Error("Message to forward not found in store")
      }
    }

    // ── Disappearing messages toggle ──────────────────────────
    else if (payload.disappearingMessages) {
      result = await this.sock.sendMessage(jid, {
        disappearingMessagesInChat: payload.disappearingMessages.enabled
          ? (payload.disappearingMessages.duration || 604800)
          : false,
      })
    }

    else {
      throw new Error("No message content provided")
    }

    return { id: (result as any)?.key?.id || "" }
  }

  async deleteMessage(chatJid: string, messageId: string): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.sendMessage(chatJid, {
      delete: { remoteJid: chatJid, id: messageId },
    })
  }

  async editMessage(chatJid: string, messageId: string, text: string): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.sendMessage(chatJid, {
      text,
      edit: { remoteJid: chatJid, id: messageId },
    })
  }

  async markRead(chatJid: string, messageIds: string[]): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    const keys = messageIds.map((id) => ({ remoteJid: chatJid, id }))
    await this.sock.readMessages(keys)
  }

  async sendPresence(chatJid: string, presence: "available" | "unavailable" | "composing" | "recording" | "paused"): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.sendPresenceUpdate(presence, chatJid)
  }

  async presenceSubscribe(chatJid: string): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.presenceSubscribe(chatJid)
  }

  async archiveChat(chatJid: string, archive: boolean): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.chatModify({ archive, lastMessages: [] }, chatJid)
  }

  async muteChat(chatJid: string, durationMs: number | null): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.chatModify({ mute: durationMs }, chatJid)
  }

  async pinChat(chatJid: string, pin: boolean): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.chatModify({ pin }, chatJid)
  }

  async deleteChat(chatJid: string): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.chatModify({ delete: true, lastMessages: [] }, chatJid)
  }

  async starMessage(chatJid: string, messageId: string, fromMe: boolean, star: boolean): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.chatModify({
      star: { messages: [{ id: messageId, fromMe }], star },
    }, chatJid)
  }

  async getProfilePicture(chatJid: string): Promise<string | null> {
    if (!this.sock) throw new Error("Engine not connected")
    try {
      return (await this.sock.profilePictureUrl(chatJid, "image")) || null
    } catch {
      return null
    }
  }

  async updateProfileName(name: string): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.updateProfileName(name)
  }

  async updateProfileStatus(status: string): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.updateProfileStatus(status)
  }

  async groupCreate(subject: string, participants: string[]): Promise<{ gid: string }> {
    if (!this.sock) throw new Error("Engine not connected")
    const jids = participants.map((p) => buildJid(p))
    const group = await this.sock.groupCreate(subject, jids)
    return { gid: group.id }
  }

  async groupMetadata(jid: string): Promise<any> {
    if (!this.sock) throw new Error("Engine not connected")
    return this.sock.groupMetadata(jid)
  }

  async groupParticipantsUpdate(jid: string, participants: string[], action: "add" | "remove" | "promote" | "demote"): Promise<any> {
    if (!this.sock) throw new Error("Engine not connected")
    const jids = participants.map((p) => p.includes("@") ? p : buildJid(p))
    return this.sock.groupParticipantsUpdate(jid, jids, action)
  }

  async groupUpdateSubject(jid: string, subject: string): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.groupUpdateSubject(jid, subject)
  }

  async groupUpdateDescription(jid: string, description: string): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.groupUpdateDescription(jid, description)
  }

  async groupSettingUpdate(jid: string, setting: "announcement" | "not_announcement" | "locked" | "unlocked"): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.groupSettingUpdate(jid, setting)
  }

  async groupLeave(jid: string): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.groupLeave(jid)
  }

  async groupInviteCode(jid: string): Promise<string> {
    if (!this.sock) throw new Error("Engine not connected")
    return (await this.sock.groupInviteCode(jid)) || ""
  }

  async groupRevokeInvite(jid: string): Promise<string> {
    if (!this.sock) throw new Error("Engine not connected")
    return (await this.sock.groupRevokeInvite(jid)) || ""
  }

  async groupAcceptInvite(code: string): Promise<string> {
    if (!this.sock) throw new Error("Engine not connected")
    return (await this.sock.groupAcceptInvite(code)) || ""
  }

  async groupGetInviteInfo(code: string): Promise<any> {
    if (!this.sock) throw new Error("Engine not connected")
    return await this.sock.groupGetInviteInfo(code)
  }

  async groupToggleEphemeral(jid: string, duration: number): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.groupToggleEphemeral(jid, duration)
  }

  async groupMemberAddMode(jid: string, mode: "all_member_add" | "admin_add"): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.groupMemberAddMode(jid, mode)
  }

  async groupFetchAllParticipating(): Promise<Record<string, any>> {
    if (!this.sock) throw new Error("Engine not connected")
    return await this.sock.groupFetchAllParticipating()
  }

  async groupRequestParticipantsList(jid: string): Promise<any[]> {
    if (!this.sock) throw new Error("Engine not connected")
    return await this.sock.groupRequestParticipantsList(jid) || []
  }

  async groupRequestParticipantsUpdate(jid: string, participants: string[], action: "approve" | "reject"): Promise<any> {
    if (!this.sock) throw new Error("Engine not connected")
    return await this.sock.groupRequestParticipantsUpdate(jid, participants, action)
  }

  async updateBlockStatus(jid: string, status: "block" | "unblock"): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.updateBlockStatus(jid, status)
  }

  async fetchBlocklist(): Promise<string[]> {
    if (!this.sock) throw new Error("Engine not connected")
    const list = await this.sock.fetchBlocklist()
    return (list || []).filter((jid): jid is string => !!jid)
  }

  async fetchPrivacySettings(refresh?: boolean): Promise<any> {
    if (!this.sock) throw new Error("Engine not connected")
    return await this.sock.fetchPrivacySettings(refresh)
  }

  async updateLastSeenPrivacy(value: "all" | "contacts" | "contact_blacklist" | "none"): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.updateLastSeenPrivacy(value)
  }

  async updateOnlinePrivacy(value: "all" | "match_last_seen"): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.updateOnlinePrivacy(value)
  }

  async updateProfilePicturePrivacy(value: "all" | "contacts" | "contact_blacklist" | "none"): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.updateProfilePicturePrivacy(value)
  }

  async updateStatusPrivacy(value: "all" | "contacts" | "contact_blacklist" | "none"): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.updateStatusPrivacy(value)
  }

  async updateReadReceiptsPrivacy(value: "all" | "none"): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.updateReadReceiptsPrivacy(value)
  }

  async updateGroupsAddPrivacy(value: "all" | "contacts" | "contact_blacklist"): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.updateGroupsAddPrivacy(value)
  }

  async updateDefaultDisappearingMode(duration: number): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.updateDefaultDisappearingMode(duration)
  }

  async sendBroadcast(jid: string, content: any, options?: any): Promise<{ id: string }> {
    if (!this.sock) throw new Error("Engine not connected")
    const result = await this.sock.sendMessage(jid, content, { ...options, broadcast: true })
    return { id: (result as any)?.key?.id || "" }
  }

  async sendStatus(content: any, statusJidList: string[], options?: any): Promise<{ id: string }> {
    if (!this.sock) throw new Error("Engine not connected")
    const jids = statusJidList.map((p) => p.includes("@") ? p : buildJid(p))
    const result = await this.sock.sendMessage("status@broadcast", content, {
      ...options,
      statusJidList: jids,
      broadcast: true,
    })
    return { id: (result as any)?.key?.id || "" }
  }

  async getBroadcastListInfo(jid: string): Promise<any> {
    if (!this.sock) throw new Error("Engine not connected")
    return await (this.sock as any).getBroadcastListInfo?.(jid) || { name: "", recipients: [] }
  }

  async fetchMessageHistory(count: number, oldestMsgKey: any, oldestMsgTimestamp: number): Promise<void> {
    if (!this.sock) throw new Error("Engine not connected")
    await this.sock.fetchMessageHistory(count, oldestMsgKey, oldestMsgTimestamp)
  }

  async downloadMedia(msg: any, type: "buffer" | "stream" = "buffer"): Promise<any> {
    if (!this.sock) throw new Error("Engine not connected")
    const { downloadMediaMessage } = await import("@whiskeysockets/baileys")
    return downloadMediaMessage(msg, type, {}, {
      logger: log,
      reuploadRequest: this.sock.updateMediaMessage,
    })
  }

  async getContacts(): Promise<Contact[]> {
    if (!this.sock) throw new Error("Engine not connected")
    try {
      const contacts = await (this.sock as any).getContacts?.() || []
      const list: Contact[] = []
      for (const c of contacts as any[]) {
        if (!c.id || isJidGroup(c.id)) continue
        const phone = getPhoneFromJid(c.phoneNumber || "") || getPhoneFromJid(c.id)
        const id = phone ? pnJid(phone) : await this.resolveCanonicalJid(c.id, c.phoneNumber)
        list.push({
          id,
          name: c.name,
          pushName: c.notify,
          phone,
          isGroup: false,
        })
      }

      // Sync ke DB
      await contactStore.upsertBulk(this.sessionId, list)
      return list
    } catch {
      // Fallback ke DB
      return contactStore.getAll(this.sessionId)
    }
  }

  async getChats(): Promise<Chat[]> {
    if (!this.sock) throw new Error("Engine not connected")
    try {
      const store = (this.sock as any).store
      const chats = store?.chat?.all?.() || []
      const list: Chat[] = []
      for (const c of chats as any[]) {
        const canonical = await this.resolveCanonicalJid(c.id, c.pnJid)
        const phone = getPhoneFromJid(canonical) || getPhoneFromJid(c.pnJid || "")
        list.push({
          id: canonical,
          name: c.name,
          phone,
          isGroup: !!isJidGroup(canonical),
          lastMessage: c.lastMessage
            ? { text: c.lastMessage.conversation, timestamp: c.lastMessageTimestamp || 0 }
            : undefined,
          unreadCount: c.unreadCount || 0,
        })
      }

      // Sync ke DB
      await chatStore.upsertBulk(this.sessionId, list)
      return list
    } catch {
      // Fallback ke DB
      return chatStore.getAll(this.sessionId)
    }
  }
}
