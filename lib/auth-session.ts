export const MINIAPP_WALLET_COOKIE = "miniapp_wallet";
export const MINIAPP_WALLET_EXPIRES_COOKIE = "miniapp_wallet_exp";
export const SIWE_NONCE_COOKIE = "siwe";
export const MINIAPP_SESSION_MAX_AGE_SECONDS = 60 * 5;

type CookieStoreLike = {
  get(name: string): { value?: string } | undefined;
};

type CookieMutatorLike = {
  delete(name: string): void;
};

export function readMiniAppWalletSession(cookieStore: CookieStoreLike): {
  walletAddress: string | null;
  expiresAtMs: number | null;
  expired: boolean;
} {
  const walletAddress = String(cookieStore.get(MINIAPP_WALLET_COOKIE)?.value ?? "").trim();
  const expiresRaw = String(cookieStore.get(MINIAPP_WALLET_EXPIRES_COOKIE)?.value ?? "").trim();
  const expiresAtMs = Number(expiresRaw);
  const hasValidExpiry = Number.isFinite(expiresAtMs) && expiresAtMs > 0;
  const expired = !hasValidExpiry || expiresAtMs <= Date.now();

  if (!walletAddress || expired) {
    return { walletAddress: null, expiresAtMs: hasValidExpiry ? expiresAtMs : null, expired };
  }

  return { walletAddress, expiresAtMs, expired: false };
}

export function clearMiniAppWalletCookies(cookies: CookieMutatorLike) {
  cookies.delete(MINIAPP_WALLET_COOKIE);
  cookies.delete(MINIAPP_WALLET_EXPIRES_COOKIE);
  cookies.delete(SIWE_NONCE_COOKIE);
}
