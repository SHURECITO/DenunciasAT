'use client';

export default function LogoutButton() {
  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.replace('/login');
  }

  return (
    <button
      onClick={handleLogout}
      className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
    >
      Cerrar sesión
    </button>
  );
}
