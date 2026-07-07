/**
 * Handler registry types. index.ts merges every domain's HandlerMap and
 * consults the registry BEFORE falling back to the legacy switch, so domain
 * work packages only ever touch their own handlers/<domain>.ts file.
 */
import type { Req } from '../shared/messages';

// `req: any` is deliberate: a Partial<Record<...>> cannot express the per-key
// request narrowing, and handlers are looked up dynamically by req.type. Each
// handler file narrows its own request type internally.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Handler = (req: any, sender: chrome.runtime.MessageSender) => Promise<unknown>;

export type HandlerMap = Partial<Record<Req['type'], Handler>>;

/** Stub for RPCs whose work package has not landed yet. */
export function notImplemented(type: string): Handler {
  return async () => {
    throw new Error(`not_implemented: ${type}`);
  };
}
