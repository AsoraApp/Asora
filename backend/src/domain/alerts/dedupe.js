export function dedupeKey(tenantId, ruleId, conditionKey) {
  const raw = `${tenantId}|${ruleId}|${conditionKey}`;
  // sha256 using WebCrypto
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)).then((buf) => {
    const bytes = new Uint8Array(buf);
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return hex;
  });
}
