// frontend/src/app/layout.jsx
"use client";

import "./globals.css";
import AdminHeader from "./_ui/AdminHeader.jsx";
import SessionBanner from "./_ui/SessionBanner.jsx";
import { useEffect } from "react";
import { getAuthMode } from "@/lib/authStorage";

export const metadata = {
  title: "Asora",
  description: "Asora Admin Console",
};

function AuthGate({ children }) {
  useEffect(() => {
    const mode = getAuthMode();
    const path = window.location.pathname || "/";
    const isAuthPage = path.startsWith("/login") || path.startsWith("/auth/callback");

    if (mode === "UNAUTH" && !isAuthPage) {
      window.location.href = "/login";
    }
  }, []);

  return children;
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AdminHeader />
        <SessionBanner />
        <AuthGate>
          <main className="container">{children}</main>
        </AuthGate>
      </body>
    </html>
  );
}
