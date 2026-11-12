/** A readable message for anything that was thrown (an Error or not). */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
