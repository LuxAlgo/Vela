// `@luxalgo/vela/locales/tr`: every core message in Turkish. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'tr'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './tr.json';

const tr: LocalePack = { locale: 'tr', messages };

export default tr;
