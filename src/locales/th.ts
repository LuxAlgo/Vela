// `@luxalgo/vela/locales/th`: every core message in Thai. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'th'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './th.json';

const th: LocalePack = { locale: 'th', messages };

export default th;
