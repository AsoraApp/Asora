"use client";

import AdminHeader from "./_ui/AdminHeader.jsx";

export default function AdminShell({ children }) {
  return (
    <>
      <AdminHeader />
      {children}
    </>
  );
}
