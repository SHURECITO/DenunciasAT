import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function GET(req: NextRequest) {
  const token = cookies().get('token')?.value;
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  const estado = searchParams.get('estado') ?? '';

  const params = new URLSearchParams({ q });
  if (estado) params.set('estado', estado);

  const res = await fetch(`${API_URL}/denuncias/buscar?${params}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
