// `@luxalgo/vela/locales/it`: every core message in Italian. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'it'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './it.json';

const it: LocalePack = { locale: 'it', messages };

export default it;
