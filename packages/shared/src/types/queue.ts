export interface QueueStatus {
  enabled: boolean;
  concurrency?: number;
  waiting?: number;
  active?: number;
  completed?: number;
  failed?: number;
  delayed?: number;
  workers?: number;
}

export interface LogDestination {
  type: 'stdout' | 'webhook' | 's3';
  url?: string;
  bucket?: string;
  region?: string;
  prefix?: string;
  enabled: boolean;
}

export interface LogStreamConfig {
  destinations: LogDestination[];
}
