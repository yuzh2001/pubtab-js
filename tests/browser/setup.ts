import { afterEach } from 'vitest';

(globalThis as Record<string, unknown>).__VUE_OPTIONS_API__ = true;
(globalThis as Record<string, unknown>).__VUE_PROD_DEVTOOLS__ = false;
(globalThis as Record<string, unknown>).__VUE_PROD_HYDRATION_MISMATCH_DETAILS__ = false;

afterEach(() => {
  document.body.innerHTML = '';
});
