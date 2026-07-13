import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // ── Preflight OPTIONS para qualquer rota ──────────────────────────────────
  if (method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  const res = NextResponse.next();

  // ── Cabeçalhos que permitem o iframe do Bitrix24 funcionar ────────────────
  res.headers.delete("X-Frame-Options");
  res.headers.set("Content-Security-Policy", "frame-ancestors *");

  // ── CORS ──────────────────────────────────────────────────────────────────
  res.headers.set("Access-Control-Allow-Origin",  "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "*");

  // ── Bypassa a tela de aviso do ngrok dentro do iframe do Bitrix24 ─────────
  // O ngrok exibe uma página HTML de aviso para requisições de browser sem
  // este cookie, causando "Unexpected token '<'" nos arquivos JS/CSS.
  res.cookies.set("ngrok-skip-browser-warning", "1", {
    path: "/",
    sameSite: "none",
    secure: true,
    maxAge: 60 * 60 * 24, // 24h
  });

  // ── Rastreamento ──────────────────────────────────────────────────────────
  res.headers.set("X-Request-ID", crypto.randomUUID());

  return res;
}

export const config = {
  // Cobre todas as rotas (necessário para o iframe do Bitrix24 funcionar)
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
