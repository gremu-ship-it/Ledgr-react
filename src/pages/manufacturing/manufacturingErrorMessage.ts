export function manufacturingErrorMessage(error: unknown, translate: (key: string) => unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith('manufacturing.errors.') ? String(translate(message)) : message;
}
