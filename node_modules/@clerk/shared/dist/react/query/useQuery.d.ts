import { DefinedUseQueryResult, UseQueryOptions, UseQueryResult } from "./types.js";
import { DefinedInitialDataOptions, UndefinedInitialDataOptions } from "./queryOptions.js";
import { CommonQueryResult, DistributivePick } from "./useBaseQuery.js";
import { DefaultError, QueryKey } from "@tanstack/query-core";

//#region src/react/query/useQuery.d.ts
declare function useClerkQuery<TQueryFnData = unknown, TError = DefaultError, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey>(options: DefinedInitialDataOptions<TQueryFnData, TError, TData, TQueryKey>): DistributivePick<DefinedUseQueryResult<NoInfer<TData>, TError>, CommonQueryResult>;
declare function useClerkQuery<TQueryFnData = unknown, TError = DefaultError, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey>(options: UndefinedInitialDataOptions<TQueryFnData, TError, TData, TQueryKey>): DistributivePick<UseQueryResult<NoInfer<TData>, TError>, CommonQueryResult>;
declare function useClerkQuery<TQueryFnData = unknown, TError = DefaultError, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey>(options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>): DistributivePick<UseQueryResult<NoInfer<TData>, TError>, CommonQueryResult>;
//#endregion
export { useClerkQuery };
//# sourceMappingURL=useQuery.d.ts.map