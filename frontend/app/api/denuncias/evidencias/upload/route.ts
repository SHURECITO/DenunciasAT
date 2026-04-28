import { NextRequest, NextResponse } from 'next/server';

const DASHBOARD_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return NextResponse.json({ message: 'No autenticado' }, { status: 401 });

  // Reenviar el FormData al dashboard-api conservando el archivo binario
  const formData = await req.formData();
  const res = await fetch(`${DASHBOARD_API_URL}/denuncias/evidencias/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(
      { message: (err as any).message ?? 'Error al subir imagen' },
      { status: res.status },
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
