import Link from 'next/link';
import DenunciaEstadoBadge from '@/components/DenunciaEstadoBadge';
import LogoutButton from '@/components/LogoutButton';
import { getDenuncias, type Denuncia, type DenunciaEstado } from '@/lib/api';

const FILTROS: { label: string; value: DenunciaEstado | undefined }[] = [
  { label: 'Todas', value: undefined },
  { label: 'Recibida', value: 'RECIBIDA' },
  { label: 'En gestión', value: 'EN_GESTION' },
  { label: 'Radicada', value: 'RADICADA' },
  { label: 'Con respuesta', value: 'CON_RESPUESTA' },
];

function getUserEmail(): string {
  // El JWT está en httpOnly — solo mostramos el email si lo guardamos en un cookie no-httpOnly
  // Por ahora usamos un placeholder; en Fase 4+ se decodifica el JWT en servidor
  return 'admin@denunciasat.co';
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { estado?: string };
}) {
  const filtroEstado = searchParams.estado as DenunciaEstado | undefined;

  let denuncias: Denuncia[] = [];
  let fetchError = '';

  try {
    denuncias = await getDenuncias(filtroEstado);
  } catch {
    fetchError = 'No se pudo cargar las denuncias. Verifica que el servidor esté activo.';
  }

  const userEmail = getUserEmail();

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col bg-gray-900 text-white">
        {/* Logo */}
        <div className="flex items-center gap-2 border-b border-gray-700 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
            <svg
              className="h-5 w-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">DenunciasAT</p>
            <p className="text-[10px] text-gray-400 leading-tight">Concejal Andrés Tobón</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium bg-gray-700 text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
            </svg>
            Denuncias
          </Link>

          <button
            disabled
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-gray-500 cursor-not-allowed"
            title="Próximamente"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
            </svg>
            Denuncias especiales
          </button>
        </nav>

        {/* Usuario */}
        <div className="border-t border-gray-700 px-3 py-3">
          <p className="mb-1 px-3 text-xs text-gray-400 truncate">{userEmail}</p>
          <LogoutButton />
        </div>
      </aside>

      {/* Contenido principal */}
      <main className="flex flex-1 flex-col overflow-auto">
        {/* Header */}
        <header className="border-b border-gray-200 bg-white px-8 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Gestión de Denuncias</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Concejo de Medellín — Despacho Concejal Andrés Tobón
          </p>
        </header>

        <div className="flex-1 px-8 py-6">
          {/* Filtros */}
          <div className="mb-5 flex flex-wrap gap-2">
            {FILTROS.map((f) => {
              const isActive = f.value === filtroEstado;
              const href = f.value ? `/?estado=${f.value}` : '/';
              return (
                <Link
                  key={f.label}
                  href={href}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-800 text-white'
                      : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {f.label}
                </Link>
              );
            })}
          </div>

          {/* Error de carga */}
          {fetchError && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
              {fetchError}
            </div>
          )}

          {/* Tabla */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {denuncias.length === 0 && !fetchError ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <svg className="mb-3 h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <p className="text-sm font-medium">No hay denuncias</p>
                <p className="text-xs mt-1">
                  {filtroEstado ? 'No hay denuncias con este estado.' : 'Aún no se han registrado denuncias.'}
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
                    <th className="px-6 py-3 text-left">Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                  {denuncias.map((d) => (
                    <tr key={d.id} className="transition-colors hover:bg-gray-50">
                      <td className="px-6 py-3 font-mono font-medium text-gray-900">
                        {d.radicado}
                      </td>
                      <td className="px-6 py-3">
                        <div className="font-medium">{d.nombreCiudadano}</div>
                        <div className="text-xs text-gray-400">{d.cedula}</div>
                      </td>
                      <td className="px-6 py-3 text-gray-500">
                        {d.dependenciaAsignada ?? <span className="italic text-gray-300">Sin asignar</span>}
                      </td>
                      <td className="px-6 py-3">
                        <DenunciaEstadoBadge estado={d.estado} />
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

          {/* Conteo */}
          {denuncias.length > 0 && (
            <p className="mt-3 text-right text-xs text-gray-400">
              {denuncias.length} denuncia{denuncias.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
