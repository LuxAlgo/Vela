// `@luxalgo/vela/locales/es`: every core message in Spanish. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'es'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './es.json';

const es: LocalePack = { locale: 'es', messages };

export default es;
