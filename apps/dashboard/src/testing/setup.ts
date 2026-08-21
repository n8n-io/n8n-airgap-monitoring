// jsdom does not implement ResizeObserver, which reka-ui's ScrollArea relies
// on. Stub it so components using ScrollArea can mount in tests.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
