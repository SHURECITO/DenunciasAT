import { notFound } from 'next/navigation';
import DenunciaDetalle from './DenunciaDetalle';
import Sidebar from '@/components/Sidebar';
import { getDenuncia, getMensajes } from '@/lib/api';

export default async function DenunciaPage({
  params,
}: {
  params: { id: string };
}) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) notFound();

  let denuncia;
  let mensajes;

  try {
    [denuncia, mensajes] = await Promise.all([getDenuncia(id), getMensajes(id)]);
  } catch {
    notFound();
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar active="denuncias" />
      <main className="flex flex-1 flex-col overflow-auto">
        <DenunciaDetalle denuncia={denuncia} mensajes={mensajes} />
      </main>
    </div>
  );
}
