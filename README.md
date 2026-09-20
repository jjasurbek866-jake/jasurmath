# JasurMath

Matematikani noldan o'rgatadigan AI-o'qituvchi. Telegram Mini App ko'rinishida
ishlaydi, Google Gemini (`gemini-3.6-flash`) modeliga tayanadi.

## Texnologiyalar

- **Next.js 15** (App Router) + **TypeScript** — frontend va backend bitta loyihada
- **@google/genai** — Gemini bilan oqim (streaming) rejimida ishlaydi
- API kaliti faqat serverda (`/api/chat` route handler) — brauzerga hech qachon chiqmaydi

## Ishga tushirish

```bash
npm install
cp .env.example .env.local     # keyin .env.local ni to'ldiring
npm run dev
```

`.env.local`:

| O'zgaruvchi | Kerakmi | Izoh |
| --- | --- | --- |
| `GEMINI_API_KEY` | Ha | https://aistudio.google.com/apikey dan bepul olinadi |
| `TELEGRAM_BOT_TOKEN` | Productionda ha | @BotFather beradi. Dev rejimida bo'sh qolsa, brauzerdan Telegramsiz sinash mumkin |
| `GEMINI_MODEL` | Yo'q | Default `gemini-3.6-flash` |
| `API_ACCESS_KEY` | Yo'q | Ochiq API kaliti. Bo'sh bo'lsa faqat kalitsiz rejim (soatiga 3 so'rov) |

