import {
  jidDecode,
  jidEncode,
  jidNormalizedUser,
  isJidGroup,
  isJidBroadcast,
  isJidNewsletter,
} from "@whiskeysockets/baileys"

export function getPhoneFromJid(jid: string): string {
  const decoded = jidDecode(jid)
  if (!decoded) return ""
  if (decoded.server === "s.whatsapp.net" || decoded.server === "hosted") {
    return decoded.user
  }
  return ""
}

export function normalizeJid(jid: string): string {
  return jid.includes("@") ? jidNormalizedUser(jid) : jid
}

export function isImmutableJid(jid: string): boolean {
  return !!isJidGroup(jid) || !!isJidBroadcast(jid) || !!isJidNewsletter(jid)
}

export function pnJid(phone: string): string {
  return jidEncode(phone, "s.whatsapp.net")
}

// Canonical chat jid = <phone>@s.whatsapp.net ketika nomor HP diketahui.
// WhatsApp 7 mengalamatkan chat via LID (@lid); API/outgoing memakai PN.
// Tanpa canonicalisasi, satu akun terpecah jadi dua baris di wa_chats.
export function canonicalJid(
  rawJid: string | null | undefined,
  altJid?: string | null,
  lidPnMap?: Map<string, string>
): string {
  if (!rawJid) return ""
  if (isImmutableJid(rawJid)) return rawJid

  const direct = getPhoneFromJid(rawJid)
  if (direct) return pnJid(direct)

  const fromAlt = altJid ? getPhoneFromJid(altJid) : ""
  if (fromAlt) return pnJid(fromAlt)

  const mapped = lidPnMap?.get(normalizeJid(rawJid))
  if (mapped) {
    const phone = getPhoneFromJid(mapped)
    if (phone) return pnJid(phone)
  }

  // LID belum ter-resolve — biarkan dulu, di-merge saat mapping datang
  return rawJid
}
