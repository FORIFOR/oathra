import { z } from "zod";
import { normalizePhoneNumber } from "./phone-input.js";

/** Experimental local contact contract. Saving a contact never authorizes a call. */
const fields = {
  name: z.string().trim().max(200).default(""),
  company: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(128).default("").transform((value, ctx) => {
    if (!value) return "";
    try { return normalizePhoneNumber(value); }
    catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "電話番号の形式を確認してください。" }); return z.NEVER; }
  }),
  email: z.string().trim().max(320).default("").refine(value => value === "" || z.string().email().safeParse(value).success, "メールアドレスの形式を確認してください。"),
  notes: z.string().trim().max(20000).default(""),
  lastCallNotes: z.string().trim().max(20000).default(""),
};
const hasLabel = (value: { name: string; company: string }) => Boolean(value.name || value.company);
const labelError = { message: "名前または会社名を入力してください。", path: ["name"] };
export const ContactInputSchema = z.object(fields).strict().refine(hasLabel, labelError);
export const ContactUpdateSchema = z.object({ ...fields, revision: z.number().int().positive() }).strict().refine(hasLabel, labelError);
export const ContactRecordSchema = z.object({
  ...fields, id: z.string().uuid(), revision: z.number().int().positive(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict().refine(hasLabel, labelError);
export type ContactInput = z.input<typeof ContactInputSchema>;
export type ContactRecord = z.output<typeof ContactRecordSchema>;
