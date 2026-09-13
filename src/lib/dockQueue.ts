let queue: Promise<void> = Promise.resolve();

export function enqueueDockResize(task: () => Promise<void>) {
  queue = queue.catch(() => undefined).then(task);
  return queue;
}
