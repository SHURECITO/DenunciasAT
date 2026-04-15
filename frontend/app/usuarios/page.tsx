import Sidebar from '@/components/Sidebar';
import UsuariosClient from './UsuariosClient';
import { getUsuarios, type Usuario } from '@/lib/api';

export default async function UsuariosPage() {
  let usuarios: Usuario[] = [];
  let fetchError = '';

  try {
    usuarios = await getUsuarios();
  } catch {
    fetchError = 'No se pudo cargar la lista de usuarios.';
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar active="usuarios" />
      <main className="flex flex-1 flex-col overflow-auto">
        <header className="border-b border-gray-200 bg-white px-8 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Gestión de usuarios</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Administra el acceso al dashboard del despacho
          </p>
        </header>
        <div className="flex-1 px-8 py-6">
          <UsuariosClient initialUsuarios={usuarios} initialError={fetchError} />
        </div>
      </main>
    </div>
  );
}
