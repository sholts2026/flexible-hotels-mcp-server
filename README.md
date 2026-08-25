# flexible-hotels-mcp-server

שרת MCP (Model Context Protocol) שמאפשר ל-AI (קלוד או כל לקוח MCP אחר) לחפש חדרי מלון **לפי מספר לילות בטווח תאריכים גמיש**, במקום לפי תאריך צ'ק-אין/צ'ק-אאוט קבוע.

> 🚀 **השרת כבר פרוס וחי**: `https://flexible-hotels-mcp-server.onrender.com` (Render, תוכנית חינמית). כתובת ה-MCP לחיבור: `https://flexible-hotels-mcp-server.onrender.com/mcp`. שימו לב: בתוכנית החינמית השרת "נרדם" אחרי 15 דקות ללא שימוש, והבקשה הראשונה אחרי שינה עלולה לקחת עד כ-50 שניות. עדיין **חסר מפתח Amadeus אמיתי** — ראו "התקנה" למטה, ואז מגדירים אותו ב-Render תחת Environment.

לדוגמה: "3 לילות בתל אביב, איפשהו בין 1.9 ל-20.9" — השרת סורק את כל תאריכי הצ'ק-אין האפשריים בטווח, מביא מחירים אמיתיים לכל אחד מהם, ומחזיר את העסקאות הזולות ביותר ממוינות לפי מחיר.

**מודל אפיליאט**: זה כלי השוואת מחירים בלבד — הוא **לא** אוסף פרטי תשלום ולא מבצע הזמנה. כל תוצאה כוללת קישור (`bookingUrl`) שמפנה למקור (כרגע Booking.com) שבו המשתמש יכול להשלים את הרכישה בעצמו, אם בכלל ירצה.

