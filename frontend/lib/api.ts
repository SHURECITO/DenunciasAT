import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export type DenunciaEstado = 'RECIBIDA' | 'EN_GESTION' | 'RADICADA' | 'CON_RESPUESTA';

export interface Denuncia {
  id: number;
  radicado: string;
  nombreCiudadano: string;
  cedula: string;
  telefono: string;
  ubicacion: string;
  descripcion: string;
  estado: DenunciaEstado;
  dependenciaAsignada: string | null;
  esEspecial: boolean;
  fechaCreacion: string;
  fechaActualizacion: string;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = cookies().get('token')?.value;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${path}`);
  }

  return res.json() as Promise<T>;
}

export function getDenuncias(estado?: DenunciaEstado): Promise<Denuncia[]> {
  const query = estado ? `?estado=${estado}` : '';
  return apiFetch<Denuncia[]>(`/denuncias${query}`);
}

export function createDenuncia(data: Partial<Denuncia>): Promise<Denuncia> {
  return apiFetch<Denuncia>('/denuncias', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function patchEstadoDenuncia(id: number, estado: DenunciaEstado): Promise<Denuncia> {
  return apiFetch<Denuncia>(`/denuncias/${id}/estado`, {
    method: 'PATCH',
    body: JSON.stringify({ estado }),
  });
}
