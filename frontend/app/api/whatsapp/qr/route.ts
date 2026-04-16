import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function GET() {
  const token = cookies().get('token')?.value;
  const res = await fetch(`${API_URL}/whatsapp/qr`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: 'no-store',
  });

  if (!res.ok) {
    return NextResponse.json({ qr: null }, { status: 200 });
  }

  const data = await res.json() as unknown;
  return NextResponse.json(data);
}
