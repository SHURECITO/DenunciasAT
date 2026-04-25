'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Denuncia } from '@/lib/api';

interface Props {
  denuncia: Denuncia;
  onClose: () => void;
  onDone: (updated: Denuncia) => void;
}

interface Dependencia {
  nombre: string;
}

function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(star)}
          className="text-2xl leading-none focus:outline-none"
          aria-label={`${star} estrella${star !== 1 ? 's' : ''}`}
        >
          <span
            className={
              star <= (hovered || value)
                ? 'text-amber-400'
                : 'text-gray-300'
            }
          >
            ★
          </span>
        </button>
      ))}
    </div>
  );
}

export default function ModalFeedback({ denuncia, onClose, onDone }: Props) {
  const [dependencias, setDependencias] = useState<string[]>([]);
  const [dependenciaCorrecta, setDependenciaCorrecta] = useState<boolean | null>(null);
  const [dependenciaCorregida, setDependenciaCorregida] = useState('');
  const [calidadHechos, setCalidadHechos] = useState(0);
  const [comentarioHechos, setComentarioHechos] = useState('');
  const [asuntoCorrect, setAsuntoCorrect] = useState<boolean | null>(null);
  const [asuntoCorregido, setAsuntoCorregido] = useState('');
  const [feedbackLibre, setFeedbackLibre] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/dependencias')
      .then((r) => r.json())
      .then((data: Dependencia[]) => setDependencias(data.map((d) => d.nombre)))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (dependenciaCorrecta === null) {
      toast.error('Indica si la dependencia asignada fue correcta');
      return;
    }
    if (calidadHechos === 0) {
      toast.error('Califica la calidad de los HECHOS');
      return;
    }
    if (asuntoCorrect === null) {
      toast.error('Indica si el ASUNTO fue apropiado');
      return;
    }
    if (!dependenciaCorrecta && !dependenciaCorregida) {
      toast.error('Selecciona la dependencia correcta');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          denunciaId: denuncia.id,
          dependenciaOriginal: denuncia.dependenciaAsignada ?? '',
          dependenciaCorregida: dependenciaCorrecta ? null : dependenciaCorregida,
          dependenciaCorrecta: dependenciaCorrecta,
          calidadHechos,
          comentarioHechos: comentarioHechos || null,
          asuntoCorrect: asuntoCorrect,
          asuntoCorregido: asuntoCorrect ? null : asuntoCorregido || null,
          feedbackLibre: feedbackLibre || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? `Error ${res.status}`);
      }

      const { denuncia: updated } = await res.json();
      toast.success('Feedback guardado y documento marcado como revisado');
      onDone(updated);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/denuncias/${denuncia.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentoRevisado: true }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated: Denuncia = await res.json();
      toast.success('Documento marcado como revisado');
      onDone(updated);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al actualizar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 border-b border-gray-100 bg-white px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            Revisión del documento —{' '}
            <span className="font-mono text-blue-700">{denuncia.radicado}</span>
          </h2>
          <p className="mt-0.5 text-xs text-gray-400">
            Tu evaluación ayuda a mejorar la IA. Todos los campos son opcionales excepto los marcados.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 px-6 py-5">
          {/* Pregunta 1: dependencia */}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-800">
              1. ¿La dependencia asignada fue correcta?{' '}
              <span className="text-red-500">*</span>
            </legend>
            {denuncia.dependenciaAsignada && (
              <p className="mb-2 text-xs text-gray-500">
                IA asignó:{' '}
                <span className="font-medium text-gray-700">
                  {denuncia.dependenciaAsignada}
                </span>
              </p>
            )}
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="depCorrecta"
                  checked={dependenciaCorrecta === true}
                  onChange={() => setDependenciaCorrecta(true)}
                  className="accent-blue-600"
                />
                Sí, fue correcta
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="depCorrecta"
                  checked={dependenciaCorrecta === false}
                  onChange={() => setDependenciaCorrecta(false)}
                  className="accent-blue-600"
                />
                No, era otra
              </label>
            </div>
            {dependenciaCorrecta === false && (
              <div className="mt-2">
                <label className="mb-1 block text-xs text-gray-500">
                  ¿Cuál era la correcta?
                </label>
                <select
                  value={dependenciaCorregida}
                  onChange={(e) => setDependenciaCorregida(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Selecciona una dependencia…</option>
                  {dependencias.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>

          {/* Pregunta 2: calidad hechos */}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-800">
              2. Calidad de la redacción de los HECHOS{' '}
              <span className="text-red-500">*</span>
            </legend>
            <StarRating value={calidadHechos} onChange={setCalidadHechos} />
            {calidadHechos > 0 && (
              <p className="mt-1 text-xs text-gray-400">
                {['', 'Muy deficiente', 'Deficiente', 'Aceptable', 'Buena', 'Excelente'][calidadHechos]}
              </p>
            )}
            <textarea
              value={comentarioHechos}
              onChange={(e) => setComentarioHechos(e.target.value)}
              placeholder="¿Qué se podría mejorar? (opcional)"
              rows={2}
              maxLength={1000}
              className="mt-2 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </fieldset>

          {/* Pregunta 3: asunto */}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-800">
              3. ¿El ASUNTO del documento fue apropiado?{' '}
              <span className="text-red-500">*</span>
            </legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="asunto"
                  checked={asuntoCorrect === true}
                  onChange={() => setAsuntoCorrect(true)}
                  className="accent-blue-600"
                />
                Sí
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="asunto"
                  checked={asuntoCorrect === false}
                  onChange={() => setAsuntoCorrect(false)}
                  className="accent-blue-600"
                />
                No
              </label>
            </div>
            {asuntoCorrect === false && (
              <div className="mt-2">
                <label className="mb-1 block text-xs text-gray-500">
                  ¿Cómo debería decir?
                </label>
                <input
                  type="text"
                  value={asuntoCorregido}
                  onChange={(e) => setAsuntoCorregido(e.target.value)}
                  maxLength={500}
                  placeholder="Escribe el ASUNTO correcto…"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}
          </fieldset>

          {/* Pregunta 4: observaciones */}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-800">
              4. Observaciones adicionales (opcional)
            </legend>
            <textarea
              value={feedbackLibre}
              onChange={(e) => setFeedbackLibre(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Cualquier otra observación sobre el documento…"
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1 text-right text-xs text-gray-400">
              {feedbackLibre.length}/500
            </p>
          </fieldset>

          {/* Botones */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Guardando…' : 'Guardar y marcar como revisado'}
            </button>
            <button
              type="button"
              onClick={handleSkip}
              disabled={submitting}
              className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Omitir y marcar como revisado
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Cancelar
          </button>
        </form>
      </div>
    </div>
  );
}
