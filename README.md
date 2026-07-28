# ServicePro

אפליקציית CRM עובדת לנותני שירות: לקוחות, יומן עבודות, צוות, חשבוניות, הוצאות ותזכורות ב‑WhatsApp. הממשק בעברית מלאה, מותאם למחשב ולנייד וניתן להתקנה על מסך הבית באייפון.

## מה כבר עובד

- פתיחת חשבון וכניסה עם Supabase Auth.
- פתיחת עסק חדש והפרדה מלאה בין עסקים.
- שלושה תפקידים: בעלים, משרד ושטח.
- הוספה, עריכה ומחיקה של לקוחות.
- שיבוץ ועריכה של עבודות, כולל מניעת שיבוץ כפול לטכנאי.
- מעבר מסודר בין מצבי עבודה: `יצאתי לדרך` → `הגעתי ללקוח` → `סיימתי את העבודה`.
- חשבוניות, מע״מ, תאריכי תשלום וסימון תשלום שהתקבל.
- הוצאות ותמונה חודשית של הכנסות מול הוצאות.
- פתיחת תזכורת מוכנה ב‑WhatsApp ורישום הפעולה.
- חיפוש, מסך מותאם תפקיד, תצוגה רספונסיבית והתקנה כ‑PWA באייפון.
- Row Level Security בכל הטבלאות, כך שהפרדת הנתונים לא תלויה רק בממשק.

## הפעלה ב‑Supabase

1. פותחים פרויקט ב‑Supabase.
2. נכנסים ל‑SQL Editor, פותחים שאילתה חדשה ומדביקים את כל התוכן של [`supabase/schema.sql`](supabase/schema.sql).
3. לוחצים `Run` פעם אחת. בסיום אמורה להופיע הודעת הצלחה בלי שגיאות.
4. נכנסים ל‑Authentication → URL Configuration:
   - ב‑Site URL מכניסים את כתובת האתר ב‑Vercel. בזמן עבודה מקומית: `http://localhost:3000`.
   - ב‑Redirect URLs מוסיפים `http://localhost:3000/auth/callback` ואת `https://YOUR-DOMAIN/auth/callback`.
5. אם אישור מייל מופעל, כדאי לחבר SMTP לפני מכירה. בפרויקטים חדשים במסלול החינמי של Supabase אי אפשר להתאים את תבניות המייל בלי SMTP חיצוני.

האפליקציה משתמשת רק ב‑Publishable Key בצד הלקוח. אין צורך ב‑Service Role Key, ואסור להוסיף אותו למשתני `NEXT_PUBLIC_*`.

## משתני סביבה

מעתיקים את `.env.example` לקובץ `.env.local` ומחליפים את הערכים:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

את כתובת הפרויקט ואת ה‑Publishable Key מוצאים ב‑Supabase דרך כפתור `Connect`.

## הרצה מקומית

נדרש Node.js 22 ומעלה.

```bash
npm install
npm run dev
```

פותחים `http://localhost:3000`, נרשמים, פותחים עסק ומתחילים לעבוד.

## העלאה ל‑GitHub ול‑Vercel

1. מעלים ל‑GitHub את כל התיקייה הזאת, כולל `package-lock.json`. לא מעלים `.env.local`.
2. ב‑Vercel בוחרים `Add New Project` ומחברים את ה‑repository.
3. מוסיפים ב‑Environment Variables את שלושת המשתנים שמופיעים למעלה. ב‑`NEXT_PUBLIC_SITE_URL` שמים את כתובת ה‑Vercel האמיתית.
4. מבצעים Deploy.
5. חוזרים ל‑Supabase ומוסיפים את כתובת ה‑callback האמיתית לרשימת Redirect URLs.

## הוספת אנשי צוות

הבסיס והרשאות התפקיד כבר קיימים. בגרסה הנוכחית בעל העסק הראשון נוצר אוטומטית בתפקיד `owner`. מסך הזמנה במייל עדיין דורש חיבור לשירות מייל; עד שהוא מחובר, אפשר לצרף משתמש קיים דרך SQL:

```sql
insert into public.organization_members (organization_id, user_id, role)
values (123, 'USER_UUID_FROM_AUTH', 'technician');
```

מחליפים את `123` במזהה העסק ואת ה‑UUID במזהה המשתמש מתוך Authentication → Users. התפקידים האפשריים הם `owner`, `office`, `technician`.

## בדיקות לפני פרסום

```bash
npm run typecheck
npm run build
npm audit
```

הגרסאות בקובץ `package.json` נעולות, ו‑`package-lock.json` חייב להישאר ב‑GitHub כדי שהפריסה תשתמש בדיוק בגרסאות שנבדקו.

## אייפון ו‑App Store

כבר עכשיו אפשר להתקין את האפליקציה על האייפון: פותחים אותה ב‑Safari, לוחצים על שיתוף ואז על „הוספה למסך הבית”. היא נפתחת במסך מלא כמו אפליקציה.

כדי למכור אותה ב‑App Store צריך בשלב הבא מעטפת iOS חתומה, חשבון Apple Developer, מדיניות פרטיות, אייקונים בגודלי App Store ובדיקת App Review. בסיס הנתונים והממשק נבנו כך שאפשר להשתמש באותו Supabase גם באפליקציית iOS בלי לשנות את מבנה הנתונים.
