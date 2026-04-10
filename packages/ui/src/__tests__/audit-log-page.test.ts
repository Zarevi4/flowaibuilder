import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { AuditLog } from '../pages/AuditLog';
import type { AuditLogEntry } from '@flowaibuilder/shared';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    createElement('a', { href: to }, children),
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: (props: Record<string, unknown>) =>
    createElement('svg', { 'data-testid': 'arrow-left', ...props }),
}));

const mockListAuditLog = vi.fn();

vi.mock('../lib/api', () => ({
  listAuditLog: (...args: unknown[]) => mockListAuditLog(...args),
}));

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'a1',
    timestamp: new Date().toISOString(),
    actor: 'alice',
    action: 'create',
    resourceType: 'workflow',
    resourceId: 'wf-1',
    ...overrides,
  };
}

describe('AuditLog page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when API returns empty entries', async () => {
    mockListAuditLog.mockResolvedValue({ entries: [] });
    render(createElement(AuditLog));
    await waitFor(() => {
      expect(screen.getByText('No audit entries yet.')).toBeDefined();
    });
  });

  it('renders rows with timestamp/actor/action/resource', async () => {
    mockListAuditLog.mockResolvedValue({ entries: [makeEntry()] });
    render(createElement(AuditLog));
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeDefined();
    });
    expect(screen.getByText('create')).toBeDefined();
    expect(screen.getByText('workflow:wf-1')).toBeDefined();
  });

  it('typing in actor filter triggers a re-fetch', async () => {
    mockListAuditLog.mockResolvedValue({ entries: [] });
    render(createElement(AuditLog));
    await waitFor(() => expect(mockListAuditLog).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Actor filter'), { target: { value: 'bob' } });

    await waitFor(
      () => {
        expect(mockListAuditLog).toHaveBeenCalledWith(expect.objectContaining({ actor: 'bob' }));
      },
      { timeout: 1000 },
    );
  });
});
