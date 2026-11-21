// `@luxalgo/vela/locales/ru`: every core message in Russian. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'ru'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './ru.json';

const ru: LocalePack = { locale: 'ru', messages };

export default ru;
