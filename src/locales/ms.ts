// `@luxalgo/vela/locales/ms`: every core message in Malay. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'ms'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './ms.json';

const ms: LocalePack = { locale: 'ms', messages };

export default ms;
