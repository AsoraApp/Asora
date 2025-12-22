import "./globals.css";
import AdminHeader from "./_ui/AdminHeader.jsx";

export const metadata = {
  title: "Asora",
  description: "Asora Admin Console",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AdminHeader />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
