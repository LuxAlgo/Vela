// `@luxalgo/vela/locales/he`: every core message in Hebrew. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'he'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './he.json';

const he: LocalePack = { locale: 'he', direction: 'rtl', messages };

export default he;
