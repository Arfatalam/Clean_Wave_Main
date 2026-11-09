import { QueryKey, QueryObserverResult } from "@tanstack/query-core";

//#region src/react/query/useBaseQuery.d.ts
type DistributivePick<T, K extends PropertyKey> = T extends unknown ? Pick<T, Extract<K, keyof T>> : never;
type CommonQueryResult = 'data' | 'error' | 'isLoading' | 'isFetching' | 'status';
//#endregion
export { CommonQueryResult, DistributivePick };
//# sourceMappingURL=useBaseQuery.d.ts.map