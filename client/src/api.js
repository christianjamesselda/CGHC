// In production the Express server hosts both the app and API, so use the
// current site origin. Local development keeps the separate API server.
const API = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:4000/api');
export const API_ORIGIN = new URL(API, window.location.origin).origin;
export function getToken() { return localStorage.getItem('church-token'); }
export async function request(path, options = {}) {
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}), ...options.headers };
  let response;
  try { response = await fetch(`${API}${path}`, { ...options, headers }); }
  catch { throw new Error('The church server is not responding. Start the API server and PostgreSQL, then try again.'); }
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || `Request failed (${response.status})`); }
  return response.headers.get('content-type')?.includes('text/csv') ? response.blob() : response.json();
}
