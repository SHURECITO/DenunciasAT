import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function POST() {
  const token = cookies().get('token')?.value;
  const res = await fetch(`${API_URL}/whatsapp/reconectar`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false }, { status: res.status });
  }

  const data = await res.json() as unknown;
  return NextResponse.json(data);
}
