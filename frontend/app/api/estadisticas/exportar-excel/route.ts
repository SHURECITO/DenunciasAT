import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function GET(req: NextRequest) {
  const token = cookies().get('token')?.value;
  const search = req.nextUrl.search;
  const res = await fetch(`${API_URL}/estadisticas/exportar-excel${search}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'Error al exportar' }, { status: res.status });
  }

  const buffer = await res.arrayBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': res.headers.get('Content-Disposition') ?? 'attachment; filename=denunciantes.xlsx',
    },
  });
}
