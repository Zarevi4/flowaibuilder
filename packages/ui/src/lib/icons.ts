import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';
import {
  Zap,
  Clock,
  Play,
  Code,
  PenLine,
  GitBranch,
  GitMerge,
  Repeat,
  Globe,
  Bot,
  Send,
} from 'lucide-react';

const iconMap: Record<string, ComponentType<LucideProps>> = {
  Zap,
  Clock,
  Play,
  Code,
  PenLine,
  GitBranch,
  GitMerge,
  Repeat,
  Globe,
  Bot,
  Send,
};

export function resolveIcon(iconName: string): ComponentType<LucideProps> {
  return iconMap[iconName] ?? Code;
}
