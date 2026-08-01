// Types for lib/core/paging.mjs.
//
// The .mjs file is where the loop lives (so `node --test` can run the shipped
// code against a real database); this is how TypeScript sees it. Without this,
// every import would need `@ts-ignore` and the paging arithmetic would arrive
// at the data layer as `any` — which is precisely the boundary ledger 6.1 spent
// its effort typing.

export declare const POSTGREST_ROW_CAP: 1000;
export declare const PAGE_SIZE: number;
export declare const MAX_PAGES: number;

export declare function pageBounds(page: number, size?: number): { from: number; to: number };
export declare function isLastPage(batchLength: number, size?: number): boolean;
export declare function clampLimit(limit: number): number;

export declare function pageAll<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  options: {
    size?: number;
    maxPages?: number;
    onOverflow: (ceiling: number) => never;
  },
): Promise<T[]>;
