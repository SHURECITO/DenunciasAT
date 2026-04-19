'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DenunciaEstadoBadge from '@/components/DenunciaEstadoBadge';
import ChatPanel from '@/components/ChatPanel';
import ModalEditarDenuncia from '@/components/ModalEditarDenuncia';
import { type Denuncia, type DenunciaEstado, type Mensaje, type RespuestaDependencia } from '@/lib/api';

const ESTADOS_SIGUIENTE: Record<DenunciaEstado, DenunciaEstado | null> = {
  RECIBIDA: 'EN_GESTION',
  EN_GESTION: 'RADICADA',
  RADICADA: 'CON_RESPUESTA',
  CON_RESPUESTA: null,
};

const ESTADOS_LABEL: Record<DenunciaEstado, string> = {
  RECIBIDA: 'Iniciar gestión',
  EN_GESTION: 'Marcar como radicada',
  RADICADA: 'Registrar respuesta',
  CON_RESPUESTA: '',
};

function formatTelefono(tel: string): string {
  // Colombia: 573XXXXXXXXX → +57 3XX XXX XXXX
  if (/^57\d{10}$/.test(tel)) {
    return `+57 ${tel.slice(2, 5)} ${tel.slice(5, 8)} ${tel.slice(8)}`;
  }
  return tel;
}

interface Props {
  denuncia: Denuncia;
  mensajes: Mensaje[];
}

