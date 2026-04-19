'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import DenunciaEstadoBadge from '@/components/DenunciaEstadoBadge';
import { useWebSocket } from '@/hooks/useWebSocket';
import { type Denuncia, type DenunciaEstado } from '@/lib/api';

interface DenunciasLiveTableProps {
  initialDenuncias: Denuncia[];
  fetchError: string;
  filtroEstado?: DenunciaEstado;
}

interface NuevaDenunciaEvent {
  id: number;
  radicado?: string;
  nombreCiudadano?: string;
  dependenciaAsignada?: string | null;
  estado?: DenunciaEstado;
  esEspecial?: boolean;
  fechaCreacion?: string;
}

interface CambioEstadoEvent {
  denunciaId: number;
  estadoAnterior: string;
  estadoNuevo: DenunciaEstado;
}

interface DocumentoListoEvent {
  denunciaId: number;
  radicado: string;
}

function buildDenunciaFromEvent(data: NuevaDenunciaEvent): Denuncia {
  const now = new Date().toISOString();

  return {
    id: data.id,
    radicado: data.radicado ?? `DAT-${String(data.id).padStart(6, '0')}`,
    nombreCiudadano: data.nombreCiudadano ?? 'Sin nombre',
    cedula: '',
    telefono: '',
    ubicacion: '',
    descripcion: '',
    estado: data.estado ?? 'RECIBIDA',
    dependenciaAsignada: data.dependenciaAsignada ?? null,
    esEspecial: data.esEspecial ?? false,
    origenManual: false,
    documentoRevisado: false,
    documentoGeneradoOk: false,
    documentoUrl: null,
    documentoPendiente: false,
    incompleta: false,
    barrio: null,
    comuna: null,
    descripcionResumen: null,
    esAnonimo: false,
    respuestasPorDependencia: [],
    fechaCreacion: data.fechaCreacion ?? now,
    fechaActualizacion: data.fechaCreacion ?? now,
    historialCambios: [],
  };
}

