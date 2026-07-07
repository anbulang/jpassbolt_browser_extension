/**
 * Shared dictionary shape for the split i18n layer. A `Dict` is a flat map of
 * dot-namespaced keys to translated strings; `{{var}}` placeholders are
 * resolved at call time by `t()`. Every dicts/*.ts module exports an `en` and a
 * `zh` map of this shape, and ../index.ts spreads them into the two runtime
 * dictionaries.
 */
export type Dict = Record<string, string>;
