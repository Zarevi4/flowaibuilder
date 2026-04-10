import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface Props {
  state: ContextMenuState | null;
  onClose: () => void;
}

const MENU_WIDTH = 200;
const ITEM_HEIGHT = 32;

export function CanvasContextMenu({ state, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [state, onClose]);

  if (!state) return null;

  // Viewport-clamp
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const height = state.items.length * ITEM_HEIGHT + 8;
  const left = Math.max(8, Math.min(state.x, vw - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(state.y, vh - height - 8));

  return (
    <div
      ref={ref}
      data-testid="canvas-context-menu"
      style={{
        position: 'fixed',
        left,
        top,
        width: MENU_WIDTH,
        zIndex: 1000,
      }}
      className="bg-gray-900 border border-gray-700 rounded-md shadow-xl py-1 text-sm text-gray-100"
    >
      {state.items.map((item, i) => (
        <button
          key={i}
          type="button"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
          className={`w-full text-left px-3 py-1.5 ${
            item.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-800'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
