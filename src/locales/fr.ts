// `@luxalgo/vela/locales/fr`: every core message in French. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'fr'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './fr.json';

const fr: LocalePack = { locale: 'fr', messages };

export default fr;
