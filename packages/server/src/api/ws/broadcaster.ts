import { WebSocketServer, WebSocket } from 'ws';
import type { WebSocketMessage, WebSocketEventType } from '@flowaibuilder/shared';

export class Broadcaster {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        workflowId: '',
        data: { clientCount: this.clients.size },
        timestamp: new Date().toISOString(),
      }));
    });

    this.wss.on('error', (err) => {
      console.error('WebSocket server error:', err);
    });
  }

  /**
   * Broadcast a message to all connected clients.
   */
  broadcast(type: WebSocketEventType, workflowId: string, data: unknown) {
    const message: WebSocketMessage = {
      type,
      workflowId,
      data,
      timestamp: new Date().toISOString(),
    };

    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Send to clients watching a specific workflow.
   * For now, broadcasts to all (filtering can be added later with subscriptions).
   */
  broadcastToWorkflow(workflowId: string, type: WebSocketEventType, data: unknown) {
    this.broadcast(type, workflowId, data);
  }

  get clientCount() {
    return this.clients.size;
  }

  close() {
    this.wss.close();
  }
}

let broadcasterInstance: Broadcaster | null = null;

export function createBroadcaster(port: number): Broadcaster {
  broadcasterInstance = new Broadcaster(port);
  return broadcasterInstance;
}

export function getBroadcaster(): Broadcaster | null {
  return broadcasterInstance;
}
