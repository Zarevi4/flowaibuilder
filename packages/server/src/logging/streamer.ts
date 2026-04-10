import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { instanceSettings } from '../db/schema.js';
import type { LogDestination } from '@flowaibuilder/shared';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'error';
  event: string;
  workflowId: string;
  executionId: string;
  nodeId?: string;
  nodeName?: string;
  message: string;
  data?: unknown;
}

export class LogStreamer {
  private s3Buffer = new Map<string, LogEntry[]>();
  private s3Clients = new Map<string, InstanceType<any>>();
  private destinationsCache: LogDestination[] | null = null;
  private cacheExpiry = 0;
  private static readonly CACHE_TTL_MS = 10_000; // 10 seconds

  async getDestinations(): Promise<LogDestination[]> {
    const now = Date.now();
    if (this.destinationsCache && now < this.cacheExpiry) {
      return this.destinationsCache;
    }
    try {
      const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.id, 'singleton'));
      this.destinationsCache = ((row?.logStreamDestinations as LogDestination[] | null) ?? []).filter(d => d.enabled);
      this.cacheExpiry = now + LogStreamer.CACHE_TTL_MS;
      return this.destinationsCache;
    } catch {
      return [];
    }
  }

  async emit(entry: LogEntry): Promise<void> {
    const destinations = await this.getDestinations();
    if (destinations.length === 0) return;

    const tasks = destinations.map(dest => this.sendToDestination(dest, entry));
    await Promise.allSettled(tasks);
  }

  private async sendToDestination(dest: LogDestination, entry: LogEntry): Promise<void> {
    try {
      switch (dest.type) {
        case 'stdout':
          console.log(JSON.stringify(entry));
          break;
        case 'webhook':
          if (dest.url) {
            await fetch(dest.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(entry),
              signal: AbortSignal.timeout(5000),
            });
          }
          break;
        case 's3':
          this.bufferForS3(dest, entry);
          // Flush on execution completion or error events
          if (entry.event === 'execution_completed' || entry.event === 'execution_error') {
            await this.flushS3Buffer(dest, entry.executionId);
          }
          break;
      }
    } catch (err) {
      console.error(`[LogStreamer] Failed to send to ${dest.type}:`, err instanceof Error ? err.message : err);
    }
  }

  private s3BufferKey(dest: LogDestination, executionId: string): string {
    return `${dest.bucket}:${dest.prefix || 'logs/'}:${dest.region || 'us-east-1'}:${executionId}`;
  }

  private bufferForS3(dest: LogDestination, entry: LogEntry): void {
    const key = this.s3BufferKey(dest, entry.executionId);
    const buffer = this.s3Buffer.get(key) ?? [];
    buffer.push(entry);
    this.s3Buffer.set(key, buffer);
  }

  private async flushS3Buffer(dest: LogDestination, executionId: string): Promise<void> {
    const key = this.s3BufferKey(dest, executionId);
    const entries = this.s3Buffer.get(key);
    if (!entries || entries.length === 0) return;
    this.s3Buffer.delete(key);

    try {
      // Dynamic import so @aws-sdk/client-s3 is only loaded when needed
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const region = dest.region || 'us-east-1';
      let client = this.s3Clients.get(region);
      if (!client) {
        client = new S3Client({ region });
        this.s3Clients.set(region, client);
      }
      const prefix = dest.prefix || 'logs/';
      const workflowId = entries[0].workflowId;
      const s3Key = `${prefix}${workflowId}/${executionId}/${Date.now()}.jsonl`;
      const body = entries.map(e => JSON.stringify(e)).join('\n');

      await client.send(new PutObjectCommand({
        Bucket: dest.bucket,
        Key: s3Key,
        Body: body,
        ContentType: 'application/jsonl',
      }));
    } catch (err) {
      console.error(`[LogStreamer] S3 flush failed:`, err instanceof Error ? err.message : err);
    }
  }
}

let streamerInstance: LogStreamer | null = null;

export function getLogStreamer(): LogStreamer {
  if (!streamerInstance) {
    streamerInstance = new LogStreamer();
  }
  return streamerInstance;
}
