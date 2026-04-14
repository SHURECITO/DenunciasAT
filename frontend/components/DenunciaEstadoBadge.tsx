import type { DenunciaEstado } from '@/lib/api';

const ESTADO_CONFIG: Record<DenunciaEstado, { label: string; className: string }> = {
  RECIBIDA: {
    label: 'Recibida',
    className: 'bg-blue-100 text-blue-700',
  },
  EN_GESTION: {
    label: 'En gestión',
    className: 'bg-yellow-100 text-yellow-700',
  },
  RADICADA: {
    label: 'Radicada',
    className: 'bg-orange-100 text-orange-700',
  },
  CON_RESPUESTA: {
    label: 'Con respuesta',
    className: 'bg-green-100 text-green-700',
  },
};

export default function DenunciaEstadoBadge({ estado }: { estado: DenunciaEstado }) {
  const config = ESTADO_CONFIG[estado] ?? {
    label: estado,
    className: 'bg-gray-100 text-gray-700',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