export default function DenunciaDetalle({ denuncia: initial, mensajes }: Props) {
  const router = useRouter();
  const [denuncia, setDenuncia] = useState(initial);
  const [chatOpen, setChatOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModalEditar, setShowModalEditar] = useState(false);
  const [reintentandoDoc, setReintentandoDoc] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tieneDocumento = denuncia.documentoGeneradoOk === true;
  const generando = denuncia.documentoPendiente === true && !tieneDocumento;
  const errorDocumento =
    !denuncia.documentoPendiente &&
    !tieneDocumento &&
    !denuncia.esEspecial &&
    denuncia.estado !== 'RECIBIDA';

  // Polling: mientras documentoPendiente && !documentoGeneradoOk, refresca cada 8 s
  useEffect(() => {
    if (generando) {
      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/denuncias/${denuncia.id}`);
          if (!res.ok) return;
          const updated: Denuncia = await res.json();
          setDenuncia(updated);
          if (!updated.documentoPendiente || updated.documentoGeneradoOk) {
            clearInterval(pollingRef.current!);
          }
        } catch {
          // ignorar errores de red en el polling
        }
      }, 8000);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [denuncia.id, generando]);

  async function reintentarDocumento() {
    setReintentandoDoc(true);
    try {
      const res = await fetch(`/api/denuncias/${denuncia.id}/generar-documento`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated: Denuncia = await res.json();
      setDenuncia(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al reintentar generación');
    } finally {
      setReintentandoDoc(false);
    }
  }

  const siguienteEstado = ESTADOS_SIGUIENTE[denuncia.estado];

  async function avanzarEstado() {
    if (!siguienteEstado) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/denuncias/${denuncia.id}/estado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: siguienteEstado }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      const updated: Denuncia = await res.json();
      setDenuncia(updated);
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cambiar estado');
    } finally {
      setLoading(false);
    }
  }

  // Construye el arreglo de seguimiento a partir de la dependencia asignada (separada por coma).
  // Si la denuncia ya tiene respuestasPorDependencia en la BD, se usa como fuente de verdad.
  function seguimientoInicial(): RespuestaDependencia[] {
    if (denuncia.respuestasPorDependencia && denuncia.respuestasPorDependencia.length > 0) {
      return denuncia.respuestasPorDependencia;
    }
    const dependencias = (denuncia.dependenciaAsignada ?? '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return dependencias.map((dep) => ({
      dependencia:    dep,
      respondio:      false,
      fechaRespuesta: null,
      observacion:    null,
    }));
  }

  const dependenciasList = (denuncia.dependenciaAsignada ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const esMultiDependencia = dependenciasList.length > 1;
  const seguimiento = seguimientoInicial();

  async function marcarRespondida(dep: string) {
    setLoading(true);
    setError('');
    try {
      const ahora = new Date().toISOString();
      const nuevo = seguimientoInicial().map((r) =>
        r.dependencia === dep
          ? { ...r, respondio: true, fechaRespuesta: ahora }
          : r,
      );
      const res = await fetch(`/api/denuncias/${denuncia.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ respuestasPorDependencia: nuevo }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated: Denuncia = await res.json();
      setDenuncia(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al marcar respuesta');
    } finally {
      setLoading(false);
    }
  }

  async function toggleDocumento() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/denuncias/${denuncia.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentoRevisado: !denuncia.documentoRevisado }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated: Denuncia = await res.json();
      setDenuncia(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al actualizar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <ChatPanel mensajes={mensajes} open={chatOpen} onClose={() => setChatOpen(false)} />

      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-8 py-5">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">
            ← Volver
          </Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-xl font-semibold text-gray-900 font-mono">{denuncia.radicado}</h1>
          <DenunciaEstadoBadge estado={denuncia.estado} />
          {denuncia.esEspecial && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              Especial
            </span>
          )}
          {denuncia.origenManual && (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
              Manual
            </span>
          )}
          {denuncia.incompleta && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
              Incompleta
            </span>
          )}
          {generando && (
            <span className="animate-pulse rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
              ⏳ Generando documento...
            </span>
          )}
          {tieneDocumento && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              ✅ Documento listo
            </span>
          )}
          {errorDocumento && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              ⚠️ Error generando documento
            </span>
          )}
        </div>
      </header>

      <div className="flex flex-1 gap-6 px-8 py-6">
        {/* Columna izquierda — 60% */}
        <div className="flex w-3/5 flex-col gap-5">
          {/* Datos del ciudadano */}
          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Datos del ciudadano
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div>
                <dt className="text-xs text-gray-400">Nombre</dt>
                <dd className="mt-0.5 font-medium text-gray-900">{denuncia.nombreCiudadano}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Cédula</dt>
                <dd className="mt-0.5 text-gray-700">{denuncia.cedula}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Teléfono</dt>
                <dd className="mt-0.5 text-gray-700">{formatTelefono(denuncia.telefono)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Ubicación</dt>
                <dd className="mt-0.5 text-gray-700">{denuncia.ubicacion}</dd>
              </div>
              {(denuncia.barrio || denuncia.comuna) && (
                <div>
                  <dt className="text-xs text-gray-400">Barrio / Comuna</dt>
                  <dd className="mt-0.5 text-gray-700">
                    {[denuncia.barrio, denuncia.comuna].filter(Boolean).join(' — ')}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* Descripción */}
          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Descripción de la denuncia
            </h2>
            {denuncia.descripcionResumen && (
              <p className="mb-3 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
                {denuncia.descripcionResumen}
              </p>
            )}
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
              {denuncia.descripcion}
            </p>
          </section>

          {/* Seguimiento por dependencia (solo cuando hay múltiples) */}
          {esMultiDependencia && (
            <section className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Seguimiento por dependencia
              </h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="pb-2 text-left">Dependencia</th>
                    <th className="pb-2 text-center">Respondió</th>
                    <th className="pb-2 text-left">Fecha respuesta</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {seguimiento.map((r) => (
                    <tr key={r.dependencia}>
                      <td className="py-2 pr-2 font-medium">{r.dependencia}</td>
                      <td className="py-2 text-center">
                        {r.respondio ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            ✅ Sí
                          </span>
                        ) : (
                          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                            ⏳ No
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-xs text-gray-600">
                        {r.fechaRespuesta
                          ? new Date(r.fechaRespuesta).toLocaleDateString('es-CO')
                          : '—'}
                      </td>
                      <td className="py-2 text-right">
                        {!r.respondio && (
                          <button
                            onClick={() => marcarRespondida(r.dependencia)}
                            disabled={loading}
                            className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Marcar respondida
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Fechas */}
          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Seguimiento
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div>
                <dt className="text-xs text-gray-400">Fecha de creación</dt>
                <dd className="mt-0.5 text-gray-700">
                  {new Date(denuncia.fechaCreacion).toLocaleString('es-CO')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Última actualización</dt>
                <dd className="mt-0.5 text-gray-700">
                  {new Date(denuncia.fechaActualizacion).toLocaleString('es-CO')}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        {/* Columna derecha — 40% */}
        <div className="flex w-2/5 flex-col gap-5">
          {/* Acciones */}
          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Acciones
            </h2>

            {error && (
              <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </div>
            )}

            {/* Dependencia */}
            <div className="mb-4">
              <div className="flex items-center justify-between">
                <dt className="text-xs text-gray-400">Dependencia(s) asignada(s)</dt>
                {(denuncia.estado === 'RECIBIDA' || denuncia.estado === 'EN_GESTION') && (
                  <button 
                    onClick={() => setShowModalEditar(true)}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
                  >
                    ✏️ Editar denuncia
                  </button>
                )}
              </div>
              <dd className="mt-1.5 flex flex-wrap gap-2 text-sm text-gray-700">
                {denuncia.dependenciaAsignada ? (
                  denuncia.dependenciaAsignada.split(/[,;]/).filter(Boolean).map(d => d.trim()).map((dep, idx) => (
                    <span 
                      key={idx} 
                      className="inline-flex items-center bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-md text-xs font-medium text-gray-800"
                    >
                      {dep}
                    </span>
                  ))
                ) : (
                  <span className="italic text-gray-400">Sin asignar</span>
                )}
              </dd>
            </div>

            {/* Documento revisado */}
            <div className="mb-5 flex items-center gap-3">
              <button
                onClick={toggleDocumento}
                disabled={loading}
                className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-colors ${
                  denuncia.documentoRevisado
                    ? 'border-green-500 bg-green-500 text-white'
                    : 'border-gray-300 bg-white'
                }`}
              >
                {denuncia.documentoRevisado && (
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                )}
              </button>
              <span className="text-sm text-gray-700">Documento revisado</span>
            </div>

            {/* Documento — generando */}
            {generando && (
              <div className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2.5 text-sm font-medium text-yellow-700">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Generando documento...
              </div>
            )}

            {/* Documento — listo para descargar */}
            {tieneDocumento && (
              <a
                href={`/api/denuncias/${denuncia.id}/documento`}
                download
                className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              >
                📄 Descargar documento .docx
              </a>
            )}

            {/* Documento — error / reintentar */}
            {errorDocumento && (
              <div className="mb-3">
                <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                  No se pudo generar el documento.
                </div>
                <button
                  onClick={reintentarDocumento}
                  disabled={reintentandoDoc}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
                >
                  {reintentandoDoc ? 'Reintentando...' : '🔄 Reintentar generación'}
                </button>
              </div>
            )}

            {/* Avanzar estado */}
            {siguienteEstado && (
              <button
                onClick={avanzarEstado}
                disabled={loading}
                className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Guardando…' : ESTADOS_LABEL[denuncia.estado]}
              </button>
            )}

            {!siguienteEstado && (
              <p className="text-center text-xs text-gray-400">
                Esta denuncia ya ha sido completamente gestionada.
              </p>
            )}

            <div className="mt-6 pt-4 border-t border-red-100">
              <button
                onClick={async () => {
                  if (!confirm('¿Estás seguro de eliminar esta denuncia? Esta acción no se puede deshacer.')) return;
                  setLoading(true);
                  try {
                    const res = await fetch(`/api/denuncias/${denuncia.id}`, { method: 'DELETE' });
                    if (res.ok) router.push('/');
                    else throw new Error('Error al eliminar');
                  } catch (e: unknown) {
                    setError(e instanceof Error ? e.message : 'Error de red');
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="w-full rounded-lg bg-red-50 text-red-600 px-4 py-2 text-sm font-medium hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                🗑️ Eliminar denuncia
              </button>
            </div>
          </section>

          {/* Chat */}
          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Conversación
            </h2>
            <p className="mb-4 text-sm text-gray-500">
              {mensajes.length === 0
                ? 'Sin mensajes de WhatsApp registrados.'
                : `${mensajes.length} mensaje${mensajes.length !== 1 ? 's' : ''} en WhatsApp`}
            </p>
            <button
              onClick={() => setChatOpen(true)}
              className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Ver conversación
            </button>
          </section>

          {/* Historial de Trazabilidad */}
          {denuncia.historialCambios && denuncia.historialCambios.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Historial de la denuncia
              </h2>
              <div className="space-y-3">
                {denuncia.historialCambios.slice().reverse().map((hist, idx) => (
                  <div key={idx} className="border-l-2 border-blue-200 pl-3">
                    <p className="text-xs text-gray-500">
                      {new Date(hist.timestamp).toLocaleString('es-CO')}
                      {hist.usuario && hist.usuario !== 'sistema' && (
                        <span className="ml-1 font-medium text-gray-700">— {hist.usuario}</span>
                      )}
                    </p>
                    <div className="mt-0.5 text-xs text-gray-700">
                      {Object.keys(hist.cambios).map(key => {
                        const c = hist.cambios[key];
                        if (key === 'creacion') {
                          return (
                            <span key={key} className="text-blue-700 font-medium">
                              {c.nuevo ?? ''}
                            </span>
                          );
                        }
                        if (key === 'estado') {
                          return (
                            <span key={key}>
                              Estado: <span className="line-through text-red-500 mr-1">{c.anterior ?? '—'}</span>
                              <span className="text-green-600">→ {c.nuevo ?? '—'}</span>
                            </span>
                          );
                        }
                        return (
                          <div key={key} className="mb-0.5">
                            <span className="font-semibold capitalize">{key}: </span>
                            {c.anterior != null && (
                              <span className="line-through text-red-500 opacity-60 mr-1">{c.anterior || '(vacío)'}</span>
                            )}
                            <span className="text-green-600">→ {c.nuevo ?? '(vacío)'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
      
      {showModalEditar && (
        <ModalEditarDenuncia
          denuncia={denuncia}
          onClose={() => setShowModalEditar(false)}
          onSaved={(updated) => {
            setDenuncia(updated);
            setShowModalEditar(false);
          }}
        />
      )}
    </>
  );
}
