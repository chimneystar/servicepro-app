"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { createDocument, type ActionResult } from "@/lib/documents";

export type { ActionResult };

export async function createInvoice(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const res = await createDocument("invoice", formData, profile, getLocale());
  if (res.ok) revalidatePath("/invoices");
  return res;
}
