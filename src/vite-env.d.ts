/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHECKOUT_MONTHLY_URL?: string;
  readonly VITE_CHECKOUT_YEARLY_URL?: string;
  readonly VITE_CHECKOUT_LIFETIME_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