export default function DenunciasLiveTable({
  initialDenuncias,
  fetchError,
  filtroEstado,
}: DenunciasLiveTableProps) {
  const [denuncias, setDenuncias] = useState<Denuncia[]>(initialDenuncias);
  const [ultimaActividad, setUltimaActividad] = useState<string | null>(null);
  const [nuevasDesdeUltimaVisita, setNuevasDesdeUltimaVisita] = useState(0);
  const [actividadReciente, setActividadReciente] = useState(false);
  const actividadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDenuncias(initialDenuncias);
    setNuevasDesdeUltimaVisita(0);
  }, [initialDenuncias]);

  useEffect(() => {
    return () => {
      if (actividadTimerRef.current) {
        clearTimeout(actividadTimerRef.current);
      }
    };
  }, []);

  const marcarActividad = (mensaje: string) => {
    setUltimaActividad(mensaje);
    setActividadReciente(true);

    if (actividadTimerRef.current) {
      clearTimeout(actividadTimerRef.current);
    }

    actividadTimerRef.current = setTimeout(() => {
      setActividadReciente(false);
    }, 4000);
  };

  useWebSocket<NuevaDenunciaEvent>(
    'nueva_denuncia',
    (data) => {
      const nuevaDenuncia = buildDenunciaFromEvent(data);

      setDenuncias((prev) => {
        if (prev.some((d) => d.id === nuevaDenuncia.id)) {
          return prev;
        }

        if (filtroEstado && nuevaDenuncia.estado !== filtroEstado) {
          return prev;
        }

        return [nuevaDenuncia, ...prev];
      });

      setNuevasDesdeUltimaVisita((n) => n + 1);

      const mensajeActividad = `Nueva denuncia: ${
        nuevaDenuncia.radicado
      } - ${nuevaDenuncia.nombreCiudadano}`;
      marcarActividad(mensajeActividad);
      toast.success(`Nueva denuncia: ${nuevaDenuncia.radicado}`);
    },
    [filtroEstado],
  );

  useWebSocket<CambioEstadoEvent>(
    'cambio_estado',
    (data) => {
      setDenuncias((prev) =>
        prev.flatMap((d) => {
          if (d.id !== data.denunciaId) {
            return [d];
          }

          const actualizada = { ...d, estado: data.estadoNuevo };
          if (filtroEstado && actualizada.estado !== filtroEstado) {
            return [];
          }

          return [actualizada];
        }),
      );

      marcarActividad(
        `Cambio de estado en ${data.denunciaId}: ${data.estadoAnterior} -> ${data.estadoNuevo}`,
      );
    },
    [filtroEstado],
  );

  useWebSocket<DocumentoListoEvent>(
    'documento_listo',
    (data) => {
      setDenuncias((prev) =>
        prev.map((d) =>
          d.id === data.denunciaId
            ? {
                ...d,
                documentoGeneradoOk: true,
                documentoPendiente: false,
              }
            : d,
        ),
      );

      marcarActividad(`Documento listo: ${data.radicado}`);
    },
    [],
  );

  return (
    <>
      <div className="mb-4 flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full bg-emerald-500 ${
              actividadReciente ? 'animate-pulse' : ''
            }`}
          />
          <p className="text-sm font-medium text-emerald-900">
            En vivo - ultima actividad: {ultimaActividad ?? 'Esperando eventos'}
          </p>
        </div>

        {nuevasDesdeUltimaVisita > 0 && (
          <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            +{nuevasDesdeUltimaVisita} nueva{nuevasDesdeUltimaVisita !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {fetchError && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {fetchError}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {denuncias.length === 0 && !fetchError ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <svg className="mb-3 h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            <p className="text-sm font-medium">No hay denuncias</p>
            <p className="mt-1 text-xs">
              {filtroEstado ? 'No hay denuncias con este estado.' : 'Aun no se han registrado denuncias.'}
            </p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-6 py-3 text-left">Radicado</th>
                <th className="px-6 py-3 text-left">Ciudadano</th>
                <th className="px-6 py-3 text-left">Dependencia</th>
                <th className="px-6 py-3 text-left">Estado</th>
                <th className="px-6 py-3 text-left">Doc.</th>
                <th className="px-6 py-3 text-left">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
              {denuncias.map((d) => (
                <tr key={d.id} className="cursor-pointer transition-colors hover:bg-gray-50">
                  <td className="px-6 py-3 font-mono font-medium text-gray-900">
                    <Link href={`/denuncias/${d.id}`} className="hover:text-blue-600">
                      {d.radicado}
                    </Link>
                    {d.incompleta && (
                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                        Incompleta
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <Link href={`/denuncias/${d.id}`} className="block">
                      <div className="font-medium">{d.nombreCiudadano}</div>
                      <div className="text-xs text-gray-400">{d.cedula}</div>
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-gray-500">
                    {d.dependenciaAsignada ?? <span className="italic text-gray-300">Sin asignar</span>}
                  </td>
                  <td className="px-6 py-3">
                    <DenunciaEstadoBadge estado={d.estado} />
                  </td>
                  <td
                    className="px-6 py-3 text-center text-base"
                    title={
                      d.documentoGeneradoOk
                        ? 'Documento listo'
                        : d.documentoPendiente
                          ? 'Generando...'
                          : d.esEspecial
                            ? 'Caso especial'
                            : '—'
                    }
                  >
                    {d.documentoGeneradoOk ? '📄' : d.documentoPendiente ? '⏳' : '—'}
                  </td>
                  <td className="px-6 py-3 text-gray-500">
                    {new Date(d.fechaCreacion).toLocaleDateString('es-CO', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {denuncias.length > 0 && (
        <p className="mt-3 text-right text-xs text-gray-400">
          {denuncias.length} denuncia{denuncias.length !== 1 ? 's' : ''}
        </p>
      )}
    </>
  );
}