/**
 * Compatibility shim. The i18n implementation moved to shared/i18n/index.ts and
 * the dictionaries to shared/i18n/dicts/*.ts (split so the ~500-line Dict stops
 * being a merge-conflict hotspot). Every existing importer — popup / options /
 * content scripts / background / ui — keeps importing `../shared/i18n`
 * unchanged; this file simply re-exports the runtime API and types.
 */
export * from './i18n/index';
