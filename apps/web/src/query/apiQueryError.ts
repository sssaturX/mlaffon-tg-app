import type { ApiErr, ApiOk, ApiResult } from "../api";

export class ApiQueryError extends Error {
  readonly apiErr: ApiErr;

  constructor(apiErr: ApiErr) {
    super("api_error");
    this.name = "ApiQueryError";
    this.apiErr = apiErr;
  }
}

export function throwIfApiErr<T>(r: ApiResult<T>): asserts r is ApiOk<T> {
  if (!r.ok) {
    throw new ApiQueryError(r);
  }
}
