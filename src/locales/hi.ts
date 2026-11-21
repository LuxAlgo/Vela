// `@luxalgo/vela/locales/hi`: every core message in Hindi. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'hi'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './hi.json';

const hi: LocalePack = { locale: 'hi', messages };

export default hi;
