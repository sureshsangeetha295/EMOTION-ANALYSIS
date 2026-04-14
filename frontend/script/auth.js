const Auth = (() => {

  const KEYS = {
    access:  'ea_access_token',
    refresh: 'ea_refresh_token',
    user:    'ea_user',
  };

  // Storage helpers

  function saveTokens(access, refresh) {
    localStorage.setItem(KEYS.access,  access);
    localStorage.setItem(KEYS.refresh, refresh);
  }

  function getAccessToken()  { return localStorage.getItem(KEYS.access);  }
  function getRefreshToken() { return localStorage.getItem(KEYS.refresh); }

  function saveUser(user) { localStorage.setItem(KEYS.user, JSON.stringify(user)); }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(KEYS.user)); }
    catch { return null; }
  }

  function clearAll() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    document.cookie = 'ea_session=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;';
  }

  // Token helpers 

  function isTokenExpired(token) {
    try {
      // JWT payload is the second segment, base64url-encoded
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(b64));
      // Treat as expired 60s before actual expiry to give refresh time
      return Date.now() / 1000 >= payload.exp - 60;
    } catch {
      return true; // Malformed token → treat as expired
    }
  }

  function isLoggedIn() {
    const access = getAccessToken();
    if (!access) return false;
    // FIX: also check the token is not permanently invalid (malformed)
    try {
      const b64 = access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      JSON.parse(atob(b64)); // Will throw if malformed
      return true;
    } catch {
      clearAll();
      return false;
    }
  }

  //  Token refresh 

  let _refreshPromise = null; // Deduplicate concurrent refresh calls

  async function refreshAccessToken() {
    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = (async () => {
      const refresh = getRefreshToken();
      if (!refresh) {
        clearAll();
        throw new Error('No refresh token — please log in again.');
      }

      const res = await fetch('/auth/refresh', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refresh_token: refresh }),
      });

      if (!res.ok) {
        clearAll();
        // FIX: Redirect to login with reason so user knows why
        window.location.href = '/login?reason=session_expired';
        throw new Error('Session expired. Please log in again.');
      }

      const data = await res.json();
      saveTokens(data.access_token, data.refresh_token);
      return data.access_token;
    })();

    
    _refreshPromise = _refreshPromise.finally(() => { _refreshPromise = null; });
    return _refreshPromise;
  }


  async function apiFetch(url, options = {}) {
    let token = getAccessToken();

    if (token && isTokenExpired(token)) {
      try {
        token = await refreshAccessToken();
      } catch {
        throw new Error('Session expired');
      }
    }

    if (!token) {
      clearAll();
      window.location.href = '/login';
      throw new Error('Not authenticated');
    }

    const headers = { ...(options.headers || {}) };

    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401) {
      try {
        token = await refreshAccessToken();
        headers['Authorization'] = `Bearer ${token}`;
        return fetch(url, { ...options, headers });
      } catch {
        throw new Error('Session expired');
      }
    }

    return res;
  }

  // Login 

  async function login(username, password) {
    const body = new URLSearchParams({ username, password });
    const res  = await fetch('/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Incorrect username or password');
    }

    const data = await res.json();
    saveTokens(data.access_token, data.refresh_token);

    const meRes = await fetch('/auth/me', {
      headers: { 'Authorization': `Bearer ${data.access_token}` },
    });

    if (meRes.ok) {
      const meData = await meRes.json();
      saveUser(meData);
      return meData;
    }

    return { username };
  }

  // Register

  async function register(username, email, password) {
    const res = await fetch('/auth/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, email, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Registration failed');
    }

    return res.json();
  }

  // Logout 

  async function logout() {
    const refresh = getRefreshToken();
    if (refresh) {
      fetch('/auth/logout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refresh_token: refresh }),
      }).catch(() => {});
    }
    clearAll();
    window.location.href = '/login';
  }

  //  Guards 

  function requireAuth() {
    if (!isLoggedIn()) {
      window.location.href = '/login';
      return false;
    }
    return true;
  }

  function redirectIfLoggedIn() {
    if (isLoggedIn()) {
      window.location.href = '/home';
    }
  }

  return {
    login, register, logout,
    isLoggedIn, requireAuth, redirectIfLoggedIn,
    getUser, getAccessToken,
    apiFetch,
    saveTokens, clearAll,
  };

})();
