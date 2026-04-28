'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface FormState {
  nombreCiudadano: string;
  cedula: string;
  telefono: string;
  ubicacion: string;
  barrio: string;
  comuna: string;
  descripcion: string;
  esEspecial: boolean;
}

interface EvidenciaItem {
  file: File;
  uploading: boolean;
  url?: string;
  error?: string;
}

const EMPTY: FormState = {
  nombreCiudadano: '',
  cedula: '',
  telefono: '',
  ubicacion: '',
  barrio: '',
  comuna: '',
  descripcion: '',
  esEspecial: false,
};

export default function NuevaDenunciaForm() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [evidencias, setEvidencias] = useState<EvidenciaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [denunciaCreada, setDenunciaCreada] = useState<{ id: number; radicado: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setForm((prev) => ({ ...prev, [name]: checked }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    // Agregar archivos al estado como pendientes de subir
    const newItems: EvidenciaItem[] = files.map((f) => ({ file: f, uploading: true }));
    setEvidencias((prev) => [...prev, ...newItems]);

    // Subir cada archivo al servidor
    const uploadResults = await Promise.all(
      newItems.map(async (item) => {
        const data = new FormData();
        data.append('file', item.file);
        try {
          const res = await fetch('/api/denuncias/evidencias/upload', {
            method: 'POST',
            body: data,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            return { file: item.file, uploading: false, error: body.message ?? 'Error al subir' };
          }
          const { url } = await res.json();
          return { file: item.file, uploading: false, url };
        } catch {
          return { file: item.file, uploading: false, error: 'Error de conexión' };
        }
      }),
    );

    // Actualizar estado con resultados de subida
    setEvidencias((prev) => {
      const updated = [...prev];
      const startIdx = updated.length - newItems.length;
      uploadResults.forEach((result, i) => {
        updated[startIdx + i] = result;
      });
      return updated;
    });

    // Limpiar el input para permitir seleccionar los mismos archivos de nuevo
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeEvidencia(idx: number) {
    setEvidencias((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Bloquear envío si hay imágenes pendientes de subir
    if (evidencias.some((ev) => ev.uploading)) {
      setError('Espera a que terminen de subirse todas las imágenes');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const uploadedUrls = evidencias.filter((ev) => ev.url).map((ev) => ev.url!);
      const res = await fetch('/api/denuncias/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombreCiudadano: form.nombreCiudadano,
          cedula: form.cedula,
          telefono: form.telefono,
          ubicacion: form.ubicacion,
          barrio: form.barrio || undefined,
          comuna: form.comuna || undefined,
          descripcion: form.descripcion,
          esEspecial: form.esEspecial,
          imagenesEvidencia: uploadedUrls.length > 0 ? JSON.stringify(uploadedUrls) : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      const data = await res.json();

      if (form.esEspecial) {
        alert(`Denuncia especial creada: ${data.radicado}`);
        router.push('/');
      } else {
        // El backend ya dispara la generación automáticamente
        setDenunciaCreada({ id: data.id, radicado: data.radicado });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al crear la denuncia');
      setLoading(false);
    }
  }

  if (denunciaCreada) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="mb-1 text-lg font-semibold text-gray-900">Denuncia {denunciaCreada.radicado} creada</h2>
          <p className="mb-6 text-sm text-gray-500">
            La IA está clasificando la descripción y generando el documento oficial…
          </p>
          <Link
            href={`/denuncias/${denunciaCreada.id}`}
            className="block rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 transition-colors text-center"
          >
            Ver denuncia
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-gray-200 bg-white p-8">
        {error && (
          <div className="mb-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        <div className="grid grid-cols-2 gap-5">
          {/* Nombre */}
          <div className="col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Nombre completo <span className="text-red-500">*</span>
            </label>
            <input
              name="nombreCiudadano"
              value={form.nombreCiudadano}
              onChange={handleChange}
              required
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Juan Pérez"
            />
          </div>

          {/* Cédula */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Cédula <span className="text-red-500">*</span>
            </label>
            <input
              name="cedula"
              value={form.cedula}
              onChange={handleChange}
              required
              minLength={6}
              maxLength={12}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="1234567890"
            />
          </div>

          {/* Teléfono */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Teléfono <span className="text-red-500">*</span>
            </label>
            <input
              name="telefono"
              value={form.telefono}
              onChange={handleChange}
              required
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="3001234567"
            />
          </div>

          {/* Ubicación */}
          <div className="col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Ubicación <span className="text-red-500">*</span>
            </label>
            <input
              name="ubicacion"
              value={form.ubicacion}
              onChange={handleChange}
              required
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Calle 44 #52-49"
            />
          </div>

          {/* Barrio */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Barrio</label>
            <input
              name="barrio"
              value={form.barrio}
              onChange={handleChange}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="El Poblado"
            />
          </div>

          {/* Comuna */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Comuna</label>
            <input
              name="comuna"
              value={form.comuna}
              onChange={handleChange}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Comuna 14"
            />
          </div>

          {/* Descripción */}
          <div className="col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Descripción <span className="text-red-500">*</span>
            </label>
            <textarea
              name="descripcion"
              value={form.descripcion}
              onChange={handleChange}
              required
              rows={5}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              placeholder="Descripción detallada del problema reportado…"
            />
          </div>

          {/* Evidencia */}
          <div className="col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Imágenes de evidencia <span className="text-xs font-normal text-gray-500">(JPG/PNG, máx 10 MB c/u)</span>
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors w-full justify-center"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
              Seleccionar imágenes
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            {evidencias.length > 0 && (
              <ul className="mt-3 space-y-2">
                {evidencias.map((ev, idx) => (
                  <li key={idx} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
                    <span className="truncate max-w-xs text-gray-700">{ev.file.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {ev.uploading && (
                        <span className="text-blue-500">Subiendo…</span>
                      )}
                      {!ev.uploading && ev.url && (
                        <span className="text-green-600">✓ Subida</span>
                      )}
                      {!ev.uploading && ev.error && (
                        <span className="text-red-500">{ev.error}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeEvidencia(idx)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        aria-label="Eliminar imagen"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="col-span-2 border-t border-gray-200 pt-5 mt-2">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                id="esEspecial"
                name="esEspecial"
                checked={form.esEspecial}
                onChange={handleChange}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-900">¿Es denuncia especial?</span>
            </label>
            {form.esEspecial && (
              <p className="mt-1 text-xs text-gray-500 ml-7">
                Las denuncias especiales no generan documento oficial.
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Link
            href="/"
            className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={loading || evidencias.some((ev) => ev.uploading)}
            className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Procesando…' : 'Crear denuncia'}
          </button>
        </div>
      </div>
    </form>
  );
}
