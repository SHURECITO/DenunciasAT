'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

type WhatsappEstado = 'open' | 'close' | 'connecting';

interface EstadoResponse {
  estado: WhatsappEstado;
  qr?: string;
}

interface QrResponse {
  qr?: string;
}

interface DependenciaIndexada {
  nombre: string;
  metadata?: {
    areasTematicas?: string[];
    entidadCompleta?: string;
    cargoTitular?: string;
  };
  actualizadoEn?: string;
}

export default function ConfiguracionClient() {
  const [estado, setEstado] = useState<WhatsappEstado | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [reconectando, setReconectando] = useState(false);
  const [dependenciasIndexadas, setDependenciasIndexadas] = useState<DependenciaIndexada[]>([]);
  const [loadingDependencias, setLoadingDependencias] = useState(false);
  const [reindexando, setReindexando] = useState(false);
  const [errorRag, setErrorRag] = useState<string | null>(null);
  const qrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEstado = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/estado');
      const data = (await res.json()) as EstadoResponse;
      setEstado(data.estado);
    } catch {
      setEstado('close');
    }
  }, []);

  const fetchQr = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/qr');
      const data = (await res.json()) as QrResponse;
      setQr(data.qr ?? null);
    } catch {
      setQr(null);
    }
  }, []);

  const fetchDependenciasIndexadas = useCallback(async () => {
    setLoadingDependencias(true);
    setErrorRag(null);

    try {
      const res = await fetch('/api/rag/dependencias', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('No se pudo consultar la base de conocimiento');
      }

      const data = (await res.json()) as DependenciaIndexada[];
      setDependenciasIndexadas(Array.isArray(data) ? data : []);
    } catch (err) {
      setErrorRag((err as Error).message);
      setDependenciasIndexadas([]);
    } finally {
      setLoadingDependencias(false);
    }
  }, []);

  // Polling de estado cada 5 segundos
  useEffect(() => {
    fetchEstado();
    const interval = setInterval(fetchEstado, 5000);
    return () => clearInterval(interval);
  }, [fetchEstado]);

  useEffect(() => {
    fetchDependenciasIndexadas();
  }, [fetchDependenciasIndexadas]);

  // Cuando no está conectado: cargar QR y refrescarlo cada 30 segundos
  useEffect(() => {
    if (estado === 'open') {
      setQr(null);
      if (qrTimerRef.current) clearInterval(qrTimerRef.current);
      return;
    }
    if (estado === 'close' || estado === 'connecting') {
      fetchQr();
      qrTimerRef.current = setInterval(fetchQr, 30000);
    }
    return () => {
      if (qrTimerRef.current) clearInterval(qrTimerRef.current);
    };
  }, [estado, fetchQr]);

  const handleReconectar = async () => {
    setReconectando(true);
    try {
      await fetch('/api/whatsapp/reconectar', { method: 'POST' });
      setEstado('connecting');
      setQr(null);
      await fetchQr();
    } finally {
      setReconectando(false);
    }
  };

  const handleReindexar = useCallback(async (silencioso = false) => {
    setReindexando(true);
    setErrorRag(null);

    try {
      const res = await fetch('/api/rag/reindexar', { method: 'POST' });
      if (!res.ok) {
        throw new Error('No se pudo reindexar la base de conocimiento');
      }

      await fetchDependenciasIndexadas();
      if (!silencioso) {
        toast.success('Reindexación completada correctamente');
      }
    } catch (err) {
      const mensaje = (err as Error).message;
      setErrorRag(mensaje);
      if (!silencioso) {
        toast.error(mensaje);
      }
    } finally {
      setReindexando(false);
    }
  }, [fetchDependenciasIndexadas]);

  // Si otra pantalla del dashboard actualiza dependencias.json,
  // puede disparar este evento para reindexar automáticamente.
  useEffect(() => {
    const onDependenciasActualizadas = () => {
      void handleReindexar(true);
    };

    window.addEventListener('dependencias-json-actualizado', onDependenciasActualizadas);
    return () => {
      window.removeEventListener('dependencias-json-actualizado', onDependenciasActualizadas);
    };
  }, [handleReindexar]);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Estado de conexión */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Estado de WhatsApp
        </h2>

        <div className="flex items-center gap-3">
          {estado === null ? (
            <span className="text-sm text-gray-400">Verificando...</span>
          ) : estado === 'open' ? (
            <>
              <span className="h-3 w-3 rounded-full bg-green-500 shadow-sm shadow-green-300" />
              <span className="text-sm font-medium text-green-700">
                WhatsApp conectado
              </span>
            </>
          ) : estado === 'connecting' ? (
            <>
              <span className="h-3 w-3 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-sm font-medium text-yellow-700">
                Conectando...
              </span>
            </>
          ) : (
            <>
              <span className="h-3 w-3 rounded-full bg-red-500" />
              <span className="text-sm font-medium text-red-700">
                WhatsApp desconectado
              </span>
            </>
          )}

          <button
            onClick={handleReconectar}
            disabled={reconectando}
            className="ml-auto rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reconectando ? 'Reconectando...' : 'Reconectar'}
          </button>
        </div>
      </div>

      {/* QR — solo cuando no está conectado */}
      {estado !== 'open' && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-1 text-base font-semibold text-gray-900">
            Escanear código QR
          </h2>
          <p className="mb-4 text-sm text-gray-500">
            Abre WhatsApp en tu teléfono &rarr; Dispositivos vinculados &rarr; Vincular dispositivo
          </p>

          {qr ? (
            <div className="flex flex-col items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                alt="Código QR de WhatsApp"
                className="h-56 w-56 rounded-lg border border-gray-200 p-1"
              />
              <p className="text-xs text-gray-400">
                El código QR se renueva automáticamente cada 30 segundos
              </p>
            </div>
          ) : (
            <div className="flex h-56 w-56 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50">
              <span className="text-sm text-gray-400">Cargando QR...</span>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Base de conocimiento</h2>
            <p className="text-sm text-gray-500">
              Dependencias indexadas: <span className="font-semibold text-gray-800">{dependenciasIndexadas.length}</span>
            </p>
          </div>

          <button
            onClick={() => void handleReindexar(false)}
            disabled={reindexando}
            className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reindexando ? 'Reindexando...' : 'Reindexar'}
          </button>
        </div>

        {errorRag && (
          <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorRag}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-gray-100">
          {loadingDependencias ? (
            <div className="px-4 py-8 text-sm text-gray-400">Cargando dependencias indexadas...</div>
          ) : dependenciasIndexadas.length === 0 ? (
            <div className="px-4 py-8 text-sm text-gray-400">No hay dependencias indexadas.</div>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left">Dependencia</th>
                    <th className="px-4 py-2.5 text-left">Áreas temáticas</th>
                    <th className="px-4 py-2.5 text-left">Actualizado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {dependenciasIndexadas.map((dep) => (
                    <tr key={dep.nombre}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-900">{dep.nombre}</p>
                        <p className="text-xs text-gray-500">{dep.metadata?.entidadCompleta ?? '—'}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">
                        {Array.isArray(dep.metadata?.areasTematicas) && dep.metadata?.areasTematicas.length > 0
                          ? dep.metadata.areasTematicas.slice(0, 4).join(', ')
                          : 'Sin áreas registradas'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">
                        {dep.actualizadoEn
                          ? new Date(dep.actualizadoEn).toLocaleString('es-CO')
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