מקור הנתונים: [Amadeus for Developers](https://developers.amadeus.com) — ה-API החינמי המוביל בתחום התיירות, עם סביבת בדיקות (`test`) חינמית לגמרי וללא צורך בכרטיס אשראי.

## מה יש כאן

ארבעה כלים (tools) חשופים ל-AI:

| כלי | מה הוא עושה |
|---|---|
| `flexible_hotels_resolve_city_code` | הופך שם עיר חופשי ("תל אביב") לקוד IATA ("TLV") |
| `flexible_hotels_list_hotels_in_city` | מחזיר רשימת מלונות (ומזהים) בעיר נתונה |
| `flexible_hotels_search_flexible_offers` | **הכלי המרכזי** — חיפוש גמיש לפי מספר לילות בטווח תאריכים, עם קישור הזמנה לכל תוצאה |
| `flexible_hotels_get_offer_details` | פרטים מלאים ומחיר עדכני לעסקה ספציפית + קישור הזמנה |

הלוגיקה של "חיפוש גמיש" ממומשת ב-`src/services/hotelSearch.ts`: מכיוון ש-Amadeus (וכל ספק אחר) תומך רק בטווח תאריכים קבוע אחד לכל קריאה, השרת סורק בעצמו כל תאריך צ'ק-אין אפשרי בחלון שהוגדר, קורא ל-API בהתאם, ומאגד את התוצאות. הקישור לכל תוצאה נבנה ב-`src/services/affiliateLink.ts`.

## התקנה

**1. השג מפתח API חינמי** (2 דקות, בלי כרטיס אשראי):

1. הירשם ב-<https://developers.amadeus.com/register>
2. אחרי האימות, צור "New App" ב-[My Self-Service Workspace](https://developers.amadeus.com/my-apps)
3. תקבל `API Key` ו-`API Secret` — אלה יהיו `AMADEUS_CLIENT_ID` ו-`AMADEUS_CLIENT_SECRET`

זו סביבת ה-`test` (sandbox) — חינמית לחלוטין, עם מכסה חודשית נדיבה ומגבלת קצב של כ-10 בקשות בשנייה. היא מכסה מאות אלפי מלונות ברחבי העולם עם נתונים אמיתיים (אם כי לפעמים חלקיים/מטמון). כדי לעבור לנתונים חיים מלאים בעתיד אפשר לבקש גישת production מ-Amadeus (בתשלום) ולשנות `AMADEUS_ENV=production`.

**2. הזנת המפתחות בשרת החי (Render):**

1. פתחו את [דף השירות ב-Render](https://dashboard.render.com/web/srv-da6j5f8u01pc738a4ij0)
2. בתפריט הצד לחצו על "Environment"
3. מלאו את הערכים של `AMADEUS_CLIENT_ID` ו-`AMADEUS_CLIENT_SECRET` עם המפתחות שקיבלתם
4. שמרו — Render יעשה דיפלוי מחדש אוטומטית תוך דקה-שתיים

**התקנה מקומית (אופציונלי, להרצה על המחשב שלכם):**

```bash
npm install
cp .env.example .env
# ערכו את .env והכניסו את המפתחות שקיבלתם
npm run build
```

**בדיקה שהכול עובד** (בלי לפגוע במכסה — לא שולח בקשות אמיתיות ל-Amadeus):

```bash
npm test
```

## הרצה מקומית

```bash
npm start
```

כברירת מחדל השרת רץ דרך `stdio` (מתאים לחיבור מקומי ללקוחות כמו Claude Desktop). כדי להריץ כשרת מרוחק ב-HTTP (לחיבור מ-Claude.ai / Cowork כ"custom connector", או מכל לקוח MCP מרוחק אחר):

```bash
TRANSPORT=http PORT=3000 npm start
```

## חיבור כ"פלאגין" ל-AI

### חיבור מרוחק (מומלץ — השרת כבר פרוס)

השרת רץ כבר בכתובת:

```
https://flexible-hotels-mcp-server.onrender.com/mcp
```

חברו אותה כ-"Custom Connector" / "Remote MCP Server" בהגדרות הלקוח שלכם (Claude.ai, Cowork, ChatGPT וכו'). אין צורך בהתקנה מקומית.

### Claude Desktop (מקומי, חלופה)

הוסיפו לקובץ ההגדרות `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flexible-hotels": {
      "command": "node",
      "args": ["/נתיב-מלא/ל/flexible-hotels-mcp-server/dist/index.js"],
      "env": {
        "AMADEUS_CLIENT_ID": "המפתח-שלכם",
        "AMADEUS_CLIENT_SECRET": "הסוד-שלכם"
      }
    }
  }
}
```

לאחר הפעלה מחדש של Claude Desktop, ה-AI יוכל לקרוא לכלים האלה ישירות בשיחה.

### פריסה עצמאית (Render / Railway)

אם תרצו לפרוס עותק משלכם: קובץ `render.yaml` בשורש הפרויקט מוכן כ-Blueprint עבור Render, וקובץ `railway.toml` מוכן ל-Railway. שני הקבצים בונים מה-`Dockerfile` ומחשפים `/healthz` לבדיקת תקינות.

שימו לב בכל האפשרויות: `AMADEUS_CLIENT_ID`/`AMADEUS_CLIENT_SECRET` צריכים להיות משתני סביבה מוגדרים על השרת המארח, לעולם לא כתובים בקוד.

## דוגמת שימוש (מה ה-AI "רואה")

```
User: תמצא לי 3 לילות בתל אביב, איפשהו בין ה-1 ל-20 בספטמבר, לזוג.

AI calls: flexible_hotels_resolve_city_code(keyword="Tel Aviv")
  -> TLV

AI calls: flexible_hotels_search_flexible_offers(
  city_code="TLV", nights=3,
  earliest_check_in="2026-09-01", latest_check_in="2026-09-20",
  adults=2
)
  -> רשימת עסקאות ממוינת מהזולה ביותר, עם תאריך צ'ק-אין/אאוט מדויק וקישור הזמנה לכל אחת

User: מעולה, תראה לי את הפרטים המלאים של האופציה הכי זולה.

AI calls: flexible_hotels_get_offer_details(offer_id="...")
  -> מחיר מעודכן + קישור לחיצה שמעביר את המשתמש להשלים את ההזמנה באתר המקורי
```

## המודל העסקי: אפיליאט

השרת הזה **לא** מבצע הזמנות ולא נוגע בפרטי תשלום בשום שלב — זה בכוונה, גם מטעמי פשטות/בטיחות וגם כי ככה עובדים חנויות האפליקציות (כמו ChatGPT App Directory) שדורשות "external checkout" ואוסרות איסוף מספרי כרטיס אשראי דרך הכלי עצמו.

איך זה עובד בפועל:

1. השרת מוצא מחירים אמיתיים דרך Amadeus (חינם).
2. לכל תוצאה נבנה קישור לדף חיפוש ב-Booking.com עם שם המלון והתאריכים כבר ממולאים (`src/services/affiliateLink.ts`).
3. אם תרשמו ל-[Booking.com Affiliate Partner Program](https://www.booking.com/affiliate-program) (חינמי, הרשמה עצמאית, ללא אישור מיוחד) ותקבלו `aid`, אפשר להגדיר אותו כמשתנה סביבה `BOOKING_AFFILIATE_ID` באותו Environment ב-Render — אז כל קישור יכלול את מזהה השותף שלכם ותוכלו לקבל עמלה על הזמנות שמתבצעות דרך הקישור.
4. בלי `BOOKING_AFFILIATE_ID` הקישורים עדיין עובדים במלואם — הם פשוט לא מתוגמלים.

זה בדיוק ה-"רק צריך להירשם" שביקשת: הרשמה חד-פעמית לתוכנית השותפים של Booking.com (לא ל-Amadeus, לא ל-Render) היא כל מה שצריך כדי שהקישורים יתחילו להרוויח.

## מגבלות ידועות

- **מכסה חינמית**: סביבת ה-`test` של Amadeus מוגבלת במכסה חודשית ובקצב בקשות (~10/שנייה). חיפוש גמיש על חלון של N ימים שולח עד N בקשות (עם השהיה קלה ביניהן) — חלון גדול = חיפוש איטי יותר. החלון מוגבל ל-30 יום לכל חיפוש כדי להגן על המכסה.
- **שינה בתוכנית החינמית**: Render מרדים את השרת אחרי 15 דקות ללא שימוש; הבקשה הראשונה אחרי שינה איטית (עד כ-50 שניות).
- **מספר מלונות**: כברירת מחדל נבדקים עד 15 מלונות בעיר לכל תאריך (ניתן להעלות עד 30 דרך `max_hotels`, או לצמצם ל-hotelIds ספציפיים).
- **נתוני sandbox**: בסביבת ה-`test` הכיסוי הכי אמין הוא בערים גדולות (למשל NYC, LON, PAR). ערים קטנות יותר עלולות להחזיר מעט מלונות או כלום — זה נפתר במעבר ל-`production`.
- **קישורי ההזמנה** בונים חיפוש ב-Booking.com לפי שם המלון ותאריכים — לא קישור עמוק (deep link) ישיר לחדר הספציפי, כי Amadeus לא מספקת כזה. ברוב המקרים המלון הרלוונטי יופיע ראשון בתוצאות.

## מבנה הפרויקט

```
src/
├── index.ts              # נקודת כניסה, רישום השרת והכלים
├── constants.ts           # קבועים (URLs, מגבלות)
├── types.ts                # טיפוסי TypeScript משותפים
├── services/
│   ├── amadeusClient.ts   # קליינט HTTP מאומת ל-Amadeus (OAuth2, endpoints)
│   ├── hotelSearch.ts     # הלוגיקה של חיפוש גמיש (הליבה)
│   ├── affiliateLink.ts   # בניית קישור ההזמנה (Booking.com + aid אופציונלי)
│   └── format.ts           # פורמט markdown לתשובות
├── schemas/
│   └── schemas.ts          # סכמות Zod לכל כלי
├── tools/                  # רישום כל כלי MCP
└── test/
    └── hotelSearch.test.ts # בדיקות יחידה ללוגיקת החיפוש (ללא צורך במפתח API)
scripts/
└── smoke-test-tools.mjs    # בדיקת עשן שמפעילה את השרת האמיתי ומוודאת שכל הכלים נחשפים כראוי
```

## הרחבות אפשריות להמשך

- טווח לילות גמיש (min/max nights) ולא רק מספר קבוע.
- קאשינג של תוצאות חיפוש לחיסכון במכסה.
- הצטרפות לתוכניות אפיליאט נוספות (Expedia, Agoda וכו') והצגת כמה קישורים למקורות שונים לכל תוצאה, לא רק Booking.com.
- מעבר ל-provider בתשלום (כמו StayAPI / RapidAPI) לכיסוי רחב יותר של ספקים כשהמוצר יגדל.
- רישום בחנות האפליקציות של ChatGPT (Apps SDK) — פרויקט נפרד עם דרישות משלו (חשבון מפתחים ב-OpenAI, מדיניות פרטיות, חשבון דמו לבדיקה); המודל האפיליאט הנוכחי (בלי איסוף כרטיס אשראי) כבר תואם לדרישת ה-"external checkout" שלהם.
