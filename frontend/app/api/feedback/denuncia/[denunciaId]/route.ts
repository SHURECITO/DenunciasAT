import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function GET(
  _req: NextRequest,
  { params }: { params: { denunciaId: string } },
) {
  const token = cookies().get('token')?.value;

  const res = await fetch(`${API_URL}/feedback/denuncia/${params.denunciaId}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
