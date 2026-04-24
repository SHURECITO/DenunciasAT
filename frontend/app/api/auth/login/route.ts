import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json({ message: 'No se pudo conectar con el servidor' }, { status: 503 });
  }

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { message: data.message ?? 'Credenciales inválidas' },
      { status: res.status },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set('token', data.access_token, {
    httpOnly: true,
    // HTTP deployment — activar cuando se configure TLS en el proxy
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 8, // 8h
  });
  return response;
}
