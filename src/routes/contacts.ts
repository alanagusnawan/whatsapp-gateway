import { Elysia } from "elysia"
import { contactService } from "../services/contact"

export const contactRoutes = new Elysia({ prefix: "/contacts" })
  .get("/:sessionId", async ({ params }) => {
    const contacts = await contactService.getContacts(params.sessionId)
    return { success: true, contacts }
  })
