import { NextRequest, NextResponse } from 'next/server';

const DOCUMENT_SERVICE_URL = process.env.DOCUMENT_SERVICE_URL ?? 'http://document-service:3004';
const INTERNAL_KEY = process.env.DASHBOARD_API_INTERNAL_KEY ?? '';

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return NextResponse.json({ message: 'No autenticado' }, { status: 401 });
  
  const body = await req.json();
  const res = await fetch(`${DOCUMENT_SERVICE_URL}/generar-desde-descripcion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-key': INTERNAL_KEY
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
