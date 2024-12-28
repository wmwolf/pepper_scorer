// src/lib/pathUtils.ts

export function getPath(path: string): string {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  
  // Get base URL from environment or fall back to '/'
  const base = import.meta.env.BASE_URL || '/';
  
  // Combine and ensure proper formatting
  return `${base}/${cleanPath}`.replace(/\/+/g, '/');
}

// Usage example:
// Instead of window.location.href = '/game'
// Use: window.location.href = getPath('game')