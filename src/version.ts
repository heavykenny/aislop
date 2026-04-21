/**
 * Application version — injected at build time by tsdown from package.json.
 * The fallback should always match the "version" field in package.json.
 */
export const APP_VERSION = process.env.VERSION ?? "0.6.1";
