'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  DependenciaStat,
  PeriodoStat,
  ResumenEstadisticas,
} from '@/lib/api';

interface FeedbackStats {
  totalFeedbacks: number;
  porcentajeDependenciaCorrecta: number;
  promedioCalidadHechos: number;
  porcentajeAsuntoCorrect: number;
  dependenciasConMasCorrecciones: { dependencia: string; total: number }[];
}

async function descargar(tipo: 'excel' | 'pdf', desde?: string, hasta?: string) {
  const q = new URLSearchParams();
  if (desde) q.set('desde', desde);
  if (hasta) q.set('hasta', hasta);
  const url = `/api/estadisticas/exportar-${tipo}${q.size ? '?' + q : ''}`;
  const res = await fetch(url);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${tipo === 'excel' ? 'denunciantes' : 'informe'}-${new Date().toISOString().split('T')[0]}.${tipo === 'excel' ? 'xlsx' : 'pdf'}`;
  a.click();
  URL.revokeObjectURL(href);
}

// ── Tipos de período ──────────────────────────────────────────────────────────

type TipoPeriodo = 'semana' | 'mes' | 'ano' | 'personalizado';

function calcularFechas(tipo: TipoPeriodo): { desde: string; hasta: string } {
  const hoy = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  if (tipo === 'semana') {
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
    return { desde: fmt(lunes), hasta: fmt(hoy) };
  }
  if (tipo === 'mes') {
    return {
      desde: fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
      hasta: fmt(hoy),
    };
  }
  if (tipo === 'ano') {
    return {
      desde: fmt(new Date(hoy.getFullYear(), 0, 1)),
      hasta: fmt(hoy),
    };
  }
  return { desde: '', hasta: '' };
}

const ESTADO_COLORES: Record<string, string> = {
  RECIBIDA: '#3b82f6',
  EN_GESTION: '#f59e0b',
  RADICADA: '#f97316',
  CON_RESPUESTA: '#22c55e',
};

// ── Tarjeta de métrica ────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'normal' | 'red' | 'green' | 'yellow';
}) {
  const colorMap = {
    normal: 'text-gray-900',
    red: 'text-red-600',
    green: 'text-green-600',
    yellow: 'text-amber-600',
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${colorMap[accent ?? 'normal']}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function EstadisticasClient() {
  const [tipoPeriodo, setTipoPeriodo] = useState<TipoPeriodo>('mes');
  const [desdeCustom, setDesdeCustom] = useState('');
  const [hastaCustom, setHastaCustom] = useState('');

  const [resumen, setResumen] = useState<ResumenEstadisticas | null>(null);
  const [porDep, setPorDep] = useState<DependenciaStat[]>([]);
  const [porPeriodo, setPorPeriodo] = useState<PeriodoStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [descargando, setDescargando] = useState<'excel' | 'pdf' | null>(null);
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats | null>(null);

  const { desde: desdeCalc, hasta: hastaCalc } =
    tipoPeriodo !== 'personalizado'
      ? calcularFechas(tipoPeriodo)
      : { desde: desdeCustom, hasta: hastaCustom };

  const agrupacion: 'semana' | 'mes' =
    tipoPeriodo === 'semana' ? 'semana' : 'mes';

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams();
      if (desdeCalc) q.set('desde', desdeCalc);
      if (hastaCalc) q.set('hasta', hastaCalc);
      const qs = q.size ? '?' + q : '';

      const [r, dep, per, fb] = await Promise.all([
        fetch(`/api/estadisticas/resumen${qs}`).then((r) => r.json()),
        fetch(`/api/estadisticas/por-dependencia${qs}`).then((r) => r.json()),
        fetch(`/api/estadisticas/por-periodo${qs}&agrupacion=${agrupacion}`).then((r) => r.json()),
        fetch('/api/feedback/stats').then((r) => r.json()).catch(() => null),
      ]);
      setResumen(r);
      setPorDep(Array.isArray(dep) ? dep : []);
      setPorPeriodo(Array.isArray(per) ? per : []);
      setFeedbackStats(fb ?? null);
    } catch {
      setError('No se pudieron cargar las estadísticas. Verifica que el servidor esté activo.');
    } finally {
      setLoading(false);
    }
  }, [desdeCalc, hastaCalc, agrupacion]);

  useEffect(() => {
    if (tipoPeriodo !== 'personalizado' || (desdeCustom && hastaCustom)) {
      fetchData();
    }
  }, [tipoPeriodo, desdeCustom, hastaCustom, fetchData]);

  async function handleDescargar(tipo: 'excel' | 'pdf') {
    setDescargando(tipo);
    try {
      await descargar(tipo, desdeCalc, hastaCalc);
    } finally {
      setDescargando(null);
    }
  }

  // Datos para gráfica de barras por estado
  const estadoData = resumen
    ? Object.entries(resumen.porEstado).map(([estado, value]) => ({
        estado: estado.replace('_', ' '),
        total: value,
        fill: ESTADO_COLORES[estado] ?? '#94a3b8',
      }))
    : [];

  // Datos para gráfica de línea por período
  const periodoData = porPeriodo.map((p) => ({
    periodo: new Date(p.periodo).toLocaleDateString('es-CO', {
      month: 'short',
      year: '2-digit',
      day: agrupacion === 'semana' ? '2-digit' : undefined,
    }),
    Recibidas: p.recibidas,
    Resueltas: p.resueltas,
  }));

  // Tasa de resolución → color
  const tasaColor =
    !resumen
      ? 'normal'
      : resumen.tasaResolucion >= 70
        ? 'green'
        : resumen.tasaResolucion >= 40
          ? 'yellow'
          : 'red';

  const PERIODOS: { key: TipoPeriodo; label: string }[] = [
    { key: 'semana', label: 'Esta semana' },
    { key: 'mes', label: 'Este mes' },
    { key: 'ano', label: 'Este año' },
    { key: 'personalizado', label: 'Personalizado' },
  ];

  return (
    <div className="space-y-6">
      {/* Barra de acciones */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Selector de período */}
        <div className="flex flex-wrap items-center gap-2">
          {PERIODOS.map((p) => (
            <button
              key={p.key}
              onClick={() => setTipoPeriodo(p.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                tipoPeriodo === p.key
                  ? 'bg-blue-700 text-white'
                  : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
          {tipoPeriodo === 'personalizado' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={desdeCustom}
                onChange={(e) => setDesdeCustom(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <span className="text-sm text-gray-400">—</span>
              <input
                type="date"
                value={hastaCustom}
                onChange={(e) => setHastaCustom(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Botones de descarga */}
        <div className="flex gap-2">
          <button
            onClick={() => handleDescargar('pdf')}
            disabled={!!descargando || loading}
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            {descargando === 'pdf' ? 'Generando…' : 'Informe PDF'}
          </button>
          <button
            onClick={() => handleDescargar('excel')}
            disabled={!!descargando || loading}
            className="flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {descargando === 'excel' ? 'Generando…' : 'Excel denunciantes'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center text-gray-400">
          <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="ml-3 text-sm">Cargando estadísticas…</span>
        </div>
      ) : (
        <>
          {/* ── SECCIÓN 1: Panel operativo ───────────────────────────────── */}
          <div>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Panel operativo
            </h2>

            {/* Tarjetas */}
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricCard
                label="Total denuncias"
                value={resumen?.totalDenuncias ?? 0}
                sub="En el período seleccionado"
              />
              <MetricCard
                label="Casos estancados"
                value={resumen?.casosEstancados ?? 0}
                sub="+15 días sin cambio de estado"
                accent={(resumen?.casosEstancados ?? 0) > 0 ? 'red' : 'green'}
              />
              <MetricCard
                label="Denuncias especiales"
                value={resumen?.especiales ?? 0}
                sub="Seguimiento prioritario"
              />
              <MetricCard
                label="Tasa de resolución"
                value={`${resumen?.tasaResolucion ?? 0}%`}
                sub="Denuncias con respuesta / total"
                accent={tasaColor as 'normal' | 'red' | 'green' | 'yellow'}
              />
            </div>

            {/* Gráficas lado a lado */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Barras por estado */}
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="mb-4 text-sm font-semibold text-gray-700">
                  Denuncias por estado
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={estadoData} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="estado" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="total" name="Denuncias" radius={[4, 4, 0, 0]}>
                      {estadoData.map((entry, i) => (
                        <rect key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Línea recibidas vs resueltas */}
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="mb-4 text-sm font-semibold text-gray-700">
                  Recibidas vs resueltas por período
                </h3>
                {periodoData.length === 0 ? (
                  <div className="flex h-[220px] items-center justify-center text-sm text-gray-400">
                    Sin datos para el período seleccionado
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={periodoData} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="Recibidas"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="Resueltas"
                        stroke="#22c55e"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* ── SECCIÓN 2: Impacto de la gestión ────────────────────────── */}
          <div>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Impacto de la gestión
            </h2>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Barras horizontales top dependencias */}
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="mb-4 text-sm font-semibold text-gray-700">
                  Top 8 dependencias
                </h3>
                {porDep.length === 0 ? (
                  <div className="flex h-[260px] items-center justify-center text-sm text-gray-400">
                    Sin datos de dependencias
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      layout="vertical"
                      data={porDep.slice(0, 8).map((d) => ({
                        ...d,
                        dependenciaCorta: d.dependencia.length > 30 ? d.dependencia.slice(0, 30) + '…' : d.dependencia,
                      }))}
                      margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="dependenciaCorta"
                        width={140}
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip />
                      <Bar dataKey="total" name="Total" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Tabla top 5 + tiempo promedio */}
              <div className="flex flex-col gap-5">
                <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-100 text-sm">
                    <thead className="bg-gray-50">
                      <tr className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-3 text-left">Dependencia</th>
                        <th className="px-4 py-3 text-right">Total</th>
                        <th className="px-4 py-3 text-right">Resueltas</th>
                        <th className="px-4 py-3 text-right">% Resolución</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-700">
                      {porDep.slice(0, 5).map((d) => (
                        <tr key={d.dependencia} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-medium truncate max-w-[160px]">
                            {d.dependencia}
                          </td>
                          <td className="px-4 py-2.5 text-right">{d.total}</td>
                          <td className="px-4 py-2.5 text-right">{d.resueltas}</td>
                          <td className="px-4 py-2.5 text-right">
                            <span
                              className={
                                d.porcentajeResolucion >= 70
                                  ? 'text-green-600 font-medium'
                                  : d.porcentajeResolucion >= 40
                                    ? 'text-amber-600 font-medium'
                                    : 'text-red-600 font-medium'
                              }
                            >
                              {d.porcentajeResolucion}%
                            </span>
                          </td>
                        </tr>
                      ))}
                      {porDep.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-gray-400 text-xs">
                            Sin datos
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Tiempo promedio */}
                <div className="rounded-xl border border-gray-200 bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Tiempo promedio de resolución
                  </p>
                  <p className="mt-2 text-4xl font-bold text-blue-700">
                    {resumen?.tiempoPromedioResolucion !== null &&
                    resumen?.tiempoPromedioResolucion !== undefined
                      ? `${resumen.tiempoPromedioResolucion} días`
                      : '—'}
                  </p>
                  <p className="mt-2 text-xs text-gray-400">
                    Tiempo promedio desde que se recibe una denuncia hasta obtener
                    respuesta de la administración.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ── SECCIÓN 3: Precisión de la IA ───────────────────────────── */}
          <div>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Precisión de la IA
            </h2>
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              {!feedbackStats || feedbackStats.totalFeedbacks === 0 ? (
                <p className="text-sm text-gray-400">
                  Aún no hay revisiones registradas. Aparecerán aquí cuando el abogado complete el formulario de revisión.
                </p>
              ) : (
                <>
                  <p className="mb-5 text-xs text-gray-400">
                    Basado en {feedbackStats.totalFeedbacks} revisión{feedbackStats.totalFeedbacks !== 1 ? 'es' : ''}
                  </p>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                    <div className="text-center">
                      <p className="text-3xl font-bold text-blue-700">
                        {feedbackStats.porcentajeDependenciaCorrecta}%
                      </p>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Dependencias correctas
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold text-amber-600">
                        {feedbackStats.promedioCalidadHechos.toFixed(1)}
                        <span className="text-base font-normal text-gray-400"> / 5</span>
                      </p>
                      <div className="mt-1 flex justify-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <span
                            key={s}
                            className={
                              s <= Math.round(feedbackStats.promedioCalidadHechos)
                                ? 'text-amber-400'
                                : 'text-gray-200'
                            }
                          >
                            ★
                          </span>
                        ))}
                      </div>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Calidad HECHOS
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold text-green-600">
                        {feedbackStats.porcentajeAsuntoCorrect}%
                      </p>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                        ASUNTO apropiado
                      </p>
                    </div>
                  </div>

                  {feedbackStats.dependenciasConMasCorrecciones.length > 0 && (
                    <div className="mt-6 border-t border-gray-100 pt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Dependencias con más correcciones
                      </p>
                      <div className="space-y-1">
                        {feedbackStats.dependenciasConMasCorrecciones.map((d) => (
                          <div key={d.dependencia} className="flex items-center justify-between text-sm">
                            <span className="text-gray-700 truncate max-w-[280px]">{d.dependencia}</span>
                            <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              {d.total} corrección{d.total !== 1 ? 'es' : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
