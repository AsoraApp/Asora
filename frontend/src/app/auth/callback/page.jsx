// frontend/src/app/auth/callback/page.jsx
"use client";

import { useEffect } from "react";
import { setAccessToken } from "@/lib/authStorage";

export default function AuthCallbackPage() {
  useEffect(() => {
    // The Worker callback is proxied through /api/auth/oidc/callback automatically by Pages route handler.
    // But this page exists as the redirect URI target. We
