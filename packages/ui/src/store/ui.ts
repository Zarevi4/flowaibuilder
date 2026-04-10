import { create } from 'zustand';

interface UiState {
  selectedNodeId: string | null;
  sidebarOpen: boolean;
  jsonPanelOpen: boolean;
  loading: boolean;
  selectNode: (id: string | null) => void;
  toggleSidebar: () => void;
  toggleJsonPanel: () => void;
  setLoading: (loading: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  selectedNodeId: null,
  sidebarOpen: false,
  jsonPanelOpen: false,
  loading: false,

  selectNode: (id) => set({ selectedNodeId: id }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleJsonPanel: () => set((state) => ({ jsonPanelOpen: !state.jsonPanelOpen })),
  setLoading: (loading) => set({ loading }),
}));
