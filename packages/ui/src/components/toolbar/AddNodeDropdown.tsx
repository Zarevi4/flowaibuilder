import { useCallback, useEffect, useRef } from 'react';
import { NODE_TYPES, NODE_CATEGORIES } from '@flowaibuilder/shared';
import type { NodeCategory } from '@flowaibuilder/shared';
import { resolveIcon } from '../../lib/icons';

interface AddNodeDropdownProps {
  onSelect: (type: string, name: string) => void;
  onClose: () => void;
}

const categoryOrder: NodeCategory[] = ['trigger', 'logic', 'integration', 'output'];

export function AddNodeDropdown({ onSelect, onClose }: AddNodeDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleSelect = useCallback(
    (type: string, label: string) => {
      onSelect(type, label);
      onClose();
    },
    [onSelect, onClose],
  );

  // Group node types by category
  const grouped = categoryOrder.map((cat) => ({
    category: cat,
    meta: NODE_CATEGORIES[cat],
    nodes: Object.values(NODE_TYPES).filter((n) => n.category === cat),
  }));

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden"
    >
      <div className="max-h-80 overflow-y-auto py-1">
        {grouped.map(({ category, meta, nodes }) => (
          <div key={category}>
            <div
              className="px-3 py-1.5 text-xs uppercase tracking-wider font-medium"
              style={{ color: meta.color }}
            >
              {meta.label}
            </div>
            {nodes.map((node) => {
              const Icon = resolveIcon(node.icon);
              return (
                <button
                  key={node.type}
                  onClick={() => handleSelect(node.type, node.label)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  <Icon size={14} style={{ color: node.color }} />
                  <span>{node.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
