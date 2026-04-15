import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export type DenunciaEstado = 'RECIBIDA' | 'EN_GESTION' | 'RADICADA' | 'CON_RESPUESTA';
export type TipoMensaje = 'TEXTO' | 'AUDIO_TRANSCRITO' | 'IMAGEN' | 'PDF';
export type DireccionMensaje = 'ENTRANTE' | 'SALIENTE';

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
  origenManual: boolean;
  documentoRevisado: boolean;
  fechaCreacion: string;
  fechaActualizacion: string;
}

export interface Mensaje {
  id: number;
  denunciaId: number;
  contenido: string;
  tipo: TipoMensaje;
  direccion: DireccionMensaje;
  timestamp: string;
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

export function getDenuncia(id: number): Promise<Denuncia> {
  return apiFetch<Denuncia>(`/denuncias/${id}`);
}

export function getDenunciasEspeciales(): Promise<Denuncia[]> {
  return apiFetch<Denuncia[]>('/denuncias/especiales');
}

export function getMensajes(denunciaId: number): Promise<Mensaje[]> {
  return apiFetch<Mensaje[]>(`/mensajes/${denunciaId}`);
}

export function createDenuncia(data: Partial<Denuncia>): Promise<Denuncia> {
  return apiFetch<Denuncia>('/denuncias', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function createDenunciaManual(data: Partial<Denuncia>): Promise<Denuncia> {
  return apiFetch<Denuncia>('/denuncias/manual', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function patchDenuncia(id: number, data: Partial<Denuncia>): Promise<Denuncia> {
  return apiFetch<Denuncia>(`/denuncias/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function patchEstadoDenuncia(id: number, estado: DenunciaEstado): Promise<Denuncia> {
  return apiFetch<Denuncia>(`/denuncias/${id}/estado`, {
    method: 'PATCH',
    body: JSON.stringify({ estado }),
  });
}

// ── Usuarios ─────────────────────────────────────────────────────────────────

export interface Usuario {
  id: number;
  nombre: string;
  email: string;
  activo: boolean;
  fechaCreacion: string;
}

export function getUsuarios(): Promise<Usuario[]> {
  return apiFetch<Usuario[]>('/usuarios');
}

export function createUsuario(data: {
  nombre: string;
  email: string;
  password: string;
}): Promise<Usuario> {
  return apiFetch<Usuario>('/usuarios', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateUsuario(
  id: number,
  data: { nombre?: string; email?: string },
): Promise<Usuario> {
  return apiFetch<Usuario>(`/usuarios/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function toggleActivoUsuario(id: number): Promise<Usuario> {
  return apiFetch<Usuario>(`/usuarios/${id}/toggle-activo`, {
    method: 'PATCH',
  });
}
