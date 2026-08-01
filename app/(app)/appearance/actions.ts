"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { isOneOf } from "@/lib/validation";

export type AppearanceResult = { ok: boolean; error?: string };

export async function saveAppearance(
  _previous: AppearanceResult,
  formData: FormData,
): Promise<AppearanceResult> {
  const profile = await requireProfile();
  const locale = await getLocale();
  const theme = String(formData.get("theme") ?? "system");
  const contrast = String(formData.get("contrast") ?? "normal");
  const textScale = String(formData.get("textScale") ?? "normal");
  const reduceMotion = formData.get("reduceMotion") === "on";

  if (
    !isOneOf(["light", "dark", "system"], theme) ||
    !isOneOf(["normal", "high"], contrast) ||
    !isOneOf(["normal", "large"], textScale)
  ) {
    return {
      ok: false,
      error:
        locale === "he"
          ? "אחת מהאפשרויות אינה תקינה."
          : "One of the appearance options is invalid.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      ui_theme: theme,
      ui_contrast: contrast,
      ui_text_scale: textScale,
      ui_reduce_motion: reduceMotion,
    })
    .eq("id", profile.id);
  if (error)
    return {
      ok: false,
      error:
        locale === "he"
          ? "לא הצלחנו לשמור את המראה. נסו שוב."
          : "We couldn't save your appearance. Please try again.",
    };

  const cookieStore = await cookies();
  const options = { path: "/", maxAge: 31536000, sameSite: "lax" as const };
  cookieStore.set("ui_theme", theme, options);
  cookieStore.set("ui_contrast", contrast, options);
  cookieStore.set("ui_text_scale", textScale, options);
  cookieStore.set("ui_reduce_motion", String(reduceMotion), options);
  revalidatePath("/", "layout");
  return { ok: true };
}
