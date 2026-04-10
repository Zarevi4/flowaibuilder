import { WebSocketServer, WebSocket } from 'ws';
import type { WebSocketMessage, WebSocketEventType } from '@flowaibuilder/shared';
import type { Workflow } from '@flowaibuilder/shared';

export type GetWorkflowFn = (id: string) => Promise<Workflow | null>;

export class Broadcaster {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private subscriptions = new Map<WebSocket, string>();

  constructor(port: number, private getWorkflowFn?: GetWorkflowFn) {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      ws.on('close', () => {
        this.clients.delete(ws);
        this.subscriptions.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
        this.subscriptions.delete(ws);
      });

      // Handle incoming messages (subscribe)
      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'subscribe' && msg.workflowId) {
            this.subscriptions.set(ws, msg.workflowId);
            if (this.getWorkflowFn) {
              const workflow = await this.getWorkflowFn(msg.workflowId);
              if (workflow && ws.readyState === WebSocket.OPEN) {
                try {
                  ws.send(JSON.stringify({
                    type: 'full_sync',
                    workflowId: workflow.id,
                    data: workflow,
                    timestamp: new Date().toISOString(),
                  } satisfies WebSocketMessage));
                } catch {
                  // Client disconnected between check and send
                }
              }
            }
          }
        } catch {
          // Ignore malformed messages
        }
      });

      // Send connection acknowledgment
      const ack: WebSocketMessage = {
        type: 'connected',
        workflowId: '',
        data: { clientCount: this.clients.size },
        timestamp: new Date().toISOString(),
      };
      try {
        ws.send(JSON.stringify(ack));
      } catch {
        // Client disconnected before ack could be sent
      }
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
        try {
          client.send(payload);
        } catch {
          // Client disconnected between check and send
        }
      }
    }
  }

  /**
   * Send to clients subscribed to a specific workflow.
   * Falls back to broadcasting to all clients if no subscriptions are set.
   */
  broadcastToWorkflow(workflowId: string, type: WebSocketEventType, data: unknown) {
    const message: WebSocketMessage = {
      type,
      workflowId,
      data,
      timestamp: new Date().toISOString(),
    };

    const payload = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        const subscribedTo = this.subscriptions.get(client);
        if (subscribedTo === workflowId) {
          try {
            client.send(payload);
          } catch {
            // Client disconnected between check and send
          }
        }
      }
    }
  }

  get clientCount() {
    return this.clients.size;
  }

  close() {
    this.wss.close();
  }
}

let broadcasterInstance: Broadcaster | null = null;

export function createBroadcaster(port: number, getWorkflowFn?: GetWorkflowFn): Broadcaster {
  broadcasterInstance = new Broadcaster(port, getWorkflowFn);
  return broadcasterInstance;
}

export function getBroadcaster(): Broadcaster | null {
  return broadcasterInstance;
}
