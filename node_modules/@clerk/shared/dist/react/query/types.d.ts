import { DefaultError, DefinedQueryObserverResult, OmitKeyof, QueryKey, QueryObserverOptions, QueryObserverResult } from "@tanstack/query-core";

//#region src/react/query/types.d.ts
interface UseBaseQueryOptions<TQueryFnData = unknown, TError = DefaultError, TData = TQueryFnData, TQueryData = TQueryFnData, TQueryKey extends QueryKey = QueryKey> extends QueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey> {
  /**
   * Set this to `false` to unsubscribe this observer from updates to the query cache.
   * Defaults to `true`.
   */
  subscribed?: boolean;
}
interface UseQueryOptions<TQueryFnData = unknown, TError = DefaultError, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey> extends OmitKeyof<UseBaseQueryOptions<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>, 'suspense'> {}
type UseBaseQueryResult<TData = unknown, TError = DefaultError> = QueryObserverResult<TData, TError>;
type UseQueryResult<TData = unknown, TError = DefaultError> = UseBaseQueryResult<TData, TError>;
type DefinedUseQueryResult<TData = unknown, TError = DefaultError> = DefinedQueryObserverResult<TData, TError>;
//#endregion
export { DefinedUseQueryResult, UseQueryOptions, UseQueryResult };
//# sourceMappingURL=types.d.ts.map