'use client';

import { useState } from 'react';
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
  generarDocumento: boolean;
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
  generarDocumento: true,
};

export default function NuevaDenunciaForm() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [denunciaGenerando, setDenunciaGenerando] = useState<{ id: number, radicado: string } | null>(null);
  
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setForm((prev) => {
        const next = { ...prev, [name]: checked };
        // Reglas de negocio para esEspecial
        if (name === 'esEspecial') {
          next.generarDocumento = !checked;
        }
        return next;
      });
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/denuncias/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombreCiudadano: form.nombreCiudadano,
          cedula: form.cedula,
          telefono: form.telefono,
          ubicacion: form.ubicacion,
          barrio: form.barrio,
          comuna: form.comuna,
          descripcion: form.descripcion,
          esEspecial: form.esEspecial,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      const data = await res.json();
      
      if (form.generarDocumento) {
        setDenunciaGenerando({ id: data.id, radicado: data.radicado });
        
        // Disparar IA de forma asíncrona
        fetch('/api/generar-desde-descripcion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            denunciaId: data.id,
            descripcion: form.descripcion,
            ubicacion: form.ubicacion,
            barrio: form.barrio,
            esEspecial: form.esEspecial,
            generarDocumento: form.generarDocumento
          })
        }).catch(console.error);
        
      } else {
        alert(`Denuncia creada: ${data.radicado}`);
        router.push('/');
      }
      
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al crear la denuncia');
      setLoading(false);
    }
  }

  if (denunciaGenerando) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="mb-1 text-lg font-semibold text-gray-900">Denuncia {denunciaGenerando.radicado} creada ✅</h2>
          <p className="mb-6 text-sm text-gray-500">
            La IA está analizando la descripción para identificar la dependencia competente y generar el documento oficial...
          </p>
          <div className="flex flex-col gap-2">
            <Link
              href={`/denuncias/${denunciaGenerando.id}`}
              className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 transition-colors text-center"
            >
              Ver denuncia
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-gray-200 bg-white p-8">
        {error && (
          <div className="mb-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
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
              placeholder="Barrio El Poblado, Medellín"
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

          <div className="col-span-2 border-t border-gray-200 pt-5 mt-2 space-y-3">
            {/* Es especial */}
            <div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="esEspecial"
                  name="esEspecial"
                  checked={form.esEspecial}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-900">
                  ¿Es denuncia especial?
                </span>
              </label>
              {form.esEspecial && (
                <p className="mt-1 text-xs text-gray-500 ml-7">
                  Las denuncias especiales normalmente no generan documento oficial. ¿Deseas generar uno igualmente?
                </p>
              )}
            </div>

            {/* Generar documento oficial */}
            <div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="generarDocumento"
                  name="generarDocumento"
                  checked={form.generarDocumento}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-900">
                  {form.esEspecial ? "Generar documento de todas formas" : "Generar documento oficial (recomendado)"}
                </span>
              </label>
            </div>
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
            disabled={loading}
            className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Procesando…' : 'Crear denuncia'}
          </button>
        </div>
      </div>
    </form>
  );
}
