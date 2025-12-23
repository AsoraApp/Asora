import "./globals.css";
import AdminHeader from "./_ui/AdminHeader.jsx";
import SessionBanner from "./_ui/SessionBanner.jsx";
import AuthGate from "./_ui/AuthGate.jsx";

export const metadata = {
  title: "Asora",
  description: "Asora Admin Console",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthGate>
          <AdminHeader />
          <SessionBanner />
          <main className="container">{children}</main>
        </AuthGate>
      </body>
    </html>
  );
}
