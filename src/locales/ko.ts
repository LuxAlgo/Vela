// `@luxalgo/vela/locales/ko`: every core message in Korean. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'ko'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './ko.json';

const ko: LocalePack = { locale: 'ko', messages };

export default ko;
