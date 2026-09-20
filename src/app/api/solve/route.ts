import { NextRequest } from "next/server";

import { describeModelError, modelName, solve } from "@/lib/model";
import { createLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ochiq API: matematik masalani yuborasiz, tuzilgan JSON javob olasiz.
 *
 *   curl -X POST https://jasur-math.vercel.app/api/solve \
 *     -H "Content-Type: application/json" \
 *     -d '{"savol": "2x + 5 = 13"}'
 *
 * Kalitsiz: soatiga 3 ta so'rov (IP bo'yicha).
 * Kalit bilan (X-API-Key sarlavhasi): soatiga 100 ta.
 */

const ANON_LIMIT = 3;
const KEY_LIMIT = 100;
const WINDOW_SECONDS = 3600;

const MAX_QUESTION_CHARS = 500;

const anonLimiter = createLimiter({
  capacity: ANON_LIMIT,
  windowSeconds: WINDOW_SECONDS,
});
const keyLimiter = createLimiter({
  capacity: KEY_LIMIT,
  windowSeconds: WINDOW_SECONDS,
});

const SYSTEM = `Sen matematik masalalarni yechadigan aniq va ishonchli yordamchisan.

Qoidalar:
- Javobni o'zbek tilida yoz.
- LaTeX ishlatma. Oddiy belgilar: x^2, ildiz(16), 3/4, 12 : 4, 5 * 6, <=, >=, pi.
- Yechim bosqichlari qisqa bo'lsin, har biri bitta amalni tushuntirsin.
- Hisobni oxirida tekshirib ko'r.
- Savol matematikaga oid bo'lmasa: matematikami=false, javob maydoniga sababni yoz.`;

export function GET() {
  return json(
    {
      endpoint: "POST /api/solve",
      tavsif: "Matematik masalani yechadi va JSON qaytaradi",
      so_rov: { savol: "2x + 5 = 13" },
      javob: {
        savol: "string",
        mavzu: "string",
        javob: "string",
        yechim: ["string"],
        model: "string",
      },
      cheklov: {
        kalitsiz: `soatiga ${ANON_LIMIT} ta so'rov (IP bo'yicha)`,
        kalit_bilan: `soatiga ${KEY_LIMIT} ta so'rov (X-API-Key sarlavhasi)`,
      },
      hujjat: "/api",
    },
    200,
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: NextRequest) {
  // --- 1. Kim so'rayapti: kalit bilanmi yoki kalitsizmi ---
  const publicKey = process.env.API_ACCESS_KEY;
  const providedKey = request.headers.get("x-api-key")?.trim();
  const hasValidKey = Boolean(
    publicKey && providedKey && safeEqual(providedKey, publicKey),
  );

  if (providedKey && !hasValidKey) {
    return json({ xato: "API kalit noto'g'ri." }, 401);
  }

  // --- 2. Cheklov ---
  const limiter = hasValidKey ? keyLimiter : anonLimiter;
  const limitKey = hasValidKey
    ? `key:${providedKey}`
    : `ip:${clientIp(request)}`;
  const limit = hasValidKey ? KEY_LIMIT : ANON_LIMIT;

  if (!limiter.take(limitKey)) {
    return json(
      {
        xato: `Soatlik cheklovga yetdingiz (${limit} ta so'rov). Keyinroq urinib ko'ring.`,
        maslahat: hasValidKey
          ? undefined
          : "Ko'proq so'rov uchun X-API-Key sarlavhasi bilan murojaat qiling.",
      },
      429,
      { "X-RateLimit-Limit": String(limit), "X-RateLimit-Remaining": "0" },
    );
  }

  const rateHeaders = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(limiter.remaining(limitKey)),
  };

  // --- 3. So'rovni tekshirish ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      { xato: "So'rov tanasi JSON bo'lishi kerak." },
      400,
      rateHeaders,
    );
  }

  const raw =
    (body as { savol?: unknown; question?: unknown })?.savol ??
    (body as { question?: unknown })?.question;

  if (typeof raw !== "string" || !raw.trim()) {
    return json(
      { xato: '"savol" maydoni bo\'sh bo\'lmagan matn bo\'lishi kerak.' },
      400,
      rateHeaders,
    );
  }

  const savol = raw.trim().slice(0, MAX_QUESTION_CHARS);

  // --- 4. Modeldan tuzilgan javob olish ---
  try {
    const result = await solve({ system: SYSTEM, savol });

    if (!result.matematikami) {
      return json(
        { xato: "Bu savol matematikaga oid emas.", izoh: result.javob },
        400,
        rateHeaders,
      );
    }

    return json(
      {
        savol,
        mavzu: result.mavzu,
        javob: result.javob,
        yechim: result.yechim,
        model: modelName(),
      },
      200,
      rateHeaders,
    );
  } catch (error) {
    const { status, message } = describeModelError(error);
    return json({ xato: message }, status, rateHeaders);
  }
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
    "Access-Control-Max-Age": "86400",
  };
}

function json(
  data: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}
