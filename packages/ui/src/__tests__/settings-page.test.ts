import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { Settings } from '../pages/Settings';
import type { InstanceSettings } from '@flowaibuilder/shared';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    createElement('a', { href: to }, children),
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: (props: Record<string, unknown>) =>
    createElement('svg', { 'data-testid': 'arrow-left', ...props }),
}));

const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock('../lib/api', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
}));

const initial: InstanceSettings = {
  id: 'singleton',
  timezone: 'UTC',
  autoReviewEnabled: false,
  errorWorkflowId: null,
  updatedAt: new Date().toISOString(),
};

describe('Settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue(initial);
    mockUpdateSettings.mockImplementation((patch: Partial<InstanceSettings>) =>
      Promise.resolve({ ...initial, ...patch }),
    );
  });

  it('loads settings, edits fields, saves, and shows confirmation', async () => {
    render(createElement(Settings));

    await waitFor(() => {
      expect(mockGetSettings).toHaveBeenCalled();
    });

    const tzInput = await screen.findByDisplayValue('UTC');
    fireEvent.change(tzInput, { target: { value: 'America/New_York' } });

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    const errInput = screen.getAllByRole('textbox')[1];
    fireEvent.change(errInput, { target: { value: 'wf-err' } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        timezone: 'America/New_York',
        autoReviewEnabled: true,
        errorWorkflowId: 'wf-err',
      });
    });

    expect(await screen.findByText('Saved!')).toBeDefined();
  });
});
