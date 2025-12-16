import { AppError } from "../errors/AppError.js";

export function errorHandler(err, req, res, next) {
  const isApp = err instanceof AppError;

  const status = isApp ? err.status : 500;
  const code = isApp ? err.code : "INTERNAL_ERROR";

  return res.status(status).json({
    ok: false,
    errorCode: code,
    message: isApp ? err.message : "Internal server error.",
    details: isApp ? err.details : null,
  });
}