Brauzerda `http://localhost:3000` ni oching. Telegramsiz ham chat ishlaydi
(dev rejimida tekshiruv o'chirilgan).

## Telegramga ulash

1. [@BotFather](https://t.me/BotFather) da bot yarating, tokenni `.env.local` ga yozing.
2. Loyihani deploy qiling (Vercel: `vercel` — `GEMINI_API_KEY` va
   `TELEGRAM_BOT_TOKEN` ni Environment Variables ga qo'shing).
3. BotFather da: `/newapp` → botni tanlang → Mini App URL sifatida deploy
   qilingan manzilni bering (masalan `https://jasurmath.vercel.app`).
4. Lokalda Telegram ichida sinash uchun tunnel kerak: `npx localtunnel --port 3000`
   yoki `ngrok http 3000`, keyin o'sha HTTPS manzilni BotFather ga bering.

## Ochiq API

Sayt Telegramdan tashqarida ham ishlatiladigan ochiq API beradi. To'liq hujjat
va jonli sinov formasi: **https://jasur-math.vercel.app/api**

| Metod | Yo'l | Tavsif |
| --- | --- | --- |
| GET | `/api/health` | Xizmat holati, cheklovsiz |
| POST | `/api/solve` | Masalani yechadi, JSON qaytaradi |
| GET | `/api/solve` | Endpoint haqida qisqa ma'lumot |
| POST | `/api/chat` | Mini App ichki endpointi (Telegram imzosi kerak) |

```bash
curl -X POST https://jasur-math.vercel.app/api/solve \
  -H "Content-Type: application/json" \
  -d '{"savol": "2x + 5 = 13"}'
```

```json
{
  "savol": "2x + 5 = 13",
  "mavzu": "chiziqli tenglama",
  "javob": "x = 4",
  "yechim": ["Ikkala tomondan 5 ni ayiramiz: 2x = 8", "..."],
  "model": "gemini-3.6-flash"
}
```

Javob tuzilishi Gemini'ning **structured output** imkoniyati bilan
kafolatlanadi (`responseSchema`) - matn tahlil qilinmaydi, sxema modelga
majburlanadi.

**Cheklovlar:** kalitsiz - IP bo'yicha soatiga 3 so'rov; `X-API-Key`
sarlavhasi bilan - soatiga 100. Har javobda `X-RateLimit-Remaining` qaytadi.

## Fayl tuzilmasi

```
src/
├── app/
│   ├── api/page.tsx         Ochiq API hujjati (/api)
│   ├── api/chat/route.ts    Mini App endpointi, oqim (NDJSON) qaytaradi
│   ├── api/solve/route.ts   Ochiq API: masala -> tuzilgan JSON
│   ├── api/health/route.ts  Xizmat holati
│   ├── layout.tsx           Telegram WebApp SDK skripti shu yerda ulanadi
│   ├── page.tsx
│   └── globals.css          Telegram mavzu ranglariga moslashgan uslublar
├── components/
│   ├── Chat.tsx             Butun chat mantiqi (holat, oqim, tugmalar)
│   ├── MessageBubble.tsx    Markdown render
│   └── ApiTester.tsx        /api sahifasidagi jonli sinov formasi
└── lib/
    ├── model.ts             Gemini bilan ishlash (chat oqimi + tuzilgan javob)
    ├── prompt.ts            System prompt (o'qituvchi + Mini App qoidalari)
    ├── telegram.ts          initData ni HMAC bilan tekshirish (server)
    ├── telegram-client.ts   window.Telegram.WebApp bilan ishlash (klient)
    ├── chat-client.ts       Oqimni o'qish (fetch + ReadableStream)
    ├── options.ts           [[VARIANTLAR: ...]] ni tugmalarga ajratish
    ├── rate-limit.ts        Token-bucket cheklov (createLimiter)
    └── types.ts             Umumiy tiplar va limitlar
```

## Qanday ishlaydi

**Tugmalar.** System prompt modelga har javob oxirida shunday qator qo'shishni
buyuradi:

```
[[VARIANTLAR: Noldan o'rganish | Imtihonga tayyorgarlik | SAT]]
```

`src/lib/options.ts` bu qatorni matndan ajratib oladi va tugmalarga aylantiradi.
Foydalanuvchi bu qatorni matn sifatida ko'rmaydi. Oqim paytida yarim yozilgan
`[[VARI...` ham yashiriladi.

**Birinchi xabar.** Ilova ochilganda modelga ko'rinmas turtki
(`KICKOFF_MESSAGE`) yuboriladi — shuning uchun JasurMath birinchi bo'lib
salomlashadi va darrov maqsad haqida so'raydi.

**Suhbat xotirasi.** Tarix brauzerning `localStorage` ida saqlanadi
(`jasurmath.chat.v1`) va har so'rovda serverga yuboriladi. Server bazasi yo'q —
shuning uchun deploy qilish oson, lekin suhbat qurilmaga bog'liq. Foydalanuvchi
turli qurilmalarda bir xil tarixni ko'rishi kerak bo'lsa, Telegram user id bo'yicha
baza (Postgres/Redis) qo'shish kerak. Serverga oxirgi 40 ta xabar yuboriladi.

**Xavfsizlik.** `/api/chat` har so'rovda Telegram `initData` ni bot tokeni bilan
HMAC-SHA256 orqali tekshiradi (`src/lib/telegram.ts`), 24 soatdan eski
ma'lumotni rad etadi va foydalanuvchi id bo'yicha so'rovlarni cheklaydi.
`TELEGRAM_BOT_TOKEN` productionda majburiy — u bo'lmasa route 500 qaytaradi.

## Model sozlamalari (`src/lib/model.ts`)

Modelga so'rov yuboradigan butun mantiq shu bitta faylda. Provayder almashsa,
faqat shu fayl o'zgaradi - route'lar tegilmaydi.

| Sozlama | Qiymat | Nega |
| --- | --- | --- |
| `model` | `gemini-3.6-flash` | Bepul tarifda ishlaydi, matematika uchun yetarli. `GEMINI_MODEL` bilan almashtiriladi |
| `maxOutputTokens` | 8192 (chat), 4096 (solve) | Uzun reja yoki bosqichli yechim kesilib qolmasin |
| `responseSchema` | `/api/solve` da | Javob doim bir xil JSON shaklida keladi |

## Deploy

```bash
npx vercel --prod          # yangi deploy yaratadi
```

**Diqqat - deploy "Ready" bo'lishi domen yangilandi degani emas.** Agar
loyihada biror vaqt *Instant Rollback* ishlatilgan bo'lsa, `jasur-math.vercel.app`
eski deploy'ga qotib qoladi va keyingi deploylar unga ta'sir qilmaydi. Shunda:

```bash
npx vercel ls jasur-math                    # eng yangi deployment manzilini oling
npx vercel promote <deployment-url> --yes   # domenni o'shanga bog'lang
```

Qaysi kod internetda ekanini bilish uchun:

```bash
curl https://jasur-math.vercel.app/api/health
# {"commit":"398d4e5","model":"gemini-3.6-flash",...}
```

`commit` maydoni lokal `git log -1` bilan mos kelmasa - deploy chiqmagan yoki
domen eski deploy'da qolgan.

## Tekshiruv

```bash
npm run typecheck   # tsc --noEmit
npm run build       # production build
```

## Keyingi qadamlar uchun g'oyalar

- Reja va o'zlashtirishni bazada saqlash (hozir faqat suhbat tarixi bor)
- Rasm yuborish (foydalanuvchi masala rasmini tashlasin) — Gemini buni qo'llab-quvvatlaydi
- Test rejimi: N ta savol, avtomatik ball va xatolar tahlili
- Redis (Upstash) bilan jiddiy rate limiting
