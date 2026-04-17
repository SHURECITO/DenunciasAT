import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const token = cookies().get('token')?.value;

  const res = await fetch(`${API_URL}/denuncias/${params.id}/documento`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'Documento no disponible' }, { status: res.status });
  }

  const buffer = await res.arrayBuffer();
  const contentDisposition = res.headers.get('Content-Disposition') ?? 'attachment; filename="documento.docx"';

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': contentDisposition,
    },
  });
}
