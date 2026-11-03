export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const badRequest = (message: string) =>
  new AppError(400, 'INVALID_INPUT', message);
export const conflict = (message: string) =>
  new AppError(409, 'REVISION_CONFLICT', message);
