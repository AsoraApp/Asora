export class AppError extends Error {
  constructor({ status, code, message, details }) {
    super(message || code);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details || null;
  }
}
