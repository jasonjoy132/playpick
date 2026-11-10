// 로그인 상태 + 찜 상태(화면 전체에서 공유)
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [wishOverrides, setWishOverrides] = useState({}); // gameId → bool (이번 방문에서 바꾼 값)
  const [wishCount, setWishCount] = useState(null);

  const refreshWishCount = useCallback(async () => {
    try {
      setWishCount((await api.wishlist()).items.length);
    } catch {
      setWishCount(null);
    }
  }, []);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (user) refreshWishCount();
    else setWishCount(null);
  }, [user?.id, refreshWishCount]);

  // 내 정보 다시 받기 (새 칭호 알림 등). 다른 탭에 갔다 오면 30초에 한 번까지
  const refreshUser = useCallback(() => api.me().then((r) => setUser(r.user)).catch(() => {}), []);
  useEffect(() => {
    let last = Date.now();
    const onFocus = () => {
      if (document.visibilityState === 'hidden' || Date.now() - last < 30_000) return;
      last = Date.now();
      refreshUser();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refreshUser]);

  const login = useCallback(async (loginId, password) => {
    const r = await api.login({ loginId, password });
    setWishOverrides({});
    setUser(r.user);
    return r.user;
  }, []);
  const signup = useCallback(async (form) => {
    const r = await api.signup(form);
    setWishOverrides({});
    setUser(r.user);
    return r.user;
  }, []);
  /** 소셜 가입 마치기(닉네임) */
  const completeSocial = useCallback(async (form) => {
    const r = await api.oauthComplete(form);
    setWishOverrides({});
    setUser(r.user);
    return r;
  }, []);
  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setWishOverrides({});
    }
  }, []);

  const isWished = useCallback((game) => (game.id in wishOverrides ? wishOverrides[game.id] : Boolean(game.wished)), [wishOverrides]);
  const toggleWish = useCallback(
    async (game) => {
      const next = !isWished(game);
      setWishOverrides((o) => ({ ...o, [game.id]: next }));
      try {
        if (next) await api.wish(game.id);
        else await api.unwish(game.id);
        setWishCount((c) => (c == null ? c : c + (next ? 1 : -1)));
      } catch (e) {
        setWishOverrides((o) => ({ ...o, [game.id]: !next })); // 실패하면 되돌림
        throw e;
      }
    },
    [isWished],
  );

  return (
    <AuthCtx.Provider value={{ user, ready, login, signup, completeSocial, logout, isWished, toggleWish, wishCount, refreshWishCount, setUser, refreshUser }}>{children}</AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
