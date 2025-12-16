const { randomUUID } = require("crypto");

function getOrCreateRequestId(req) {
  const header = req.headers["x-request-id"];
  if (typeof header === "string" && header.trim().length > 0) {
    return header.trim();
  }
  return randomUUID();
}

module.exports = {
  getOrCreateRequestId
};
