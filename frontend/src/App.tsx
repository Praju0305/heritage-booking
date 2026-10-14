import { useState } from 'react';
import { useAuth } from './auth/AuthContext';
import AuthPage from './pages/AuthPage';
import BookingPage from './pages/BookingPage';
import AdminDashboard from './pages/AdminDashboard';

export default function App() {
  const { user, loading, logout } = useAuth();
  const [tab, setTab] = useState<'book' | 'admin'>('book');

  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <AuthPage />;

  // The tab is a UX convenience only; the API enforces admin rights from the database role.
  const isAdmin = user.role === 'admin';

  return (
    <>
      <header className="topbar">
        <strong className="brand">Heritage Booking</strong>
        <nav className="tabs">
          <button className={tab === 'book' ? 'active' : ''} onClick={() => setTab('book')}>
            Book tickets
          </button>
          {isAdmin && (
            <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>
              Admin dashboard
            </button>
          )}
        </nav>
        <div className="row gap">
          <span className="muted small">{user.name}{isAdmin ? ' (admin)' : ''}</span>
          <button className="btn link" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <main className="container">{tab === 'admin' && isAdmin ? <AdminDashboard /> : <BookingPage />}</main>
    </>
  );
}
