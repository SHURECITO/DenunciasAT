import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value;

  if (!token) {
    return NextResponse.json({ message: 'No autenticado' }, { status: 401 });
  }

  const res = await fetch(`${API_URL}/denuncias/dependencias`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    return NextResponse.json(
      { message: 'Error fetching dependencias' },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
