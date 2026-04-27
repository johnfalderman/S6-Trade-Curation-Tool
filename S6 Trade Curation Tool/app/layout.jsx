import './globals.css';

export const metadata = {
  title: 'Society6 Curation Tool BETA',
  description: 'Curation tool for the Society6 trade team — wall art, pillows, and beyond',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold tracking-tight text-lg">Society6 Curation Tool</span>
            <span className="text-xs bg-red-600 px-2 py-0.5 rounded text-white font-mono tracking-wider">BETA</span>
          </div>
          <nav className="flex items-center gap-6 text-sm text-gray-400">
            <a href="/" className="hover:text-white transition-colors">New Request</a>
          </nav>
        </header>
        <main className="max-w-screen-xl mx-auto px-4 py-8">
          {children}
        </main>
        {/* Catalog link is intentionally tucked into the footer in muted gray
            so casual users don't accidentally find/use the admin page. This
            is security-through-obscurity — adequate for an internal tool but
            not a real auth boundary. */}
        <footer className="text-center text-xs text-gray-400 py-8 mt-16 border-t border-gray-200">
          Society6 Curation Tool BETA — Internal Use Only
          <span className="text-gray-300"> · </span>
          <a href="/catalog" className="text-gray-400 hover:text-gray-500">Catalog</a>
        </footer>
      </body>
    </html>
  );
}
