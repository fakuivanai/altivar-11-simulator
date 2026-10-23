/** A failed internal contract is a programming error, not invalid user input. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('Invariante del simulador: ' + message);
}
