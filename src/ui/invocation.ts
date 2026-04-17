/**
 * The canonical command prefix used in hint text.
 *
 * Always `npx aislop` — it works regardless of how the user installed aislop:
 * globally (npx resolves to the global bin), as a devDependency (npx resolves
 * to node_modules/.bin), or not at all (npx downloads and runs it).
 */
export const detectInvocation = (): string => "npx aislop";
