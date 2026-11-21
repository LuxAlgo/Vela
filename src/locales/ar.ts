// `@luxalgo/vela/locales/ar`: every core message in Arabic. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'ar'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './ar.json';

const ar: LocalePack = { locale: 'ar', direction: 'rtl', messages };

export default ar;
