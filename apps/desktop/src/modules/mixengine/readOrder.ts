export interface ReadOrder {
  issued: number;
  applied: number;
  inFlight: number;
  stale: boolean;
}

export function noReadsYet(): ReadOrder {
  return { issued: 0, applied: 0, inFlight: 0, stale: false };
}

export function readBegan(order: ReadOrder): { order: ReadOrder; seq: number } {
  const seq = order.issued + 1;
  return { order: { ...order, issued: seq, inFlight: order.inFlight + 1 }, seq };
}

export function eventArrived(order: ReadOrder): ReadOrder {
  return order.inFlight === 0 ? order : { ...order, stale: true };
}

export function readLanded(
  order: ReadOrder,
  seq: number,
): { order: ReadOrder; apply: boolean; readAgain: boolean } {
  const inFlight = order.inFlight - 1;
  const apply = seq > order.applied;
  const readAgain = order.stale && inFlight === 0;
  return {
    order: {
      ...order,
      applied: apply ? seq : order.applied,
      inFlight,
      stale: readAgain ? false : order.stale,
    },
    apply,
    readAgain,
  };
}
