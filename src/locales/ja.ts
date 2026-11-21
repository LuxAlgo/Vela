// `@luxalgo/vela/locales/ja`: every core message in Japanese. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'ja'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './ja.json';

const ja: LocalePack = { locale: 'ja', messages };

export default ja;
