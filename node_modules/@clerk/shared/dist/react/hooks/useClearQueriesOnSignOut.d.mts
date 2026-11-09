//#region src/react/hooks/useClearQueriesOnSignOut.d.ts
type ClearQueriesOnSignOutOptions = {
  isSignedOut: boolean;
  stableKeys: string | readonly string[];
  /**
   * Whether the queries for this hook are keyed as authenticated.
   * If this is not `true`, the effect becomes a no-op.
   */
  authenticated?: boolean;
  /**
   * Optional callback that will run after queries are cleared on sign-out.
   */
  onCleanup?: () => void;
};
/**
 * Clears React Query caches associated with the given stable prefixes when
 * the authenticated state transitions from signed-in to signed-out.
 *
 * @internal
 */
declare function useClearQueriesOnSignOut(options: ClearQueriesOnSignOutOptions): void;
//#endregion
export { useClearQueriesOnSignOut };
//# sourceMappingURL=useClearQueriesOnSignOut.d.mts.map