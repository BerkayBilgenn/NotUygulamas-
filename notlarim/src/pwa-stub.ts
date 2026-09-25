// Used only by the single-file preview build, which has no service worker.
export function useRegisterSW(_opts?: unknown) {
  void _opts
  return {
    needRefresh: [false, () => {}] as [boolean, (v: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (v: boolean) => void],
    updateServiceWorker: async (_reload?: boolean) => {
      void _reload
    },
  }
}
