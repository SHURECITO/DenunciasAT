import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function GET(req: NextRequest) {
  const token = cookies().get('token')?.value;
  const { searchParams } = new URL(req.url);
  const estado = searchParams.get('estado') ?? '';

  const params = new URLSearchParams();
  if (estado) params.set('estado', estado);

  const query = params.toString() ? `?${params}` : '';

  const res = await fetch(`${API_URL}/denuncias${query}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
