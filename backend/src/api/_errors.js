// backend/src/api/_errors.js
"use strict";

function isPlainObject(v) {
  return !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
}

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function err(res, statusCode, error, code, details) {
  let d = null;
  if (details === null || details === undefined) d = null;
  else if (isPlainObject(details)) d = details;
  else d = { info: String(details) }; // never a string
  return json(res, statusCode, { error, code, details: d });
}

function badRequest(res, code, details) {
  return err(res, 400, "BAD_REQUEST", code, details);
}
function unauthorized(res, code, details) {
  return err(res, 401, "UNAUTHORIZED", code, details);
}
function forbidden(res, code, details) {
  return err(res, 403, "FORBIDDEN", code, details);
}
function notFound(res, code, details) {
  return err(res, 404, "NOT_FOUND", code, details);
}
function conflict(res, code, details) {
  return err(res, 409, "CONFLICT", code, details);
}
function methodNotAllowed(res, code, details) {
  return err(res, 405, "METHOD_NOT_ALLOWED", code, details);
}

module.exports = {
  json,
  err,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  methodNotAllowed,
};
