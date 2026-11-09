import { ResourceCacheStableKey, __internal_ResourceCacheStableKey } from "../stable-keys.mjs";

//#region src/react/hooks/createCacheKeys.d.ts
/**
 * @internal
 */
declare function createCacheKeys<Params, T extends Record<string, unknown> = Record<string, unknown>, U extends Record<string, unknown> | undefined = undefined>(params: {
  stablePrefix: ResourceCacheStableKey | __internal_ResourceCacheStableKey | `mosaic-${string}`;
  authenticated: boolean;
  tracked: T;
  untracked: U extends {
    args: Params;
  } ? U : never;
}): {
  queryKey: readonly [ResourceCacheStableKey | __internal_ResourceCacheStableKey | `mosaic-${string}`, boolean, T, U extends {
    args: Params;
  } ? U : never];
  invalidationKey: readonly [ResourceCacheStableKey | __internal_ResourceCacheStableKey | `mosaic-${string}`, boolean, T];
  stableKey: ResourceCacheStableKey | __internal_ResourceCacheStableKey | `mosaic-${string}`;
  authenticated: boolean;
};
//#endregion
export { createCacheKeys };
//# sourceMappingURL=createCacheKeys.d.mts.map