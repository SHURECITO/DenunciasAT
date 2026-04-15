'use client';

import { type Mensaje } from '@/lib/api';

interface ChatPanelProps {
  mensajes: Mensaje[];
  open: boolean;
  onClose: () => void;
}

const TIPO_LABEL: Record<string, string> = {
  TEXTO: '',
  AUDIO_TRANSCRITO: '🎤 Audio transcrito',
  IMAGEN: '🖼 Imagen',
  PDF: '📄 PDF',
};

export default function ChatPanel({ mensajes, open, onClose }: ChatPanelProps) {
  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={onClose}
        />
      )}

      {/* Panel deslizante */}
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-96 flex-col bg-white shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Conversación WhatsApp</h2>
            <p className="text-xs text-gray-400">{mensajes.length} mensajes</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Burbujas */}
        <div className="flex-1 overflow-y-auto space-y-3 px-4 py-4" style={{ background: '#e5ddd5' }}>
          {mensajes.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-gray-500">Sin mensajes registrados</p>
            </div>
          ) : (
            mensajes.map((m) => {
              const isEntrante = m.direccion === 'ENTRANTE';
              return (
                <div
                  key={m.id}
                  className={`flex ${isEntrante ? 'justify-start' : 'justify-end'}`}
                >
                  <div
                    className={`max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                      isEntrante
                        ? 'bg-white text-gray-800'
                        : 'bg-green-100 text-gray-800'
                    }`}
                  >
                    {TIPO_LABEL[m.tipo] && (
                      <p className="mb-1 text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                        {TIPO_LABEL[m.tipo]}
                      </p>
                    )}
                    <p className="leading-snug whitespace-pre-wrap">{m.contenido}</p>
                    <p className="mt-1 text-right text-[10px] text-gray-400">
                      {new Date(m.timestamp).toLocaleTimeString('es-CO', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
