import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import AppearanceForm from "./AppearanceForm";

export const dynamic = "force-dynamic";

export default async function AppearancePage() {
  const profile = await requireProfile();
  const locale = await getLocale();
  const he = locale === "he";
  return (
    <div className="ops-page appearance-page">
      <header className="ops-heading">
        <div>
          <span>{he ? "החשבון שלי" : "My account"}</span>
          <h1>{he ? "מראה ונגישות" : "Appearance & accessibility"}</h1>
          <p>
            {he
              ? "מתאימים את ServicePro בדיוק לאופן שנוח לך לעבוד."
              : "Make ServicePro comfortable for the way you work."}
          </p>
        </div>
        <div className="ops-heading-mark" aria-hidden="true">
          Aa
        </div>
      </header>
      <AppearanceForm
        locale={locale}
        initialValues={{
          theme: profile.ui_theme ?? "system",
          contrast: profile.ui_contrast ?? "normal",
          textScale: profile.ui_text_scale ?? "normal",
          reduceMotion: profile.ui_reduce_motion ?? false,
        }}
      />
    </div>
  );
}
