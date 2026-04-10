import { useEffect, useRef, useCallback } from 'react';
import { MessageSquare } from 'lucide-react';
import type { InboxMessage } from '@flowaibuilder/shared';

interface DashboardMessage extends InboxMessage {
  to: string;
}

interface MessageFeedProps {
  messages: DashboardMessage[];
}

export function MessageFeed({ messages }: MessageFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wasAtBottom = useRef(true);

  const checkAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    wasAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    if (wasAtBottom.current) {
      bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
    }
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-600">
        <MessageSquare className="w-8 h-8 mb-2" />
        <p className="text-sm">No messages yet</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={checkAtBottom}
      className="flex flex-col gap-2 overflow-y-auto h-full p-2"
    >
      {messages.map(msg => (
        <div key={msg.id} className="p-2 bg-gray-900 border border-gray-800 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-purple-400 text-xs font-medium">{msg.from}</span>
            <span className="text-gray-600 text-xs">&rarr;</span>
            <span className="text-gray-400 text-xs">{msg.to}</span>
            <span className="text-gray-600 text-xs ml-auto">
              {new Date(msg.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <p className="text-gray-300 text-xs">{msg.message}</p>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
