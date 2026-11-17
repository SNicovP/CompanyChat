/** The newer of two ISO timestamps: a person's "read up to" time only ever moves forward. */
export const laterOf = (a: string | undefined, b: string): string => (a && a > b ? a : b)
