import './globals.css';

export const metadata = {
  title: 'S6 Trade Curation Tool',
  description: 'Internal wall art curation tool for Society6 trade team',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold tracking-tight text-lg">S6 Trade Curation</span>
            <span className="text-xs bg-gray-700 px-2 py-0.5 rounded text-gray-300 font-mono">internal</span>
          </div>
          <nav className="flex items-center gap-6 text-sm text-gray-400">
            <a href="/" className="hover:text-white transition-colors">New Request</a>
            <a href="/catalog" className="hover:text-white transition-colors">Catalog</a>
          </nav>
        </header>
        <main className="max-w-screen-xl mx-auto px-4 py-8">
          {children}
        </main>
        <footer className="text-center text-xs text-gray-400 py-8 mt-16 border-t border-gray-200">
          Society6 Trade Curation Tool — Internal Use Only
        </footer>
      </body>
    </html>
  );
}
