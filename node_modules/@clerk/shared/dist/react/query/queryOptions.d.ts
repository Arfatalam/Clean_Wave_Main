import { UseQueryOptions } from "./types.js";
import { DefaultError, InitialDataFunction, NonUndefinedGuard, OmitKeyof, QueryFunction, QueryKey } from "@tanstack/query-core";

//#region src/react/query/queryOptions.d.ts
type UndefinedInitialDataOptions<TQueryFnData = unknown, TError = DefaultError, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey> = UseQueryOptions<TQueryFnData, TError, TData, TQueryKey> & {
  initialData?: undefined | InitialDataFunction<NonUndefinedGuard<TQueryFnData>> | NonUndefinedGuard<TQueryFnData>;
};
type DefinedInitialDataOptions<TQueryFnData = unknown, TError = DefaultError, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey> = Omit<UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>, 'queryFn'> & {
  initialData: NonUndefinedGuard<TQueryFnData> | (() => NonUndefinedGuard<TQueryFnData>);
  queryFn?: QueryFunction<TQueryFnData, TQueryKey>;
};
//#endregion
export { DefinedInitialDataOptions, UndefinedInitialDataOptions };
//# sourceMappingURL=queryOptions.d.ts.map