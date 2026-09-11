import { defineStore } from 'pinia';

const STORAGE_KEY = 'desktop-window-state';
const DEFAULT_STATE = {
  mode: 'floating',
  minimized: false,
  position: { x: 30, y: 24 },
  floatingPosition: { x: 30, y: 24 },
};

function loadState() {
  if (typeof window === 'undefined') return { ...DEFAULT_STATE };

  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    return {
      ...DEFAULT_STATE,
      ...saved,
      position: { ...DEFAULT_STATE.position, ...saved?.position },
      floatingPosition: { ...DEFAULT_STATE.floatingPosition, ...saved?.floatingPosition },
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export const useDesktopStore = defineStore('desktop', {
  state: loadState,

  actions: {
    persist() {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode: this.mode,
        minimized: this.minimized,
        position: this.position,
        floatingPosition: this.floatingPosition,
      }));
    },

    setPosition(x, y) {
      this.position = { x, y };
      this.floatingPosition = { x, y };
      this.persist();
    },

    setFloatingPosition(x, y) {
      this.position = { x, y };
      this.floatingPosition = { x, y };
      this.persist();
    },

    setMode(mode) {
      this.mode = mode;
      this.persist();
    },

    minimize() {
      this.minimized = true;
      this.persist();
    },

    restore() {
      this.minimized = false;
      this.persist();
    },
  },
});
