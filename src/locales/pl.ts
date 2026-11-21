// `@luxalgo/vela/locales/pl`: every core message in Polish. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'pl'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './pl.json';

const pl: LocalePack = { locale: 'pl', messages };

export default pl;
