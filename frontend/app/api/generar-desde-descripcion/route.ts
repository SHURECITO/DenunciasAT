import { NextRequest, NextResponse } from 'next/server';

const DASHBOARD_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return NextResponse.json({ message: 'No autenticado' }, { status: 401 });
  
  const body = await req.json();
  const res = await fetch(`${DASHBOARD_API_URL}/denuncias/generar-manual`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body),
    cache: 'no-store'
  });
  
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    return NextResponse.json({ message: errorData.message || 'Error generando documento' }, { status: res.status });
  }
  
  const data = await res.json();
  return NextResponse.json(data);
}
