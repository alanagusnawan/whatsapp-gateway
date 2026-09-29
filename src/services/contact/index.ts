import { sessionManager } from "../session"
import { contactStore } from "../../storage/contact-store"
import { chatStore } from "../../storage/chat-store"
import { cache } from "../../utils/cache"
import type { Contact, Chat } from "../../types"

export const contactService = {
  async getContacts(sessionId: string): Promise<Contact[]> {
    const cacheKey = `wa:${sessionId}:contacts`
    const cached = await cache.get<Contact[]>(cacheKey)
    if (cached) return cached

    try {
      const contacts = await sessionManager.getContacts(sessionId)
      await cache.set(cacheKey, contacts, 600)
      return contacts
    } catch {
      const contacts = await contactStore.getAll(sessionId)
      return contacts
    }
  },

  async getChats(sessionId: string): Promise<Chat[]> {
    const cacheKey = `wa:${sessionId}:chats`
    const cached = await cache.get<Chat[]>(cacheKey)
    if (cached) return cached

    try {
      const chats = await sessionManager.getChats(sessionId)
      await cache.set(cacheKey, chats, 300)
      return chats
    } catch {
      const chats = await chatStore.getAll(sessionId)
      return chats
    }
  },

  async getGroups(sessionId: string): Promise<Contact[]> {
    return contactStore.getGroups(sessionId)
  },
}
