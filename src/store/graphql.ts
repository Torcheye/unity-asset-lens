import type { HttpClient } from "./http.js";
import type { StoreSession } from "./csrf.js";
import { GRAPHQL_BATCH_URL } from "./constants.js";

/**
 * Low-level client for the batched GraphQL endpoint (spec §3.4).
 * The request body is an array of operations; the response is a parallel array.
 */

export interface GraphqlOperationResult<T = unknown> {
  readonly data?: T;
  readonly errors?: ReadonlyArray<{ message: string }>;
}

export interface StoreClient {
  /** Run one operation through the batch endpoint and return its result. */
  operation<T>(
    operationName: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<GraphqlOperationResult<T>>;
}

export function createStoreClient(
  http: HttpClient,
  session: StoreSession,
): StoreClient {
  return {
    async operation<T>(
      operationName: string,
      query: string,
      variables: Record<string, unknown>,
    ): Promise<GraphqlOperationResult<T>> {
      const body = JSON.stringify([{ query, variables, operationName }]);
      const res = await http(GRAPHQL_BATCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-requested-with": "XMLHttpRequest",
          "x-source": "storefront",
          operations: operationName,
          "x-csrf-token": session.csrfToken,
          Cookie: session.cookie,
        },
        body,
      });
      if (!res.ok) {
        throw new Error(`GraphQL ${operationName} failed: HTTP ${res.status}`);
      }
      const parsed = (await res.json()) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error(
          `GraphQL ${operationName}: expected a non-empty batch array response.`,
        );
      }
      const first = parsed[0] as GraphqlOperationResult<T>;
      if (first.errors && first.errors.length > 0) {
        throw new Error(
          `GraphQL ${operationName} errors: ${first.errors
            .map((e) => e.message)
            .join("; ")}`,
        );
      }
      return first;
    },
  };
}
