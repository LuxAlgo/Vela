// `@luxalgo/vela/locales/de`: every core message in German. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'de'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './de.json';

const de: LocalePack = { locale: 'de', messages };

export default de;
