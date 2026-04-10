import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getWorkflow, listWorkflows, updateWorkflow } from '../lib/api';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('api client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('getWorkflow calls GET /api/workflows/:id', async () => {
    const mockWorkflow = { id: 'w1', name: 'Test' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockWorkflow),
    });

    const result = await getWorkflow('w1');

    expect(mockFetch).toHaveBeenCalledWith('/api/workflows/w1', expect.objectContaining({
      headers: {},
    }));
    expect(result).toEqual(mockWorkflow);
  });

  it('listWorkflows calls GET /api/workflows', async () => {
    const mockResponse = { workflows: [] };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await listWorkflows();
    expect(mockFetch).toHaveBeenCalledWith('/api/workflows', expect.objectContaining({
      headers: {},
    }));
    expect(result).toEqual(mockResponse);
  });

  it('updateWorkflow calls PUT /api/workflows/:id', async () => {
    const mockWorkflow = { id: 'w1', name: 'Updated' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockWorkflow),
    });

    const result = await updateWorkflow('w1', { name: 'Updated' });

    expect(mockFetch).toHaveBeenCalledWith('/api/workflows/w1', expect.objectContaining({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    }));
    expect(result).toEqual(mockWorkflow);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(getWorkflow('bad-id')).rejects.toThrow('API 404: Not Found');
  });
});
