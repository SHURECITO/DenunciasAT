import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const token = cookies().get('token')?.value;

  const res = await fetch(`${API_URL}/denuncias/${params.id}/generar`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
