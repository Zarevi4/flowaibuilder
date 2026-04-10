import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
const mockDestinations = vi.fn().mockResolvedValue([]);
vi.mock('../db/index.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockDestinations,
      }),
    }),
  },
}));

vi.mock('../db/schema.js', () => ({
  instanceSettings: { id: { _col: 'id' } },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

describe('LogStreamer', () => {
  let LogStreamer: typeof import('../logging/streamer.js').LogStreamer;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const mod = await import('../logging/streamer.js');
    LogStreamer = mod.LogStreamer;
  });

  const baseEntry = {
    timestamp: new Date().toISOString(),
    level: 'info' as const,
    event: 'execution_started',
    workflowId: 'wf-1',
    executionId: 'exec-1',
    message: 'Test execution started',
  };

  it('emits to stdout destination', async () => {
    mockDestinations.mockResolvedValue([{
      logStreamDestinations: [{ type: 'stdout', enabled: true }],
    }]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const streamer = new LogStreamer();

    await streamer.emit(baseEntry);

    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(baseEntry));
    consoleSpy.mockRestore();
  });

  it('emits to webhook destination', async () => {
    mockDestinations.mockResolvedValue([{
      logStreamDestinations: [{ type: 'webhook', url: 'https://hooks.example.com/logs', enabled: true }],
    }]);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const streamer = new LogStreamer();

    await streamer.emit(baseEntry);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hooks.example.com/logs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(baseEntry),
      }),
    );
    fetchSpy.mockRestore();
  });

  it('does not emit to disabled destinations', async () => {
    mockDestinations.mockResolvedValue([{
      logStreamDestinations: [{ type: 'stdout', enabled: false }],
    }]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const streamer = new LogStreamer();

    await streamer.emit(baseEntry);

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('does not fail when one destination errors', async () => {
    mockDestinations.mockResolvedValue([{
      logStreamDestinations: [
        { type: 'webhook', url: 'https://broken.example.com', enabled: true },
        { type: 'stdout', enabled: true },
      ],
    }]);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const streamer = new LogStreamer();

    // Should not throw
    await streamer.emit(baseEntry);

    // stdout should still have received the entry
    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(baseEntry));

    fetchSpy.mockRestore();
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('buffers S3 entries and flushes on execution_completed', async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: class { send = mockSend; },
      PutObjectCommand: class { constructor(public params: unknown) {} },
    }));

    // Re-import to pick up the mock
    vi.resetModules();
    const mod = await import('../logging/streamer.js');
    const streamer = new mod.LogStreamer();

    // Mock destinations to return an S3 destination
    const destMock = vi.spyOn(streamer, 'getDestinations').mockResolvedValue([
      { type: 's3', bucket: 'my-bucket', region: 'us-west-2', prefix: 'logs/', enabled: true },
    ]);

    const nodeEntry = {
      timestamp: new Date().toISOString(),
      level: 'info' as const,
      event: 'node_completed',
      workflowId: 'wf-1',
      executionId: 'exec-1',
      nodeId: 'n1',
      nodeName: 'HTTP',
      message: 'Node completed',
    };

    // Emit a non-terminal event — should buffer, not flush
    await streamer.emit(nodeEntry);
    expect(mockSend).not.toHaveBeenCalled();

    // Emit execution_completed — should flush the buffer
    const completeEntry = {
      ...nodeEntry,
      event: 'execution_completed',
      message: 'Execution completed',
    };
    await streamer.emit(completeEntry);
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Verify the PutObjectCommand was constructed with the correct bucket
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.params).toMatchObject({ Bucket: 'my-bucket' });

    destMock.mockRestore();
  });

  it('emits nothing when no destinations configured', async () => {
    mockDestinations.mockResolvedValue([{ logStreamDestinations: [] }]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const streamer = new LogStreamer();

    await streamer.emit(baseEntry);

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
