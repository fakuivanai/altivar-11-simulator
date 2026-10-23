// Original shared formatting for Spanish readings and native number inputs.
const spanishNumber = new Intl.NumberFormat('es-AR', {
  maximumSignificantDigits: 3,
  useGrouping: false,
});

function roundedNumber(value: number): number {
  // Suppress floating-point residuals, retaining the smallest admitted circuit values.
  return Math.abs(value) < 1e-12 ? 0 : Number(value.toPrecision(3));
}

export function displayNumber(value: number): string {
  return spanishNumber.format(roundedNumber(value));
}

export function inputNumber(value: number): string {
  return String(roundedNumber(value));
}
