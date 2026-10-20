import type { RaphaelApi } from '../../shared/ipc';

declare global {
  interface Window {
    raphael: RaphaelApi;
  }
}

export {};
