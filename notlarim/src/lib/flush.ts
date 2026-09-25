/** Editors register a "save now" function so exports always include the last few strokes or words. */
const fns = new Set<() => Promise<void> | void>()

export function registerFlush(fn: () => Promise<void> | void) {
  fns.add(fn)
  return () => {
    fns.delete(fn)
  }
}

export async function flushAll() {
  await Promise.all([...fns].map((f) => f()))
}
